// 原生书源的阶段级 rate 与脚本 http 的 responseType: 'bytes'。
// 阶段 rate：导入校验、batch 提示按实际生效的 rate、声明式与脚本请求带上所在阶段的 rate。
// 字节响应：宿主给出 bodyBase64，脚本里得到不可枚举的 response.bytes（Uint8Array），各种长度的补位都对。
// 运行：node --experimental-strip-types scripts/native-stage-rate-binary-check.mjs

import { createTestHost, loadNativeSourceModules } from './lib/load-native-source-modules.mjs';
import { createNodeScriptEngine } from './lib/node-script-engine.mjs';

const mods = await loadNativeSourceModules();
const { NativeExpr, NativeSourceSpec, NativeSourceRunner, NativeJsPrelude, JsonPathEvaluator } = mods;

let assertions = 0;
function equal(actual, expected, message) {
  assertions++;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected: ${b}\n  actual:   ${a}`);
}
async function rejects(promise, pattern, message) {
  assertions++;
  let text = '';
  try {
    await promise;
  } catch (e) {
    text = e.message;
  }
  if (!pattern.test(text)) throw new Error(`${message}：应当报错，实际：${text || '未报错'}`);
}
function throws(fn, pattern, message) {
  assertions++;
  let text = '';
  try {
    fn();
  } catch (e) {
    text = e.message;
  }
  if (!pattern.test(text)) throw new Error(`${message}：应当报错，实际：${text || '未报错'}`);
}

const define = (object) => NativeSourceSpec.fromObject(JSON.parse(JSON.stringify(object)));
const base = {
  sourceFormat: 'native', version: 1, name: '阶段限流', url: 'https://api.example.com',
  search: { url: '/s', list: '$.l', fields: { name: '$.n', bookUrl: '$.u' } },
};
const book = { bookUrl: 'https://api.example.com/b/1', tocUrl: '', name: '书', author: '', kind: '', type: 'text', vars: {} };
const chapter = { url: 'https://api.example.com/c/1', title: '第一章', index: 0 };
const pages = {
  '/s': { l: [{ n: '书', u: '/b/1' }] },
  '/toc': { l: [{ t: '第一章', u: '/c/1' }] },
  '/c/1': { text: '正文' },
};
const respond = async (request) => pages[request.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]] ?? null;
function host(fetchOverride) {
  const h = createTestHost(JsonPathEvaluator, respond);
  h.scriptEngine = (code) => createNodeScriptEngine(NativeJsPrelude, NativeExpr.scriptBuiltinNames(), code);
  h.userAgent = () => 'UA-test';
  if (fetchOverride) {
    h.fetch = async (request) => { h.requests.push(request); return fetchOverride(request); };
  }
  return h;
}

try {
  // ---------- 导入校验 ----------
  const tocSpec = { url: '/toc', list: '$.l', fields: { title: '$.t', url: '$.u' } };
  define({ ...base, rate: '1/1000', toc: { ...tocSpec, rate: '5/1000' } });
  define({ ...base, toc: { ...tocSpec, rate: 0 } });
  define({ ...base, toc: { ...tocSpec, rate: '1500' } });
  assertions += 3;
  throws(() => define({ ...base, toc: { ...tocSpec, rate: 'fast' } }), /toc\.rate 写法不对/, '阶段 rate 写法不对时导入报错');
  throws(() => define({ ...base, search: { ...base.search, rate: { n: 1 } } }), /search\.rate 写法不对/, '阶段 rate 不能是对象');

  // ---------- batch 提示按阶段实际生效的 rate ----------
  const warnings = (object) => NativeSourceSpec.warningsOf(JSON.parse(JSON.stringify(object)));
  const content = { url: '{{chapter.url}}', text: '$.text' };
  equal(warnings({ ...base, rate: '1000', toc: { ...tocSpec, batch: 4, rate: '5/1000' }, content: { ...content, batch: 4 } })
    .filter((w) => w.includes('batch')),
  ['rate 写成纯数字（每次请求间隔 1000 毫秒）会让 content.batch 的并发失效，分页只能一页一页排队；站点要限流时写成“次数/毫秒”，例如 "8/1000"'],
  '阶段写了“次数/毫秒”的 rate 时，顶层纯数字不再连带提示该阶段');
  equal(warnings({ ...base, toc: { ...tocSpec, batch: 4, rate: '500' } }).filter((w) => w.includes('batch')).length, 1,
    '阶段自己的 rate 写成纯数字时也提示');
  assertions++;
  if (!warnings({ ...base, toc: { ...tocSpec, batch: 4, rate: '500' } })[0].startsWith('toc.rate 写成纯数字')) {
    throw new Error('阶段 rate 的提示应指明 toc.rate');
  }

  // ---------- 声明式请求带上所在阶段的 rate ----------
  const staged = define({ ...base, rate: '1/1000', toc: { ...tocSpec, rate: '5/1000' }, content: { ...content, rate: 0 } });
  let h = host();
  await new NativeSourceRunner(staged, h, {}).search('书', 1);
  await new NativeSourceRunner(staged, h, {}).toc(book);
  await new NativeSourceRunner(staged, h, {}).content(book, chapter);
  equal(h.requests.map((r) => [r.url.replace('https://api.example.com', ''), r.stageRate ?? null]),
    [['/s', null], ['/toc', { stage: 'toc', rate: '5/1000' }], ['/c/1', { stage: 'content', rate: '0' }]],
    '没写 rate 的阶段沿用顶层，写了的按阶段排队，写 0 的阶段也单独标出（不限流）');

  // ---------- 脚本阶段的请求同样带上 ----------
  const scripted = define({ ...base, toc: { script: 'toc', rate: '2/1000' },
    js: `function toc(ctx) { http.get('/toc'); http.all(['/toc']); return [{ title: '一', url: '/c/1' }]; }
      function search(ctx) { http.get('/s'); return []; }`,
    search: { script: 'search' } });
  h = host();
  await new NativeSourceRunner(scripted, h, {}).toc(book);
  await new NativeSourceRunner(scripted, h, {}).search('书', 1);
  equal(h.requests.map((r) => r.stageRate ?? null),
    [{ stage: 'toc', rate: '2/1000' }, { stage: 'toc', rate: '2/1000' }, null],
    '脚本里的 http.get、http.all 按所在阶段排队；阶段没写 rate 时不带');

  // ---------- responseType: 'bytes' ----------
  const samples = [[], [0], [0, 1], [0, 1, 2], [250, 255, 128, 64], [1, 2, 3, 4, 5], [0x00, 0x01, 0x00, 0x00, 0x00, 0x0c]];
  const binary = define({ ...base, search: { script: 'search' }, js: `function search(ctx) {
    const out = [];
    for (let i = 0; i < ${samples.length}; i++) {
      const r = http.get('/font/' + i, { responseType: 'bytes' });
      out.push([r.ok, r.body, r.bytes instanceof Uint8Array, Array.from(r.bytes), Object.keys(r).indexOf('bytes'),
        'bodyBase64' in r]);
    }
    const text = http.get('/s');
    const batch = http.all([{ url: '/font/1', responseType: 'bytes' }, '/s']);
    out.push([typeof text.bytes, Array.from(batch[0].bytes), typeof batch[1].bytes]);
    return [{ name: JSON.stringify(out), bookUrl: '/b/1' }];
  }` });
  h = host((request) => {
    const path = request.url.replace('https://api.example.com', '');
    if (!request.binary) return { ok: true, status: 200, body: JSON.stringify(pages['/s']), url: request.url, error: '' };
    const index = Number(path.split('/').pop());
    return { ok: true, status: 200, body: '', bodyBase64: Buffer.from(samples[index]).toString('base64'),
      url: request.url, error: '' };
  });
  const result = JSON.parse((await new NativeSourceRunner(binary, h, {}).search('', 1))[0].name);
  equal(result.slice(0, samples.length), samples.map((bytes) => [true, '', true, bytes, -1, false]),
    '字节按原样还原（各种补位长度），bytes 不可枚举，bodyBase64 不留在响应上');
  equal(result[samples.length], ['undefined', [0], 'undefined'], '普通请求没有 bytes；http.all 里可以单独取字节');
  equal(h.requests.map((r) => r.binary === true), [...samples.map(() => true), false, true, false],
    '只有写了 responseType: bytes 的请求按字节取');

  for (const [options, pattern, message] of [
    ["{ responseType: 'blob' }", /responseType 只能是 'text' 或 'bytes'/, 'responseType 写错时报错'],
    ["{ responseType: 'bytes', webView: true }", /不能与 webView 同用/, '字节不能经网页抓取取'],
  ]) {
    const bad = define({ ...base, search: { script: 'search' },
      js: `function search(ctx) { http.get('/font/0', ${options}); return []; }` });
    await rejects(new NativeSourceRunner(bad, host(), {}).search('', 1), pattern, message);
  }

  console.log(`Native stage rate & binary check passed: ${assertions} assertions.`);
} finally {
  mods.cleanup();
}
