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
  const copy = new BookSource();
  assert.equal(host.readerImagesDeferred(source), false, 'default content/download callers materialize images');
  host.setReaderImagesDeferred(source, true);
  host.bindSource(source, copy);
  assert.equal(host.readerImagesDeferred(copy), true, 'per-request image policy follows copied sources');
  host.setReaderImagesDeferred(source, false);
  host.bindSource(source, copy);
  assert.equal(host.readerImagesDeferred(copy), false, 'rebinding cannot retain an old deferred policy');
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
  const independent = NativeSourceImport.importObject(definition);
  independent.loginInfo = 'private';
  independent.getContentRule().content = 'changed';
  const fresh = NativeSourceImport.importObject(definition);
  assert.notEqual(fresh.loginInfo, 'private');
  assert.notEqual(fresh.getContentRule().content, 'changed');
  assert.equal(typeof fresh.getContentRule, 'function');
  const {SourceDefinitionCache} = load('core/nativesource/SourceDefinitionCache');
  let conversions = 0;
  const definitions = new SourceDefinitionCache(raw => {conversions++; if(raw==='bad') throw Error('bad'); return raw;}, 2, 12);
  definitions.normalize('aa'); definitions.normalize('aa'); assert.equal(conversions,1);
  definitions.normalize('bb'); definitions.normalize('aa'); definitions.normalize('cc');
  definitions.normalize('bb'); assert.equal(conversions,4, 'LRU eviction');
  assert.throws(()=>definitions.normalize('bad')); assert.throws(()=>definitions.normalize('bad'));
  assert.equal(conversions,6, 'failed conversion is not cached');
  definitions.normalize('oversized'); definitions.normalize('oversized');
  assert.equal(conversions,8, 'oversized result bypasses cache');
  definitions.clear(); definitions.normalize('bb'); assert.equal(conversions,9);
  const {NativePureParser} = load('core/nativesource/NativePureParser');
  assert.throws(()=>NativePureParser.run('{}'), /synchronous QuickJS disabled/);
  const executor = {concurrent:true,forceFullScripts:true,allowSynchronousQuickJs:false,
    evaluate:async()=>{throw Error('pure parsing must not execute scripts');}};
  host.install({scripts:executor,cookies:()=>jar});
  const parse = request => JSON.parse(NativePureParser.run(JSON.stringify(request)));
  assert.equal(parse({kind:'expression',rule:'a + 2',scope:{a:3}}),5);
  assert.equal(parse({kind:'expression',rule:'hello {{a}}',template:true,scope:{a:3}}),'hello 3');
  const html = Array.from({length:178},(_,i)=>`<img src="https://img.test/${i}.jpg">`).join('');
  const images = parse({kind:'select',rule:'img@src',content:html,list:true});
  assert.equal(images.length,178);
  images.forEach((url,i)=>assert.equal(url,`https://img.test/${i}.jpg`));
  assert.equal(parse({kind:'items',rule:'img',content:html}).length,178);
  assert.equal(host.scriptExecutor(),executor, 'parser must not replace host');
  assert.equal(host.cookies(source.bookSourceUrl),jar);
  assert.throws(()=>NativePureParser.run('x'.repeat(8*1024*1024+1)),/8M/);
  assert.throws(()=>parse({kind:'expression',rule:'cookie("https://host.test", "session")'}),/Cookie/);
  assert.throws(()=>parse({kind:'invalid',rule:''}),/未知/);
  // Routing preserves the original selector host for script-bearing rules.
  const {NativeScope} = load('core/nativesource/NativeExpr');
  const runner = native.runner(fresh,{},()=>false);
  let offloads=0, fallbacks=0;
  runner.host.parsePure=async input=>{offloads++; return NativePureParser.run(input);};
  runner.host.select=()=>{fallbacks++;return ['legacy'];};
  const scope=new NativeScope().set('item',html).set('baseUrl','https://host.test');
  assert.equal((await runner.rawValue('img@src',scope,true)).length,178);
  assert.equal(await runner.rawValue('img@src@js:result',scope),'legacy');
  assert.equal(offloads,1); assert.equal(fallbacks,1);
  runner.host.parsePure=undefined;
  assert.equal(await runner.rawValue('img@src',scope),'legacy', 'absent parser keeps old path');
  let cancelled=false, dispatched=0;
  host.setReaderImagesDeferred(fresh,true);
  host.install({nativeParsing:async()=>{dispatched++;cancelled=true;return '[]';}});
  const cancellable=native.runner(fresh,{},()=>cancelled);
  await assert.rejects(cancellable.host.parsePure('{}'),/取消/);
  await assert.rejects(cancellable.host.parsePure('{}'),/取消/);
  assert.equal(dispatched,1, 'cancellation checked before and after dispatch');
  host.install({});
  console.log('PASS pure parser: 178 images, expressions, host isolation, bounds and script routing');
  console.log('PASS immutable definition cache: hits, LRU, bounds, errors and independent runtime objects');
  console.log('PASS shared host: default serial runtime, injected parallel runtime, cookies, persistence, cancellation');
  console.log('PASS native conversion and cache isolation across definition/account changes and actual reimport');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
