// JsRuntime 文本模拟把变量代入表达式：一次扫描、代入的值不再被扫描、替换串里的 $ 不当特殊符号。
// 逐个变量 replace 时，网页里出现的变量名会被再塞进一整份值，几轮下来字符串成倍膨胀，搜索时主线程卡死。
// 运行：node --experimental-strip-types scripts/js-runtime-var-substitution-check.mjs

import { ensureTransformTypes, loadAnalyzeRule } from './lib/load-analyze-rule.mjs';

ensureTransformTypes();

const mods = await loadAnalyzeRule();
let assertions = 0;
const check = (cond, message) => {
  assertions++;
  if (!cond) throw new Error(message);
};

try {
  const { JsRuntime } = await mods.load('core/rule/JsRuntime.ts');
  // QuickJS 在 Node 里是桩，让残余表达式回到文本模拟，才能走到变量代入。
  const { QuickJsScriptRuntime } = await mods.load('core/script/QuickJsScriptRuntime.ts');
  QuickJsScriptRuntime.evaluateResidualExpression = () => ({ success: false, value: '' });
  const quoted = (value) => `"${value}"`;

  // 代入的值里出现别的变量名，不能再被换掉。
  let rt = new JsRuntime();
  rt.setVar('a', 'b c');
  rt.setVar('b', 'X');
  check(rt.substituteVars('a + b', quoted) === '"b c" + "X"', `代入值被二次替换：${rt.substituteVars('a + b', quoted)}`);

  // 替换串里的 $' $` $& 原样保留。
  rt = new JsRuntime();
  rt.setVar('v', "$'$`$&");
  check(rt.substituteVars('v', (value) => value) === "$'$`$&", `$ 被当成替换模式：${rt.substituteVars('v', (value) => value)}`);

  // 带点的名字按字面匹配，长名字优先。
  rt = new JsRuntime();
  rt.setVar('source', 'S');
  rt.setVar('source.tone', 'T');
  check(rt.substituteVars('source.tone sourceXtone source', (value) => value) === 'T sourceXtone S',
    `带点名字匹配不对：${rt.substituteVars('source.tone sourceXtone source', (value) => value)}`);

  // 只换整词。
  rt = new JsRuntime();
  rt.setVar('page', '2');
  check(rt.substituteVars('page pages subpage page2 (page)', (value) => value) === '2 pages subpage page2 (2)',
    `整词边界不对：${rt.substituteVars('page pages subpage page2 (page)', (value) => value)}`);

  // 代入后超出上限时放弃，返回 null。
  rt = new JsRuntime();
  rt.setVar('big', 'x'.repeat(1024 * 1024));
  check(rt.substituteVars('big+big+big', (value) => value) === null, '超出上限没有放弃');

  // 卡死现场：上一条结果留下的大变量名在网页里反复出现。旧写法这里会膨胀到上百 MB。
  let html = '<html><body><ul>';
  for (let i = 0; i < 200; i++) {
    html += `<li><a href="/book/${i}.html" title="page ${i}">第 ${i} 本 html url page</a></li>`;
  }
  html += '</ul></body></html>';
  rt = new JsRuntime();
  rt.setVar('baseUrl', 'https://example.com/');
  const code = 'var html = result; var t = html + page; t';
  const startedAt = performance.now();
  for (let i = 0; i < 20; i++) {
    rt.setVar('page', String(i + 1));
    rt.evaluate(code, html);
  }
  const elapsed = performance.now() - startedAt;
  check(elapsed < 2000, `20 次求值耗时 ${elapsed.toFixed(0)} ms，变量代入仍在膨胀`);
  const htmlVar = rt.getVar('html');
  check(typeof htmlVar !== 'string' || htmlVar.length < html.length * 4,
    `变量 html 膨胀到 ${typeof htmlVar === 'string' ? htmlVar.length : '?'} 字符`);

  console.log(`JsRuntime var substitution check passed: ${assertions} assertions, 20 次求值 ${elapsed.toFixed(0)} ms.`);
} finally {
  mods.cleanup();
}
