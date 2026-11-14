// A stage task must not bring back an old login token: an empty saved header is a logout, and a task that started
// before the user logged in again must not overwrite the new token when it finishes.
// DEVECO_HOME=... node scripts/stage-runtime-login-state-check.cjs
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
  const {BookSourceRuntimeStore} = load('core/book/BookSourceRuntimeStore');
  const {BookSourceStageWebRuntime: Runtime, StageWebRuntimeRequest: Request} = load('core/book/BookSourceStageWebRuntime');
  const URL = 'https://login-state.test';
  const saved = {variable: 'cfg-1', loginHeader: '', loginInfo: ''};
  let duringFetch = null;
  BookSourceRuntimeStore.install({
    getBookSource: async url => {
      if (url !== URL) return null;
      const row = new BookSource();
      row.bookSourceUrl = URL;
      Object.assign(row, saved);
      return row;
    },
    updateBookSourceLoginRuntime: async (url, variable, loginHeader, loginInfo) => {
      if (url === URL) Object.assign(saved, {variable, loginHeader, loginInfo});
    }
  });
  AnalyzeUrl.prototype.fetchWithRetry = async function (req) {
    if (duringFetch) { const action = duringFetch; duringFetch = null; action(); }
    return {url: req.url, statusCode: 200, headers: {}, body: '{"ok":1}', success: true, error: ''};
  };
  const evaluate = async script => vm.runInNewContext(script, {atob, btoa, TextEncoder, TextDecoder, escape,
    unescape, encodeURIComponent, decodeURIComponent}, {timeout: 5000});
  const runtime = Runtime.get();
  const controller = {runJavaScript: evaluate};
  runtime.attach(controller); runtime.setReady(true, controller);

  // A page still holding the source it opened with (old token) runs a script after the user logged out.
  const held = new BookSource();
  held.bookSourceUrl = URL;
  held.variable = 'cfg-1';
  held.loginHeader = 'old-key';
  const execute = async code => {
    const request = new Request();
    request.source = held;
    request.baseUrl = URL;
    request.code = code;
    return (await runtime.execute(request)).value;
  };
  assert.equal(await execute('source.getLoginHeader() || "(empty)"'), '(empty)',
    'the logged-out (empty) saved header wins over the held snapshot');
  assert.equal(saved.loginHeader, '', 'the old token is not written back after a logout');
  assert.equal(held.loginHeader, '', 'the held snapshot is refreshed to the saved state');

  // The user logs in again while a long task (one that started with the old token) is waiting on its request.
  saved.loginHeader = 'old-key';
  held.loginHeader = 'old-key';
  duringFetch = () => { saved.loginHeader = 'new-key'; saved.variable = 'cfg-2'; };
  assert.equal(await execute('JSON.parse(java.ajax("https://login-state.test/api")).ok'), '1');
  assert.equal(saved.loginHeader, 'new-key', 'a task that started before the login cannot overwrite the new token');
  assert.equal(saved.variable, 'cfg-2', 'nor a variable saved meanwhile');

  // What the script itself changes is still saved.
  assert.equal(await execute('source.putLoginHeader("script-key"); source.setVariable("cfg-3"); "done"'), 'done');
  assert.equal(saved.loginHeader, 'script-key');
  assert.equal(saved.variable, 'cfg-3');
  assert.equal(await execute('source.putLoginHeader(""); "out"'), 'out');
  assert.equal(saved.loginHeader, '', 'a script logging out clears the saved header');
  console.log('PASS stage tasks keep logouts, never write an old token over a new login, and save their own changes');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
