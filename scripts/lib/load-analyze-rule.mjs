// 把规则解析器 AnalyzeRule 连同它引用的源码加载进 Node，供选择器一致性与性能回归使用。
// 做法：从 AnalyzeRule.ts 起沿相对 import 收集文件，拷到临时目录；系统模块（@kit.* 等）换成什么都不做的桩；
// 只导入了类型的名字从 import 里去掉（Node 只剥类型不做省略）。源码里有 enum，需要 --experimental-transform-types，
// 调用方用 ensureTransformTypes() 在缺少该参数时以子进程重跑自己。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ETS_ROOTS, locateEtsModule } from './ets-module-staging.mjs';

const STUB_FILE = '__stub.ts';
const STUB_SOURCE = [
  '// 系统模块的桩：任意取成员、调用、构造都返回桩自身，不做任何事。',
  'const handler: ProxyHandler<any> = {',
  '  get: (_t: any, key: any) => (key === "then" ? undefined : stub),',
  '  apply: () => stub,',
  '  construct: () => stub,',
  '};',
  'export const stub: any = new Proxy(function () {}, handler);',
  '',
].join('\n');

/** 缺少 --experimental-transform-types 时带上它重跑当前脚本，并以子进程的退出码退出。 */
export function ensureTransformTypes() {
  if (process.execArgv.includes('--experimental-transform-types')) return;
  const result = spawnSync(process.execPath,
    ['--experimental-transform-types', '--no-warnings', process.argv[1], ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}

function relativeToRoot(file) {
  for (const root of ETS_ROOTS) {
    const rel = path.relative(root, file);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  throw new Error(`不在源码根内：${file}`);
}

/** 文件在运行时导出的名字（class / function / const / enum 等，不含 interface 与 type）。 */
function runtimeExports(text) {
  const names = new Set();
  const declared = /^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function\*?|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of text.matchAll(declared)) names.add(match[1]);
  for (const match of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',').map((item) => item.trim()).filter(Boolean)) {
      if (!part.startsWith('type ')) names.add(part.split(/\s+as\s+/).pop().trim());
    }
  }
  return names;
}

function resolveRelative(fromRel, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier));
  for (const ext of ['.ts', '.ets']) {
    try {
      locateEtsModule(base + ext);
      return base + ext;
    } catch (e) {
      // 换下一个扩展名
    }
  }
  throw new Error(`${fromRel}: 找不到 ${specifier}`);
}

/** 暂存后的文件名：.ets 改成 .ets.ts，Node 才会按 TypeScript 处理。 */
function stagedName(rel) {
  return rel.endsWith('.ets') ? `${rel}.ts` : rel;
}

function rewrite(text, rel, queue) {
  const fromDir = path.posix.dirname(rel);
  let stubSpec = path.posix.relative(fromDir, STUB_FILE);
  if (!stubSpec.startsWith('.')) stubSpec = `./${stubSpec}`;
  let stubIndex = 0;
  return text.replace(/^import\s+(type\s+)?(\{[^}]*\}|[\w$]+|\*\s+as\s+[\w$]+)\s+from\s+'([^']+)';?/gm,
    (all, typeOnly, clause, specifier) => {
      if (typeOnly) return '';
      const isRelative = specifier.startsWith('.');
      const target = isRelative ? resolveRelative(rel, specifier) : '';
      const exported = isRelative ? runtimeExports(fs.readFileSync(locateEtsModule(target), 'utf8')) : null;
      const trimmed = clause.trim();
      if (isRelative) queue.push(target);
      if (!trimmed.startsWith('{')) {
        if (isRelative) {
          let spec = path.posix.relative(fromDir, stagedName(target));
          if (!spec.startsWith('.')) spec = `./${spec}`;
          return `import ${trimmed} from '${spec}';`;
        }
        const local = trimmed.replace(/^\*\s+as\s+/, '');
        return `import { stub as __stub${stubIndex} } from '${stubSpec}';\nconst ${local}: any = __stub${stubIndex++};`;
      }
      const parts = trimmed.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean)
        .filter((part) => !part.startsWith('type '));
      if (isRelative) {
        const kept = parts.filter((part) => exported.has(part.split(/\s+as\s+/)[0].trim()));
        if (kept.length === 0) return '';
        let spec = path.posix.relative(fromDir, stagedName(target));
        if (!spec.startsWith('.')) spec = `./${spec}`;
        return `import { ${kept.join(', ')} } from '${spec}';`;
      }
      const lines = [`import { stub as __stub${stubIndex} } from '${stubSpec}';`];
      for (const part of parts) lines.push(`const ${part.split(/\s+as\s+/).pop().trim()}: any = __stub${stubIndex};`);
      stubIndex++;
      return lines.join('\n');
    });
}

/**
 * 暂存并加载 AnalyzeRule 及其依赖，返回 { AnalyzeRule, RuleExecutionTarget, ..., load, cleanup }。
 * load(rel) 按源码根相对路径导入已暂存的其他模块（例如 'core/rule/JsRuntime.ts'）。
 */
export async function loadAnalyzeRule() {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-rule-check-'));
  const cleanup = () => fs.rmSync(stagingDir, { recursive: true, force: true });
  try {
    fs.writeFileSync(path.join(stagingDir, STUB_FILE), STUB_SOURCE);
    const entry = relativeToRoot(locateEtsModule('core/rule/AnalyzeRule.ts'));
    const queue = [entry, 'core/rule/RuleValue.ts'];
    const seen = new Set();
    while (queue.length > 0) {
      const rel = queue.shift();
      if (seen.has(rel)) continue;
      seen.add(rel);
      const target = path.join(stagingDir, stagedName(rel));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, rewrite(fs.readFileSync(locateEtsModule(rel), 'utf8'), rel, queue));
    }
    const load = (rel) => import(pathToFileURL(path.join(stagingDir, rel)).href);
    return { ...(await load(entry)), ...(await load('core/rule/RuleValue.ts')), stagedFiles: seen.size, load, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
