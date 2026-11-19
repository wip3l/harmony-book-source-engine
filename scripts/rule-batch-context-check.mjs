// 批量取字段时每条结果的上下文：没改动时复用同一份 JSON，不再按条数复制大变量。
// 曾经几千章的目录带一个约 900 KB 的书籍变量，逐条 JSON.stringify 把共享堆耗尽而闪退。
// 运行：node --experimental-strip-types scripts/rule-batch-context-check.mjs

import { ensureTransformTypes, loadAnalyzeRule } from './lib/load-analyze-rule.mjs';

ensureTransformTypes();

const mods = await loadAnalyzeRule(['core/rule/RuleExecutionService.ts', 'core/rule/RuleExecutionModels.ts']);
let assertions = 0;
const check = (cond, message) => {
  assertions++;
  if (!cond) throw new Error(message);
};

try {
  const { RuleExecutionService } = await mods.load('core/rule/RuleExecutionService.ts');
  const { RuleBatchExecutionRequest, RuleFieldRequest } = await mods.load('core/rule/RuleExecutionModels.ts');

  const count = 3000;
  const big = 'x'.repeat(900 * 1024);
  const request = new RuleBatchExecutionRequest();
  request.stage = 'toc';
  request.ownerId = 'rule-batch-context-check';
  request.baseUrl = 'https://example.com/';
  request.contents = Array.from({ length: count }, (_, i) => `<a href="/c/${i}">第${i}章</a>`);
  request.fields = [new RuleFieldRequest('title', 'tag.a@text'), new RuleFieldRequest('url', 'tag.a@href', true)];
  request.contextValues = { bigPage: big, bookId: '42' };
  request.timeoutMs = 120000;

  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = Date.now();
  const result = await RuleExecutionService.get().executeBatch(request);
  const elapsed = Date.now() - startedAt;
  globalThis.gc?.();
  const heapGrowthMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
  // 字符串按值比较，看不出是不是同一份；只能看堆：逐条复制时这里会涨到数 GB（或直接耗尽）。
  check(heapGrowthMb < 64, `结果上下文占用 ${heapGrowthMb.toFixed(0)} MB，大变量被逐条复制了`);
  check(result.errors.length === 0, `批量取字段出错：${result.errors.join('; ')}`);
  check(result.values.length === count && result.values[count - 1].title === `第${count - 1}章`, '字段结果不对');
  check(result.contextValues.length === count, '每条结果都要有上下文');
  const distinct = new Set(result.contextValues);
  check(distinct.size === 1, `上下文没改动时应只有一份 JSON，实际 ${distinct.size} 份`);
  const context = JSON.parse(result.contextValues[0]);
  check(context.bigPage === big && context.bookId === '42', '上下文内容要原样保留');

  // 某条规则写了上下文（@put）：从那条起是新的一份，之前的条目不受影响。
  const putRequest = new RuleBatchExecutionRequest();
  putRequest.stage = 'search';
  putRequest.ownerId = 'rule-batch-context-check-put';
  putRequest.baseUrl = 'https://example.com/';
  putRequest.contents = ['<a href="/b/0">甲</a>', '<a href="/b/1">乙</a>', '<a href="/b/2">丙</a>'];
  putRequest.fields = [new RuleFieldRequest('name', 'tag.a@text@put:{"last":"tag.a@text"}')];
  putRequest.contextValues = { bookId: '7' };
  const putResult = await RuleExecutionService.get().executeBatch(putRequest);
  const parsed = putResult.contextValues.map((json) => JSON.parse(json));
  check(parsed.every((ctx) => ctx.bookId === '7'), '写过上下文后种子变量仍在');
  check(new Set(putResult.contextValues).size === putResult.contextValues.length || parsed.every((ctx) => !ctx.last),
    '每条结果写了不同的值时各自保留自己的上下文');

  console.log(`Rule batch context check passed: ${assertions} assertions, ${count} 条 × 900 KB 变量 ${elapsed} ms，` +
    `堆增长 ${heapGrowthMb.toFixed(1)} MB.`);
} finally {
  mods.cleanup();
}
