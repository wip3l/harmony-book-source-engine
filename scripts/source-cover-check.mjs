import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadNativeSourceModules, createTestHost } from './lib/load-native-source-modules.mjs';

const mods = await loadNativeSourceModules();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-check-'));
try {
  // Only replace the platform crypto/UTF8 boundaries; exercise the actual decoder.
  let code = fs.readFileSync(new URL('../sourceengine/src/main/ets/core/nativesource/SourceImageDecoder.ts', import.meta.url), 'utf8');
  code = code.replace(/^import .*;\r?\n/gm, '');
  code = `import crypto from 'node:crypto';
    const util = { TextEncoder: class { encodeInto(s) { return new TextEncoder().encode(s); } } };
    const NativeSourceCrypto = { decryptBytes(a, data, key, iv) {
      const k = Buffer.from(key, 'hex');
      const cipher = crypto.createDecipheriv('aes-' + k.length * 8 + '-cbc', k, Buffer.from(iv, 'hex'));
      return new Uint8Array(Buffer.concat([cipher.update(data), cipher.final()]));
    }, async decryptBytesAsync(...args) { return this.decryptBytes(...args); } };
    const NativeSourceSpec = globalThis.__coverCheckSpec;\n` + code;
  globalThis.__coverCheckSpec = mods.NativeSourceSpec;
  const filename = path.join(dir, 'decoder.ts');
  fs.writeFileSync(filename, code);
  const { SourceImageDecoder: decoder } = await import(pathToFileURL(filename));
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');
  const key = '0123456789abcdef';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), iv);
  const encrypted = Buffer.concat([iv, cipher.update(png), cipher.final()]);
  const spec = { algorithm: 'AES/CBC/PKCS7Padding', key, keyEncoding: 'utf8', ivPrefixBytes: 16 };
  assert.deepEqual(Buffer.from(decoder.decode(encrypted, spec)), png);
  assert.deepEqual(Buffer.from(await decoder.decodeAsync(encrypted, spec)), png);
  assert.deepEqual(Buffer.from(decoder.decode(encrypted.subarray(16), { ...spec, ivPrefixBytes: 0, iv: iv.toString('hex') })), png);
  assert.equal(decoder.decode(png, spec), png);
  assert.throws(() => decoder.decode(encrypted.subarray(1), spec));
  assert.throws(() => decoder.decode(new Uint8Array(decoder.MAX_BYTES + 1), spec));
  assert.throws(() => decoder.decode(encrypted, { ...spec, key: 'bad' }));
  assert.throws(() => decoder.decode(encrypted, { ...spec, iv: iv.toString('hex') }));
  // An IV that happens to start with "BM" must still be decrypted rather than passed through as a bitmap.
  const bmIv = Buffer.concat([Buffer.from('BM'), crypto.randomBytes(14)]);
  const bmCipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), bmIv);
  const bmEncrypted = Buffer.concat([bmIv, bmCipher.update(png), bmCipher.final()]);
  assert.deepEqual(Buffer.from(decoder.decode(bmEncrypted, spec)), png);
  const bmp = Buffer.alloc(58);
  bmp.write('BM', 0); bmp.writeUInt32LE(58, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(1, 18); bmp.writeInt32LE(1, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  assert.equal(decoder.decode(bmp, spec), bmp, 'a real bitmap is still recognised');
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(20)]);
  assert.equal(decoder.decode(heic, spec), heic, 'HEIF covers are recognised');
  const { SourceCoverUrl: urls, NativeSourceRunner: Runner, NativeSourceSpec: Spec, JsonPathEvaluator } = mods;
  const stage = { url: 'https://example.com/list', list: '=data', fields: { name: '=item.name', bookUrl: '=item.url', coverUrl: '=item.cover' } };
  const definition = { nativeSource: 1, name: 'test', url: 'https://example.com', coverDecode: spec,
    search: stage, explore: { ...stage, menus: [{ title: 'test', url: '/list' }] }, detail: { fields: { coverUrl: '=data[0].cover' } } };
  assert.deepEqual(Spec.validate(definition), []);
  // Import rejects keys the decoder would refuse, instead of failing on every cover later.
  for (const bad of [{ key: '0123456789abcde' }, { key: 'abc', keyEncoding: 'hex' }, { key: '00'.repeat(15), keyEncoding: 'hex' },
    { key: '0123456789abcdef', keyEncoding: 'base64' }, { key: 'g'.repeat(32), keyEncoding: 'hex' }, { key: '' }]) {
    assert.equal(Spec.validate({ ...definition, coverDecode: { ...spec, ...bad } }).length, 1, JSON.stringify(bad));
  }
  assert.deepEqual(Spec.validate({ ...definition, coverDecode: { ...spec, key: '00'.repeat(32), keyEncoding: 'hex' } }), []);
  assert.deepEqual(Spec.validate({ ...definition, coverDecode: { ...spec, key: '密钥'.repeat(2) + '0000' } }), [],
    'utf8 length counts bytes, not characters');
  assert.equal(Spec.validate({ ...definition, coverDecode: { ...spec, key: '\ud800'.repeat(16) } }).length, 1,
    'lone surrogates do not throw');
  const host = createTestHost(JsonPathEvaluator, () => [{ name: 'test', url: '/book', cover: 'https://cdn.example.com/a.webp' }]);
  const runner = new Runner(definition, host);
  const books = await runner.search('test', 1);
  assert.equal(urls.source(books[0].coverUrl), definition.url);
  assert.equal(urls.address(books[0].coverUrl), 'https://cdn.example.com/a.webp');
  assert.equal(books[0].coverUrl.includes(key), false);
  const menus = await runner.exploreMenus();
  const discovered = await runner.explore(menus[0].target || menus[0].url, 1);
  assert.equal(discovered[0].coverUrl, books[0].coverUrl);
  const detail = await runner.detail({ bookUrl: 'https://example.com/book', vars: {} });
  assert.equal(detail.coverUrl, books[0].coverUrl);
  assert.equal(urls.wrap('', definition.url), '');
  assert.equal(urls.source(urls.wrap('https://cdn.example.com/a#old', definition.url)), definition.url);
  assert.throws(() => urls.source('https://cdn.example.com/a#source-cover-v1=%'));
  // Exercise the actual loader with only HTTP/crypto platform boundaries replaced.
  globalThis.__coverLoaderCheck = { NativeSourceSpec: Spec, SourceCoverUrl: urls, SourceImageDecoder: decoder };
  const loaderFile = path.join(dir, 'loader.ts');
  const loaderSource = fs.readFileSync(new URL('../sourceengine/src/main/ets/core/nativesource/SourceCoverLoader.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  fs.writeFileSync(loaderFile, 'const { NativeSourceSpec, SourceCoverUrl, SourceImageDecoder } = globalThis.__coverLoaderCheck;\n' + loaderSource);
  const { SourceCoverLoader: loader } = await import(pathToFileURL(loaderFile));
  const raw = urls.wrap('https://cdn.example.com/a.png', definition.url, {'Accept-Language':'en-US',Referer:'https://example.com/'});
  const requests = [];
  let binary = encrypted;
  const http = { async executeBinary(request, limit) { requests.push({request,limit}); return {success:true,data:binary}; } };
  const source = { bookSourceUrl: definition.url, jsLib: Spec.pack(definition) };
  assert.deepEqual(Buffer.from(await loader.load(http,source,raw)),png);
  assert.equal(requests[0].request.url,'https://cdn.example.com/a.png','local metadata never reaches the HTTP URL');
  assert.equal(requests[0].request.headers['Accept-Language'],'en-US');
  assert.equal(requests[0].request.headers.Referer,'https://example.com/');
  assert.equal(requests[0].request.cookieSource,definition.url);
  assert.equal(requests[0].limit,decoder.MAX_BYTES);
  binary=png;
  const plainDefinition={...definition}; delete plainDefinition.coverDecode;
  source.jsLib=Spec.pack(plainDefinition);
  assert.deepEqual(Buffer.from(await loader.load(http,source,raw)),png,'ordinary covers can carry custom headers');
  await loader.load(http,source,urls.wrap('https://cdn.example.com/a.png',definition.url));
  assert.equal(requests.at(-1).request.headers['Accept-Language'],'zh-CN,zh;q=0.9,en;q=0.8');
  await assert.rejects(loader.load(http,{...source,bookSourceUrl:'https://wrong.example'},raw),/source mismatch/);
  binary=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
  assert.deepEqual(Buffer.from(await loader.load(http,source,raw)),binary,'ordinary SVG covers retain renderer support');
  binary=new Uint8Array();
  await assert.rejects(loader.load(http,source,raw),/byte length/);
  await assert.rejects(loader.load({executeBinary:async()=>({success:false})},source,raw),/download failed/);
  delete globalThis.__coverLoaderCheck;
  console.log('source-cover-check: AES prefix/fixed IV, bounds, malformed parameters and search/explore/detail passed');
} finally { mods.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
