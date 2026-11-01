// 规则解析器 AnalyzeRule 的 HTML 选择器回归：一组页面 × 规则的结果必须与基准文件一致，
// 同一进程里再跑一遍（命中解析器内部缓存）结果也不能变。最后打印 HTML 目录取字段的耗时，只作参考。
// 运行：node --experimental-strip-types scripts/analyze-rule-check.mjs
// 有意改变选择器行为后更新基准：node --experimental-strip-types scripts/analyze-rule-check.mjs --update

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTransformTypes, loadAnalyzeRule } from './lib/load-analyze-rule.mjs';

ensureTransformTypes();

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'analyze-rule-golden.json');
const BASE_URL = 'https://www.example.com/book/123/';

const PAGES = {
  catalog: `<html><head><title>某书 目录</title><meta name="keywords" content="甲,乙"></head><body>
<div class="nav top-nav"><a href="/">首页</a> &gt; <a href='/sort/1/'>玄幻</a></div>
<div id="info" class="book-info"><h1>某书</h1><p>作者：<a href="/author/9" title="作者 甲">甲</a></p>
<p class="intro">简介第一句。<br/>简介第二句&amp;更多</p><img src="/cover/1.jpg" data-src=/lazy/1.jpg alt="封面"></div>
<div id="list" class="listmain"><dl>
<dt>最新章节</dt>
<dd><a href="/book/123/9.html">第九章 新的</a></dd>
<dt>正文卷</dt>
<dd><a href="/book/123/1.html" class="vip free">第一章 开始</a></dd>
<dd><a href="/book/123/2.html" data-id="2">第二章 继续</a></dd>
<dd class="hidden"><a href="/book/123/3.html" rel="nofollow">第三章 隐藏</a></dd>
<dd><a href="/book/123/4.html" title="4">第四章 <span>标注</span>结尾</a></dd>
<dd><a HREF="/book/123/5.html" Class="x-y">第五章 大写属性</a></dd>
</dl></div>
<ul class="pages"><li><a href="?p=1">1</a></li><li class="cur"><a href="?p=2">2</a></li><li><a href="?p=3">3</a></li></ul>
<div class="footer">版权 <b>所有</b></div></body></html>`,
  search: `<div class="result-list">
<div class="result-item result-game-item"><div class="pic"><img src="//img.example.com/a.jpg" /></div>
<div class="detail"><h3><a href="/book/1/" title="书一">书<em>一</em></a></h3><p class="desc">描述一</p>
<p><span>作者：</span><span>张三</span></p><p><span>类型：</span><span>都市</span></p></div></div>
<div class="result-item result-game-item"><div class="pic"><img src="//img.example.com/b.jpg" /></div>
<div class="detail"><h3><a href="/book/2/" title="书二">书二</a></h3><p class="desc">描述二</p>
<p><span>作者：</span><span>李四</span></p><p><span>类型：</span><span>仙侠</span></p></div></div>
<div class="result-item ad"><a href="/ad">广告</a></div>
</div>`,
  table: `<table id="t"><tr><th>名</th><th>作者</th></tr>
<tr><td class="odd"><a href="/b/1">甲书</a></td><td>甲</td></tr>
<tr><td class="even"><a href="/b/2">乙书</a></td><td>乙</td></tr>
<tr><td class="odd"><a href="/b/3">丙书</a></td><td>丙</td></tr></table>`,
};

const RULES = [
  // CSS
  '#list dd a@text', '#list dd a@href', '#list dd a@html', '#list dd', 'dd a', 'dl > dd > a@href', 'div#list dd:first a@text',
  '#list dd:last a@text', '#list dd:eq(2) a@text', '#list dd:lt(2) a@text', '#list dd:gt(3) a@text',
  '#list dd:nth-child(3)@text', 'dd:nth-of-type(2) a@text', 'dd:contains(继续) a@href', 'dd:has(span) a@href',
  'dd:not(.hidden) a@text', 'dd a:not([rel]) @text', 'a[data-id]@href', 'a[data-id=2]@text', 'a[href$=4.html]@text',
  'a[href^=/book/123/1]@text', 'a[href*=123/3]@text', 'a[class~=vip]@text', 'a[class|=x]@text', '.vip.free@text',
  'a.vip@href', '.x-y@text', '#info img@src', '#info img@data-src', '#info img@alt', 'meta[name=keywords]@content',
  '.intro@text', '.intro@html', 'p.intro@ownText', '.nav a@href', '.nav a, .footer b@text', 'h1@text', 'title@text',
  '.pages li.cur a@href', '.pages li.1@text', '.pages li!0@text', '.pages li.0:2@text', '.pages li.0:1:2@text',
  '@css:#list dd a@text', '@css:.pages li a@href', 'a@title', 'a@HREF', 'dd a@Class',
  // 旧式写法
  'class.listmain@tag.dd@tag.a@text', 'id.list@tag.a.0@href', 'id.list@tag.a.-1@text', 'tag.dd.1@text',
  'class.nav@tag.a[0:1]@text', 'id.info@tag.p.1@text', 'text.第二章@href', 'text.简介@ownText',
  'class.result-item@tag.h3@tag.a@href', 'class.detail@tag.p.1@tag.span.1@text', 'class.result-item!2@class.desc@text',
  'id.t@tag.tr!0@tag.td.0@text', 'id.t@tag.td.odd@text', 'tag.td.1@text',
  // 组合与替换
  '#list dd a@text##第(.)章##$1', '#list dd a@href##\\.html$', 'h1@text||title@text', '.nothing@text||h1@text',
  '#list dd a@text&&.nav a@text', '.pages li a@text%%.pages li a@href', 'textNodes', 'text', 'html',
  // 只取元素
  '.result-item', '-.result-item', 'class.result-item', '.result-game-item', 'tr', '#list dd!0',
];

const run = (AnalyzeRule, RuleExecutionTarget) => {
  const out = {};
  for (const [name, html] of Object.entries(PAGES)) {
    for (const rule of RULES) {
      const key = `${name} :: ${rule}`;
      const analyzer = () => new AnalyzeRule(html, BASE_URL);
      const safe = (fn) => {
        try {
          return fn();
        } catch (error) {
          return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
        }
      };
      out[key] = {
        string: safe(() => analyzer().getString(rule)),
        url: safe(() => analyzer().getString(rule, true)),
        list: safe(() => analyzer().getStringList(rule)),
        elements: safe(() => analyzer().execute(rule, RuleExecutionTarget.ELEMENTS).map((value) => value.asString())),
      };
    }
  }
  return out;
};

const mods = await loadAnalyzeRule();
try {
  const { AnalyzeRule, RuleExecutionTarget } = mods;
  const first = run(AnalyzeRule, RuleExecutionTarget);
  const second = run(AnalyzeRule, RuleExecutionTarget);
  let assertions = 0;
  for (const key of Object.keys(first)) {
    assertions++;
    if (JSON.stringify(first[key]) !== JSON.stringify(second[key])) {
      throw new Error(`同一进程第二次执行结果不同：${key}\n  first:  ${JSON.stringify(first[key])}\n  second: ${JSON.stringify(second[key])}`);
    }
  }
  if (process.argv.includes('--update')) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, `${JSON.stringify(first, null, 1)}\n`);
    console.log(`已更新基准：${Object.keys(first).length} 条`);
  } else {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    const keys = new Set([...Object.keys(golden), ...Object.keys(first)]);
    const diffs = [];
    for (const key of keys) {
      assertions++;
      const expected = JSON.stringify(golden[key]);
      const actual = JSON.stringify(first[key]);
      if (expected !== actual) diffs.push(`${key}\n  expected: ${expected}\n  actual:   ${actual}`);
    }
    if (diffs.length > 0) throw new Error(`选择器结果与基准不一致（${diffs.length} 条）：\n${diffs.slice(0, 10).join('\n')}`);
  }

  // 属性值跨行（例如多行的 og:description）时整段取出，不能只取到一个引号。
  const multiline = '<head><meta property="og:description" content="  第一行\n  第二行“引号”\n" /></head>';
  for (const rule of ['@css:meta[property="og:description"]@content', "@css:meta[property='og:description']@content"]) {
    assertions++;
    const value = new AnalyzeRule(multiline, BASE_URL).getString(rule);
    if (!/第一行[\s\S]*第二行“引号”/.test(value)) throw new Error(`跨行属性值取值不对：${rule} => ${JSON.stringify(value)}`);
  }

  // CRLF/CR 站点：先统一行尾，再压缩空行，取文本不能留下 \r 或多出空行。
  for (const [html, expected] of [['<div id="c">甲\r\n<br/>\r\n<br/>乙</div>', '甲\n\n乙'],
    ['<div id="c">甲\r<br>\r<br>乙</div>', '甲\n\n乙'], ['<div id="c">甲\n<br>乙</div>', '甲\n\n乙']]) {
    assertions++;
    const value = new AnalyzeRule(html, BASE_URL).getString('#c@text');
    if (value !== expected) throw new Error(`行尾归一化不对：${JSON.stringify(html)} => ${JSON.stringify(value)}`);
  }

  // HTML 目录取字段耗时（参考值，不做断言）。
  const timings = [];
  for (const count of [1000, 8000]) {
    let html = `<html><body><div id="list"><dl><dt>正文</dt>`;
    for (let i = 0; i < count; i++) {
      html += `<dd><a href="/book/123/${1000000 + i}.html" title="第${i + 1}章">第${i + 1}章 这是一个比较长的章节标题</a></dd>\n`;
    }
    html += '</dl></div></body></html>';
    const startedAt = performance.now();
    const items = new AnalyzeRule(html, BASE_URL).execute('#list dd', RuleExecutionTarget.ELEMENTS).map((v) => v.asString());
    const listedAt = performance.now();
    for (const item of items) {
      new AnalyzeRule(item, BASE_URL).getString('a@text');
      new AnalyzeRule(item, BASE_URL).getString('a@href', true);
    }
    const doneAt = performance.now();
    timings.push(`${count} 章：列表 ${(listedAt - startedAt).toFixed(0)} ms，字段 ${(doneAt - listedAt).toFixed(0)} ms`);
  }
  console.log(`AnalyzeRule check passed: ${assertions} assertions (${mods.stagedFiles} files staged). ` +
    `HTML 目录参考耗时：${timings.join('；')}`);
} finally {
  mods.cleanup();
}
