import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { createTestHost, loadNativeSourceModules } from './lib/load-native-source-modules.mjs';
import { createNodeScriptEngine } from './lib/node-script-engine.mjs';

const mods = await loadNativeSourceModules();
const { NativeSourceRunner: Runner, NativeSourceSpec: Spec, NativeCommentPage: Page, JsonPathEvaluator } = mods;
const book = { bookUrl: '/book/1', tocUrl: '/toc/1', name: 'Book', author: '', kind: '', type: 'text', vars: {} };
const chapter = { url: '/chapter/1', title: 'One', index: 0 };
const definition = {
  nativeSource: 1, name: 'Inline', url: 'https://example.com',
  search: { url: '/search', list: '$.list[*]', fields: { name: '$.name', bookUrl: '$.url' } },
  content: { url: '= chapter.url', text: '= data.text', comments: {
    stats: { url: '/stats' }, counts: '= stats.counts', paragraphUrl: '/remote/{{para.index}}', chapterUrl: '/remote/chapter',
    page: { fetch: { reviews: { url: '/comments/{{para.index}}' } },
      html: '<p>{{para.text}}</p>', data: { index: '= para.index', count: '= para.count', list: '= reviews.items' },
      title: '第 {{para.index + 1}} 段', height: 0.7 },
    chapterPage: { html: '<p>本章 {{total}}</p>', data: { total: '= total' } }
  } }
};
let text = '第一段\n第二段';
const host = createTestHost(JsonPathEvaluator, async (req) => {
  if (req.url.includes('/stats')) return { counts: { 0: 2, 1: 3 } };
  if (req.url.includes('/comments/')) return { items: ['hello', '</script><script>evil()</script>'] };
  return { text };
});
const runner = (def = definition, vars = {}) => new Runner(def, host, vars);
try {
  assert.deepEqual(Spec.validate(definition), []);
  assert.deepEqual(Spec.unpack(Spec.pack(Spec.fromObject(Spec.toExportObject(definition)))),definition);
  for (const invalid of [{ html: '' }, { html: '<p/>', height: 0.1 }, { html: '<p/>', data: [] },
    { html: '<p/>', fetch: { para: { url: '/x' } } }, { html: '<p/>', fetch: { x: {} } },
    { html: '<p/>', fetch: Object.fromEntries([1,2,3,4].map(n => ['r' + n, {url:'/x'}])) }]) {
    const def = structuredClone(definition); def.content.comments.page = invalid;
    assert(Spec.validate(def).length > 0, JSON.stringify(invalid));
  }
  const only = structuredClone(definition);
  delete only.content.comments.paragraphUrl; delete only.content.comments.chapterUrl;
  assert.deepEqual(Spec.validate(only), [], 'page-only source accepted by the new validator');
  const content = await runner().content(book, chapter);
  assert.equal(content.paragraphComments.length, 2);
  assert.equal(host.requests.length, 2, 'content only fetches body and counts, never page.fetch');
  const action = content.paragraphComments[1].url;
  assert(Page.isAction(action)); assert(!action.includes('第一段')); assert(!action.includes('HTML'));
  const page = await runner().commentPage(book, chapter, action);
  assert.equal(host.requests.length, 3, 'warm click reuses bounded context and only requests chosen paragraph');
  assert.equal(host.requests[2].url, 'https://example.com/comments/1');
  assert.equal(page.html, '<p>第二段</p>'); assert.equal(page.title, '第 2 段'); assert.equal(page.height, 0.7);
  assert.deepEqual(JSON.parse(page.dataJson), { index: 1, count: 3, list: ['hello', '</script><script>evil()</script>'] });
  const chapterPage = await runner().commentPage(book, chapter, content.chapterCommentUrl);
  assert.equal(chapterPage.html, '<p>本章 5</p>'); assert.equal(JSON.parse(chapterPage.dataJson).total, 5);
  const beforeClear = host.requests.length;
  Runner.clearCommentContexts(definition.url);
  await runner().commentPage(book,chapter,action);
  assert.equal(host.requests.length-beforeClear,3,'source cache clearing drops inline context too');
  const realNow=Date.now;
  try {
    Date.now=()=>realNow()+300001;
    const beforeExpiry=host.requests.length;
    await runner().commentPage(book,chapter,action);
    assert.equal(host.requests.length-beforeExpiry,3,'expired context is reconstructed');
  } finally {Date.now=realNow; Runner.clearCommentContexts(definition.url);}
  await assert.rejects(runner().commentPage(book, {...chapter, url:'/chapter/2'}, action), /失效/);
  await assert.rejects(runner().commentPage({...book, bookUrl:'/book/2'}, chapter, action), /失效/);
  await assert.rejects(runner(definition, {server:'changed'}).commentPage(book, chapter, action), /失效/);
  const changed = structuredClone(definition); changed.content.comments.page.html = '<p>changed</p>';
  await assert.rejects(runner(changed).commentPage(book, chapter, action), /失效/);
  await assert.rejects(runner().setCredential({token:'new',user:''}).commentPage(book, chapter, action), /失效/);
  const cancelled = runner().setCancelCheck(() => true);
  await assert.rejects(cancelled.commentPage(book, chapter, action), /取消/);

  // Evict the original context using real distinct chapters, then reconstruct it on click.
  for (let i=2;i<=5;i++) await runner().content(book, {...chapter,url:'/chapter/'+i});
  const beforeCold = host.requests.length;
  await runner().commentPage(book, chapter, action);
  assert.equal(host.requests.length-beforeCold, 3, 'cold click rebuilds body/stats before fetching paragraph');
  text = '第一段\n已经替换的第二段';
  await runner().content(book, chapter);
  await assert.rejects(runner().commentPage(book, chapter, action), /段落已变化/);
  await assert.rejects(runner().commentPage(book, chapter, content.chapterCommentUrl), /段落已变化/);
  text = '第一段\n第二段';

  for (const badHtml of ['= 42', '= ""', '中'.repeat(90000)]) {
    const def = structuredClone(definition); def.content.comments.page.html = badHtml;
    const c = await runner(def).content(book,chapter);
    const fallback = await runner(def).commentPage(book,chapter,c.paragraphComments[0].url);
    assert.equal(fallback.html,''); assert(fallback.error); assert.equal(fallback.fallbackUrl,'https://example.com/remote/0');
    delete def.content.comments.paragraphUrl;
    const noFallback = await runner(def).content(book,chapter);
    await assert.rejects(runner(def).commentPage(book,chapter,noFallback.paragraphComments[0].url));
  }
  const largeData = structuredClone(definition); largeData.content.comments.page.data = { text: '中'.repeat(22000) };
  const large = await runner(largeData).content(book,chapter);
  assert.match((await runner(largeData).commentPage(book,chapter,large.paragraphComments[0].url)).error,/64 KiB/);
  const failedHost=createTestHost(JsonPathEvaluator,async req=>req.url.includes('/comments/')?null:
    (req.url.includes('/stats')?{counts:{0:2}}:{text:'第一段'}));
  const failedContent=await new Runner(definition,failedHost).content(book,chapter);
  const failedPage=await new Runner(definition,failedHost).commentPage(book,chapter,failedContent.paragraphComments[0].url);
  assert.equal(failedPage.html,''); assert(failedPage.error); assert(failedPage.fallbackUrl);
  let cancelledDuringFetch=false;
  const cancelHost=createTestHost(JsonPathEvaluator,async req=>{
    if(req.url.includes('/comments/')) cancelledDuringFetch=true;
    return {};
  });
  await assert.rejects(new Runner(definition,cancelHost).setCancelCheck(()=>cancelledDuringFetch)
    .commentPage(book,chapter,failedContent.paragraphComments[0].url),/取消/);

  // Injection round-trip through a JS parser: user data never terminates the trusted script.
  const doc = Page.contentDocument(page);
  const injected = doc.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert(!injected.includes('</script>')); assert(doc.indexOf('Content-Security-Policy') < doc.indexOf('<script>'));
  const realm = {window:{}}; vm.runInNewContext(injected,realm);
  assert.equal(JSON.stringify(realm.window.__NATIVE_PAGE_DATA__),page.dataJson);
  for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert(doc.includes(directive));
  }
  assert(Page.document(page).includes('sandbox="allow-scripts"'));
  assert(!Page.document(page).includes('allow-same-origin'));
  for (const value of ['ascii', '中文', '😀', '\ud800', '\udc00', '\u2028']) assert.equal(Page.bytes(value),Buffer.byteLength(value));
  const example = Spec.fromObject(JSON.parse(fs.readFileSync(new URL('../docs/examples/native-inline-comments.json',import.meta.url),'utf8')));
  const exampleHost = createTestHost(JsonPathEvaluator,async()=>{throw Error('offline example must not request network');});
  exampleHost.scriptEngine = code => createNodeScriptEngine(mods.NativeJsPrelude,mods.NativeExpr.scriptBuiltinNames(),code);
  const demoRunner = new Runner(example,exampleHost);
  const demoContent = await demoRunner.content(book,chapter);
  assert.equal(demoContent.paragraphComments.length,2);
  const demoPage = await new Runner(example,exampleHost).commentPage(book,chapter,demoContent.paragraphComments[0].url);
  assert.equal(JSON.parse(demoPage.dataJson).count,2);
  assert(Page.document(demoPage).includes('测试本地交互'));
  assert.equal(exampleHost.requests.length,0);
  console.log('native-comment-page-check: lazy fetch, schema, warm/cold contexts, stale actions, fallback, cancellation, UTF-8 limits and safe injection passed');
} finally { mods.cleanup(); }
