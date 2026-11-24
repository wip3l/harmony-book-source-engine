// java.put() in a list rule belongs to that item, like Android Legado's search-result variables. A source that stores
// the book id with java.put() while building bookUrl and reads it back with java.get() in tocUrl used to read the
// source-wide copy, i.e. the id written by the LAST search result: every opened book showed another book's catalog.
// DEVECO_HOME=... node scripts/rule-item-variable-scope-check.cjs
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
  const {BookSource, Book} = load('model/data/Book');
  const {BookSourceRuntimeStore} = load('core/book/BookSourceRuntimeStore');
  const {BookSourceStageWebRuntime: Runtime, StageWebRuntimeRequest: Request} = load('core/book/BookSourceStageWebRuntime');
  const {RuleExecutionService} = load('core/rule/RuleExecutionService');
  const {RuleBatchExecutionRequest, RuleFieldRequest} = load('core/rule/RuleExecutionModels');
  const URL = 'http://item-scope.test';
  const saved = {variable: '', loginHeader: '', loginInfo: JSON.stringify({cdkey: 'k1'})};
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
  const evaluate = async script => vm.runInNewContext(script, {atob, btoa, TextEncoder, TextDecoder, escape,
    unescape, encodeURIComponent, decodeURIComponent}, {timeout: 5000});
  const runtime = Runtime.get();
  const controller = {runJavaScript: evaluate};
  runtime.attach(controller); runtime.setReady(true, controller);

  const source = new BookSource();
  source.bookSourceUrl = URL;
  source.bookSourceName = 'item-scope';
  Object.assign(source, saved);

  // Search: the bookUrl rule (complete script, routed to the web runtime) stores each result's id.
  const search = new RuleBatchExecutionRequest();
  search.source = source;
  search.stage = 'search';
  search.ownerId = 'rule-item-variable-scope-search';
  search.baseUrl = URL;
  search.contents = [{bookId: '101', bookName: 'A'}, {bookId: '202', bookName: 'B'}, {bookId: '303', bookName: 'C'}]
    .map(item => JSON.stringify(item));
  search.fields = [
    new RuleFieldRequest('name', 'bookName'),
    new RuleFieldRequest('bookUrl', '<js>\nvar cdkey = String(source.getLoginInfoMap().get("cdkey"))\n' +
      'params={{$.bookId}}\njava.put("myBookId", params);\n' +
      `'${URL}/getCatalog?bookId='+params+'&token='+cdkey;\n</js>`, true)
  ];
  search.timeoutMs = 20000;
  const found = await RuleExecutionService.get().executeBatch(search);
  assert.equal(found.errors.join('; '), '');
  assert.deepEqual(Array.from(found.values, v => v.bookUrl),
    ['101', '202', '303'].map(id => `${URL}/getCatalog?bookId=${id}&token=k1`));
  const contexts = Array.from(found.contextValues, json => JSON.parse(json));
  assert.deepEqual(contexts.map(ctx => String(ctx.myBookId)), ['101', '202', '303'],
    'each search result keeps the id its own bookUrl rule stored');

  // Open the middle result: tocUrl reads the id back while the source-wide copy still holds the last result's id.
  const book = new Book();
  book.bookUrl = found.values[1].bookUrl;
  book.origin = URL;
  book.variable = found.contextValues[1];
  const open = new Request();
  open.source = source;
  open.book = book;
  open.baseUrl = book.bookUrl;
  open.code = 'String(java.get("myBookId"))';
  assert.equal((await runtime.execute(open)).value, '202', 'the opened book reads its own id, not the last result\'s');

  // A put made while a book is open belongs to that book and is read back from it.
  open.code = 'java.put("page", "3"); "ok"';
  assert.equal((await runtime.execute(open)).value, 'ok');
  assert.equal(book.variableMap['page'], '3', 'java.put with an open book writes the book variable');

  // Without a list item or a book the value stays source-wide, as before.
  const plain = new Request();
  plain.source = source;
  plain.baseUrl = URL;
  plain.code = 'java.put("token2", "x"); "ok"';
  assert.equal((await runtime.execute(plain)).value, 'ok');
  plain.code = 'String(java.get("token2"))';
  assert.equal((await runtime.execute(plain)).value, 'x', 'a source-wide put is still read back');
  console.log('PASS java.put in list rules is kept per item and per book; java.get reads the item/book value first');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
