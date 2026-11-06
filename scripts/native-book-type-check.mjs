// 原生书源的书籍类型：fields 不写 type 时沿用书源顶层的 type（视频没有类型位，记在书籍变量 tab 里）。
// 运行：node scripts/native-book-type-check.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const code = fs.readFileSync(new URL('../sourceengine/src/main/ets/core/nativesource/NativeSourceService.ts',
  import.meta.url), 'utf8');
const method = (signature) => {
  const start = code.indexOf(`  ${signature}`);
  assert.ok(start >= 0, `production method ${signature}`);
  return code.slice(start, code.indexOf('\n  }', start) + 4);
};
const methods = ['private static typeBits(', 'private static typeName(', 'private static tabVariable(',
  'private static toSearchBook(', 'static async getBookInfo('].map(method);

const parse = (raw) => { try { return JSON.parse(raw || '{}'); } catch (_) { return {}; } };
const context = vm.createContext({
  BookUrlResolver: {
    setVariableJson: (raw, key, value) => JSON.stringify({ ...parse(raw), [key]: value }),
    getVariableJson: (raw, key) => parse(raw)[key] || ''
  },
  BookTypeSupport: {
    TEXT: 8, AUDIO: 32, IMAGE: 64,
    typeFromTab: (tab) => ({ audio: 32, comic: 64, image: 64, text: 8 })[String(tab || '').toLowerCase()] || 0,
    typeFromSource: (source) => source.bookSourceType === 1 ? 32 : (source.bookSourceType === 2 ? 64 : 0)
  },
  NativeSourceSpec: { unpack: (jsLib) => jsLib ? JSON.parse(jsLib) : null },
  BookFieldSanitizer: { clean: (v) => v || '', prefer: (a, b) => a || b },
  SourceCoverUrl: { isEncoded: () => false },
  SearchBook: class {}
});
const Service = vm.runInContext(stripTypeScriptTypes(`class NativeSourceService { ${methods.join('\n')} }
  NativeSourceService.bookInput = () => ({}); NativeSourceService;`), context);

const source = (type) => ({
  bookSourceUrl: 's', bookSourceName: 'S', bookSourceType: type === 'audio' ? 1 : (type === 'comic' ? 2 : 0),
  jsLib: JSON.stringify({ nativeSource: 1, type })
});
const record = (type = '') => ({ name: 'n', bookUrl: '/b', type, keep: {} });
const tabOf = (book) => parse(book.variable).tab;
const detail = async (src, book, rec) => {
  Service.runner = () => ({ detail: async () => rec });
  return Service.getBookInfo(src, {}, book);
};

// 顶层 type: video，fields 不写 type：搜索结果和详情都按视频。
const video = source('video');
const found = Service.toSearchBook(video, record());
assert.equal(tabOf(found), 'video', '搜索/发现结果沿用书源的 video');
assert.equal(tabOf(await detail(video, { ...found }, record())), 'video', '详情没给类型时仍是视频');
// 修复前加进书架的书（tab 已落成 text），下次取详情时按书源类型纠正。
assert.equal(tabOf(await detail(video, { type: 8, variable: '{"tab":"text"}' }, record())), 'video',
  '旧的 tab=text 在详情没给类型时纠正为视频');
// 显式写了类型的以它为准。
assert.equal(tabOf(Service.toSearchBook(video, record('text'))), 'text', '视频书源里显式写 text 的书仍是文本');
assert.equal(tabOf(await detail(video, { type: 8, variable: '{"tab":"video"}' }, record('text'))), 'text',
  '详情显式给出 text 时以详情为准');
// 其他类型不受影响。
assert.equal(tabOf(Service.toSearchBook(source('text'), record())), 'text', '文本书源');
assert.equal(tabOf(Service.toSearchBook(source('audio'), record())), 'audio', '有声书源');
assert.equal(tabOf(Service.toSearchBook(source('text'), record('video'))), 'video', '文本书源里显式写 video');
assert.equal(tabOf(await detail(source('text'), { type: 8, variable: '{"tab":"video"}' }, record())), 'video',
  '搜索定下的视频在详情没给类型时保留');
assert.equal(tabOf(await detail(source('audio'), { type: 32, variable: '{"tab":"audio"}' }, record())), 'audio',
  '搜索定下的有声在详情没给类型时保留');

console.log('native-book-type-check: ok');
