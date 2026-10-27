// 脚本阶段引擎的 Node 版：脚本在 worker 线程的 vm 里运行，调用宿主时用 Atomics.wait 同步等待，
// 宿主在主线程上异步处理后写回共享内存。与真机“后台线程 + 主线程代办”的模型一致。

import { Worker } from 'node:worker_threads';

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const control = new Int32Array(workerData.control);
const data = new Uint8Array(workerData.data);
const context = vm.createContext({});
context.__host = (name, payload) => {
  Atomics.store(control, 0, 0);
  parentPort.postMessage({ type: 'call', name: name, payload: payload });
  Atomics.wait(control, 0, 0);
  const state = Atomics.load(control, 0);
  const length = Atomics.load(control, 1);
  const text = Buffer.from(data.subarray(0, length)).toString('utf8');
  if (state === 2) throw new Error(text);
  return text;
};
try {
  vm.runInContext(workerData.prelude, context, { filename: 'native-prelude.js' });
  vm.runInContext(workerData.code, context, { filename: 'js' });
  const result = vm.runInContext(workerData.call, context, { filename: 'script' });
  Promise.resolve(result).then(
    (value) => parentPort.postMessage({ type: 'done', value: value }),
    (error) => parentPort.postMessage({ type: 'error', message: String(error) }));
} catch (error) {
  parentPort.postMessage({ type: 'error', message: String(error) });
}
`;

const DATA_BYTES = 32 * 1024 * 1024;

/** 与 NativeScriptSessions 同一接口：run(fn, ctx, handler, options)。每次运行新开一个 worker。 */
export function createNodeScriptEngine(NativeJsPrelude, builtinNames, code) {
  const prelude = NativeJsPrelude.source(builtinNames, true);
  return {
    runs: 0,
    run(fn, ctx, handler, options) {
      this.runs++;
      const control = new SharedArrayBuffer(8);
      const data = new SharedArrayBuffer(DATA_BYTES);
      const controlView = new Int32Array(control);
      const dataView = new Uint8Array(data);
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { prelude, code, call: NativeJsPrelude.stageSource(fn, ctx), control, data },
      });
      return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        let finished = false;
        const finish = (callback) => {
          if (finished) return;
          finished = true;
          clearInterval(timer);
          worker.terminate();
          callback();
        };
        const timer = setInterval(() => {
          if (options.cancelled()) finish(() => reject(new Error('已取消')));
          else if (Date.now() - startedAt - (options.pausedMs ? options.pausedMs() : 0) > options.wallMs) {
            finish(() => reject(new Error(`运行超过 ${Math.round(options.wallMs / 1000)} 秒`)));
          }
        }, 10);
        worker.on('message', async (message) => {
          if (message.type === 'call') {
            let ok = true;
            let text;
            try {
              const value = await handler(message.name, message.payload ? JSON.parse(message.payload) : []);
              text = JSON.stringify(value === undefined ? null : value);
            } catch (error) {
              ok = false;
              text = error && error.message ? error.message : String(error);
            }
            if (finished) return;
            const bytes = Buffer.from(text, 'utf8');
            dataView.set(bytes.subarray(0, DATA_BYTES));
            Atomics.store(controlView, 1, Math.min(bytes.length, DATA_BYTES));
            Atomics.store(controlView, 0, ok ? 1 : 2);
            Atomics.notify(controlView, 0);
          } else if (message.type === 'done') {
            finish(() => {
              try {
                resolve(NativeJsPrelude.parseResult(message.value));
              } catch (error) {
                reject(new Error('返回值无法转换'));
              }
            });
          } else if (message.type === 'error') {
            finish(() => reject(new Error(NativeJsPrelude.scriptError(message.message, builtinNames))));
          }
        });
        worker.on('error', (error) => finish(() => reject(error)));
      });
    },
  };
}
