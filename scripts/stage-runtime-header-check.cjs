// A stage script's java.ajax() must not wait on the serial stage runtime for the source's `@js:` header rule.
// DEVECO_HOME=... node scripts/stage-runtime-header-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(path.join(process.env.DEVECO_HOME || 'C:/Program Files/Huawei/DevEco Studio',
  'sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript'));
const root = path.resolve(__dirname, '../sourceengine/src/main/ets');
const cache = new Map();
const stubs = {
  '@ohos.deviceInfo': {sdkApiVersion: 26},
  '@kit.BasicServicesKit': {deviceInfo: {deviceType: 'phone'}},
  '@kit.ArkTS': {util: {TextEncoder: class {encodeInto(s) {return Buffer.from(s);}},
    Base64Helper: class {encodeToStringSync(a) {return Buffer.from(a).toString('base64');}
      decodeSync(s) {return Uint8Array.from(Buffer.from(s,'base64'));}}}},
  '@kit.ArkWeb': {webview: {WebCookieManager: {fetchCookieSync: () => ''}}},
  '@kit.CryptoArchitectureKit': {cryptoFramework: {}},
  '@ohos.net.http': {}, '@ohos.data.preferences': {}, '@devzeng/quickjs': {}
};
function load(name) {
  if (stubs[name]) return stubs[name];
  if (cache.has(name)) return cache.get(name).exports;
  const module = {exports:{}};
  cache.set(name, module);
  const source = fs.readFileSync(path.join(root, name + '.ts'), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2021}}).outputText;
  vm.runInNewContext(output, {module, exports:module.exports, console, setTimeout, clearTimeout,
    AppStorage:{get:()=>undefined, setOrCreate:()=>{}},
    require: dep => load(dep.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(name), dep)) : dep)
  }, {filename:name});
  return module.exports;
}

async function run() {
  const {BookSource} = load('model/data/Book');
  const {AnalyzeUrl} = load('core/rule/AnalyzeUrl');
  const {BookSourceHeaderRuntime} = load('core/book/BookSourceHeaderRuntime');
  const {BookSourceStageWebRuntime: Runtime, StageWebRuntimeRequest: Request} = load('core/book/BookSourceStageWebRuntime');
  const sent = [];
  AnalyzeUrl.prototype.fetchWithRetry = async function (req) {
    sent.push({url: req.url, headers: Object.assign({}, req.headers)});
    return {url: req.url, statusCode: 200, headers: {}, body: '{"ok":1}', success: true, error: ''};
  };
  const evaluate = async script => vm.runInNewContext(script, {atob, btoa, TextEncoder, TextDecoder, escape,
    unescape, encodeURIComponent, decodeURIComponent}, {timeout: 5000});
  const runtime = Runtime.get();
  const controller = {runJavaScript: evaluate};
  runtime.attach(controller); runtime.setReady(true, controller);
  const source = new BookSource();
  source.bookSourceUrl = 'https://header.test';
  source.jsLib = 'function secret() { return "k-" + source.getVariable(); }';
  source.variable = 'v1';
  source.header = '@js:\nJSON.stringify({"X-Api-Key": secret(), "X-Fixed": "1"})';
  BookSourceHeaderRuntime.clearCache();
  const request = new Request();
  request.source = source;
  request.baseUrl = source.bookSourceUrl;
  request.code = 'JSON.parse(java.ajax("https://header.test/api")).ok';
  const outcome = await Promise.race([
    runtime.execute(request).then(result => result.value),
    new Promise(resolve => setTimeout(() => resolve('DEADLOCK'), 3000))
  ]);
  assert.notEqual(outcome, 'DEADLOCK', 'java.ajax inside the stage runtime waited on its own header task');
  assert.equal(outcome, '1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers['X-Api-Key'], 'k-v1', 'headers computed by the script with jsLib are sent');
  assert.equal(sent[0].headers['X-Fixed'], '1');
  // Requests issued outside the runtime still resolve the header rule through it.
  sent.length = 0;
  const response = await new AnalyzeUrl(source, null).fetch('https://header.test/direct');
  assert.equal(response.statusCode, 200);
  assert.equal(sent[0].headers['X-Api-Key'], 'k-v1');
  console.log('PASS stage runtime requests reuse script-evaluated headers; direct requests still resolve them');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
