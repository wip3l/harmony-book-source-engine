import { JSScriptSession, JSScriptSessionOptions } from '@devzeng/quickjs';
import type { JSScriptEvalResult } from '@devzeng/quickjs';
import { NativeExpr } from './NativeExpr';
import type { NativeValue } from './NativeExpr';
import { NativeJsPrelude } from './NativeJsPrelude';
import type { NativeScriptCallHandler, NativeScriptEngine, NativeScriptRunOptions } from './NativeScriptHost';

/** 一个已载入书源 js 的后台会话；handler 指向正在使用它的那次阶段运行。 */
class PooledSession {
  session: JSScriptSession;
  handler: NativeScriptCallHandler | null = null;

  constructor(options: JSScriptSessionOptions) {
    this.session = new JSScriptSession((name: string, payload: string): Promise<string> =>
      this.answer(name, payload), options);
  }

  private async answer(name: string, payload: string): Promise<string> {
    const handler = this.handler;
    if (!handler) throw new Error('脚本不在运行中');
    const args: NativeValue = payload ? JSON.parse(payload) : [];
    const value: NativeValue = await handler(name, Array.isArray(args) ? args : []);
    const text = JSON.stringify(value === undefined ? null : value);
    return text === undefined ? 'null' : text;
  }
}

/**
 * 脚本阶段的真机引擎：QuickJS 在后台线程运行，宿主调用由主线程代办（见阶段 0 的 JSScriptSession）。
 *
 * 同一份代码的会话空闲时留着复用（每份最多 2 个，总共最多 8 个），连续的搜索、详情、目录不必重复载入；
 * 会话被占用时另开一个，所以多个书源可以同时运行脚本。全局变量在复用的会话之间保留，与表达式里的
 * JS 函数库（主线程）不共享。
 */
export class NativeScriptSessions implements NativeScriptEngine {
  private static readonly LOAD_CPU_MS: number = 2000;
  private static readonly IDLE_PER_CODE: number = 2;
  private static readonly IDLE_TOTAL: number = 8;
  private static readonly POLL_MS: number = 100;
  private static readonly HOST_WAIT_MS: number = 15 * 60 * 1000;
  private static idle: Map<string, PooledSession[]> = new Map();
  private code: string;
  private key: string;

  private constructor(code: string) {
    this.code = code;
    this.key = NativeScriptSessions.keyOf(code);
  }

  static forCode(code: string): NativeScriptSessions {
    return new NativeScriptSessions(code);
  }

  async run(fn: string, ctx: NativeValue, handler: NativeScriptCallHandler,
    options: NativeScriptRunOptions): Promise<NativeValue> {
    if (!NativeJsPrelude.isIdentifier(fn)) throw new Error(`函数名无效：${fn}`);
    const pooled = await this.acquire();
    pooled.handler = handler;
    const startedAt = Date.now();
    let cancelled = false;
    let overtime = false;
    const timer = setInterval((): void => {
      if (options.cancelled()) {
        cancelled = true;
        pooled.session.cancel();
      } else if (Date.now() - startedAt - (options.pausedMs ? options.pausedMs() : 0) > options.wallMs) {
        overtime = true;
        pooled.session.cancel();
      }
    }, NativeScriptSessions.POLL_MS);
    let result: JSScriptEvalResult;
    try {
      result = await pooled.session.evaluate(NativeJsPrelude.stageSource(fn, ctx), `script:${fn}`, options.cpuMs);
    } finally {
      clearInterval(timer);
      pooled.handler = null;
    }
    this.giveBack(pooled);
    if (options.timing) options.timing(result.cpuMs, Date.now() - startedAt);
    if (result.success) {
      try {
        return NativeJsPrelude.parseResult(result.value);
      } catch (e) {
        throw new Error('返回值无法转换');
      }
    }
    if (result.timedOut) throw new Error(`计算时间超过 ${Math.round(options.cpuMs / 1000)} 秒（已用 ${result.cpuMs} ms）`);
    if (overtime) throw new Error(`运行超过 ${Math.round(options.wallMs / 1000)} 秒`);
    if (cancelled || result.cancelled) throw new Error('已取消');
    throw new Error(NativeJsPrelude.scriptError(result.error, NativeExpr.scriptBuiltinNames()));
  }

  private async acquire(): Promise<PooledSession> {
    const idle = NativeScriptSessions.idle.get(this.key);
    if (idle && idle.length > 0) {
      const pooled = idle.pop() as PooledSession;
      if (idle.length === 0) NativeScriptSessions.idle.delete(this.key);
      return pooled;
    }
    const sessionOptions = new JSScriptSessionOptions();
    // 单次宿主调用最长等待：browser.verify 要等用户在网页里操作；普通请求由各自的网络超时控制。
    sessionOptions.hostTimeoutMs = NativeScriptSessions.HOST_WAIT_MS;
    const pooled = new PooledSession(sessionOptions);
    const prelude = await pooled.session.evaluate(NativeJsPrelude.source(NativeExpr.scriptBuiltinNames(), true),
      'native-prelude.js', NativeScriptSessions.LOAD_CPU_MS);
    const loaded = prelude.success ?
      await pooled.session.evaluate(this.code, 'js', NativeScriptSessions.LOAD_CPU_MS) : prelude;
    if (!loaded.success) {
      pooled.session.release();
      throw new Error(loaded.timedOut ? `js 顶层代码运行超过 ${NativeScriptSessions.LOAD_CPU_MS / 1000} 秒` :
        `js 载入失败：${NativeJsPrelude.scriptError(loaded.error, NativeExpr.scriptBuiltinNames())}`);
    }
    return pooled;
  }

  private giveBack(pooled: PooledSession): void {
    const pool = NativeScriptSessions.idle;
    let total = 0;
    pool.forEach((list: PooledSession[]): void => {
      total += list.length;
    });
    const list = pool.get(this.key) || [];
    if (pooled.session.released || list.length >= NativeScriptSessions.IDLE_PER_CODE ||
      total >= NativeScriptSessions.IDLE_TOTAL) {
      pooled.session.release();
      return;
    }
    list.push(pooled);
    pool.set(this.key, list);
  }

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
