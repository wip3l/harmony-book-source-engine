// Executes shared code with deterministic platform substitutes; no device claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(path.join(process.env.DEVECO_HOME,
  'sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript'));
const root = path.resolve(__dirname, '../sourceengine/src/main/ets');
const cache = new Map();
const storage = new Map();
const stubs = {
  '@kit.BasicServicesKit': {deviceInfo: {deviceType: 'phone'}},
  '@kit.ArkTS': {util: {TextEncoder: class {encodeInto(s) {return Buffer.from(s);}},
    Base64Helper: class {encodeToStringSync(a) {return Buffer.from(a).toString('base64');}
      decodeSync(s) {return Uint8Array.from(Buffer.from(s,'base64'));}}}},
  '@kit.ArkWeb': {webview: {WebCookieManager: {fetchCookieSync: () => 'default=1'}}},
  '@kit.CryptoArchitectureKit': {cryptoFramework: {createMd: name => {
    const h = require('node:crypto').createHash(name.toLowerCase());
    return {updateSync: v => h.update(v.data),digestSync: () => ({data:h.digest()})};
  }}},
  '@ohos.net.http': {}, '@ohos.data.preferences': {}, '@devzeng/quickjs': {}
};
function load(name) {
  if (stubs[name]) return stubs[name];
  if (cache.has(name)) return cache.get(name).exports;
  const module = {exports:{}};
  cache.set(name,module);
  const source = fs.readFileSync(path.join(root,name+'.ts'),'utf8');
  const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2021}}).outputText;
  vm.runInNewContext(output,{module,exports:module.exports,console,setTimeout,clearTimeout,
    AppStorage:{get:k=>storage.get(k),setOrCreate:(k,v)=>storage.set(k,v)},
    require: dep=>load(dep.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(name),dep)) : dep)
  },{filename:name});
  return module.exports;
}
async function run() {
  const {SourceEngineHost:host} = load('core/host/SourceEngineHost');
  const {BookSource} = load('model/data/Book');
  const source = new BookSource(); source.bookSourceUrl = 'https://host.test';
  const {CookieStore} = load('core/http/CookieStore');
  const {BookSourceRuntimeStore:store} = load('core/book/BookSourceRuntimeStore');
  assert.equal(CookieStore.forSource(source.bookSourceUrl),CookieStore);
  assert.equal(store.forSource(source),null);
  const persistence = {getBookSource:async()=>source,updateBookSourceLoginRuntime:async()=>{}};
  store.install(persistence);
  assert.equal(store.forSource(source),persistence);
  host.setError(source,'default error'); assert.equal(host.getError(source),'default error');
  const {BookSourceStageWebRuntime:Runtime,StageWebRuntimeRequest:Request} = load('core/book/BookSourceStageWebRuntime');
  let active = 0, peak = 0;
  const evaluate = async script => {
    active++; peak=Math.max(peak,active);
    try {await new Promise(r=>setTimeout(r,10)); return vm.runInNewContext(script,{atob,btoa,TextEncoder,TextDecoder}, {timeout:1000});}
    finally {active--;}
  };
  const runtime = Runtime.get();
  const controller = {runJavaScript:evaluate};
  runtime.attach(controller); runtime.setReady(true,controller);
  const request = () => { const r=new Request(); r.source=source; r.code='result = "ok"'; return r; };
  const defaults = await Promise.all([runtime.execute(request()),runtime.execute(request())]);
  assert.equal(peak,1,'default ArkWeb execution must remain serial');
  assert.equal(defaults[0].value,'ok');
  peak=0;
  const jar = {getCookie:()=> 'isolated=1'};
  host.install({cookies:()=>jar,persistence:()=>persistence,
    scripts:{concurrent:true,forceFullScripts:true,allowSynchronousQuickJs:false,evaluate}});
  assert.equal(CookieStore.forSource(source.bookSourceUrl),jar);
  await Promise.all([runtime.execute(request()),runtime.execute(request())]);
  assert.equal(peak,2,'independent executor permits parallel tasks');
  host.install({requests:{isCancelled:()=>true}});
  await assert.rejects(runtime.execute(request()),/取消/);
  const {BookSourceRateLimiter,RateLimitAcquireResult} = load('core/http/BookSourceRateLimiter');
  assert.equal(await BookSourceRateLimiter.acquire(source),RateLimitAcquireResult.Cancelled);
  host.install({});
  assert.equal(CookieStore.forSource(source.bookSourceUrl),CookieStore);
  const {NativeSourceImport} = load('core/nativesource/NativeSourceImport');
  const {NativeSourceService:native} = load('core/nativesource/NativeSourceService');
  const definition = {sourceFormat:'native',version:1,name:'Cache test',url:source.bookSourceUrl,type:'text',
    search:{url:source.bookSourceUrl+'/search',list:'$.items',fields:{name:'$.name',bookUrl:'$.url'}}};
  const nativeSource = NativeSourceImport.importObject(definition);
  const nativeHost = native.runner(nativeSource,{},()=>false).host;
  nativeHost.cachePut('item','first account',60);
  assert.equal(nativeHost.cacheGet('item'),'first account');
  NativeSourceImport.importObject(definition);
  assert.equal(nativeHost.cacheGet('item'),'first account','pure conversion preserves live cache');
  nativeSource.loginInfo='{"nativeToken":"second"}';
  assert.equal(nativeHost.cacheGet('item'),undefined,'another account cannot read cached values');
  nativeHost.cachePut('item','second account',60);
  nativeSource.jsLib=NativeSourceImport.importObject({...definition,name:'Changed definition'}).jsLib;
  assert.equal(nativeHost.cacheGet('item'),undefined,'changed definitions use fresh cache');
  nativeHost.cachePut('item','new definition',60);
  native.importObject(definition);
  assert.equal(nativeHost.cacheGet('item'),undefined,'actual reimport clears source cache');
  console.log('PASS shared host: default serial runtime, injected parallel runtime, cookies, persistence, cancellation');
  console.log('PASS native conversion and cache isolation across definition/account changes and actual reimport');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
