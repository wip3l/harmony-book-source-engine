// Copyright (c) 2026 legado-harmony contributors
// SPDX-License-Identifier: MIT

#include "script_session.h"
#include "quickjs_headers.h"

#include <pthread.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;
constexpr size_t MAX_BINARY_BYTES = 20 * 1024 * 1024;

struct EvalJob {
    int64_t id = 0;
    int64_t generation = 0;
    std::string code;
    std::string name;
    int cpuTimeoutMs = 1000;
    bool binary = false;
    std::vector<uint8_t> bytes;
};

struct EvalOutcome {
    bool success = false;
    std::string value;
    std::string error;
    bool timedOut = false;
    bool cancelled = false;
    double cpuMs = 0;
    double wallMs = 0;
    double hostWaitMs = 0;
    int hostCalls = 0;
    bool binary = false;
    std::vector<uint8_t> bytes;
};

enum class MessageKind { HostCall, EvalDone };

struct Message {
    MessageKind kind = MessageKind::HostCall;
    int64_t sessionId = 0;
    int64_t id = 0;
    std::string name;
    std::string payload;
    EvalOutcome outcome;
    bool binary = false;
    std::vector<uint8_t> bytes;
};

struct PendingCall {
    bool done = false;
    bool ok = false;
    std::string payload;
    std::vector<uint8_t> bytes;
};

/**
 * State that only the ArkTS thread touches. It is owned by the thread-safe function and freed in
 * its finalizer, so messages still queued after the session object is gone remain deliverable.
 */
struct MainSide {
    int64_t sessionId = 0;
    std::unordered_map<int64_t, napi_deferred> deferreds;
};

class ScriptSession;

std::mutex g_registryMutex;
std::unordered_map<int64_t, std::shared_ptr<ScriptSession>> g_sessions;
int64_t g_nextSessionId = 1;

std::shared_ptr<ScriptSession> FindSession(int64_t id)
{
    std::lock_guard<std::mutex> lock(g_registryMutex);
    auto it = g_sessions.find(id);
    return it == g_sessions.end() ? nullptr : it->second;
}

std::string ToStdString(JSContext* ctx, JSValueConst value)
{
    size_t length = 0;
    const char* raw = JS_ToCStringLen(ctx, &length, value);
    if (!raw) return "";
    std::string text(raw, length);
    JS_FreeCString(ctx, raw);
    return text;
}

JSValue ThrowError(JSContext* ctx, const std::string& message)
{
    JSValue error = JS_NewError(ctx);
    JS_SetPropertyStr(ctx, error, "message", JS_NewStringLen(ctx, message.data(), message.size()));
    return JS_Throw(ctx, error);
}

std::string TakeException(JSContext* ctx)
{
    JSValue exception = JS_GetException(ctx);
    std::string message = ToStdString(ctx, exception);
    if (JS_IsObject(exception)) {
        JSValue stack = JS_GetPropertyStr(ctx, exception, "stack");
        if (!JS_IsUndefined(stack) && !JS_IsNull(stack)) {
            std::string stackText = ToStdString(ctx, stack);
            if (!stackText.empty() && stackText != message) {
                if (!message.empty()) message += "\n";
                message += stackText;
            }
        }
        JS_FreeValue(ctx, stack);
    }
    JS_FreeValue(ctx, exception);
    return message.empty() ? "script error" : message;
}

/** Strings pass through as-is, undefined becomes "", everything else is JSON. */
bool ValueToText(JSContext* ctx, JSValueConst value, std::string& out)
{
    if (JS_IsUndefined(value)) {
        out.clear();
        return true;
    }
    if (JS_IsString(value)) {
        out = ToStdString(ctx, value);
        return true;
    }
    JSValue json = JS_JSONStringify(ctx, value, JS_UNDEFINED, JS_UNDEFINED);
    if (JS_IsException(json)) return false;
    out = JS_IsUndefined(json) ? ToStdString(ctx, value) : ToStdString(ctx, json);
    JS_FreeValue(ctx, json);
    return true;
}

// Copy only the visible byte view. No JSON expansion and no pointer outlives its QuickJS value.
bool ValueToBytes(JSContext* ctx, JSValueConst value, std::vector<uint8_t>& out)
{
    size_t size = 0;
    uint8_t* data = JS_GetArrayBuffer(ctx, &size, value);
    JSValue buffer = JS_UNDEFINED;
    if (!data) {
        JSValue error = JS_GetException(ctx);
        const bool emptyBuffer = size == 0 && (JS_IsNull(error) || JS_IsUndefined(error));
        JS_FreeValue(ctx, error);
        if (emptyBuffer) { out.clear(); return true; }
        size_t offset = 0, elementSize = 0;
        buffer = JS_GetTypedArrayBuffer(ctx, value, &offset, &size, &elementSize);
        if (JS_IsException(buffer)) return false;
        size_t bufferSize = 0;
        data = JS_GetArrayBuffer(ctx, &bufferSize, buffer);
        bool validBuffer = data != nullptr;
        if (!data) {
            JSValue error = JS_GetException(ctx);
            validBuffer = bufferSize == 0 && (JS_IsNull(error) || JS_IsUndefined(error));
            JS_FreeValue(ctx, error);
        }
        if (!validBuffer || elementSize != 1 || offset > bufferSize || size > bufferSize - offset) {
            JS_FreeValue(ctx, buffer);
            JS_ThrowTypeError(ctx, "image result must be an ArrayBuffer or an 8-bit typed array");
            return false;
        }
        if (data) data += offset;
    }
    if (size > MAX_BINARY_BYTES) {
        JS_FreeValue(ctx, buffer);
        JS_ThrowRangeError(ctx, "image bytes exceed 20 MiB");
        return false;
    }
    out.clear();
    if (size) out.assign(data, data + size);
    JS_FreeValue(ctx, buffer);
    return true;
}

double Millis(Clock::duration duration)
{
    return std::chrono::duration<double, std::milli>(duration).count();
}

class ScriptSession : public std::enable_shared_from_this<ScriptSession> {
public:
    ScriptSession(int64_t id, size_t memoryLimit, size_t stackLimit, int hostTimeoutMs)
        : id_(id), memoryLimit_(memoryLimit), stackLimit_(stackLimit), hostTimeoutMs_(hostTimeoutMs) {}

    int64_t id() const { return id_; }
    napi_threadsafe_function tsfn() const { return tsfn_; }
    MainSide* mainSide() const { return mainSide_; }
    void attach(napi_threadsafe_function tsfn, MainSide* side)
    {
        tsfn_ = tsfn;
        mainSide_ = side;
    }

    bool start()
    {
        pthread_attr_t attr;
        if (pthread_attr_init(&attr) != 0) return false;
        // musl's default thread stack is small; QuickJS's own limit must stay well inside it.
        const size_t threadStack = std::max<size_t>(stackLimit_ + 1024 * 1024, 2 * 1024 * 1024);
        pthread_attr_setstacksize(&attr, threadStack);
        pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
        auto* holder = new std::shared_ptr<ScriptSession>(shared_from_this());
        pthread_t thread;
        const int created = pthread_create(&thread, &attr, &ScriptSession::ThreadMain, holder);
        pthread_attr_destroy(&attr);
        if (created != 0) {
            delete holder;
            return false;
        }
        return true;
    }

    void enqueue(EvalJob job)
    {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            job.generation = cancelGeneration_.load();
            jobs_.push_back(std::move(job));
        }
        cv_.notify_all();
    }

    bool resolve(int64_t callId, bool ok, std::string payload, std::vector<uint8_t> bytes = {})
    {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            auto it = calls_.find(callId);
            if (it == calls_.end()) return false;
            it->second.done = true;
            it->second.ok = ok;
            it->second.payload = std::move(payload);
            it->second.bytes = std::move(bytes);
        }
        cv_.notify_all();
        return true;
    }

    /** Aborts the running job and every job queued before this call. */
    void cancel()
    {
        {
            // Change the flag under the lock so a waiter between its predicate check and its wait
            // cannot miss the notification.
            std::lock_guard<std::mutex> lock(mutex_);
            cancelGeneration_.fetch_add(1);
        }
        cv_.notify_all();
    }

    void close()
    {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            closing_.store(true);
        }
        cancel();
    }

    /** Called from the script thread through the `__host` global. */
    JSValue callHost(JSContext* ctx, const std::string& name, const std::string& payload,
        const std::vector<uint8_t>* bytes = nullptr)
    {
        if (aborted()) return ThrowError(ctx, "script cancelled");
        if (currentBinary_ && !bytes) return ThrowError(ctx, "image scripts cannot call the stage host");
        if (bytes && (!currentBinary_ || ++binaryCalls_ > 16 ||
            (binaryBytes_ += bytes->size()) > 80 * 1024 * 1024)) {
            return ThrowError(ctx, "image crypto call budget exceeded");
        }
        int64_t callId = 0;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            callId = nextCallId_++;
            calls_[callId] = PendingCall();
        }
        auto* message = new Message();
        message->kind = MessageKind::HostCall;
        message->sessionId = id_;
        message->id = callId;
        message->name = name;
        message->payload = payload;
        message->binary = bytes != nullptr;
        if (bytes) message->bytes = *bytes;
        if (napi_call_threadsafe_function(tsfn_, message, napi_tsfn_nonblocking) != napi_ok) {
            delete message;
            std::lock_guard<std::mutex> lock(mutex_);
            calls_.erase(callId);
            return ThrowError(ctx, "host unavailable");
        }

        const auto waitStarted = Clock::now();
        PendingCall call;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            cv_.wait_until(lock, waitStarted + std::chrono::milliseconds(hostTimeoutMs_), [&]() {
                return calls_[callId].done || aborted();
            });
            call = std::move(calls_[callId]);
            calls_.erase(callId);
        }
        const auto waited = Clock::now() - waitStarted;
        // Waiting for the host is not script CPU time.
        deadline_ += waited;
        hostWait_ += waited;
        hostCalls_++;

        if (!call.done) {
            if (aborted()) return ThrowError(ctx, "script cancelled");
            return ThrowError(ctx, "host call timed out: " + name);
        }
        if (!call.ok) return ThrowError(ctx, call.payload.empty() ? "host call failed: " + name : call.payload);
        if (bytes) {
            if (aborted()) return ThrowError(ctx, "script cancelled");
            if ((binaryBytes_ += call.bytes.size()) > 80 * 1024 * 1024) return ThrowError(ctx, "image crypto byte budget exceeded");
            return JS_NewArrayBufferCopy(ctx, call.bytes.data(), call.bytes.size());
        }
        return JS_NewStringLen(ctx, call.payload.data(), call.payload.size());
    }

private:
    static void* ThreadMain(void* arg)
    {
        auto* holder = static_cast<std::shared_ptr<ScriptSession>*>(arg);
        std::shared_ptr<ScriptSession> self = *holder;
        delete holder;
        self->run();
        return nullptr;
    }

    static int Interrupt(JSRuntime* runtime, void* opaque)
    {
        (void)runtime;
        auto* self = static_cast<ScriptSession*>(opaque);
        if (self->aborted()) {
            self->currentCancelled_ = true;
            return 1;
        }
        if (Clock::now() >= self->deadline_) {
            self->currentTimedOut_ = true;
            return 1;
        }
        return 0;
    }

    static JSValue HostFunction(JSContext* ctx, JSValueConst thisValue, int argc, JSValueConst* argv)
    {
        (void)thisValue;
        auto* self = static_cast<ScriptSession*>(JS_GetContextOpaque(ctx));
        if (!self || argc < 1) return ThrowError(ctx, "__host(name, payload) needs a name");
        const std::string name = ToStdString(ctx, argv[0]);
        std::string payload;
        if (argc > 1 && !JS_IsUndefined(argv[1]) && !JS_IsNull(argv[1])) payload = ToStdString(ctx, argv[1]);
        return self->callHost(ctx, name, payload);
    }

    static JSValue BinaryHostFunction(JSContext* ctx, JSValueConst thisValue, int argc, JSValueConst* argv)
    {
        auto* self = static_cast<ScriptSession*>(JS_GetContextOpaque(ctx));
        if (!self || argc != 3) return ThrowError(ctx, "image crypto needs name, bytes and options");
        std::vector<uint8_t> bytes;
        if (!ValueToBytes(ctx, argv[1], bytes)) return JS_EXCEPTION;
        const std::string name = ToStdString(ctx, argv[0]);
        const std::string payload = ToStdString(ctx, argv[2]);
        if (name.size() > 32 || payload.size() > 16384) return ThrowError(ctx, "image crypto options too large");
        return self->callHost(ctx, name, payload, &bytes);
    }

    bool aborted() const
    {
        return closing_.load() || cancelGeneration_.load() > currentGeneration_;
    }

    void run()
    {
        JSRuntime* runtime = JS_NewRuntime();
        JSContext* ctx = runtime ? JS_NewContext(runtime) : nullptr;
        if (ctx) {
            JS_SetMemoryLimit(runtime, memoryLimit_);
            JS_SetMaxStackSize(runtime, stackLimit_);
            JS_SetContextOpaque(ctx, this);
            JS_SetInterruptHandler(runtime, &ScriptSession::Interrupt, this);
            JSValue global = JS_GetGlobalObject(ctx);
            JS_SetPropertyStr(ctx, global, "__host", JS_NewCFunction(ctx, &ScriptSession::HostFunction, "__host", 2));
            JS_SetPropertyStr(ctx, global, "__imageHost", JS_NewCFunction(ctx, &ScriptSession::BinaryHostFunction, "__imageHost", 3));
            JS_FreeValue(ctx, global);
        }

        while (true) {
            EvalJob job;
            {
                std::unique_lock<std::mutex> lock(mutex_);
                cv_.wait(lock, [&]() { return closing_.load() || !jobs_.empty(); });
                if (closing_.load()) break;
                job = std::move(jobs_.front());
                jobs_.pop_front();
            }
            EvalOutcome outcome;
            if (!ctx) {
                outcome.error = "failed to create QuickJS runtime";
            } else {
                outcome = evaluate(runtime, ctx, job);
            }
            post(MessageKind::EvalDone, job.id, std::move(outcome));
        }

        std::deque<EvalJob> left;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            left.swap(jobs_);
        }
        for (const EvalJob& job : left) {
            EvalOutcome outcome;
            outcome.cancelled = true;
            outcome.error = "script session released";
            post(MessageKind::EvalDone, job.id, outcome);
        }
        if (ctx) JS_FreeContext(ctx);
        if (runtime) JS_FreeRuntime(runtime);
        napi_release_threadsafe_function(tsfn_, napi_tsfn_release);
    }

    EvalOutcome evaluate(JSRuntime* runtime, JSContext* ctx, const EvalJob& job)
    {
        EvalOutcome outcome;
        outcome.binary = job.binary;
        currentBinary_ = job.binary;
        binaryCalls_ = 0;
        binaryBytes_ = 0;
        currentGeneration_ = job.generation;
        currentCancelled_ = false;
        currentTimedOut_ = false;
        hostWait_ = Clock::duration::zero();
        hostCalls_ = 0;
        const auto startedAt = Clock::now();
        deadline_ = startedAt + std::chrono::milliseconds(job.cpuTimeoutMs);

        if (aborted()) {
            outcome.cancelled = true;
            outcome.error = "script cancelled";
            return outcome;
        }

        bool inputReady = true;
        if (job.binary) {
            JSValue global = JS_GetGlobalObject(ctx);
            JSValue input = JS_NewArrayBufferCopy(ctx, job.bytes.data(), job.bytes.size());
            inputReady = !JS_IsException(input);
            if (inputReady) inputReady = JS_SetPropertyStr(ctx, global, "__imageInput", input) >= 0;
            JS_FreeValue(ctx, global);
        }
        JSValue value = inputReady ? JS_Eval(ctx, job.code.c_str(), job.code.size(), job.name.c_str(), JS_EVAL_TYPE_GLOBAL) : JS_EXCEPTION;
        bool success = !JS_IsException(value);
        std::string error;
        if (!success) error = TakeException(ctx);

        while (success) {
            JSContext* jobContext = nullptr;
            const int executed = JS_ExecutePendingJob(runtime, &jobContext);
            if (executed == 0) break;
            if (executed < 0) {
                success = false;
                error = TakeException(jobContext ? jobContext : ctx);
            }
        }

        if (success && JS_IsPromise(ctx, value)) {
            const JSPromiseStateEnum state = JS_PromiseState(ctx, value);
            if (state == JS_PROMISE_FULFILLED) {
                JSValue settled = JS_PromiseResult(ctx, value);
                JS_FreeValue(ctx, value);
                value = settled;
            } else if (state == JS_PROMISE_REJECTED) {
                JSValue reason = JS_PromiseResult(ctx, value);
                error = ToStdString(ctx, reason);
                JS_FreeValue(ctx, reason);
                success = false;
            } else {
                error = "promise did not settle; scripts cannot wait for timers";
                success = false;
            }
        }

        if (success && !(job.binary ? ValueToBytes(ctx, value, outcome.bytes) : ValueToText(ctx, value, outcome.value))) {
            success = false;
            error = TakeException(ctx);
        }
        JS_FreeValue(ctx, value);
        if (job.binary) {
            JSValue global = JS_GetGlobalObject(ctx);
            JS_SetPropertyStr(ctx, global, "__imageInput", JS_UNDEFINED);
            JS_FreeValue(ctx, global);
        }
        JS_RunGC(runtime);

        const auto wall = Clock::now() - startedAt;
        outcome.wallMs = Millis(wall);
        outcome.hostWaitMs = Millis(hostWait_);
        outcome.cpuMs = std::max(0.0, outcome.wallMs - outcome.hostWaitMs);
        outcome.hostCalls = hostCalls_;
        outcome.timedOut = currentTimedOut_ || Clock::now() >= deadline_;
        outcome.cancelled = currentCancelled_ || aborted();
        outcome.success = success && !outcome.timedOut && !outcome.cancelled;
        if (outcome.timedOut) {
            outcome.error = "script CPU time limit exceeded";
        } else if (outcome.cancelled) {
            outcome.error = "script cancelled";
        } else if (!outcome.success) {
            outcome.error = error;
        }
        return outcome;
    }

    void post(MessageKind kind, int64_t id, EvalOutcome outcome)
    {
        auto* message = new Message();
        message->kind = kind;
        message->sessionId = id_;
        message->id = id;
        message->outcome = std::move(outcome);
        if (napi_call_threadsafe_function(tsfn_, message, napi_tsfn_nonblocking) != napi_ok) delete message;
    }

    const int64_t id_;
    const size_t memoryLimit_;
    const size_t stackLimit_;
    const int hostTimeoutMs_;
    napi_threadsafe_function tsfn_ = nullptr;
    MainSide* mainSide_ = nullptr;

    std::mutex mutex_;
    std::condition_variable cv_;
    std::deque<EvalJob> jobs_;
    std::unordered_map<int64_t, PendingCall> calls_;
    int64_t nextCallId_ = 1;
    std::atomic<bool> closing_{false};
    std::atomic<int64_t> cancelGeneration_{0};

    // Script-thread only.
    int64_t currentGeneration_ = 0;
    bool currentCancelled_ = false;
    bool currentTimedOut_ = false;
    Clock::time_point deadline_;
    Clock::duration hostWait_ = Clock::duration::zero();
    int hostCalls_ = 0;
    bool currentBinary_ = false;
    int binaryCalls_ = 0;
    size_t binaryBytes_ = 0;
};

// ---------- ArkTS-thread side ----------

napi_value Undefined(napi_env env)
{
    napi_value result = nullptr;
    napi_get_undefined(env, &result);
    return result;
}

napi_value MakeString(napi_env env, const std::string& text)
{
    napi_value result = nullptr;
    napi_create_string_utf8(env, text.c_str(), text.size(), &result);
    return result;
}

napi_value MakeNumber(napi_env env, double number)
{
    napi_value result = nullptr;
    napi_create_double(env, number, &result);
    return result;
}

napi_value MakeBool(napi_env env, bool value)
{
    napi_value result = nullptr;
    napi_get_boolean(env, value, &result);
    return result;
}

napi_value MakeBytes(napi_env env, const std::vector<uint8_t>& bytes)
{
    napi_value result = nullptr;
    void* data = nullptr;
    if (napi_create_arraybuffer(env, bytes.size(), &data, &result) != napi_ok) return nullptr;
    if (!bytes.empty()) std::memcpy(data, bytes.data(), bytes.size());
    return result;
}

bool ReadBytes(napi_env env, napi_value value, std::vector<uint8_t>& bytes)
{
    void* data = nullptr;
    size_t size = 0;
    bool isBuffer = false;
    napi_is_arraybuffer(env, value, &isBuffer);
    if (isBuffer) {
        if (napi_get_arraybuffer_info(env, value, &data, &size) != napi_ok) return false;
    } else {
        bool isTyped = false;
        napi_is_typedarray(env, value, &isTyped);
        if (!isTyped) return false;
        napi_typedarray_type type;
        napi_value buffer = nullptr;
        size_t offset = 0;
        if (napi_get_typedarray_info(env, value, &type, &size, &data, &buffer, &offset) != napi_ok || type != napi_uint8_array) return false;
    }
    if (size > MAX_BINARY_BYTES || (size && !data)) return false;
    if (size) bytes.assign(static_cast<uint8_t*>(data), static_cast<uint8_t*>(data) + size);
    return true;
}

std::string ReadString(napi_env env, napi_value value)
{
    napi_valuetype type = napi_undefined;
    napi_typeof(env, value, &type);
    if (type != napi_string) return "";
    size_t length = 0;
    napi_get_value_string_utf8(env, value, nullptr, 0, &length);
    std::string text(length, '\0');
    napi_get_value_string_utf8(env, value, &text[0], length + 1, &length);
    text.resize(length);
    return text;
}

double ReadNumber(napi_env env, napi_value value, double fallback)
{
    napi_valuetype type = napi_undefined;
    napi_typeof(env, value, &type);
    if (type != napi_number) return fallback;
    double number = fallback;
    napi_get_value_double(env, value, &number);
    return number;
}

bool ReadBool(napi_env env, napi_value value)
{
    bool result = false;
    napi_get_value_bool(env, value, &result);
    return result;
}

napi_value OutcomeObject(napi_env env, const EvalOutcome& outcome)
{
    napi_value object = nullptr;
    napi_create_object(env, &object);
    napi_set_named_property(env, object, "success", MakeBool(env, outcome.success));
    napi_set_named_property(env, object, "value", MakeString(env, outcome.value));
    napi_set_named_property(env, object, "error", MakeString(env, outcome.error));
    napi_set_named_property(env, object, "timedOut", MakeBool(env, outcome.timedOut));
    napi_set_named_property(env, object, "cancelled", MakeBool(env, outcome.cancelled));
    napi_set_named_property(env, object, "cpuMs", MakeNumber(env, outcome.cpuMs));
    napi_set_named_property(env, object, "wallMs", MakeNumber(env, outcome.wallMs));
    napi_set_named_property(env, object, "hostWaitMs", MakeNumber(env, outcome.hostWaitMs));
    napi_set_named_property(env, object, "hostCalls", MakeNumber(env, outcome.hostCalls));
    if (outcome.binary && outcome.success) {
        napi_value data = MakeBytes(env, outcome.bytes);
        if (data) napi_set_named_property(env, object, "bytes", data);
        else {
            napi_set_named_property(env, object, "success", MakeBool(env, false));
            napi_set_named_property(env, object, "error", MakeString(env, "could not allocate image output"));
        }
    }
    return object;
}

void CallJs(napi_env env, napi_value callback, void* context, void* data)
{
    auto* side = static_cast<MainSide*>(context);
    auto* message = static_cast<Message*>(data);
    if (!message) return;
    if (!env || !side) {
        delete message;
        return;
    }
    if (message->kind == MessageKind::HostCall) {
        napi_value args[4] = {
            MakeNumber(env, static_cast<double>(message->id)),
            MakeString(env, message->name),
            MakeString(env, message->payload),
            message->binary ? MakeBytes(env, message->bytes) : Undefined(env),
        };
        napi_value result = nullptr;
        const napi_status status = args[3] ? napi_call_function(env, Undefined(env), callback, 4, args, &result) : napi_generic_failure;
        if (status != napi_ok) {
            napi_value exception = nullptr;
            napi_get_and_clear_last_exception(env, &exception);
            // Never leave the script thread waiting on a call the handler could not take.
            auto session = FindSession(message->sessionId);
            if (session) session->resolve(message->id, false, "host handler threw");
        }
    } else {
        auto it = side->deferreds.find(message->id);
        if (it != side->deferreds.end()) {
            napi_resolve_deferred(env, it->second, OutcomeObject(env, message->outcome));
            side->deferreds.erase(it);
        }
    }
    delete message;
}

void FinalizeThreadsafe(napi_env env, void* finalizeData, void* hint)
{
    (void)hint;
    auto* side = static_cast<MainSide*>(finalizeData);
    if (!side) return;
    if (env) {
        EvalOutcome outcome;
        outcome.cancelled = true;
        outcome.error = "script session released";
        for (auto& entry : side->deferreds) napi_resolve_deferred(env, entry.second, OutcomeObject(env, outcome));
    }
    delete side;
}

// scriptSessionCreate(memoryLimitBytes, stackLimitBytes, hostTimeoutMs, onHostCall): number
napi_value Create(napi_env env, napi_callback_info info)
{
    size_t argc = 4;
    napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 4) {
        napi_throw_error(env, nullptr, "scriptSessionCreate needs 4 arguments");
        return nullptr;
    }
    const size_t memoryLimit = static_cast<size_t>(std::max(1024.0 * 1024.0,
        std::min(256.0 * 1024.0 * 1024.0, ReadNumber(env, args[0], 32.0 * 1024.0 * 1024.0))));
    const size_t stackLimit = static_cast<size_t>(std::max(64.0 * 1024.0,
        std::min(8.0 * 1024.0 * 1024.0, ReadNumber(env, args[1], 1024.0 * 1024.0))));
    const int hostTimeoutMs = static_cast<int>(std::max(100.0,
        std::min(600000.0, ReadNumber(env, args[2], 60000.0))));

    int64_t id = 0;
    {
        std::lock_guard<std::mutex> lock(g_registryMutex);
        id = g_nextSessionId++;
    }
    auto session = std::make_shared<ScriptSession>(id, memoryLimit, stackLimit, hostTimeoutMs);
    auto* side = new MainSide();
    side->sessionId = id;
    napi_value resourceName = MakeString(env, "QuickJsScriptSession");
    napi_threadsafe_function tsfn = nullptr;
    if (napi_create_threadsafe_function(env, args[3], nullptr, resourceName, 0, 1, side, FinalizeThreadsafe, side,
        CallJs, &tsfn) != napi_ok) {
        delete side;
        napi_throw_error(env, nullptr, "failed to create thread-safe function");
        return nullptr;
    }
    session->attach(tsfn, side);
    {
        std::lock_guard<std::mutex> lock(g_registryMutex);
        g_sessions[id] = session;
    }
    if (!session->start()) {
        {
            std::lock_guard<std::mutex> lock(g_registryMutex);
            g_sessions.erase(id);
        }
        napi_release_threadsafe_function(tsfn, napi_tsfn_abort);
        napi_throw_error(env, nullptr, "failed to start script thread");
        return nullptr;
    }
    return MakeNumber(env, static_cast<double>(id));
}

// scriptSessionEval(sessionId, script, sourceURL, cpuTimeoutMs): Promise<outcome>
napi_value Eval(napi_env env, napi_callback_info info)
{
    size_t argc = 4;
    napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    napi_deferred deferred = nullptr;
    napi_value promise = nullptr;
    napi_create_promise(env, &deferred, &promise);

    auto session = argc > 0 ? FindSession(static_cast<int64_t>(ReadNumber(env, args[0], 0))) : nullptr;
    if (!session) {
        EvalOutcome outcome;
        outcome.cancelled = true;
        outcome.error = "script session released";
        napi_resolve_deferred(env, deferred, OutcomeObject(env, outcome));
        return promise;
    }
    static std::atomic<int64_t> nextJobId{1};
    EvalJob job;
    job.id = nextJobId.fetch_add(1);
    job.code = argc > 1 ? ReadString(env, args[1]) : "";
    job.name = argc > 2 ? ReadString(env, args[2]) : "";
    if (job.name.empty()) job.name = "script.js";
    job.cpuTimeoutMs = static_cast<int>(std::max(1.0, std::min(600000.0,
        argc > 3 ? ReadNumber(env, args[3], 1000.0) : 1000.0)));
    session->mainSide()->deferreds[job.id] = deferred;
    session->enqueue(std::move(job));
    return promise;
}

// scriptSessionEvalBinary(sessionId, script, input, sourceURL, cpuTimeoutMs): Promise<outcome>
napi_value EvalBinary(napi_env env, napi_callback_info info)
{
    size_t argc = 5;
    napi_value args[5] = {nullptr, nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    napi_deferred deferred = nullptr;
    napi_value promise = nullptr;
    napi_create_promise(env, &deferred, &promise);
    EvalOutcome failure;
    failure.binary = true;
    auto session = argc == 5 ? FindSession(static_cast<int64_t>(ReadNumber(env, args[0], 0))) : nullptr;
    EvalJob job;
    job.binary = true;
    if (!session || !session->mainSide()->deferreds.empty()) {
        failure.error = "binary session unavailable or busy";
    } else if (!ReadBytes(env, args[2], job.bytes) || job.bytes.empty()) {
        failure.error = "image input must contain 1 to 20 MiB of bytes";
    } else {
        job.code = ReadString(env, args[1]);
        job.name = ReadString(env, args[3]);
        if (job.code.size() > 1024 * 1024) failure.error = "image script exceeds 1 MiB";
    }
    if (!failure.error.empty()) {
        napi_resolve_deferred(env, deferred, OutcomeObject(env, failure));
        return promise;
    }
    static std::atomic<int64_t> nextBinaryId{-1};
    job.id = nextBinaryId.fetch_sub(1);
    job.cpuTimeoutMs = static_cast<int>(std::max(1.0, std::min(5000.0, ReadNumber(env, args[4], 2000))));
    session->mainSide()->deferreds[job.id] = deferred;
    session->enqueue(std::move(job));
    return promise;
}

napi_value ResolveBinary(napi_env env, napi_callback_info info)
{
    size_t argc = 5;
    napi_value args[5] = {nullptr, nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc != 5) return MakeBool(env, false);
    auto session = FindSession(static_cast<int64_t>(ReadNumber(env, args[0], 0)));
    if (!session) return MakeBool(env, false);
    bool ok = ReadBool(env, args[2]);
    std::vector<uint8_t> bytes;
    std::string error = ReadString(env, args[4]);
    if (ok && !ReadBytes(env, args[3], bytes)) { ok = false; error = "invalid image crypto output"; }
    return MakeBool(env, session->resolve(static_cast<int64_t>(ReadNumber(env, args[1], 0)), ok, error, std::move(bytes)));
}

napi_value Resolve(napi_env env, napi_callback_info info)
{
    size_t argc = 4;
    napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 4) return MakeBool(env, false);
    auto session = FindSession(static_cast<int64_t>(ReadNumber(env, args[0], 0)));
    if (!session) return MakeBool(env, false);
    return MakeBool(env, session->resolve(static_cast<int64_t>(ReadNumber(env, args[1], 0)),
        ReadBool(env, args[2]), ReadString(env, args[3])));
}

// scriptSessionCancel(sessionId): void
napi_value Cancel(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    auto session = argc > 0 ? FindSession(static_cast<int64_t>(ReadNumber(env, args[0], 0))) : nullptr;
    if (session) session->cancel();
    return Undefined(env);
}

// scriptSessionRelease(sessionId): void
napi_value Release(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 1) return Undefined(env);
    const int64_t id = static_cast<int64_t>(ReadNumber(env, args[0], 0));
    std::shared_ptr<ScriptSession> session;
    {
        std::lock_guard<std::mutex> lock(g_registryMutex);
        auto it = g_sessions.find(id);
        if (it != g_sessions.end()) {
            session = it->second;
            g_sessions.erase(it);
        }
    }
    // The script thread notices, settles queued jobs and frees the runtime itself; nothing here
    // waits for it.
    if (session) session->close();
    return Undefined(env);
}

} // namespace

void DefineScriptSessionExports(napi_env env, napi_value exports)
{
    napi_property_descriptor desc[] = {
        { "scriptSessionCreate", nullptr, Create, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "scriptSessionEval", nullptr, Eval, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "scriptSessionEvalBinary", nullptr, EvalBinary, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "scriptSessionResolveBinary", nullptr, ResolveBinary, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "scriptSessionResolve", nullptr, Resolve, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "scriptSessionCancel", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "scriptSessionRelease", nullptr, Release, nullptr, nullptr, nullptr, napi_default, nullptr },
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
}
