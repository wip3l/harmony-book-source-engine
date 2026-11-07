// 回归脚本把 ArkTS 源码拷到临时目录交给 Node 加载时共用的路径工具。
// 源码根是 sourceengine/src/main/ets；模块路径都相对于它（如 core/rule/RuleContext.ts）。
// 宿主应用的源码根（entry/src/main/ets）存在时也会一起查找，便于在应用工程里复用这些脚本。
// 对 '@legado/sourceengine' 的导入按名字改写成指向定义文件的相对导入，被引用的文件需一并暂存。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ETS_ROOTS = [
  path.join(projectRoot, 'entry', 'src', 'main', 'ets'),
  path.join(projectRoot, 'sourceengine', 'src', 'main', 'ets'),
];
const PACKAGE_NAME = '@legado/sourceengine';
const PACKAGE_INDEXES = ['Index.ts'].map((name) => path.join(projectRoot, 'sourceengine', name));

/** 相对 ets 根的路径 → 实际文件路径。 */
export function locateEtsModule(relative) {
  for (const root of ETS_ROOTS) {
    const candidate = path.join(root, relative);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`找不到模块 ${relative}（已查找 entry 与 sourceengine）`);
}

export function readEtsModule(relative) {
  return fs.readFileSync(locateEtsModule(relative), 'utf8');
}

let exportOwners = null;

/** 包入口导出的名字 → 定义它的文件（相对 ets 根，带扩展名）。 */
function packageExportOwners() {
  if (exportOwners) return exportOwners;
  exportOwners = new Map();
  for (const indexPath of PACKAGE_INDEXES) {
    const text = fs.readFileSync(indexPath, 'utf8');
    for (const match of text.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/src\/main\/ets\/([^']+)'/g)) {
      const stem = match[2];
      const file = ['.ts', '.ets'].map((ext) => stem + ext)
        .find((candidate) => fs.existsSync(path.join(ETS_ROOTS[1], candidate)));
      for (const name of match[1].split(',').map((part) => part.trim()).filter(Boolean)) {
        exportOwners.set(name, file);
      }
    }
  }
  return exportOwners;
}

/**
 * 把 ArkTS 源码改成 Node 可加载的形式：相对 import 补 '.ts'，
 * 包名导入按名字拆成指向定义文件的相对导入。relative 是该文件相对 ets 根的路径。
 */
export function toNodeModuleSource(text, relative) {
  const owners = packageExportOwners();
  const fromDir = path.posix.dirname(relative.split(path.sep).join('/'));
  return text
    .replace(new RegExp(`^(import|export)\\s*\\{([^}]*)\\}\\s*from\\s*'${PACKAGE_NAME}';?`, 'gm'), (all, keyword, list) => {
      const byFile = new Map();
      for (const part of list.split(',').map((item) => item.trim()).filter(Boolean)) {
        const name = part.split(/\s+as\s+/)[0].trim();
        const owner = owners.get(name);
        if (!owner) throw new Error(`${relative}: ${PACKAGE_NAME} 没有导出 ${name}`);
        if (!byFile.has(owner)) byFile.set(owner, []);
        byFile.get(owner).push(part);
      }
      return [...byFile].map(([owner, names]) => {
        let specifier = path.posix.relative(fromDir, owner);
        if (!specifier.startsWith('.')) specifier = `./${specifier}`;
        return `${keyword} { ${names.join(', ')} } from '${specifier}';`;
      }).join('\n');
    })
    .replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g, (all, head, specifier, tail) =>
      /\.[a-z]+$/i.test(specifier) ? all : `${head}${specifier}.ts${tail}`);
}
