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
    } };\n` + code;
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
  assert.deepEqual(Buffer.from(decoder.decode(encrypted.subarray(16), { ...spec, ivPrefixBytes: 0, iv: iv.toString('hex') })), png);
  assert.equal(decoder.decode(png, spec), png);
  assert.throws(() => decoder.decode(encrypted.subarray(1), spec));
  assert.throws(() => decoder.decode(new Uint8Array(decoder.MAX_BYTES + 1), spec));
  assert.throws(() => decoder.decode(encrypted, { ...spec, key: 'bad' }));
  assert.throws(() => decoder.decode(encrypted, { ...spec, iv: iv.toString('hex') }));
  const { SourceCoverUrl: urls, NativeSourceRunner: Runner, NativeSourceSpec: Spec, JsonPathEvaluator } = mods;
  const stage = { url: 'https://example.com/list', list: '=data', fields: { name: '=item.name', bookUrl: '=item.url', coverUrl: '=item.cover' } };
  const definition = { nativeSource: 1, name: 'test', url: 'https://example.com', coverDecode: spec,
    search: stage, explore: { ...stage, menus: [{ title: 'test', url: '/list' }] }, detail: { fields: { coverUrl: '=data[0].cover' } } };
  assert.deepEqual(Spec.validate(definition), []);
  const host = createTestHost(JsonPathEvaluator, () => [{ name: 'test', url: '/book', cover: 'https://cdn.example.com/a.webp' }]);
  const runner = new Runner(definition, host);
  const books = await runner.search('test', 1);
  assert.equal(urls.source(books[0].coverUrl), definition.url);
  assert.equal(urls.address(books[0].coverUrl), 'https://cdn.example.com/a.webp');
  assert.equal(books[0].coverUrl.includes(key), false);
  assert.equal(urls.wrap('', definition.url), '');
  assert.equal(urls.source(urls.wrap('https://cdn.example.com/a#old', definition.url)), definition.url);
  assert.throws(() => urls.source('https://cdn.example.com/a#source-cover-v1=%'));
  console.log('source-cover-check: AES prefix/fixed IV, bounds, malformed parameters and native search passed');
} finally { mods.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
