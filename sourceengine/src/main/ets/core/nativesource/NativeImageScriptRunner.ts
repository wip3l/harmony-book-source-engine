import { JSScriptSession, JSScriptSessionOptions } from '@devzeng/quickjs';
import { NativeSourceCrypto } from './NativeSourceCrypto';
import { SourceEngineHost } from '../host/SourceEngineHost';

export interface NativeImageScriptContext {
  url: string;
  index: number;
  params: Object;
}

/** Image-only session: no stage host, cookies, network, storage or login APIs. */
export class NativeImageScriptRunner {
  static readonly MAX_BYTES: number = 20 * 1024 * 1024;
  private static sequence: number = 0;
  private static queue: number[] = [];
  private static active: boolean = false;

  static program(js: string, fn: string, context: NativeImageScriptContext): string {
    if (!/^[A-Za-z_$][\w$]*$/.test(fn)) throw new Error('content.imageDecode.script 必须是 JS 函数名');
    const json = JSON.stringify(context);
    if (json.length > 32768) throw new Error('content.imageDecode 脚本上下文过大');
    if (!js || js.length > 256 * 1024) throw new Error('content.imageDecode.script 需要 js 函数库（最多 256K 字符）');
    // Capture bridge and input before evaluating the untrusted function library.
    return `(function(input,ctx,host){
      "use strict";
      const invoke=(op,data,algorithm,keyHex,ivHex)=>new Uint8Array(host(op,data,
        JSON.stringify({algorithm:algorithm,keyHex:keyHex||"",ivHex:ivHex||""})));
      const image=Object.freeze({
        decrypt:(algorithm,data,keyHex,ivHex)=>invoke("decrypt",data,algorithm,keyHex,ivHex),
        encrypt:(algorithm,data,keyHex,ivHex)=>invoke("encrypt",data,algorithm,keyHex,ivHex),
        hash:(algorithm,data)=>invoke("hash",data,algorithm),
        hmac:(algorithm,data,keyHex)=>invoke("hmac",data,algorithm,keyHex)
      });
      ${js}
      if(typeof ${fn}!=="function") throw new Error("content.imageDecode.script: function missing");
      return ${fn}(input,ctx);
    })(new Uint8Array(__imageInput),${json},__imageHost)`;
  }

  static async run(js: string, fn: string, input: Uint8Array, context: NativeImageScriptContext,
    cancelled: () => boolean = (): boolean => false): Promise<Uint8Array> {
    const code = this.program(js, fn, context);
    if (!input.length || input.length > this.MAX_BYTES) throw new Error('图片脚本输入须为 1 字节至 20 MiB');
    if (cancelled()) throw new Error('书源请求已取消');
    const executor = SourceEngineHost.imageScripts();
    if (executor) return await executor.run(code, input, cancelled);
    // At most four downloaded buffers are retained; only one runtime is active.
    if (this.queue.length + (this.active ? 1 : 0) >= 4) throw new Error('图片脚本队列已满，请稍后重试');
    const ticket = ++this.sequence;
    this.queue.push(ticket);
    const queuedAt = Date.now();
    try {
      while (this.active || this.queue[0] !== ticket) {
        if (cancelled()) throw new Error('书源请求已取消');
        if (Date.now() - queuedAt >= 30000) throw new Error('图片脚本排队超时');
        await new Promise<void>((resolve): void => { setTimeout(resolve, 25); });
      }
      if (cancelled()) throw new Error('书源请求已取消');
    } catch (e) {
      this.queue = this.queue.filter((id: number): boolean => id !== ticket);
      throw e;
    }
    this.queue.shift();
    this.active = true;
    let session: JSScriptSession | null = null;
    let timer: number = -1;
    let expired = false;
    let stopped = false;
    const started = Date.now();
    try {
      const options = new JSScriptSessionOptions();
      options.memoryLimitBytes = 96 * 1024 * 1024;
      options.hostTimeoutMs = 10000;
      session = new JSScriptSession((): string => { throw new Error('图片脚本不开放此宿主接口'); }, options,
        async (name: string, bytes: Uint8Array, params: string): Promise<Uint8Array> => {
          if (cancelled() || Date.now() - started >= 10000) throw new Error('图片脚本已停止');
          return await NativeSourceCrypto.imageOperation(name, bytes, params);
        });
      const current = session;
      timer = setInterval((): void => {
        expired = Date.now() - started >= 10000;
        stopped = cancelled();
        if (expired || stopped) current.cancel();
      }, 25);
      const result = await session.evaluateBinary(code, input, 'content.imageDecode.js', 2000);
      if (stopped || cancelled()) throw new Error('书源请求已取消');
      if (expired || Date.now() - started >= 10000 || result.timedOut) throw new Error('图片脚本超时');
      if (!result.success) throw new Error(result.error || '图片脚本执行失败');
      if (!result.bytes.length || result.bytes.length > this.MAX_BYTES) throw new Error('图片脚本须返回 1 字节至 20 MiB 的字节数据');
      return result.bytes;
    } finally {
      if (timer >= 0) clearInterval(timer);
      try { session?.release(); } finally { this.active = false; }
    }
  }
}
