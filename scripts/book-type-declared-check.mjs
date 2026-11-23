// 书籍变量声明了媒体类型时以声明为准，书源名、分类里的“漫画/有声”只在没声明时参考。
// 运行：node scripts/book-type-declared-check.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const code = fs.readFileSync(new URL('../sourceengine/src/main/ets/core/book/BookTypeSupport.ts', import.meta.url),
  'utf8').replace(/^import .*$/m, '').replace(/^export /m, '');
class SearchBook {}
const context = vm.createContext({ SearchBook });
const Support = vm.runInContext(`${stripTypeScriptTypes(code)}\nBookTypeSupport;`, context);

const book = (originName, variable, type = 8, kind = '') => ({ origin: 's', originName, variable, type, kind });

// 多频道书源名带“漫画”：声明为小说、有声、视频的书都不当漫画。
assert.equal(Support.isImage(book('漫画1234-综合', '{"tab":"text"}')), false, '声明 text 的书不因书源名当漫画');
assert.equal(Support.mediaCategoryOf(book('漫画1234-综合', '{"tab":"text"}')), 'novel', '归入小说');
assert.equal(Support.isImage(book('漫画1234-综合', '{"tab":"video"}', 8)), false, '声明 video 的书不当漫画');
assert.equal(Support.mediaCategoryOf(book('漫画1234-综合', '{"tab":"audio"}', 32)), 'audio', '有声仍是有声');
assert.equal(Support.isImage(book('漫画1234-综合', '{"tab":"comic"}', 64)), true, '声明 comic 的仍是漫画');
assert.equal(Support.isImage(book('漫画1234-综合', '{"tab":"漫画"}', 8)), true, '只靠变量声明漫画也认');
// 书名带“有声”的书源里声明为小说的书不当有声。
assert.equal(Support.isAudio(book('有声小说站', '{"tab":"小说"}')), false, '声明小说的书不因书源名当有声');
// 分类里的“漫改”同样不压过声明。
assert.equal(Support.isImage(book('某站', '{"tab":"text"}', 8, '漫改')), false, '分类带漫改但声明小说');

// 没有声明时沿用按书源名、分类推断（阅读书源常见情形）。
assert.equal(Support.isImage(book('某某漫画', '')), true, '无声明时书源名带漫画仍当漫画');
assert.equal(Support.isImage(book('某站', '{"custom":"1"}', 8, '漫画')), true, '变量无类型字段时按分类');
assert.equal(Support.isAudio(book('某某听书', '')), true, '无声明时书源名带听书仍当有声');
assert.equal(Support.isImage(book('某某小说', '')), false, '普通书源');

console.log('book-type-declared-check: ok');
