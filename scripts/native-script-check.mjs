// 原生书源脚本阶段回归：阶段 script、宿主接口（http/vars/temp/cache/cookie/login/keep/log/device/sleep）、
// 预算、取消、出错提示与定义校验。脚本在 worker 线程里同步调用宿主，与真机的线程模型一致。
// 运行：node --experimental-strip-types scripts/native-script-check.mjs

import vm from 'node:vm';
import { createTestHost, loadNativeSourceModules } from './lib/load-native-source-modules.mjs';
import { createNodeScriptEngine } from './lib/node-script-engine.mjs';

const mods = await loadNativeSourceModules();
const { NativeExpr, NativeScope, NativeSourceSpec, NativeSourceRunner, NativeJsPrelude, JsonPathEvaluator } = mods;

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 测试宿主：在 createTestHost 之上补齐脚本阶段需要的端口，并记下写入。 */
function scriptHost(respond) {
  const host = createTestHost(JsonPathEvaluator, respond);
  const cookies = new Map();
  host.saved = { vars: null, credential: null };
  host.scriptEngine = (code) => createNodeScriptEngine(NativeJsPrelude, NativeExpr.scriptBuiltinNames(), code);
  host.cookieGet = (url, name) => {
    const jar = cookies.get(new URL(url).host) || {};
    return name ? (jar[name] || '') : Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  };
  host.cookieSet = (url, value) => {
    const key = new URL(url).host;
    const jar = cookies.get(key) || {};
    for (const part of value.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name) jar[name] = rest.join('=');
    }
    cookies.set(key, jar);
  };
  host.cookieRemove = (url, name) => {
    const key = new URL(url).host;
    if (!name) cookies.delete(key);
    else if (cookies.get(key)) delete cookies.get(key)[name];
  };
  host.saveVars = async (values) => { host.saved.vars = values; };
  host.saveCredential = async (token, user) => { host.saved.credential = { token, user }; };
  host.deviceId = () => 'odid-test';
  host.userAgent = () => 'UA-test';
  // 界面端口：记下调用，browser 按 host.browserAnswer 返回。
  host.ui = { toasts: [], refreshed: 0, opened: [], verifications: [] };
  host.browserAnswer = { body: '<html>验证后的页面</html>', error: '' };
  host.toast = (message) => { host.ui.toasts.push(message); };
  host.refreshExplore = async () => { host.ui.refreshed++; };
  host.openBrowser = async (url, title, wait) => {
    host.ui.opened.push({ url, title, wait });
    if (wait) await sleep(30);
    return wait ? host.browserAnswer : { body: '', error: '' };
  };
  host.requestVerification = (url, title) => { host.ui.verifications.push({ url, title }); };
  return host;
}

const define = (object) => NativeSourceSpec.fromObject(JSON.parse(JSON.stringify(object)));
const base = {
  sourceFormat: 'native', version: 1, name: '脚本示例', url: 'https://api.example.com',
  search: { url: '/s', list: '$.l', fields: { name: '$.n', bookUrl: '$.u' } },
};
const book = { bookUrl: 'https://api.example.com/b/1', tocUrl: '', name: '书', author: '', kind: '', type: 'text', vars: {} };
const chapter = { url: 'https://api.example.com/c/1', title: '第一章', index: 0 };

const library = {
  '/ids': { ids: [1, 2, 3] },
  '/book?id=1': { id: 1, title: '斗破', author: '土豆' },
  '/book?id=2': { id: 2, title: '凡人', author: '忘语' },
  '/book?id=3': { id: 3, title: '诡秘', author: '乌贼' },
};
const respond = async (request) => {
  const path = request.url.replace(/^https?:\/\/[^/]+/, '');
  if (path.startsWith('/slow')) {
    await sleep(40);
    return { ok: 1 };
  }
  if (path.startsWith('/echo')) return { method: request.method, body: request.body, headers: request.headers };
  for (const prefix of Object.keys(library)) if (path.startsWith(prefix)) return library[prefix];
  return null;
};

try {
  // Final destination survives the synchronous worker bridge; unavailable is explicitly empty.
  const finalUrlSource = define({ ...base,
    js: `function search(ctx) { const r = http.get('/redirect'); return [{ name: r.finalUrl || 'unknown', bookUrl: r.url }]; }`,
    search: { script: 'search' } });
  const finalHost = scriptHost(respond);
  finalHost.fetch = async () => ({ ok: true, status: 200, body: '{}', error: '',
    url: 'https://api.example.com/actual', finalUrl: 'https://api.example.com/actual' });
  equal((await new NativeSourceRunner(finalUrlSource, finalHost, {}).search('', 1))[0].name,
    'https://api.example.com/actual', '最终 URL 穿过脚本工作线程桥接');
  finalHost.fetch = async () => ({ ok: true, status: 200, body: '{}', error: '', url: 'https://api.example.com/redirect' });
  equal((await new NativeSourceRunner(finalUrlSource, finalHost, {}).search('', 1))[0].name,
    'unknown', '不可观测的最终 URL 不用原始地址冒充');
  // ---------- 搜索：循环请求、并发请求、默认 list 与 fields ----------
  const concurrentSource = define({ ...base, search: { script: 'search' }, js: `
    function search() {
      return http.all([0,1,2,3,4,5].map(i => ({url:'/item/' + i, timeout:i === 1 ? 700 : undefined})),
        {concurrency:3, timeout:900}).map(r => ({name:r.body, bookUrl:r.url}));
    }` });
  const concurrentHost = scriptHost(respond);
  let activeRequests = 0, peakRequests = 0, firstFinished = false, filledBeforeSlowFinished = false;
  let releaseFirst; const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  concurrentHost.fetch = async request => {
    concurrentHost.requests.push(request); activeRequests++; peakRequests = Math.max(peakRequests, activeRequests);
    const index = Number(request.url.split('/').at(-1));
    if (index === 0) { await firstGate; firstFinished = true; }
    else {
      if (index === 3) { filledBeforeSlowFinished = !firstFinished; releaseFirst(); }
      await sleep(5);
    }
    activeRequests--;
    return { ok:true, status:200, body:String(index), url:request.url, error:'' };
  };
  const concurrentBooks = await new NativeSourceRunner(concurrentSource, concurrentHost, {}).search('', 1);
  equal(concurrentBooks.map(b => b.name), ['0','1','2','3','4','5'], '并发请求按输入顺序返回');
  equal(peakRequests, 3, 'http.all 使用指定并发');
  equal(filledBeforeSlowFinished, true, '单个慢请求不挡住已空出的并发名额');
  equal(concurrentHost.requests.map(r => r.timeoutMs), [900,700,900,900,900,900], '批量默认超时与单项覆盖传到宿主');
  for (const limit of [1, 8]) {
    const pooled = scriptHost(respond); let active = 0, peak = 0;
    pooled.fetch = async request => {
      active++; peak = Math.max(peak, active); await sleep(5); active--;
      return {ok:true, status:200, body:'x', url:request.url, error:''};
    };
    await new NativeSourceRunner(define({...base, search:{script:'search'}, js:`function search(){
      http.all(Array.from({length:12}, (_,i) => '/item/'+i)${limit === 1 ? ', {concurrency:1}' : ''}); return []; }`}),
      pooled, {}).search('', 1);
    equal(peak, limit, '串行选项和默认 8 并发均生效');
  }
  let batchStopped = false;
  const cancelBatchHost = scriptHost(respond);
  cancelBatchHost.fetch = async request => {
    cancelBatchHost.requests.push(request);
    if (cancelBatchHost.requests.length === 3) batchStopped = true;
    await sleep(5);
    return {ok:true, status:200, body:'x', url:request.url, error:''};
  };
  await rejects(new NativeSourceRunner(concurrentSource, cancelBatchHost, {}).setCancelCheck(() => batchStopped).search('', 1),
    /已取消/, '取消批量请求');
  await sleep(20);
  equal(cancelBatchHost.requests.length, 3, '取消后不再启动队列中的其他请求');
  for (const call of ["http.all(['/x'], {concurrency:0})", "http.all(['/x'], {concurrency:9})",
    "http.all(['/x'], {concurrency:2.5})", "http.all(['/x'], 'bad')", "http.get('/x', {timeout:'8000'})",
    "http.get('/x', {timeout:99})", "http.post('/x', {}, {timeout:60001})", "http.all(['/x'], {timeout:null})"]) {
    const invalidHost = scriptHost(respond);
    await rejects(new NativeSourceRunner(define({...base, search:{script:'search'},
      js:`function search(){ ${call}; return []; }`}), invalidHost, {}).search('', 1),
      /必须是/, '非法并发或超时应拒绝');
    equal(invalidHost.requests.length, 0, '非法选项不发出网络请求');
  }
  const singleHost = scriptHost(respond);
  await new NativeSourceRunner(define({...base, search:{script:'search'}, js:`function search(){
    http.get('/echo', {timeout:500}); http.post('/echo', {}, {timeout:800}); return []; }`}), singleHost, {}).search('', 1);
  equal(singleHost.requests.map(r => r.timeoutMs), [500,800], 'GET 和 POST 单请求超时穿过脚本桥接');
  const batchBudgetHost = scriptHost(respond);
  await rejects(new NativeSourceRunner(define({...base, scriptLimits:{requests:2}, search:{script:'search'},
    js:"function search(){ http.all(['/a','/b','/c'], {concurrency:1}); return []; }"}), batchBudgetHost, {}).search('', 1),
    /请求次数超过上限/, '批量请求不能绕过总请求预算');
  equal(batchBudgetHost.requests.length, 0, '预算不足时整批在发送前拒绝');
  const searchSource = define({
    ...base,
    js: `
      function search(ctx) {
        const ids = http.get('/ids?q=' + encodeURIComponent(ctx.key)).json().ids;
        const pages = http.all(ids.map((id) => '/book?id=' + id));
        log('找到', ids.length, '本');
        return pages.map((p) => { const b = p.json(); return { name: b.title, author: b.author, bookUrl: '/b/' + b.id }; });
      }`,
    search: { script: 'search' },
  });
  let host = scriptHost(respond);
  const books = await new NativeSourceRunner(searchSource, host, {}).search('斗破', 1);
  equal(books.map((b) => [b.name, b.author, b.bookUrl]), [
    ['斗破', '土豆', 'https://api.example.com/b/1'],
    ['凡人', '忘语', 'https://api.example.com/b/2'],
    ['诡秘', '乌贼', 'https://api.example.com/b/3'],
  ], '脚本循环与并发请求，返回数组按同名键取字段');
  equal(host.requests.map((r) => r.url), ['https://api.example.com/ids?q=%E6%96%97%E7%A0%B4',
    'https://api.example.com/book?id=1', 'https://api.example.com/book?id=2', 'https://api.example.com/book?id=3'],
  '相对地址按书源地址补全，请求走宿主 fetch');
  equal(host.requests.every((r) => r.primary === false), true, '脚本里的请求不触发“去验证”');
  equal(host.traces.some((t) => t.type === 'script' && t.rule === 'log' && t.preview === '找到 3 本'), true, 'log 写进调试记录');
  equal(host.traces.some((t) => t.type === 'script' && t.rule === 'return' && /3 项，请求 4 次/.test(t.preview)), true,
    '返回值摘要与请求次数');

  // ---------- page()、显式 list 与 fields、POST 与 JSON 请求体、async 函数 ----------
  const pageSource = define({
    ...base,
    js: `
      async function search(ctx) {
        const echoed = http.post('/echo', { key: ctx.key }).json();
        return page(JSON.stringify({ list: [{ t: echoed.body, u: 'x/1' }], method: echoed.method,
          type: echoed.headers['Content-Type'] }), '/sub/');
      }`,
    search: { script: 'search', list: '$.list', fields: { name: '$.t', bookUrl: '$.u', kind: '= data.method + " " + data.type' } },
  });
  host = scriptHost(respond);
  const paged = await new NativeSourceRunner(pageSource, host, {}).search('凡人', 1);
  equal(paged.map((b) => [b.name, b.bookUrl, b.kind]), [['{"key":"凡人"}', 'https://api.example.com/sub/x/1',
    'POST application/json']], 'page() 带地址、对象请求体按 JSON 发送、async 函数');

  // ---------- 变量、临时值、缓存、Cookie、登录、keep、设备 ----------
  const stateSource = define({
    ...base,
    vars: [{ key: 'server', default: 'https://a.example.com' }],
    js: `
      function detail(ctx) {
        const before = vars.get('server');
        vars.set('server', 'https://b.example.com');
        vars.set('extra', { n: 1 });
        temp.set('seen', ctx.book.name);
        cache.put('token', 'abc', 60);
        cookie.set('https://api.example.com/', 'sid=1; uid=7');
        cookie.remove('https://api.example.com/', 'uid');
        login.save('tok', '我');
        keep('tab', 'video');
        return { name: ctx.book.name, kind: [before, login.token, login.user, cookie.get('https://api.example.com/'),
          device.id, device.ua, native.md5('a').slice(0, 6), uuid().length].join('|') };
      }
      function toc(ctx) {
        return [{ title: temp.get('seen') + cache.get('token') + vars.get('extra').n, url: '/c/1' }];
      }`,
    detail: { script: 'detail', fields: { name: '$.name', kind: '$.kind', intro: '= vars.server' } },
    toc: { script: 'toc', nextUrl: '/never' },
  });
  host = scriptHost(respond);
  const stateRunner = new NativeSourceRunner(stateSource, host, { server: 'https://a.example.com', old: 'kept' });
  const detail = await stateRunner.detail(book);
  equal(detail.kind, 'https://a.example.com|tok|我|sid=1|odid-test|UA-test|0cc175|36',
    '变量读取、登录保存后可读、Cookie 写入与删除、设备信息、native、uuid');
  equal(detail.intro, 'https://b.example.com', '脚本改了声明的变量，后面的规则立即看到新值');
  equal(detail.keep, { tab: 'video' }, 'keep 写入详情结果');
  equal(host.saved.vars, { server: 'https://b.example.com', old: 'kept', extra: { n: 1 } }, '变量连同未声明的键一起保存');
  equal(host.saved.credential, { token: 'tok', user: '我' }, '登录凭据保存');
  const chapters = await stateRunner.toc(book);
  equal(chapters.map((c) => c.title), ['书abc1'], '同一次操作里 temp 保留，cache 与变量可读');
  equal(host.requests.length, 0, '有 script 时目录不跟随 nextUrl');

  // ---------- 正文：字符串即正文，对象按类型取 ----------
  const contentSource = define({
    ...base,
    js: `
      function content(ctx) {
        if (ctx.chapter.index === 0) return '第一段\\n第二段';
        return { images: ['/i/1.jpg', '/i/2.jpg'] };
      }`,
    content: { script: 'content', nextUrl: '/never' },
  });
  host = scriptHost(respond);
  const text = await new NativeSourceRunner(contentSource, host, {}).content(book, chapter);
  const videoSource = define({ ...base, type: 'video', js: `
    function content() { return { video: '', videoPage: 'https://api.example.com/watch/1' }; }
  `, content: { script: 'content' } });
  const videoResult = await new NativeSourceRunner(videoSource, host, {}).content({ ...book, type: 'video' }, chapter, true);
  equal([videoResult.kind, videoResult.text, videoResult.videoPage],
    ['video', '', 'https://api.example.com/watch/1'], '脚本返回空直链时保留 videoPage');
  equal([text.kind, text.text], ['text', '第一段\n第二段'], '返回字符串直接作为正文');
  const comic = await new NativeSourceRunner(contentSource, host, {}).content({ ...book, type: 'comic' }, { ...chapter, index: 1 });
  equal([comic.kind, comic.images], ['images', ['https://api.example.com/i/1.jpg', 'https://api.example.com/i/2.jpg']],
    '返回对象时按书籍类型取 images');

  // ---------- 地址字段命中多项时取第一项 ----------
  const multiSource = define({
    ...base,
    js: "function search() { return [{ name: '多链接', u: '\\n /b/1.html\\n/b/1-27.html', c: '/c/1.jpg\\n/c/2.jpg' }]; }",
    search: { script: 'search', fields: { name: '$.name', bookUrl: '$.u', coverUrl: '$.c' } },
  });
  const multi = await new NativeSourceRunner(multiSource, scriptHost(respond), {}).search('a', 1);
  equal([multi[0].bookUrl, multi[0].coverUrl], ['https://api.example.com/b/1.html', 'https://api.example.com/c/1.jpg'],
    '地址字段拼成多行时取第一个非空行');

  // ---------- 预算、取消、出错 ----------
  const budgetSource = define({
    ...base,
    scriptLimits: { requests: 3 },
    js: "function search() { for (let i = 0; i < 5; i++) http.get('/slow?' + i); return []; }",
    search: { script: 'search' },
  });
  await rejects(new NativeSourceRunner(budgetSource, scriptHost(respond), {}).search('a', 1),
    /搜索脚本 search：.*请求次数超过上限（3 次）/, '请求次数预算');

  const loopSource = define({
    ...base,
    js: "function search() { while (true) http.get('/slow'); }",
    search: { script: 'search' },
  });
  host = scriptHost(respond);
  let stop = false;
  const startedAt = Date.now();
  const cancelledRun = new NativeSourceRunner(loopSource, host, {}).setCancelCheck(() => stop).search('a', 1);
  setTimeout(() => { stop = true; }, 150);
  await rejects(cancelledRun, /已取消/, '取消正在请求的脚本');
  assertions++;
  if (Date.now() - startedAt > 1500) throw new Error(`取消后应很快结束，实际 ${Date.now() - startedAt} ms`);

  const throwSource = define({ ...base, js: "function search() { throw new Error('坏了'); }", search: { script: 'search' } });
  await rejects(new NativeSourceRunner(throwSource, scriptHost(respond), {}).search('a', 1), /搜索脚本 search：.*坏了/,
    '脚本抛错带阶段与函数名');
  const keepSource = define({ ...base, js: "function search() { keep('a', 1); return []; }", search: { script: 'search' } });
  await rejects(new NativeSourceRunner(keepSource, scriptHost(respond), {}).search('a', 1), /keep 只能在详情阶段使用/,
    'keep 只能在详情阶段');
  const cacheSource = define({ ...base, js: "function search() { cache.put('a', 1); return []; }", search: { script: 'search' } });
  const noCacheHost = scriptHost(respond);
  delete noCacheHost.cacheGet;
  delete noCacheHost.cachePut;
  await rejects(new NativeSourceRunner(cacheSource, noCacheHost, {}).search('a', 1), /当前环境不支持缓存/,
    '宿主没有缓存时明确报错，不静默丢弃');
  const noEngine = createTestHost(JsonPathEvaluator, respond);
  await rejects(new NativeSourceRunner(searchSource, noEngine, {}).search('a', 1), /不支持脚本阶段/, '宿主没有脚本引擎');
  const catchSource = define({
    ...base,
    js: "function search() { try { http.get('/missing'); return [{ name: 'x', bookUrl: '/x' }]; } catch (e) { return []; } }",
    search: { script: 'search' },
  });
  equal((await new NativeSourceRunner(catchSource, scriptHost(respond), {}).search('a', 1)).length, 1,
    '请求失败不抛错，由脚本看 ok/status 判断');

  // ---------- 表达式环境里不能发请求 ----------
  const context = vm.createContext({});
  context.__host = () => 'null';
  vm.runInContext(NativeJsPrelude.source(NativeExpr.scriptBuiltinNames()), context);
  vm.runInContext("function fetchIt() { return http.get('/x'); } function logIt() { log('a'); } function id() { return uuid(); }", context);
  for (const call of ['fetchIt()', 'logIt()']) {
    assertions++;
    let message = '';
    try {
      vm.runInContext(call, context);
    } catch (e) {
      message = e.message;
    }
    if (!/表达式里不能发请求/.test(message)) throw new Error(`${call} 应提示改用 script，实际：${message}`);
  }
  equal(vm.runInContext('id().length', context), 36, '表达式环境里 uuid 可用');

  // ---------- 定义校验 ----------
  const invalid = (patch, pattern, message) => {
    const object = JSON.parse(JSON.stringify({ ...base, js: 'function s() {}', search: { script: 's' } }));
    patch(object);
    assertions++;
    let text = '';
    try {
      NativeSourceSpec.fromObject(object);
    } catch (e) {
      text = e.message;
    }
    if (!pattern.test(text)) throw new Error(`${message}：应当校验失败，实际：${text || '通过'}`);
  };
  invalid((o) => { o.search.script = 'a-b'; }, /search\.script 必须是 js 里的函数名/, 'script 不是函数名');
  invalid((o) => { o.search.script = 'default'; }, /search\.script 必须是 js 里的函数名/, 'script 是保留字');
  invalid((o) => { delete o.js; }, /search\.script 需要在 js 里定义函数 s/, '有 script 没有 js');
  invalid((o) => { o.scriptLimits = { requests: 0 }; }, /scriptLimits\.requests/, '请求上限过小');
  invalid((o) => { o.scriptLimits = { requests: 101 }; }, /scriptLimits\.requests/, '请求上限过大');
  equal(NativeSourceSpec.validate(define({ ...base, js: 'function s() {}', search: { script: 's' }, scriptLimits: { requests: 100 } })),
    [], '合法的脚本定义');
  equal(NativeSourceSpec.scriptFunctions(stateSource), ['detail', 'toc'], '列出阶段 script 用到的函数');
  equal(NativeJsPrelude.missingMessage(['detail', 'toc'], ['detail']), 'js 里没有阶段 script 用到的函数 “toc”',
    '导入检查：缺少函数');

  // ---------- 脚本请求也带顶层 headers（按作用域求值，脚本给的同名优先），device.ua 取求值后的 UA ----------
  const headerSource = define({
    ...base,
    vars: [{ key: 'line', options: ['甲'], default: '甲' }],
    headers: { 'User-Agent': 'UA-{{vars.line}}', 'X-Line': '= vars.line', Accept: 'text/html' },
    js: `
      function search(ctx) {
        const echoed = http.request({ url: '/echo', headers: { accept: 'application/json' } }).json();
        return [{ name: JSON.stringify(echoed.headers), author: device.ua, bookUrl: '/x' }];
      }`,
    search: { script: 'search' },
  });
  host = scriptHost(respond);
  const headerBooks = await new NativeSourceRunner(headerSource, host, {}).search('x', 1);
  equal([JSON.parse(headerBooks[0].name), headerBooks[0].author],
    [{ 'User-Agent': 'UA-甲', 'X-Line': '甲', accept: 'application/json' }, 'UA-甲'],
    '脚本请求合并求值后的顶层请求头，device.ua 用求值后的 User-Agent');

  // ---------- 阶段 3：提示、刷新、网页、按钮、动态选项、脚本登录 ----------
  const uiSource = define({
    ...base,
    vars: [{ key: 'line', label: '线路', options: ['甲'], default: '甲', optionsScript: 'lines' },
      { key: 'bad', label: '坏选项', options: ['默认'], optionsScript: 'brokenLines' }],
    js: `
      function search(ctx) { return [{ name: browser.verify('/verify', '过一下验证'), bookUrl: '/x' }]; }
      function detail(ctx) {
        ui.toast('详情来了');
        var page = browser.verify('/verify', '过一下验证');
        browser.open('/help', '说明');
        var rendered = browser.render('/spa', { js: 'document.title', waitFor: '#app' });
        return { name: page.length + ':' + rendered, kind: ctx.stage };
      }
      function exploreOpen(ctx) { browser.open('/help'); return []; }
      function switchLine(ctx) { vars.set('line', '乙'); ui.refreshExplore(); return '已切换到' + vars.get('line') + '（' + ctx.action + '）'; }
      function failing() { throw new Error('按钮坏了'); }
      function lines(ctx) { return ['甲', '乙', '丙'].concat([ctx.key]); }
      function brokenLines() { throw new Error('测速失败'); }
      function doLogin(ctx) {
        if (ctx.form.pass !== 'secret') return { ok: false, message: '密码不对' };
        login.save('tok-' + ctx.form.user, ctx.form.user);
        return '欢迎 ' + ctx.form.user;
      }
      function sendCode(ctx) { return '验证码已发到 ' + ctx.form.user; }
    `,
    search: { script: 'search' },
    explore: { menus: [{ title: '打开说明', url: 'x' }], script: 'exploreOpen' },
    detail: { script: 'detail' },
    actions: [{ label: '切换线路', script: 'switchLine' }, { label: '坏按钮', script: 'failing' }],
    login: {
      form: [{ key: 'user', label: '账号' }, { key: 'pass', label: '密码', secret: true }],
      script: 'doLogin',
      sendCode: { label: '发验证码', script: 'sendCode' },
    },
  });
  host = scriptHost(async (request) => (request.url.includes('/spa') ? 'SPA 标题' : null));
  const uiDetail = await new NativeSourceRunner(uiSource, host, {}).detail(book);
  equal(uiDetail.name, '19:SPA 标题', '详情（交互场景）里 browser.verify 拿回页面，browser.render 返回注入表达式的结果');
  equal(host.ui.toasts, ['详情来了'], 'ui.toast');
  equal(host.ui.opened.map((o) => [o.url, o.wait]), [['https://api.example.com/verify', true],
    ['https://api.example.com/help', false]], 'verify 等待、open 不等待，地址按书源补全');
  const rendered = host.requests.find((r) => r.url.includes('/spa'));
  equal([rendered.webView, rendered.webWaitFor, rendered.webJs], [true, '#app', 'document.title'], 'render 走网页渲染并带上注入的表达式');
  equal(host.traces.some((t) => t.type === 'script' && /^browser\.verify/.test(t.rule)), true, '等待网页记入调试记录');

  host = scriptHost(respond);
  await rejects(new NativeSourceRunner(uiSource, host, {}).search('a', 1), /需要网页验证（过一下验证），请点「去验证」后重试/,
    '搜索（非交互）里 browser.verify 不弹网页');
  equal([host.ui.opened.length, host.ui.verifications.map((v) => v.url)], [0, ['https://api.example.com/verify']],
    '改走应用的「去验证」');
  await rejects(new NativeSourceRunner(uiSource, scriptHost(respond), {}).explore('native:menu:0', 1), /搜索和发现时不能打开网页/,
    '发现里不能 browser.open');
  host = scriptHost(respond);
  host.browserAnswer = { body: '', error: '网页操作已取消' };
  await rejects(new NativeSourceRunner(uiSource, host, {}).detail(book), /网页操作已取消/, '用户取消网页时脚本得到原因');
  const noUi = scriptHost(respond);
  delete noUi.toast;
  await rejects(new NativeSourceRunner(uiSource, noUi, {}).detail(book), /当前环境不支持提示/, '没有界面端口时明确报错');

  host = scriptHost(respond);
  const uiRunner = new NativeSourceRunner(uiSource, host, { line: '甲' });
  equal((await uiRunner.actions()).map((a) => a.label), ['切换线路', '坏按钮'], '脚本按钮列在设置页');
  equal(await uiRunner.runAction(0), '已切换到乙（切换线路）', '按钮脚本：改变量、刷新发现页、返回提示');
  equal([host.saved.vars.line, host.ui.refreshed], ['乙', 1], '按钮改的变量已保存，发现页已刷新');
  // 真机的 QuickJS 报错带“Error: ”前缀，Node 的 worker 不带，两种都接受。
  const failedAction = (await uiRunner.runAction(1)).replace('Error: ', '');
  equal(failedAction, '操作失败：按钮坏了', '按钮脚本出错时给出原因');
  const options = await uiRunner.varOptions();
  options.bad.error = options.bad.error.replace('Error: ', '');
  equal(options, {
    line: { options: ['甲', '乙', '丙', 'line'], error: '' },
    bad: { options: [], error: '测速失败' },
  }, '动态选项：成功给出列表，失败给出原因');
  const optionDefinition = define({
    ...base,
    vars: [{ key: 'line', options: ['甲'], optionsScript: 'lines' }, { key: 'mode', options: ['小说', '听书'] }],
    js: 'function lines() { return ["甲", "乙"]; }',
    search: { script: 'lines' },
  });
  equal(NativeSourceRunner.resolveVars(optionDefinition, { line: '乙', mode: '漫画' }), { line: '乙', mode: '小说' },
    '写了 optionsScript 的变量保留脚本给出的值，其余变量不在 options 里仍回退');
  equal(NativeSourceRunner.resolveVars(optionDefinition, { line: '' }), { line: '甲', mode: '小说' },
    'optionsScript 变量没有保存值时用默认值');

  // 脚本分类：dynamicMenus 写 script 时不发请求，函数返回分类数组。
  const menuSource = define({
    ...base,
    vars: [{ key: 'mode', label: '模式', options: ['小说', '听书'], default: '小说' }],
    js: `
      function menus(ctx) {
        var kinds = ctx.vars.mode === '听书' ? ['有声'] : ['玄幻', '都市'];
        return [{ title: ctx.stage + ':' + ctx.vars.mode }].concat(kinds.map(function (k) {
          return { title: k, url: '/list?kind=' + encodeURIComponent(k) + '&page={{page}}' };
        }));
      }
      function brokenMenus() { throw new Error('分类坏了'); }
    `,
    explore: {
      menus: [{ title: '固定', url: '/fixed' }],
      dynamicMenus: { script: 'menus' },
      list: '$.books[*]',
      fields: { name: '$.name', bookUrl: '$.id' },
    },
  });
  host = scriptHost(async (request) => JSON.stringify({ books: [{ name: request.url, id: '/b/1' }] }));
  const menuRunner = new NativeSourceRunner(menuSource, host, {});
  const scriptMenus = await menuRunner.exploreMenus();
  equal(scriptMenus.map((m) => [m.title, !!m.target]),
    [['固定', true], ['menus:小说', false], ['玄幻', true], ['都市', true]], '脚本分类：没有 url 的是分组标题');
  equal(host.requests.length, 0, '脚本分类不发请求');
  const opened = await menuRunner.explore(scriptMenus[3].target, 2);
  equal(opened[0].name, 'https://api.example.com/list?kind=%E9%83%BD%E5%B8%82&page=2', '打开脚本分类时 {{page}} 换成页码');
  equal((await new NativeSourceRunner(menuSource, scriptHost(respond), { mode: '听书' }).exploreMenus()).map((m) => m.title),
    ['固定', 'menus:听书', '有声'], '脚本分类读得到书源变量');
  const customMenus = define({
    ...base, js: 'function menus() { return { data: [{ n: \'甲\', id: 7 }] }; }',
    explore: {
      dynamicMenus: { script: 'menus', list: '$.data[*]', title: '$.n', target: '= "/k/" + $.id + "?p=" + page' },
      list: '$.books[*]', fields: { name: '$.name', bookUrl: '$.id' },
    },
  });
  const customRunner = new NativeSourceRunner(customMenus, scriptHost(async () => '{"books":[{"name":"x","id":"/b"}]}'), {});
  const customEntries = await customRunner.exploreMenus();
  equal(customEntries.map((m) => m.title), ['甲'], '脚本分类也可以自己写 list、title');
  await customRunner.explore(customEntries[0].target, 3);
  // 与兼容书源 exploreUrl 相同的“名称::地址”文本：按行或 && 分隔，没有 :: 的是分组标题。
  const textMenus = define({
    ...base,
    js: "function menus() { return '排行\\n 热门 :: /rank/hot?page={{page}} && 完结::/rank/end?a=1::2\\n\\n&&'; }\n" +
      "function jsonMenus() { return JSON.stringify([{ title: 'JSON', url: '/j?p={{page}}' }]); }",
    explore: {
      menus: [{ title: '固定', url: '/fixed' }],
      dynamicMenus: { script: 'menus' },
      list: '$.books[*]',
      fields: { name: '$.name', bookUrl: '$.id' },
    },
  });
  host = scriptHost(async (request) => JSON.stringify({ books: [{ name: request.url, id: '/b/1' }] }));
  const textRunner = new NativeSourceRunner(textMenus, host, {});
  const textEntries = await textRunner.exploreMenus();
  equal(textEntries.map((m) => [m.title, !!m.target]), [['固定', true], ['排行', false], ['热门', true], ['完结', true]],
    '“名称::地址”文本：按行和 && 拆分，空段跳过，没有 :: 的是分组标题');
  equal((await textRunner.explore(textEntries[2].target, 4))[0].name, 'https://api.example.com/rank/hot?page=4',
    '文本分类的地址去掉两边空白，{{page}} 换成页码');
  equal((await textRunner.explore(textEntries[3].target, 1))[0].name, 'https://api.example.com/rank/end?a=1::2',
    '只按第一个 :: 切分，地址里的 :: 保留');
  const jsonText = define({ ...textMenus, explore: { ...textMenus.explore, menus: undefined, dynamicMenus: { script: 'jsonMenus' } } });
  equal((await new NativeSourceRunner(jsonText, scriptHost(respond), {}).exploreMenus()).map((m) => m.title), ['JSON'],
    '返回 JSON 文本时仍按数组取');
  const brokenOnly = define({ ...menuSource, explore: { ...menuSource.explore, menus: undefined, dynamicMenus: { script: 'brokenMenus' } } });
  await rejects(new NativeSourceRunner(brokenOnly, scriptHost(respond), {}).exploreMenus(), /发现分类脚本 brokenMenus：.*分类坏了/,
    '只有脚本分类且出错时报出原因');
  const brokenWithFixed = define({ ...menuSource, explore: { ...menuSource.explore, dynamicMenus: { script: 'brokenMenus' } } });
  equal((await new NativeSourceRunner(brokenWithFixed, scriptHost(respond), {}).exploreMenus()).map((m) => m.title), ['固定'],
    '脚本分类出错时保留固定分类');
  equal(NativeSourceSpec.scriptFunctions(menuSource), ['menus'], '导入检查覆盖脚本分类');
  equal(NativeSourceSpec.validate(menuSource), [], '只写 script 的 dynamicMenus 是合法的');
  invalid((o) => { o.explore = { dynamicMenus: { script: 'm', url: '/nav' }, list: '$', fields: { name: '$', bookUrl: '$' } }; },
    /写了 script 就不要写 url/, 'script 与 url 不能同时写');
  invalid((o) => { o.explore = { dynamicMenus: { url: '/nav' }, list: '$', fields: { name: '$', bookUrl: '$' } }; },
    /需要 url、list、title 和 target，或者写 script/, '没有 script 时仍要写全请求式分类');
  invalid((o) => { o.explore = { dynamicMenus: { script: 'm-x' }, list: '$', fields: { name: '$', bookUrl: '$' } }; },
    /explore\.dynamicMenus\.script 必须是 js 里的函数名/, '脚本分类的函数名不合法');

  host = scriptHost(respond);
  const wrong = await new NativeSourceRunner(uiSource, host, {}).submitLogin({ user: '小明', pass: 'nope' });
  equal([wrong.ok, wrong.message, host.saved.credential], [false, '密码不对', null], '脚本登录失败');
  const right = await new NativeSourceRunner(uiSource, host, {}).submitLogin({ user: '小明', pass: 'secret' });
  equal([right.ok, right.token, right.user, right.message], [true, 'tok-小明', '小明', '欢迎 小明'], '脚本登录成功');
  equal(host.saved.credential, { token: 'tok-小明', user: '小明' }, '凭据经 login.save 保存');
  equal(await new NativeSourceRunner(uiSource, host, {}).sendLoginCode({ user: '小明' }), '验证码已发到 小明',
    '发送验证码也可以用脚本，拿得到表单');

  equal(NativeSourceSpec.scriptFunctions(uiSource),
    ['search', 'exploreOpen', 'detail', 'switchLine', 'failing', 'lines', 'brokenLines', 'doLogin', 'sendCode'],
    '导入检查覆盖阶段、按钮、动态选项、登录与验证码');
  invalid((o) => { o.actions = [{ label: '坏', script: '1x' }]; }, /actions\[0\]\.script 必须是 js 里的函数名/, '按钮脚本名不合法');
  invalid((o) => { o.login = { script: 'login-x' }; }, /login\.script 必须是 js 里的函数名/, '登录脚本名不合法');
  equal(NativeSourceSpec.validate(define({ ...base, js: 'function s() {}', actions: [{ label: '只有脚本', script: 's' }],
    login: { script: 's' } })), [], '只写 script 的按钮和登录是合法的');

  // Final headers cross the worker bridge; HTTP failures remain inspectable.
  {
  const headerSource = define({...base, js: `function search() {
    const r=http.get('/headers'); return [{name:JSON.stringify([r.status,r.headers,r.headersAvailable,r.requestId]),bookUrl:'/book'}];
  }`,search:{script:'search'}});
  const headerHost=scriptHost(respond);
  headerHost.fetch=async request=>({ok:false,status:429,body:'slow',url:request.url,error:'HTTP 429',
    headers:{'Retry-After':'1','Content-Type':'text/plain'},headersAvailable:true,requestId:'http-7'});
  equal(JSON.parse((await new NativeSourceRunner(headerSource,headerHost,{}).search('',1))[0].name),
    [429,{'retry-after':'1','content-type':'text/plain'},true,'http-7'],'headers and availability cross the bridge');
  const aggregate = strict => define({...base,js:`function search() {
    const r=http.all(['/first','/second','/third'],{failOnPartial:${strict}});
    return [{name:JSON.stringify(r.map(x=>[x.status,x.url])),bookUrl:'/book'}];
  }`,search:{script:'search'}});
  const aggregateHost=scriptHost(respond);
  aggregateHost.fetch=async request=>{
    await sleep(request.url.endsWith('/first')?30:1);
    const failed=request.url.endsWith('/second');
    return {ok:!failed,status:failed?403:200,body:'page',url:request.url,error:failed?'HTTP 403':''};
  };
  const ordered=JSON.parse((await new NativeSourceRunner(aggregate(false),aggregateHost,{}).search('',1))[0].name);
  equal(ordered.map(x=>x[0]),[200,403,200],'default aggregation keeps failures in input order');
  await rejects(new NativeSourceRunner(aggregate(true),aggregateHost,{}).search('',1),
    /成功 2，失败 1；\[1\].*HTTP 403/, 'strict aggregation reports zero-based failed indices');
  const empty=define({...base,js:`function search(){return [{name:String(http.all([],{failOnPartial:true}).length),bookUrl:'/book'}]}`,search:{script:'search'}});
  equal((await new NativeSourceRunner(empty,aggregateHost,{}).search('',1))[0].name,'0','strict empty batch succeeds');
  invalid(o=>{o.search.retry={times:2,onStatus:[200]};},/retry.onStatus/,'invalid declarative retry rejected on import');
  invalid(o=>{o.vars=[{key:'limit',options:[{}]}];},/字符串或有限数字/,'structured variable options rejected');
  const numeric=define({...base,vars:[{key:'limit',options:[1,2,3],default:2}]});
  equal(NativeSourceSpec.validate(numeric),[],'numeric options accepted explicitly');
  equal(NativeSourceRunner.resolveVars(numeric,{}).limit,'2','numeric default normalized to text');
  }

  // 后台脚本的载入、同步执行与 Promise 拒绝统一提示；不改变 JS 绑定或异常类型。
  for (const js of [
    "split('a,b', ','); function search() { return []; }",
    "function search() { return split('a,b', ','); }",
    "async function search() { await Promise.resolve(); return split('a,b', ','); }",
    "function search() { return eval(\"split('a,b', ',')\"); }"
  ]) {
    const source = define({ ...base, js, search: { script: 'search' } });
    await rejects(new NativeSourceRunner(source, scriptHost(respond), {}).search('a', 1),
      /搜索脚本 search：.*ReferenceError: split is not defined.*native\.split/, '后台脚本未定义内置名提供修正提示');
  }
  const bindingsSource = define({ ...base, search: { script: 'search' }, js: `function search() {
    function local(split) { return split('local'); }
    var caught = '';
    try { split('a,b', ','); } catch (e) { caught = e.name; }
    return [{ name: JSON.stringify([native.split('a,b', ','), 'a,b'.split(','),
      local(x => [x]), typeof split, caught, typeof uuid(), typeof log, typeof vars.set]), bookUrl: '/book' }];
  }` });
  equal(JSON.parse((await new NativeSourceRunner(bindingsSource, scriptHost(respond), {}).search('a', 1))[0].name),
    [['a', 'b'], ['a', 'b'], ['local'], 'undefined', 'ReferenceError', 'string', 'function', 'function'],
    '后台脚本的 native、方法、局部绑定、全局探测、捕获异常和宿主 API 保持原样');

  console.log(`Native script stage check passed: ${assertions} assertions.`);
} finally {
  mods.cleanup();
}
