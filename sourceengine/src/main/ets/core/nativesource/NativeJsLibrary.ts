import { JSBoundedExecutionResult, JSContext, JSRuntimeOptions } from '@devzeng/quickjs';
import { SourceEngineHost } from '../host/SourceEngineHost';
import { NativeExpr, NativeExprError } from './NativeExpr';
import type { NativeScriptLibrary, NativeValue } from './NativeExpr';
import { NativeJsPrelude } from './NativeJsPrelude';

/** 载入好的一份 js 代码：QuickJS 上下文和已查过的函数名。 */
class LoadedScript {
  context: JSContext;
  functions: Map<string, boolean> = new Map();
  /** 正在执行的那次调用用来回调内置函数；为 null 时是在载入顶层代码。 */
  builtin: ((name: string, args: NativeValue[]) => NativeValue) | null = null;

  constructor(context: JSContext) {
    this.context = context;
  }
}

/**
 * 原生书源顶层 js 的执行器：QuickJS 在主线程同步运行，只做纯计算。
 *
 * 同一份代码的上下文按内容缓存（最多 4 份），切换书源或阶段时不必重新载入大库；被挤出缓存的上下文
 * 会释放，再用到时自动重新载入。顶层代码在载入时执行一次，全局变量在多次调用之间保留。
 */
export class NativeJsLibrary implements NativeScriptLibrary {
  static readonly LOAD_TIMEOUT_MS: number = 2000;
  static readonly CALL_TIMEOUT_MS: number = 300;
  private static readonly MEMORY_LIMIT_BYTES: number = 32 * 1024 * 1024;
  private static readonly STACK_LIMIT_BYTES: number = 512 * 1024;
  private static readonly CACHE_LIMIT: number = 4;
  private static loaded: Map<string, LoadedScript> = new Map();
  private code: string;
  private key: string;

  private constructor(code: string) {
    this.code = code;
    this.key = NativeJsLibrary.keyOf(code);
  }

  static forCode(code: string): NativeJsLibrary {
    return new NativeJsLibrary(code);
  }

  /**
   * 导入时的检查：能否载入，以及函数名是否与内置函数、lib 里的函数重名（重名时表达式不会调到 JS）。
   * 通过时返回空串。
   */
  static check(code: string, libFunctionNames: string[], scriptFunctions: string[] = [],
    expressionCalls: Array<{ path: string, name: string }> = []): string {
    if (code.length > NativeJsPrelude.MAX_CODE_LENGTH) {
      return `js 太长：上限 ${Math.round(NativeJsPrelude.MAX_CODE_LENGTH / 1024)} KB`;
    }
    const unavailable = NativeJsLibrary.unavailableReason();
    if (unavailable) return '';
    let script: LoadedScript;
    try {
      script = NativeJsLibrary.load(code);
    } catch (e) {
      return (e as Error).message;
    }
    try {
      const builtins = NativeExpr.builtinNames();
      const names = builtins.concat(libFunctionNames);
      const result = script.context.evaluateBounded(NativeJsPrelude.definedSource(names), 'js-check.js',
        NativeJsLibrary.CALL_TIMEOUT_MS, 0);
      if (!result.success) return `js：${NativeJsPrelude.shortError(result.error)}`;
      const clash = NativeJsPrelude.clashMessage(NativeJsPrelude.parseResult(result.value) as string[], builtins);
      if (clash) return clash;
      const calledNames: string[] = [];
      for (const call of expressionCalls) if (calledNames.indexOf(call.name) < 0) calledNames.push(call.name);
      const required = scriptFunctions.concat(calledNames.filter((name: string): boolean => scriptFunctions.indexOf(name) < 0));
      if (required.length === 0) return '';
      const defined = script.context.evaluateBounded(NativeJsPrelude.definedSource(required), 'js-check.js',
        NativeJsLibrary.CALL_TIMEOUT_MS, 0);
      if (!defined.success) return `js：${NativeJsPrelude.shortError(defined.error)}`;
      const definedNames = NativeJsPrelude.parseResult(defined.value) as string[];
      const missingScript = NativeJsPrelude.missingMessage(scriptFunctions, definedNames);
      if (missingScript) return missingScript;
      const missingCall = expressionCalls.find((call): boolean => definedNames.indexOf(call.name) < 0);
      return missingCall ? `${missingCall.path}：没有名为 “${missingCall.name}” 的函数，lib、内置函数和 js 里都没有` : '';
    } finally {
      script.context.release();
    }
  }

  has(name: string): boolean {
    if (!NativeJsPrelude.isIdentifier(name)) return false;
    const script = this.script();
    const known = script.functions.get(name);
    if (known !== undefined) return known;
    const result = script.context.evaluateBounded(NativeJsPrelude.hasSource(name), 'js-has.js',
      NativeJsLibrary.CALL_TIMEOUT_MS, 0);
    const defined = result.success && result.value === 'true';
    script.functions.set(name, defined);
    return defined;
  }

  call(name: string, args: NativeValue[], builtin: (name: string, args: NativeValue[]) => NativeValue): NativeValue {
    const script = this.script();
    const previous = script.builtin;
    script.builtin = builtin;
    let result: JSBoundedExecutionResult;
    try {
      result = script.context.evaluateBounded(NativeJsPrelude.callSource(name, args), `js:${name}`,
        NativeJsLibrary.CALL_TIMEOUT_MS, 8);
    } finally {
      script.builtin = previous;
    }
    if (!result.success) {
      if (result.timedOut) {
        throw new NativeExprError(`JS 函数 “${name}” 运行超过 ${NativeJsLibrary.CALL_TIMEOUT_MS} ms`);
      }
      throw new NativeExprError(`JS 函数 “${name}” 出错：${NativeJsPrelude.scriptError(result.error,
        NativeExpr.scriptBuiltinNames())}`);
    }
    try {
      return NativeJsPrelude.parseResult(result.value);
    } catch (e) {
      throw new NativeExprError(`JS 函数 “${name}” 的返回值无法转换`);
    }
  }

  private script(): LoadedScript {
    const cached = NativeJsLibrary.loaded.get(this.key);
    if (cached) {
      // 按最近使用排序：重新插入放到末尾。
      NativeJsLibrary.loaded.delete(this.key);
      NativeJsLibrary.loaded.set(this.key, cached);
      return cached;
    }
    const unavailable = NativeJsLibrary.unavailableReason();
    if (unavailable) throw new NativeExprError(unavailable);
    const script = NativeJsLibrary.load(this.code);
    NativeJsLibrary.loaded.set(this.key, script);
    while (NativeJsLibrary.loaded.size > NativeJsLibrary.CACHE_LIMIT) {
      const oldest = NativeJsLibrary.loaded.keys().next().value as string;
      const evicted = NativeJsLibrary.loaded.get(oldest);
      NativeJsLibrary.loaded.delete(oldest);
      if (evicted) evicted.context.release();
    }
    return script;
  }

  private static load(code: string): LoadedScript {
    const options = new JSRuntimeOptions();
    options.memoryLimitBytes = NativeJsLibrary.MEMORY_LIMIT_BYTES;
    options.stackLimitBytes = NativeJsLibrary.STACK_LIMIT_BYTES;
    const context = new JSContext(options);
    const script = new LoadedScript(context);
    context.setHostFunction((name: string, payload: string): string => {
      const builtin = script.builtin;
      if (!builtin) throw new Error('js 顶层代码里不能调用 native，请放到函数里');
      return NativeJsPrelude.answerBuiltin(builtin, name, payload);
    });
    const prelude = context.evaluateBounded(NativeJsPrelude.source(NativeExpr.scriptBuiltinNames()),
      'native-prelude.js', NativeJsLibrary.LOAD_TIMEOUT_MS, 0);
    let error = prelude.success ? '' : `js 环境初始化失败：${NativeJsPrelude.shortError(prelude.error)}`;
    if (!error) {
      const loaded = context.evaluateBounded(code, 'js', NativeJsLibrary.LOAD_TIMEOUT_MS, 8);
      if (!loaded.success) {
        error = loaded.timedOut ? `js 顶层代码运行超过 ${NativeJsLibrary.LOAD_TIMEOUT_MS} ms` :
          `js：${NativeJsPrelude.scriptError(loaded.error, NativeExpr.scriptBuiltinNames())}`;
      }
    }
    if (error) {
      context.release();
      throw new NativeExprError(error);
    }
    return script;
  }

  private static unavailableReason(): string {
    const executor = SourceEngineHost.scriptExecutor();
    return executor && executor.allowSynchronousQuickJs === false ? '当前环境不支持 JS 函数库' : '';
  }

  /** 缓存键：长度加两种 32 位哈希，避免每次调用都拿整段代码当键比较。 */
  private static keyOf(code: string): string {
    let fnv = 2166136261;
    let djb = 5381;
    for (let i = 0; i < code.length; i++) {
      const c = code.charCodeAt(i);
      fnv = Math.imul(fnv ^ c, 16777619);
      djb = (Math.imul(djb, 33) + c) | 0;
    }
    return `${code.length}:${(fnv >>> 0).toString(16)}:${(djb >>> 0).toString(16)}`;
  }
}
