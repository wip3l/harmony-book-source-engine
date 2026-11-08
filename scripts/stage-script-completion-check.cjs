// Rhino-compatible script values in the ArkWeb stage runtime, executed with Node vm as the Web host.
// DEVECO_HOME=... node scripts/stage-script-completion-check.cjs
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
const web = script => vm.runInNewContext(script, {atob, btoa, TextEncoder, TextDecoder, escape, unescape,
  encodeURIComponent, decodeURIComponent}, {timeout: 5000});

const {StageScriptCompletion: C} = load('core/book/StageScriptCompletion');
const prepare = code => C.instrument(code, web(C.locateScript(code)));
// What ArkWeb returns for the prepared code, with the stage runtime's fallback rule applied.
const value = code => web(`(function(){${C.prelude()}let v=(function(){return eval(${JSON.stringify(prepare(code))});})();` +
  `if(v===undefined&&${C.STATE}.set)v=${C.STATE}.value;return v;})()`);

// The source idiom: a value produced in an earlier branch, followed by an `if` that is not taken.
const idiom = `let r = "type_style";\nif (r.includes("type_style")) {\n  JSON.stringify({data: [1]});\n}\n` +
  `if (!r.includes("type_style")) {\n  JSON.stringify({data: []})\n}`;
assert.equal(vm.runInNewContext(idiom), undefined, 'ES2015 completion is undefined (the bug)');
assert.equal(value(idiom), '{"data":[1]}', 'Rhino value: last expression statement that ran');
assert.equal(value('let a = 1;\nif (a) { "x" } else { "y" }\nfor (const i of []) { i }'), 'x');
assert.equal(value('try { "t" } finally { var z = 1 }\nwhile (false) {}'), 't');
assert.equal(value('switch (2) { case 2: "two"; break; default: "d" }\nif (0) {}'), 'two');
// Values that ArkWeb already produces stay exactly as they are.
assert.equal(value('"a"; if (true) { "b" }'), 'b');
assert.equal(value('var x = 2; x * 3'), 6);
assert.equal(value('if (true) { ({k: 1}) }').k, 1);
// Function bodies are not part of the script value; sequences and ASI keep their meaning.
assert.equal(value('function f() { "inner"; return 1 }\nf(), "outer"\nif (false) {}'), 'outer');
assert.equal(value('const g = () => { "arrow" }; g()\nif (0) {}'), undefined);
assert.equal(value('let n = 1\nn++\nif (false) {}'), 1);
assert.equal(value('"use strict"; if (false) {}'), undefined, 'directives are not wrapped');
assert.ok(!prepare('function h(){ "x" }').includes(C.VALUE_FUNCTION), 'function bodies untouched');
assert.ok(!prepare('class K { m() { "x" } static { "y" } }').includes(C.VALUE_FUNCTION), 'class bodies untouched');
// Rhino-only syntax that acorn cannot parse runs unchanged.
assert.equal(prepare('for each (var v in list) { v }'), 'for each (var v in list) { v }');
assert.equal(C.instrument('abc', 'not-json'), 'abc');
assert.equal(C.instrument('abc', encodeURIComponent('[0,9]')), 'abc', 'out-of-range positions are rejected');
assert.equal(C.isCandidate('JSON.stringify(x)'), false);
assert.equal(C.isCandidate(idiom), true);
console.log('PASS script value rewrite: Rhino idioms, unchanged explicit values, functions/classes/directives, parse failures');

async function runtimeCheck() {
  const {BookSource} = load('model/data/Book');
  const {BookSourceStageWebRuntime: Runtime, StageWebRuntimeRequest: Request} = load('core/book/BookSourceStageWebRuntime');
  let locateCalls = 0;
  const evaluate = async script => {
    if (script.includes('acorn.parse(')) locateCalls++;
    return web(script);
  };
  const runtime = Runtime.get();
  const controller = {runJavaScript: evaluate};
  runtime.attach(controller); runtime.setReady(true, controller);
  const source = new BookSource();
  source.bookSourceUrl = 'https://completion.test';
  source.jsLib = 'function wrap(v) { return JSON.stringify({data: v}); }';
  const request = (code, options = {}) => {
    const r = new Request();
    r.source = source; r.code = code; r.content = 'INPUT'; r.baseUrl = source.bookSourceUrl;
    Object.assign(r, options);
    return r;
  };
  const code = 'let books = [1, 2];\nif (baseUrl.includes("completion")) {\n  result = "raw";\n  wrap(books);\n}\n' +
    'if (!baseUrl.includes("completion")) {\n  wrap([]);\n}';
  assert.equal((await runtime.execute(request(code))).value, '{"data":[1,2]}');
  assert.equal((await runtime.execute(request(code))).value, '{"data":[1,2]}');
  assert.equal(locateCalls, 1, 'each distinct script is parsed once');
  assert.equal((await runtime.execute(request(code, {rhinoCompletion: false}))).value, 'raw',
    'opting out keeps the previous fallback to result');
  assert.equal((await runtime.execute(request('if (false) { "x" }'))).value, 'INPUT',
    'no statement ran: unchanged fallback to the input');
  assert.equal((await runtime.execute(request('wrap([3])'))).value, '{"data":[3]}');
  assert.equal(locateCalls, 2, 'scripts without control statements are not parsed');
  console.log('PASS stage runtime: Rhino value used only when ArkWeb returns undefined, per-script cache, opt-out');
}
runtimeCheck().catch(error => { console.error(error); process.exitCode = 1; });
