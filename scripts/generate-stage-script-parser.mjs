// 生成 sourceengine 内置的 acorn 解析器源码（StageScriptParserSource.ts）。
// 用法：node scripts/generate-stage-script-parser.mjs [acorn 目录] [terser 目录]
// 默认取 DevEco Studio 自带的 acorn 与 terser；升级 acorn 时重新运行并同步 THIRD_PARTY_NOTICES.md。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const devecoModules = path.join(process.env.DEVECO_HOME || 'C:/Program Files/Huawei/DevEco Studio',
  'sdk/default/openharmony/ets/build-tools/ets-loader/node_modules');
const acornDir = process.argv[2] || path.join(devecoModules, 'acorn');
const terserDir = process.argv[3] || path.join(devecoModules, 'terser');
const version = JSON.parse(fs.readFileSync(path.join(acornDir, 'package.json'), 'utf8')).version;
const source = fs.readFileSync(path.join(acornDir, 'dist/acorn.js'), 'utf8');
const terser = createRequire(path.join(terserDir, 'package.json'))(terserDir);
const minified = await terser.minify(source, {
  compress: true, mangle: true, format: { comments: false }, ecma: 2015
});
if (!minified.code) throw new Error('terser 未产出代码');
const target = path.resolve(here, '../sourceengine/src/main/ets/core/book/StageScriptParserSource.ts');
const banner = `// 由 scripts/generate-stage-script-parser.mjs 生成，请勿手改。\n` +
  `// acorn ${version}（上游地址见 THIRD_PARTY_NOTICES.md），MIT License，\n` +
  `// Copyright (C) 2012-2022 by various contributors；完整许可见 THIRD_PARTY_LICENSES.txt。\n`;
fs.writeFileSync(target, `${banner}export const STAGE_SCRIPT_PARSER_VERSION: string = ${JSON.stringify(version)};\n` +
  `export const STAGE_SCRIPT_PARSER_SOURCE: string = ${JSON.stringify(minified.code)};\n`);
console.log(`acorn ${version} -> ${path.relative(process.cwd(), target)} (${minified.code.length} chars)`);
