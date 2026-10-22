import { JSScriptEvalResult, JSScriptSession, JSScriptSessionOptions } from '@devzeng/quickjs';
import { HttpClient } from '../http/HttpClient';
import { digestHashHex } from '../http/DigestHash';
import { AnalyzeRule } from '../rule/AnalyzeRule';
import { JsonPathEvaluator } from '../rule/JsonPathEvaluator';
import { NativeExpr, NativeScope } from '../nativesource/NativeExpr';
import type { NativeExprHost, NativeValue } from '../nativesource/NativeExpr';
import { NativeJsLibrary } from '../nativesource/NativeJsLibrary';
import { NativeSourceCrypto } from '../nativesource/NativeSourceCrypto';
import { NativeImageScriptRunner } from '../nativesource/NativeImageScriptRunner';
import { NativeSourceRunner } from '../nativesource/NativeSourceRunner';
import type { NativeBookRecord, NativeRequest, NativeResponse, NativeRunnerHost } from '../nativesource/NativeSourceRunner';
import { NativeSourceSpec } from '../nativesource/NativeSourceSpec';
import { NativeScriptSessions } from '../nativesource/NativeScriptSessions';
import type { NativeScriptEngine } from '../nativesource/NativeScriptHost';

/** JS 函数库验证用的表达式宿主：与原生书源运行时相同的选择器、摘要和加解密实现。 */
class ProbeExprHost implements NativeExprHost {
  jsonPath(root: NativeValue, path: string): NativeValue[] {
    return JsonPathEvaluator.evaluate(root as Object, path);
  }

  select(content: string, rule: string, baseUrl: string, list: boolean): string[] {
    const analyzer = new AnalyzeRule(content, baseUrl);
    if (list) return analyzer.getStringList(rule);
    const value = analyzer.getString(rule);
    return value ? [value] : [];
  }

  digest(algorithm: string, text: string): string {
    return digestHashHex(algorithm, text);
  }

  crypto(name: string, args: NativeValue[]): NativeValue {
    return NativeSourceCrypto.run(name, args as Object[]);
  }
}

/** 脚本阶段验证用的运行器宿主：真实请求、真机脚本会话池，变量和 Cookie 只存在内存里。 */
class ProbeRunnerHost extends ProbeExprHost implements NativeRunnerHost {
  http: HttpClient = new HttpClient(15000);
  requests: number = 0;
  savedVars: Record<string, NativeValue> = {};
  private cookies: Map<string, string> = new Map();
  private cache: Map<string, NativeValue> = new Map();

  cacheGet(key: string): NativeValue {
    return this.cache.get(key);
  }

  cachePut(key: string, value: NativeValue, ttlSeconds: number): void {
    this.cache.set(key, value);
  }

  async fetch(request: NativeRequest): Promise<NativeResponse> {
    this.requests++;
    const response = await this.http.execute({
      url: request.url, method: request.method, headers: request.headers, body: request.body || undefined
    });
    return {
      ok: response.success, status: response.statusCode, body: response.body, url: response.url || request.url,
      error: response.error || ''
    };
  }

  selectItems(content: string, rule: string, baseUrl: string): NativeValue[] {
    return new AnalyzeRule(content, baseUrl).getStringList(rule);
  }

  scriptEngine(code: string): NativeScriptEngine {
    return NativeScriptSessions.forCode(code);
  }

  cookieGet(url: string, name: string): string {
    return this.cookies.get(`${url}\n${name}`) || '';
  }

  cookieSet(url: string, value: string): void {
    for (const part of value.split(';')) {
      const index = part.indexOf('=');
      if (index > 0) this.cookies.set(`${url}\n${part.substring(0, index).trim()}`, part.substring(index + 1).trim());
    }
  }

  cookieRemove(url: string, name: string): void {
    this.cookies.delete(`${url}\n${name}`);
  }

  async saveVars(values: Record<string, NativeValue>): Promise<void> {
    this.savedVars = values;
  }

  deviceId(): string {
    return 'probe';
  }
}

export class ScriptProbeResult {
  name: string = '';
  passed: boolean = false;
  detail: string = '';
}

/**
 * 阶段 0 技术验证：QuickJS 跑在后台线程、脚本同步调用宿主（宿主在 ArkTS 线程上异步完成）。
 * 只用于真机上的调试页，不参与书源解析。
 */
export class ScriptThreadProbe {
  static readonly DEFAULT_HTTP_URL: string = 'https://www.baidu.com/';

  static async run(onResult: (result: ScriptProbeResult) => void,
    httpUrl: string = ScriptThreadProbe.DEFAULT_HTTP_URL): Promise<ScriptProbeResult[]> {
    const results: ScriptProbeResult[] = [];
    const cases: [string, () => Promise<ScriptProbeResult>][] = [
      ['基础语法与返回值', () => ScriptThreadProbe.basics()],
      ['全局变量跨次保留', () => ScriptThreadProbe.globalsPersist()],
      ['Promise 与 async', () => ScriptThreadProbe.promises()],
      ['宿主调用往返耗时', () => ScriptThreadProbe.roundTrip()],
      ['大数据与中文往返', () => ScriptThreadProbe.largePayload()],
      ['脚本忙时主线程不卡', () => ScriptThreadProbe.mainThreadResponsive()],
      ['CPU 超时且无法被 catch', () => ScriptThreadProbe.cpuTimeout()],
      ['等待宿主不计 CPU 时间', () => ScriptThreadProbe.hostWaitExcluded()],
      ['取消正在运行的脚本', () => ScriptThreadProbe.cancelBusy()],
      ['取消正在等宿主的脚本', () => ScriptThreadProbe.cancelWaiting()],
      ['内存上限后会话仍可用', () => ScriptThreadProbe.memoryLimit()],
      ['深递归不崩溃', () => ScriptThreadProbe.deepRecursion()],
      ['宿主报错可被脚本 catch', () => ScriptThreadProbe.hostError()],
      ['选择器宿主调用', () => ScriptThreadProbe.selector()],
      ['脚本里连续发真实请求', () => ScriptThreadProbe.realHttp(httpUrl)],
      ['4 个会话并行', () => ScriptThreadProbe.parallelSessions()],
      ['运行中释放会话', () => ScriptThreadProbe.releaseWhileBusy()],
      ['反复创建与释放 30 个会话', () => ScriptThreadProbe.churn()],
      ['JS 函数库：表达式调用与 native 回调', () => ScriptThreadProbe.jsLibraryCall()],
      ['JS 函数库：逐章式连续调用', () => ScriptThreadProbe.jsLibraryThroughput()],
      ['JS 函数库：超时与报错', () => ScriptThreadProbe.jsLibraryErrors()],
      ['JS 函数库：导入检查', () => ScriptThreadProbe.jsLibraryCheck()],
      ['JS 函数库：大代码载入与缓存淘汰', () => ScriptThreadProbe.jsLibraryLoad()],
      ['脚本阶段：循环与并发的真实请求', () => ScriptThreadProbe.scriptStage(httpUrl)],
      ['脚本阶段：会话复用与状态接口', () => ScriptThreadProbe.scriptStageState()],
      ['脚本阶段：请求预算与取消', () => ScriptThreadProbe.scriptStageLimits()],
      ['图片脚本：二进制边界与宿主隔离', () => ScriptThreadProbe.imageBinary()],
      ['图片脚本：异步系统加密与逐图隔离', () => ScriptThreadProbe.imageCrypto()],
      ['图片脚本：CPU 超时与等待中取消', () => ScriptThreadProbe.imageCancel()],
    ];
    for (const entry of cases) {
      let result: ScriptProbeResult;
      try {
        result = await entry[1]();
      } catch (error) {
        result = ScriptThreadProbe.result(false, `验证代码异常：${ScriptThreadProbe.message(error)}`);
      }
      result.name = entry[0];
      results.push(result);
      onResult(result);
    }
    return results;
  }

  /** 把结果整理成可以直接复制给开发者的文本。 */
  static report(results: ScriptProbeResult[]): string {
    const passed = results.filter((item: ScriptProbeResult): boolean => item.passed).length;
    const lines: string[] = [`后台脚本线程验证：${passed}/${results.length} 通过`];
    for (const item of results) lines.push(`${item.passed ? '✓' : '✗'} ${item.name}：${item.detail}`);
    return lines.join('\n');
  }

  private static async imageBinary(): Promise<ScriptProbeResult> {
    let stageCalls = 0;
    let binaryCalls = 0;
    const options = new JSScriptSessionOptions();
    options.memoryLimitBytes = 96 * 1024 * 1024;
    const session = new JSScriptSession((): string => { stageCalls++; return 'unsafe'; }, options,
      async (_name: string, bytes: Uint8Array): Promise<Uint8Array> => { binaryCalls++; return bytes.subarray(1, 3); });
    const input = new Uint8Array([99, 10, 20, 30, 88]).subarray(1, 4);
    try {
      for (const code of ['new Uint8Array(__imageInput).subarray(1)',
        'Promise.resolve(new Uint8Array(__imageInput).subarray(1))',
        'new Uint8Array(__imageHost("echo", new Uint8Array(__imageInput), "{}"))']) {
        const result = await session.evaluateBinary(code, input);
        if (!result.success || Array.from(result.bytes).join(',') !== '20,30') {
          return ScriptThreadProbe.result(false, result.error || '字节切片偏移或长度错误');
        }
      }
      for (const code of ['"text"', '[1,2]', 'new Uint16Array([1])', 'new Uint8Array(20*1024*1024+1)',
        '__host("http","{}")']) {
        const result = await session.evaluateBinary(code, input);
        if (result.success) return ScriptThreadProbe.result(false, `未拒绝 ${code}`);
      }
      const max = await session.evaluateBinary('new Uint8Array(20*1024*1024)', input);
      const empty = await session.evaluateBinary('new ArrayBuffer(0)', input);
      const limit = await session.evaluateBinary('for(let i=0;i<17;i++)__imageHost("echo",new Uint8Array(__imageInput),"{}"); __imageInput', input);
      return ScriptThreadProbe.result(max.success && max.bytes.length === 20 * 1024 * 1024 &&
        empty.success && empty.bytes.length === 0 && !limit.success && stageCalls === 0 && binaryCalls === 17,
        `切片/Promise/20 MiB/空缓冲区/非法返回值/宿主隔离；${limit.error}`);
    } finally { session.release(); }
  }

  private static async imageCrypto(): Promise<ScriptProbeResult> {
    const input = new Uint8Array([97, 98, 99]);
    const context = { url: 'https://example.com/a', index: 2, params: {} };
    const code = `function decode(bytes,ctx) {
      if (ctx.index !== 2 || globalThis.seen) throw new Error('context leaked');
      globalThis.seen = true;
      const key='000102030405060708090a0b0c0d0e0f';
      const iv='0f0e0d0c0b0a09080706050403020100';
      const encrypted=image.encrypt('AES/CBC/PKCS7Padding',bytes,key,iv);
      const plain=image.decrypt('AES/CBC/PKCS7Padding',encrypted,key,iv);
      const mac=image.hmac('SHA256',plain,key);
      if(mac.length!==32) throw new Error('hmac failed');
      return image.hash('SHA256',plain);
    }`;
    for (let i = 0; i < 2; i++) {
      const bytes = await NativeImageScriptRunner.run(code, 'decode', input, context);
      const hex = Array.from(bytes).map((value: number): string => value.toString(16).padStart(2, '0')).join('');
      if (hex !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
        return ScriptThreadProbe.result(false, `摘要不符：${hex}`);
      }
    }
    return ScriptThreadProbe.result(true, '真实异步 AES 加密/解密、HMAC、SHA256，独立会话重复执行一致');
  }

  private static async imageCancel(): Promise<ScriptProbeResult> {
    const session = new JSScriptSession((): string => '', undefined,
      async (_name: string, bytes: Uint8Array): Promise<Uint8Array> => {
        await new Promise<void>((resolve): void => { setTimeout(resolve, 300); });
        return bytes;
      });
    try {
      const input = new Uint8Array([1, 2, 3]);
      const timeout = await session.evaluateBinary('while(true){}', input, 'image-timeout.js', 100);
      const pending = session.evaluateBinary('__imageHost("slow",new Uint8Array(__imageInput),"{}")', input);
      const timer = setTimeout((): void => session.cancel(), 50);
      const cancelled = await pending;
      clearTimeout(timer);
      const recovered = await session.evaluateBinary('__imageInput', input);
      return ScriptThreadProbe.result(timeout.timedOut && cancelled.cancelled && recovered.success,
        `超时=${timeout.timedOut}，取消=${cancelled.cancelled}，恢复=${recovered.success}`);
    } finally { session.release(); }
  }

  private static async basics(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const code = 'class A { #x = 1; get x() { return this.#x; } }\n' +
        '[new A().x, [1, 2, 3].map(v => v * 2).join(","), "abc".replaceAll("b", "B"),' +
        ' JSON.stringify({ a: (1n).toString() }), /(?<y>\\d{4})/.exec("2026").groups.y, typeof __host].join("|")';
      const run = await session.evaluate(code, 'basics.js');
      const expected = '1|2,4,6|aBc|{"a":"1"}|2026|function';
      return ScriptThreadProbe.result(run.success && run.value === expected,
        run.success ? `返回 ${run.value}，用时 ${ScriptThreadProbe.ms(run.wallMs)}` : run.error);
    });
  }

  private static async globalsPersist(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      await session.evaluate('var counter = 41; function inc() { return ++counter; }', 'define.js');
      const run = await session.evaluate('inc()', 'use.js');
      return ScriptThreadProbe.result(run.success && run.value === '42', run.success ? `返回 ${run.value}` : run.error);
    });
  }

  private static async promises(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const chained = await session.evaluate('Promise.resolve(20).then(x => x + 1)', 'promise.js');
      const asyncFn = await session.evaluate('(async () => { const v = __host("echo", "a"); await null; return v + "b"; })()',
        'async.js');
      const ok = chained.value === '21' && asyncFn.value === 'ab';
      return ScriptThreadProbe.result(ok, `then 得到 ${chained.value || chained.error}，async 得到 ${asyncFn.value || asyncFn.error}`);
    });
  }

  private static async roundTrip(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const count = 2000;
      const run = await session.evaluate(
        `let total = 0; for (let i = 0; i < ${count}; i++) total += __host("echo", String(i)).length; total`,
        'round-trip.js', 5000);
      const expected = ScriptThreadProbe.digitsUpTo(count);
      const perCall = run.wallMs * 1000 / count;
      return ScriptThreadProbe.result(run.success && Number(run.value) === expected && run.hostCalls === count,
        run.success ? `${count} 次共 ${ScriptThreadProbe.ms(run.wallMs)}，平均每次 ${perCall.toFixed(0)} 微秒` : run.error);
    });
  }

  private static async largePayload(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const run = await session.evaluate(
        'const big = "中文😀".repeat(200000); const back = __host("echo", big);' +
          ' [back.length === big.length, back === big, back.slice(0, 4)].join("|")',
        'large.js', 5000);
      return ScriptThreadProbe.result(run.success && run.value === 'true|true|中文😀',
        run.success ? `约 2.4 MB 往返 ${ScriptThreadProbe.ms(run.wallMs)}，结果 ${run.value}` : run.error);
    });
  }

  private static async mainThreadResponsive(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      let last = Date.now();
      let maxGap = 0;
      const timer = setInterval((): void => {
        const now = Date.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
      }, 16);
      const run = await session.evaluate('const end = Date.now() + 1500; let n = 0; while (Date.now() < end) n++; n',
        'busy.js', 3000);
      clearInterval(timer);
      return ScriptThreadProbe.result(run.success && maxGap < 100,
        `脚本忙 ${ScriptThreadProbe.ms(run.cpuMs)}，期间主线程定时器最大间隔 ${maxGap} ms（16 ms 一次）`);
    });
  }

  private static async cpuTimeout(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const run = await session.evaluate('for (;;) { try { while (true) {} } catch (e) {} }', 'timeout.js', 300);
      const after = await session.evaluate('1 + 1', 'after.js');
      return ScriptThreadProbe.result(run.timedOut && run.wallMs < 1500 && after.value === '2',
        `超时=${run.timedOut}，用时 ${ScriptThreadProbe.ms(run.wallMs)}，之后再运行得到 ${after.value || after.error}`);
    });
  }

  private static async hostWaitExcluded(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const run = await session.evaluate('__host("sleep", "800"); "ok"', 'sleep.js', 300);
      return ScriptThreadProbe.result(run.success && run.hostWaitMs >= 700,
        run.success ? `CPU 上限 300 ms，等待宿主 ${ScriptThreadProbe.ms(run.hostWaitMs)}，脚本 CPU ${ScriptThreadProbe.ms(run.cpuMs)}` :
          run.error);
    });
  }

  private static async cancelBusy(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const pending = session.evaluate('for (;;) {}', 'forever.js', 10000);
      setTimeout((): void => session.cancel(), 200);
      const run = await pending;
      const after = await session.evaluate('"still alive"', 'after.js');
      return ScriptThreadProbe.result(run.cancelled && run.wallMs < 1500 && after.value === 'still alive',
        `已取消=${run.cancelled}，用时 ${ScriptThreadProbe.ms(run.wallMs)}，之后再运行：${after.value || after.error}`);
    });
  }

  private static async cancelWaiting(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const pending = session.evaluate('__host("sleep", "5000"); "should not reach"', 'wait.js', 1000);
      setTimeout((): void => session.cancel(), 200);
      const run = await pending;
      return ScriptThreadProbe.result(run.cancelled && run.wallMs < 1500,
        `已取消=${run.cancelled}，用时 ${ScriptThreadProbe.ms(run.wallMs)}（宿主那次 5 秒的等待被放弃）`);
    });
  }

  private static async memoryLimit(): Promise<ScriptProbeResult> {
    const options = new JSScriptSessionOptions();
    options.memoryLimitBytes = 16 * 1024 * 1024;
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const run = await session.evaluate('const a = []; for (;;) a.push(new Array(100000).fill(1));', 'oom.js', 5000);
      const after = await session.evaluate('1 + 1', 'after.js');
      const oom = !run.success && /memory/i.test(run.error);
      return ScriptThreadProbe.result(oom && after.value === '2',
        `报错：${ScriptThreadProbe.firstLine(run.error)}；之后再运行得到 ${after.value || after.error}`);
    }, options);
  }

  private static async deepRecursion(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const run = await session.evaluate('function f(n) { return f(n + 1) + 1; } try { f(0); "no error" } catch (e) { String(e) }',
        'recursion.js', 5000);
      return ScriptThreadProbe.result(run.success && /stack/i.test(run.value), run.success ? run.value : run.error);
    });
  }

  private static async hostError(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const run = await session.evaluate('try { __host("fail", "坏了"); "no error" } catch (e) { "caught:" + e.message }',
        'host-error.js');
      return ScriptThreadProbe.result(run.value === 'caught:坏了', run.success ? run.value : run.error);
    });
  }

  private static async selector(): Promise<ScriptProbeResult> {
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const code = 'const html = "<ul>" + Array.from({ length: 50 }, (_, i) => `<li class=\\"c\\"><a href=\\"/b/${i}\\">书${i}</a></li>`).join("") + "</ul>";\n' +
        'let names = []; for (let i = 0; i < 20; i++) names = JSON.parse(__host("sel", JSON.stringify({ html, rule: "@css:li.c a@text" })));\n' +
        'names.length + ":" + names[49]';
      const run = await session.evaluate(code, 'sel.js', 5000);
      return ScriptThreadProbe.result(run.success && run.value === '50:书49',
        run.success ? `20 次选择器各取 50 项，共 ${ScriptThreadProbe.ms(run.wallMs)}，结果 ${run.value}` : run.error);
    });
  }

  private static async realHttp(url: string): Promise<ScriptProbeResult> {
    const options = new JSScriptSessionOptions();
    options.hostTimeoutMs = 20000;
    return ScriptThreadProbe.withSession(async (session: JSScriptSession): Promise<ScriptProbeResult> => {
      const code = `const out = []; let target = ${JSON.stringify(url)};\n` +
        'for (let i = 0; i < 3; i++) { const r = JSON.parse(__host("http", target)); out.push(r.code + "/" + r.length + "B/" + r.ms + "ms"); ' +
        'if (r.code !== 200) break; }\nout.join(", ")';
      const run = await session.evaluate(code, 'http.js', 2000);
      return ScriptThreadProbe.result(run.success && /^200\//.test(run.value),
        run.success ? `${url} 连续 3 次：${run.value}；脚本 CPU ${ScriptThreadProbe.ms(run.cpuMs)}` : run.error);
    });
  }

  private static async parallelSessions(): Promise<ScriptProbeResult> {
    const sessions: JSScriptSession[] = [];
    for (let i = 0; i < 4; i++) sessions.push(ScriptThreadProbe.newSession());
    const startedAt = Date.now();
    try {
      const runs = await Promise.all(sessions.map((session: JSScriptSession): Promise<JSScriptEvalResult> =>
        session.evaluate('const end = Date.now() + 600; let n = 0; while (Date.now() < end) n++; n', 'busy.js', 2000)));
      const wall = Date.now() - startedAt;
      const ok = runs.every((run: JSScriptEvalResult): boolean => run.success);
      return ScriptThreadProbe.result(ok && wall < 1800,
        `4 个会话各忙 600 ms，总用时 ${wall} ms（串行约 2400 ms）`);
    } finally {
      sessions.forEach((session: JSScriptSession): void => session.release());
    }
  }

  private static async releaseWhileBusy(): Promise<ScriptProbeResult> {
    const session = ScriptThreadProbe.newSession();
    const pending = session.evaluate('for (;;) {}', 'forever.js', 10000);
    const queued = session.evaluate('"queued"', 'queued.js');
    setTimeout((): void => session.release(), 100);
    const run = await pending;
    const second = await queued;
    const after = await session.evaluate('1', 'after-release.js');
    return ScriptThreadProbe.result(run.cancelled && second.cancelled && after.cancelled,
      `运行中的已取消=${run.cancelled}，排队的已取消=${second.cancelled}，释放后再调用：${after.error}`);
  }

  private static async churn(): Promise<ScriptProbeResult> {
    const startedAt = Date.now();
    let ok = 0;
    for (let i = 0; i < 30; i++) {
      const session = ScriptThreadProbe.newSession();
      const run = await session.evaluate(`${i} * 2`, 'churn.js');
      if (run.value === String(i * 2)) ok++;
      session.release();
    }
    return ScriptThreadProbe.result(ok === 30, `${ok}/30 正常，共 ${Date.now() - startedAt} ms`);
  }

  private static jsExpr(code: string): NativeExpr {
    // 代码里带时间戳，每次验证都重新载入，不复用上一次留下的全局变量。
    return new NativeExpr(new ProbeExprHost()).loadScript(NativeJsLibrary.forCode(`// probe ${Date.now()}\n${code}`));
  }

  private static async jsLibraryCall(): Promise<ScriptProbeResult> {
    const expr = ScriptThreadProbe.jsExpr('function sign(p) { return native.md5(p).slice(0, 8); }\n' +
      "const title = () => native.sel('@css:h1@text');\n" +
      "function shape() { return { a: [1, '二'], b: null }; }\n" +
      'function viaBytes(t) { return native.bytesBase64(native.bytes(t)); }');
    const scope = new NativeScope().set('item', '<div><h1>斗破</h1></div>').set('baseUrl', '');
    const startedAt = Date.now();
    const signed: NativeValue = expr.evaluate("sign('abc')", scope);
    const loadMs = Date.now() - startedAt;
    const expected: NativeValue = expr.evaluate("substring(md5('abc'), 0, 8)", scope);
    const title: NativeValue = expr.evaluate('title()', scope);
    const shape = JSON.stringify(expr.evaluate('shape()', scope));
    const bytes = expr.evaluate("viaBytes('中文😀')", scope) === expr.evaluate("bytesBase64(bytes('中文😀'))", scope);
    const ok = signed === expected && title === '斗破' && shape === '{"a":[1,"二"],"b":null}' && bytes;
    return ScriptThreadProbe.result(ok,
      `签名 ${signed}（应为 ${expected}），标题 ${title}，对象 ${shape}，字节往返 ${bytes}；首次调用含载入 ${loadMs} ms`);
  }

  private static async jsLibraryThroughput(): Promise<ScriptProbeResult> {
    const expr = ScriptThreadProbe.jsExpr('function twice(x) { return x * 2; }\n' +
      'function hashed(x) { return native.md5(String(x)); }');
    const scope = new NativeScope();
    expr.evaluate('twice(0)', scope);
    let wrong = 0;
    let startedAt = Date.now();
    for (let i = 0; i < 2000; i++) {
      if (expr.evaluate('twice(n)', scope.set('n', i)) !== i * 2) wrong++;
    }
    const plainMs = Date.now() - startedAt;
    startedAt = Date.now();
    for (let i = 0; i < 500; i++) {
      if (expr.evaluate('hashed(n)', scope.set('n', i)) !== expr.evaluate('md5(str(n))', scope)) wrong++;
    }
    const nativeMs = Date.now() - startedAt;
    const averageMicros = Math.round(plainMs * 1000 / 2000);
    return ScriptThreadProbe.result(wrong === 0 && plainMs < 2000,
      `2000 次纯 JS 调用 ${plainMs} ms（平均 ${averageMicros} 微秒）；` +
        `500 次带 native.md5 的调用 ${nativeMs} ms（含对照计算）；错误 ${wrong} 次`);
  }

  private static async jsLibraryErrors(): Promise<ScriptProbeResult> {
    const expr = ScriptThreadProbe.jsExpr('function spin() { for (;;) {} }\n' +
      "function boom() { throw new Error('坏了'); }\n" +
      'function bad() { return native.nope(); }\n' +
      'function twice(x) { return x * 2; }');
    const scope = new NativeScope();
    const failure = (source: string): string => {
      try {
        expr.evaluate(source, scope);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    };
    const startedAt = Date.now();
    const spin = failure('spin()');
    const spinMs = Date.now() - startedAt;
    const boom = failure('boom()');
    const bad = failure('bad()');
    const after: NativeValue = expr.evaluate('twice(21)', scope);
    const ok = /300 ms/.test(spin) && spinMs < 1500 && /boom/.test(boom) && /坏了/.test(boom) && /bad/.test(bad) &&
      after === 42;
    return ScriptThreadProbe.result(ok,
      `死循环：${spin}（${spinMs} ms）；抛错：${boom}；未知 native：${ScriptThreadProbe.firstLine(bad)}；之后再调用得到 ${after}`);
  }

  private static async jsLibraryCheck(): Promise<ScriptProbeResult> {
    const clash = NativeJsLibrary.check('function md5(x) { return x; }', []);
    const libClash = NativeJsLibrary.check('function sign() { return 1; }', ['sign']);
    const syntax = NativeJsLibrary.check('function (', []);
    const topLevel = NativeJsLibrary.check("var x = native.md5('a');", []);
    const good = NativeJsLibrary.check('const ok = () => 1;', []);
    const ok = /内置函数重名/.test(clash) && /lib/.test(libClash) && /^js：/.test(syntax) && /顶层/.test(topLevel) &&
      good === '';
    return ScriptThreadProbe.result(ok,
      `重名：${clash}；与 lib 重名：${libClash}；语法错误：${ScriptThreadProbe.firstLine(syntax)}；` +
        `顶层调用 native：${ScriptThreadProbe.firstLine(topLevel)}；正常代码：${good || '通过'}`);
  }

  /** 一个只有搜索阶段的原生书源，搜索交给 js 里的 search。代码带时间戳，每次验证都重新载入。 */
  private static scriptSource(js: string, extra: Record<string, NativeValue> = {}): NativeSourceRunner {
    return ScriptThreadProbe.scriptRunner(js, extra, new ProbeRunnerHost());
  }

  private static scriptRunner(js: string, extra: Record<string, NativeValue>, host: ProbeRunnerHost): NativeSourceRunner {
    const definition: Record<string, NativeValue> = {
      sourceFormat: 'native', version: 1, name: '脚本验证', url: 'https://www.baidu.com',
      js: `// probe ${Date.now()}\n${js}`, search: { script: 'search' }
    };
    for (const key of Object.keys(extra)) definition[key] = extra[key];
    return new NativeSourceRunner(NativeSourceSpec.fromObject(definition), host, {});
  }

  private static async scriptStage(url: string): Promise<ScriptProbeResult> {
    const host = new ProbeRunnerHost();
    const runner = ScriptThreadProbe.scriptRunner(`function search(ctx) {
  const target = ${JSON.stringify(url)};
  const first = http.get(target);
  const all = http.all([target, target, target]);
  let sizes = [first.status + '/' + first.body.length];
  for (const r of all) sizes.push(r.status + '/' + r.body.length);
  return [{ name: sizes.join(' '), bookUrl: '/probe', kind: native.md5(ctx.key).slice(0, 6) }];
}`, {}, host);
    const startedAt = Date.now();
    const books: NativeBookRecord[] = await runner.search('斗破', 1);
    const ms = Date.now() - startedAt;
    const ok = books.length === 1 && /^200\/\d+ 200\/\d+ 200\/\d+ 200\/\d+$/.test(books[0].name) && host.requests === 4 &&
      books[0].kind === new NativeExpr(new ProbeExprHost()).evaluate("substring(md5('斗破'), 0, 6)", new NativeScope());
    return ScriptThreadProbe.result(ok,
      `1 次请求加 3 次并发请求：${books.length > 0 ? books[0].name : '无结果'}；地址 ${books.length > 0 ? books[0].bookUrl : ''}；共 ${ms} ms`);
  }

  private static async scriptStageState(): Promise<ScriptProbeResult> {
    const host = new ProbeRunnerHost();
    const js = `var runs = (typeof runs === 'number' ? runs : 0);
function search(ctx) {
  runs += 1;
  vars.set('mode', 'b');
  temp.set('t', 1);
  cache.put('c', 'v', 60);
  cookie.set('https://www.baidu.com/', 'sid=9');
  return [{ name: [runs, vars.get('mode'), temp.get('t'), cache.get('c'), cookie.get('https://www.baidu.com/', 'sid'),
    device.id].join('|'), bookUrl: '/x' }];
}`;
    const runner = ScriptThreadProbe.scriptRunner(js, {}, host);
    let startedAt = Date.now();
    const first: NativeBookRecord[] = await runner.search('a', 1);
    const firstMs = Date.now() - startedAt;
    startedAt = Date.now();
    const second: NativeBookRecord[] = await runner.search('a', 1);
    const secondMs = Date.now() - startedAt;
    const a = first.length > 0 ? first[0].name : '';
    const b = second.length > 0 ? second[0].name : '';
    const ok = a === '1|b|1|v|9|probe' && b === '2|b|1|v|9|probe' && host.savedVars['mode'] === 'b';
    return ScriptThreadProbe.result(ok, `第一次 ${a}（${firstMs} ms，含载入），第二次 ${b}（${secondMs} ms，复用会话）`);
  }

  private static async scriptStageLimits(): Promise<ScriptProbeResult> {
    const failure = async (runner: NativeSourceRunner): Promise<string> => {
      try {
        await runner.search('a', 1);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    };
    const budget = await failure(ScriptThreadProbe.scriptSource(
      "function search() { for (let i = 0; i < 5; i++) http.get('data:text/plain,' + i); return []; }",
      { scriptLimits: { requests: 3 } }));
    const spin = await failure(ScriptThreadProbe.scriptSource('function search() { for (;;) {} }'));
    let stop = false;
    const looping = ScriptThreadProbe.scriptSource("function search() { for (;;) http.get('https://www.baidu.com/'); }")
      .setCancelCheck((): boolean => stop);
    const startedAt = Date.now();
    setTimeout((): void => {
      stop = true;
    }, 800);
    const cancelled = await failure(looping);
    const cancelMs = Date.now() - startedAt;
    const ok = /请求次数超过上限（3 次）/.test(budget) && /计算时间超过 2 秒/.test(spin) && /已取消/.test(cancelled) &&
      cancelMs < 2500;
    return ScriptThreadProbe.result(ok, `预算：${ScriptThreadProbe.firstLine(budget)}；死循环：${spin}；` +
      `取消：${cancelled}（${cancelMs} ms）`);
  }

  private static async jsLibraryLoad(): Promise<ScriptProbeResult> {
    const parts: string[] = [];
    for (let i = 0; i < 3000; i++) {
      parts.push(`function f${i}(x) { var t = [${i}, ${i + 1}, ${i + 2}]; return x + t[0] + t.length; }`);
    }
    const code = parts.join('\n');
    const big = ScriptThreadProbe.jsExpr(code);
    const scope = new NativeScope();
    let startedAt = Date.now();
    const first: NativeValue = big.evaluate('f2999(1)', scope);
    const loadMs = Date.now() - startedAt;
    startedAt = Date.now();
    const second: NativeValue = big.evaluate('f10(1)', scope);
    const warmMs = Date.now() - startedAt;
    for (let i = 0; i < 5; i++) {
      ScriptThreadProbe.jsExpr(`function other${i}() { return ${i}; }`).evaluate(`other${i}()`, scope);
    }
    startedAt = Date.now();
    const reloaded: NativeValue = big.evaluate('f2999(2)', scope);
    const reloadMs = Date.now() - startedAt;
    const ok = first === 3003 && second === 14 && reloaded === 3004;
    return ScriptThreadProbe.result(ok,
      `约 ${Math.round(code.length / 1024)} KB 代码首次载入并调用 ${loadMs} ms，之后单次 ${warmMs} ms；` +
        `被挤出缓存后重新载入 ${reloadMs} ms，结果 ${first}/${second}/${reloaded}`);
  }

  private static newSession(options?: JSScriptSessionOptions): JSScriptSession {
    const http = new HttpClient(15000);
    return new JSScriptSession((name: string, payload: string): Promise<string> | string =>
      ScriptThreadProbe.host(http, name, payload), options);
  }

  private static async withSession(body: (session: JSScriptSession) => Promise<ScriptProbeResult>,
    options?: JSScriptSessionOptions): Promise<ScriptProbeResult> {
    const session = ScriptThreadProbe.newSession(options);
    try {
      return await body(session);
    } finally {
      session.release();
    }
  }

  private static host(http: HttpClient, name: string, payload: string): Promise<string> | string {
    if (name === 'echo') return payload;
    if (name === 'fail') throw new Error(payload);
    if (name === 'sleep') {
      return new Promise<string>((resolve: (value: string) => void): void => {
        setTimeout((): void => resolve(''), Number(payload) || 0);
      });
    }
    if (name === 'sel') {
      const request = JSON.parse(payload) as Record<string, string>;
      return JSON.stringify(new AnalyzeRule(request['html'] || '', '').getStringList(request['rule'] || ''));
    }
    if (name === 'http') {
      const startedAt = Date.now();
      return http.execute({ url: payload, method: 'GET', headers: {} }).then((response): string => JSON.stringify({
        code: response.statusCode,
        length: response.body.length,
        ms: Date.now() - startedAt,
        error: response.error || ''
      }));
    }
    throw new Error(`unknown host call: ${name}`);
  }

  /** 0..count-1 的十进制位数之和。 */
  private static digitsUpTo(count: number): number {
    let total = 0;
    for (let i = 0; i < count; i++) total += String(i).length;
    return total;
  }

  private static result(passed: boolean, detail: string): ScriptProbeResult {
    const result = new ScriptProbeResult();
    result.passed = passed;
    result.detail = detail;
    return result;
  }

  private static ms(value: number): string {
    return `${Math.round(value)} ms`;
  }

  private static firstLine(text: string): string {
    return (text || '').split('\n')[0];
  }

  private static message(error: Object): string {
    if (error instanceof Error) return error.message || String(error);
    return String(error);
  }
}
