// 把原生书源引擎（纯 TS，不依赖系统 API）加载进 Node，并提供一个只走 JSONPath 的测试宿主。
// 与 load-reader-modules.mjs 相同：拷到临时目录并给相对 import 补上 '.ts' 后再加载。

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEtsModule, toNodeModuleSource } from './ets-module-staging.mjs';

const MODULES = [
  'core/nativesource/SourceCoverUrl.ts',
  'core/rule/JsonPathEvaluator.ts',
  'core/nativesource/NativeExpr.ts',
  'core/nativesource/NativeSourceSpec.ts',
  'core/nativesource/NativeSourceRunner.ts',
  'core/http/NetworkErrorText.ts',
];

export async function loadNativeSourceModules() {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-source-check-'));
  const cleanup = () => fs.rmSync(stagingDir, { recursive: true, force: true });
  try {
    const exported = {};
    for (const relative of MODULES) {
      const target = path.join(stagingDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const text = toNodeModuleSource(readEtsModule(relative), relative);
      fs.writeFileSync(target, text);
    }
    for (const relative of MODULES) {
      Object.assign(exported, await import(pathToFileURL(path.join(stagingDir, relative)).href));
    }
    return { ...exported, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** 测试宿主：选择器只支持 JSONPath，请求由 respond(request) 给出响应体（返回 null 表示失败）。 */
export function createTestHost(JsonPathEvaluator, respond) {
  const requests = [];
  const traces = [];
  const cache = new Map();
  const jsonPath = (rootValue, rule) => JsonPathEvaluator.evaluate(rootValue, rule);
  const selectAll = (content, rule) => {
    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return [];
    }
    return jsonPath(parsed, rule);
  };
  return {
    requests,
    traces,
    trace: (entry) => { traces.push(entry); },
    jsonPath,
    select: (content, rule, baseUrl, list) => {
      const found = selectAll(content, rule).map((item) => typeof item === 'string' ? item : JSON.stringify(item));
      return list ? found : found.slice(0, 1);
    },
    selectItems: (content, rule) => selectAll(content, rule),
    digest: (algorithm, text) => crypto.createHash(algorithm.toLowerCase()).update(text, 'utf8').digest('hex'),
    // 与应用内 NativeSourceCrypto 相同的约定：字节以数字列表进出。
    crypto: (name, args) => {
      const buffer = (value) => Buffer.from(value);
      if (name === 'hash') return [...crypto.createHash(String(args[0]).toLowerCase()).update(buffer(args[1])).digest()];
      if (name === 'hmac') {
        return [...crypto.createHmac(String(args[0]).toLowerCase(), buffer(args[1])).update(buffer(args[2])).digest()];
      }
      if (name === 'encrypt' || name === 'decrypt') {
        const [family, mode, padding] = String(args[0]).toLowerCase().split('/');
        const key = buffer(args[2]);
        const algorithm = family === 'aes' ? `aes-${key.length * 8}-${mode}` : `des-ede3-${mode}`;
        const iv = mode === 'ecb' ? null : buffer(args[3]);
        const cipher = name === 'encrypt' ? crypto.createCipheriv(algorithm, key, iv) :
          crypto.createDecipheriv(algorithm, key, iv);
        // 与 NativeSourceCrypto 一致：NoPadding 不补位（Node 默认会自动补 PKCS7）。
        if (padding === 'nopadding') cipher.setAutoPadding(false);
        return [...Buffer.concat([cipher.update(buffer(args[1])), cipher.final()])];
      }
      throw new Error(`test host: unsupported ${name}`);
    },
    cacheGet: (key) => cache.get(key),
    cachePut: (key, value) => { cache.set(key, value); },
    clearCache: () => cache.clear(),
    cookie: (url, name) => (name === 'sessionid' && url.includes('example.com') ? 'abc123' : ''),
    fetch: async (request) => {
      requests.push(request);
      const body = await respond(request);
      if (body === null || body === undefined) {
        return { ok: false, status: 500, body: '', url: request.url, error: 'mock failure' };
      }
      return {
        ok: true, status: 200, body: typeof body === 'string' ? body : JSON.stringify(body), url: request.url, error: ''
      };
    },
  };
}
