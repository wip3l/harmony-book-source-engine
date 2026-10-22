import assert from 'node:assert/strict';
import { loadNativeSourceModules, createTestHost } from './lib/load-native-source-modules.mjs';

const mods = await loadNativeSourceModules();
try {
  const { NativeSourceSpec: Spec, NativeSourceRunner: Runner, JsonPathEvaluator: Json, SourceCoverUrl: Cover } = mods;
  const base = { nativeSource: 1, name: 'fixture', url: 'https://example.com', type: 'comic',
    search: { url: '/search', list: '$.items[*]', fields: { name: '$.name', bookUrl: '$.url', coverUrl: '$.cover' } },
    toc: { list: '$.items[*]', fields: { title: '$.name', url: '$.url' } },
    content: { images: '= data.images', imageDecode: {
      algorithm: 'AES/CBC/PKCS7Padding', key: '0123456789abcdef0123456789abcdef', keyEncoding: 'utf8', ivPrefixBytes: 16
    } } };
  const book = { bookUrl: 'https://example.com/book/1', tocUrl: 'https://example.com/book/1/chapters',
    name: 'book', author: '', kind: '', type: 'comic', vars: {} };
  const chapter = { url: 'https://example.com/chapter/1', title: 'chapter', index: 0 };
  const host = () => createTestHost(Json, () => ({ images: ['https://example.com/a.jpg'], items: [] }));
  const content = (def) => new Runner(def, host()).content(book, chapter);
  assert.deepEqual(Spec.validate(base), []);
  const scripted = structuredClone(base);
  scripted.js = 'function decodeImage(bytes, ctx) { return bytes; }';
  scripted.content.imageDecode = { script: 'decodeImage', params: { nested: { url: '= book.bookUrl' }, literal: 'ok' } };
  assert.deepEqual(Spec.validate(scripted), []);
  assert(Spec.scriptFunctions(scripted).includes('decodeImage'));
  assert.deepEqual((await content(scripted)).imageDecode, {
    algorithm: '', key: '', iv: '', script: 'decodeImage', processPlainImages: false,
    params: { nested: { url: book.bookUrl }, literal: 'ok' }
  });
  const spaced = structuredClone(scripted); spaced.content.imageDecode.script = ' decodeImage ';
  assert.equal((await content(spaced)).imageDecode.script, 'decodeImage');
  for (const patch of [{ script: '' }, { script: 'evil()' }, { params: [] }, { params: null },
    { processPlainImages: 'yes' }, { algorithm: '' }, { key: '' }, { iv: '' }, { ivPrefixBytes: 16 }, { keyEncoding: 'hex' }]) {
    const def = structuredClone(scripted); Object.assign(def.content.imageDecode, patch);
    assert(Spec.validate(def).length, JSON.stringify(patch));
  }
  const oversized = structuredClone(scripted); oversized.content.imageDecode.params = { text: 'a'.repeat(16385) };
  await assert.rejects(content(oversized), /content.imageDecode.params/);
  const noLibrary = structuredClone(scripted); delete noLibrary.js;
  assert(Spec.validate(noLibrary).some(error => error.includes('content.imageDecode.script')));
  const standardParams = structuredClone(base); standardParams.content.imageDecode.params = {};
  assert(Spec.validate(standardParams).length);
  const output = (await content(base)).imageDecode;
  assert.equal(output.ivPrefixBytes, 16);
  assert.equal(output.iv, '');
  assert.equal(output.key, Buffer.from(base.content.imageDecode.key).toString('hex'));
  for (const patch of [{ ivPrefixBytes: 0 }, { ivPrefixBytes: 8 }, { ivPrefixBytes: '16' }, { iv: '' },
    { iv: '= "0123456789abcdef"' }, { algorithm: 'AES/CTR/NoPadding' }, { algorithm: '3DES/CBC/PKCS5Padding' },
    { keyEncoding: 'base64' }]) {
    const def = structuredClone(base); Object.assign(def.content.imageDecode, patch);
    assert(Spec.validate(def).length, JSON.stringify(patch));
  }
  for (const encoding of ['hex', 'utf8']) {
    const def = structuredClone(base);
    const key = encoding === 'hex' ? '00'.repeat(32) : '0123456789abcdef0123456789abcdef';
    Object.assign(def.content.imageDecode, { key: '= ' + JSON.stringify(key), keyEncoding: encoding });
    assert.equal((await content(def)).imageDecode.key, encoding === 'hex' ? key : Buffer.from(key).toString('hex'));
  }
  for (const [key, encoding] of [['xx', 'hex'], ['short', 'utf8'], ['', 'utf8']]) {
    const def = structuredClone(base); Object.assign(def.content.imageDecode, {key, keyEncoding: encoding});
    await assert.rejects(content(def), /content.imageDecode.key/);
  }
  const legacy = structuredClone(base);
  legacy.content.imageDecode = { algorithm: 'AES/CBC/PKCS5Padding', key: '= "0123456789abcdef"', iv: '= "fedcba9876543210"' };
  assert.deepEqual((await content(legacy)).imageDecode, { algorithm: 'AES/CBC/PKCS5Padding',
    key: Buffer.from('0123456789abcdef').toString('hex'), iv: Buffer.from('fedcba9876543210').toString('hex') });
  const missing = structuredClone(legacy); missing.content.imageDecode.key = 'not-a-selector';
  await assert.rejects(content(missing), /密钥求值为空/);

  const menuDef = structuredClone(base);
  menuDef.explore = { list: '$.normal[*]', fields: { name: '$.name', bookUrl: '$.url' }, menus: [
    { title: 'default', url: '/home' },
    { title: 'both', url: '/home', list: '$.vip[*]', fields: { name: '$.label', bookUrl: '$.link' } },
    { title: 'list', url: '/home', list: '$.other[*]' },
    { title: 'fields', url: '/home', fields: { name: '= "overridden"', bookUrl: '$.url' } }
  ] };
  const menuHost = createTestHost(Json, () => ({ normal: [{name:'global',url:'/global'}],
    vip:[{label:'vip',link:'/vip'}], other:[{name:'other',url:'/other'}] }));
  assert.deepEqual(Spec.validate(menuDef), []);
  const runner = new Runner(menuDef, menuHost);
  const menus = await runner.exploreMenus();
  for (const [index, name] of ['global','vip','other','overridden'].entries()) {
    assert.equal((await runner.explore(menus[index].target))[0].name, name);
  }
  const standalone = structuredClone(menuDef);
  standalone.explore = { menus: [menuDef.explore.menus[1]] };
  assert.deepEqual(Spec.validate(standalone), []);
  assert.equal((await new Runner(standalone, menuHost).explore('native:menu:0'))[0].name, 'vip');
  standalone.explore.menus[0].fields = [];
  assert(Spec.validate(standalone).some(error => error.includes('fields')));

  for (const [rule, expected] of [[undefined, book.tocUrl],
    ['= book.bookUrl + "/chapters"', book.tocUrl], ['= book.tocUrl + "/chapters"', book.tocUrl + '/chapters'],
    ['https://example.com/custom', 'https://example.com/custom']]) {
    const def = structuredClone(base); if (rule !== undefined) def.toc.url = rule;
    const h = host(); await new Runner(def,h).toc(book);
    assert.equal(h.requests[0].url, expected);
    assert(h.traces.some(trace => trace.field === 'toc.url' && trace.preview === expected));
  }
  const invalidUrl = structuredClone(base); invalidUrl.toc.url = '= missingName';
  await assert.rejects(new Runner(invalidUrl,host()).toc(book), /规则 toc.url 出错/);
  for (const rule of ['= book.url + "/chapters"', '= book["url"]', '= book["u" + "rl"]',
    '= get(book, "url", "fallback")', '= lookup(book, "url")', '{{book.url}}/chapters']) {
    const def = structuredClone(base); def.toc.url = rule;
    const h = host();
    await assert.rejects(new Runner(def,h).toc(book), /规则 toc.url 出错：book.url 不存在，请使用 book.bookUrl/);
    assert.equal(h.requests.length, 0, 'mistyped address must fail before HTTP');
    assert(h.traces.some(trace => trace.field === 'toc.url' && trace.error.includes('请使用 book.bookUrl')));
  }
  const scope = new mods.NativeScope().set('book',book).set('chapter',chapter).set('item',{url:'/item'});
  const expr = new mods.NativeExpr(host());
  assert.equal(expr.evaluate('"book.url"',scope),'book.url', 'literal text is not a field access');
  assert.equal(expr.evaluate('item.url',scope),'/item');
  assert.equal(expr.evaluate('chapter.url',scope),chapter.url);
  assert.equal(expr.evaluate('book.vars.missing ?? "fallback"',scope),'fallback');
  assert.equal(expr.evaluate('item.missing',scope),null);
  assert.equal(expr.evaluate('get(book.vars, "url", "fallback")',scope),'fallback');
  assert.equal(expr.evaluate('contains(keys(book), "url")',scope),false,'no alias is injected');

  const headersDef = structuredClone(base);
  headersDef.headers = { 'Accept-Language': 'en', 'User-Agent': 'test-agent' };
  headersDef.coverHeaders = { 'accept-language': 'zh-CN', Referer: '= source.url + "/"' };
  const headersHost = createTestHost(Json, () => ({items:[{name:'test',url:'/book',cover:'https://cdn.example.com/a.png'}]}));
  const cover = (await new Runner(headersDef,headersHost).search('test'))[0].coverUrl;
  assert.equal(Cover.source(cover), base.url);
  assert.equal(Cover.address(cover),'https://cdn.example.com/a.png');
  assert.deepEqual(Cover.headers(cover), {'Accept-Language':'zh-CN',Referer:'https://example.com/','User-Agent':'test-agent'});
  assert.notEqual(cover,Cover.wrap(Cover.address(cover),base.url,{'Accept-Language':'en'}), 'headers affect cache identity');
  assert.deepEqual(Cover.headers(Cover.wrap(Cover.address(cover),base.url)),{});
  assert.deepEqual(Cover.cleanHeaders({Host:'bad',Referer:'bad\r\nInjected: yes','Accept-Language':'en'}),{'Accept-Language':'en'});
  assert.throws(()=>Cover.headers('https://example.com/a#source-cover-v1=https%3A%2F%2Fexample.com&headers=%'),URIError);
  for (const coverHeaders of [[], 'bad', {Referer: 123}]) {
    assert(Spec.validate({...base,coverHeaders}).some(error=>error.includes('coverHeaders')));
  }
  console.log('source-image-options-check: prefix/key validation, menu overrides, URL typo diagnostics/precedence/traces and cover headers passed');
} finally { mods.cleanup(); }
