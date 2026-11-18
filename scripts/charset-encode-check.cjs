// 书源声明 charset: gbk 时，查询参数与表单必须按 GBK 编码。系统 TextEncoder 不认 gb18030（构造抛错，或忽略参数照旧
// 输出 UTF-8）时，要改用由系统 TextDecoder 反推的码表；两者都不可用时报错，不能把原文发出去让站点静默返回 0 条。
// DEVECO_HOME=... node scripts/charset-encode-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(path.join(process.env.DEVECO_HOME || 'C:/Program Files/Huawei/DevEco Studio',
  'sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript'));
const root = path.resolve(__dirname, '../sourceengine/src/main/ets');

// 每种系统表现各加载一份模块，LegacyCharsetEncoder 的进程内缓存互不影响。
function environment(util) {
  const cache = new Map();
  const stubs = {
    '@ohos.deviceInfo': {sdkApiVersion: 26},
    '@kit.BasicServicesKit': {deviceInfo: {deviceType: 'phone'}},
    '@kit.ArkTS': {util: Object.assign({
      Base64Helper: class {encodeToStringSync(a) {return Buffer.from(a).toString('base64');}
        decodeSync(s) {return Uint8Array.from(Buffer.from(s, 'base64'));}}}, util)},
    '@kit.ArkWeb': {webview: {WebCookieManager: {fetchCookieSync: () => ''}}},
    '@kit.CryptoArchitectureKit': {cryptoFramework: {}},
    '@ohos.net.http': {}, '@ohos.data.preferences': {}, '@devzeng/quickjs': {}
  };
  const quiet = {info() {}, warn() {}, log() {}, error: console.error};
  function load(name) {
    if (stubs[name]) return stubs[name];
    if (cache.has(name)) return cache.get(name).exports;
    const module = {exports: {}};
    cache.set(name, module);
    const source = fs.readFileSync(path.join(root, name + '.ts'), 'utf8');
    const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021}}).outputText;
    vm.runInNewContext(output, {module, exports: module.exports, console: quiet, setTimeout, clearTimeout,
      Uint8Array, ArrayBuffer, Map, Array, AppStorage: {get: () => undefined, setOrCreate: () => {}},
      require: dep => load(dep.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(name), dep)) : dep)
    }, {filename: name});
    return module.exports;
  }
  return load;
}

// Node 自带的 TextDecoder 支持 gbk / gb18030，充当“解码一直可用”的系统解码器。
const workingDecoder = {create: (encoding) => {
  const decoder = new TextDecoder(encoding);
  return {decodeToString: (bytes) => decoder.decode(bytes)};
}};
const utf8Only = class {encodeInto(s) {return s ? new Uint8Array(Buffer.from(s, 'utf8')) : undefined;}};
const throwing = class {
  constructor(encoding) {if (encoding && encoding !== 'utf-8') throw new Error('unsupported encoding');}
  encodeInto(s) {return s ? new Uint8Array(Buffer.from(s, 'utf8')) : undefined;}
};
// 认 gb18030 的系统编码器（只放测试里用到的字）。
const GB = {'中': [0xD6, 0xD0], '总': [0xD7, 0xDC], '裁': [0xB2, 0xC3], '古': [0xB9, 0xC5], '灵': [0xC1, 0xE9]};
const working = class {
  constructor(encoding) {this.encoding = encoding || 'utf-8';}
  encodeInto(s) {
    if (!s) return undefined;
    if (this.encoding === 'utf-8') return new Uint8Array(Buffer.from(s, 'utf8'));
    const out = [];
    for (const ch of s) out.push(...(GB[ch] || [ch.charCodeAt(0)]));
    return new Uint8Array(out);
  }
};

function urlOf(load, template) {
  const {BookSource} = load('model/data/Book');
  const {AnalyzeUrl} = load('core/rule/AnalyzeUrl');
  const source = new BookSource();
  source.bookSourceUrl = 'https://gbk.test';
  return new AnalyzeUrl(source, null).parse(template);
}

let assertions = 0;
const check = (actual, expected, message) => { assertions++; assert.equal(actual, expected, message); };

for (const [label, util] of [
  ['系统编码器忽略 gb18030', {TextEncoder: utf8Only, TextDecoder: workingDecoder}],
  ['系统编码器构造抛错', {TextEncoder: throwing, TextDecoder: workingDecoder}],
  ['系统编码器正常', {TextEncoder: working, TextDecoder: workingDecoder}]
]) {
  const load = environment(util);
  check(urlOf(load, 'https://gbk.test/s.php?searchkey=总裁&t=1,{"charset":"gbk"}').url,
    'https://gbk.test/s.php?searchkey=%D7%DC%B2%C3&t=1', `${label}：查询参数按 GBK 编码`);
  check(urlOf(load, 'https://gbk.test/s.php?searchkey=%E6%80%BB%E8%A3%81,{"charset":"gb2312"}').url,
    'https://gbk.test/s.php?searchkey=%D7%DC%B2%C3', `${label}：urlencode(key) 的 UTF-8 编码先还原再按 GBK 编码`);
  const posted = urlOf(load, 'https://gbk.test/s.php,{"method":"POST","body":"searchkey=古灵&a=b c","charset":"GBK"}');
  check(posted.body, 'searchkey=%B9%C5%C1%E9&a=b+c', `${label}：表单按 GBK 编码，空格写成 +`);
}

// 码表兜底：码表里没有的字编成 ?，ASCII 原样。
{
  const load = environment({TextEncoder: utf8Only, TextDecoder: workingDecoder});
  const {LegacyCharsetEncoder} = load('core/rule/LegacyCharsetEncoder');
  check(Buffer.from(LegacyCharsetEncoder.encode('a中😀', 'gbk')).toString('hex'), '61d6d03f', '码表外的字编成 ?');
  const extended = new TextDecoder('gbk').decode(Buffer.from('8140', 'hex'));  // GBK 扩展区第一个字，不在 GB2312 里
  check(Buffer.from(LegacyCharsetEncoder.encode(extended, 'gbk')).toString('hex'), '8140', 'GBK 扩展区的字也在码表里');
  check(LegacyCharsetEncoder.encode('', 'gbk').length, 0, '空串');
}

// 编码器和解码器都不可用：报错，不再把原文发出去。
{
  const broken = {create: () => { throw new Error('no decoder'); }};
  const load = environment({TextEncoder: throwing, TextDecoder: broken});
  let message = '';
  try { urlOf(load, 'https://gbk.test/s.php?searchkey=总裁,{"charset":"gbk"}'); } catch (e) { message = e.message; }
  check(message, '当前系统无法按 gbk 编码请求参数', 'GB 系字符集编码不了时报错');
  // 不是 GB 系的字符集不认时，按 UTF-8 编码（与改动前一样能发出请求），只在日志里提示。
  check(urlOf(load, 'https://gbk.test/s.php?q=中,{"charset":"x-unknown"}').url,
    'https://gbk.test/s.php?q=%E4%B8%AD', '不认识的字符集按 UTF-8 编码');
}

console.log(`Charset encode check passed: ${assertions} assertions.`);
