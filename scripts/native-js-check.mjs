// 原生书源 JS 函数库回归：表达式调用 JS 函数、JS 经 native 调内置函数、定义校验、阶段执行。
// 真机用 QuickJS（NativeJsLibrary），这里用 node:vm 按同一份前置脚本和调用约定模拟。
// 运行：node --experimental-strip-types scripts/native-js-check.mjs

import vm from 'node:vm';
import { createTestHost, loadNativeSourceModules } from './lib/load-native-source-modules.mjs';

const mods = await loadNativeSourceModules();
const { NativeExpr, NativeScope, NativeSourceSpec, NativeSourceRunner, NativeJsPrelude, JsonPathEvaluator } = mods;

let assertions = 0;
function equal(actual, expected, message) {
  assertions++;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected: ${b}\n  actual:   ${a}`);
}
function throws(fn, pattern, message) {
  assertions++;
  let text = '';
  try {
    fn();
  } catch (e) {
    text = e.message;
  }
  if (!pattern.test(text)) throw new Error(`${message}：应当报错，实际：${text || '未报错'}`);
}

/** 与 NativeJsLibrary 相同的约定，用 node:vm 执行。 */
function vmLibrary(code) {
  const context = vm.createContext({});
  let builtin = null;
  context.__host = (name, payload) => {
    if (!builtin) throw new Error('js 顶层代码里不能调用 native，请放到函数里');
    return NativeJsPrelude.answerBuiltin(builtin, name, payload);
  };
  vm.runInContext(NativeJsPrelude.source(NativeExpr.scriptBuiltinNames()), context, { timeout: 2000 });
  try {
    vm.runInContext(code, context, { timeout: 2000 });
  } catch (e) {
    throw new Error(`js：${NativeJsPrelude.scriptError(String(e), NativeExpr.scriptBuiltinNames())}`);
  }
  return {
    has: (name) => NativeJsPrelude.isIdentifier(name) && vm.runInContext(NativeJsPrelude.hasSource(name), context) === true,
    call: (name, args, callBuiltin) => {
      const previous = builtin;
      builtin = callBuiltin;
      try {
        return NativeJsPrelude.parseResult(vm.runInContext(NativeJsPrelude.callSource(name, args), context, { timeout: 300 }));
      } catch (e) {
        throw new Error(`JS 函数 “${name}” 出错：${NativeJsPrelude.scriptError(String(e), NativeExpr.scriptBuiltinNames())}`);
      } finally {
        builtin = previous;
      }
    },
  };
}

try {
  // 只增强未定义的内置函数标识符；保留原错误、位置及其他错误的既有摘要。
  const formatError = (message) => NativeJsPrelude.scriptError(message, NativeExpr.scriptBuiltinNames());
  const hint = '；若要调用原生书源内置函数，请使用 native.split(...)';
  for (const message of ["ReferenceError: 'split' is not defined", 'ReferenceError: split is not defined']) {
    equal(formatError(message), message + hint, 'QuickJS 和 Node 未定义错误都带修正提示');
  }
  const withStack = "ReferenceError: 'split' is not defined\n    at f (js:2)\n    at <eval> (js:f:1)\n    at hidden";
  equal(formatError(withStack), NativeJsPrelude.shortError(withStack) + hint, '保留原错误和调用位置，提示不被堆栈截断');
  for (const message of [
    'ReferenceError: missingValue is not defined', 'ReferenceError: map is not defined',
    "ReferenceError: 'default' is not defined", "ReferenceError: 'split' is not initialized",
    "ReferenceError: Cannot access 'split' before initialization", 'TypeError: split is not a function',
    'Error: split is not defined', 'split is not defined',
    'Error: request failed\nReferenceError: split is not defined',
    'ReferenceError: split is not defined in response', 'InternalError: out of memory',
    '计算时间超过 2 秒', '已取消', ''
  ]) {
    equal(formatError(message), NativeJsPrelude.shortError(message), `其他错误不追加 native 提示：${message}`);
  }
  const host = createTestHost(JsonPathEvaluator, async () => null);
  const code = `
    function sign(path, salt) { return native.md5(path + salt).slice(0, 8); }
    const twice = x => x * 2;
    let counter = 0;
    function bump() { counter += 1; return counter; }
    function pickName() { return native.sel('$.name'); }
    function pickFrom(text) { return native.sel('$.name', text); }
    function viaBytes(text) { return native.bytesBase64(native.bytes(text)); }
    function shape() { return { list: [1, '二', null], ok: true }; }
    function nothing() {}
    function boom() { throw new Error('坏了'); }
    function lambdaBuiltin() { return 'map' in native; }
    function nativeAsJson() { return typeof JSON.stringify(native); }
    function badBuiltin() { return native.nope(); }
    function bareBuiltin() { return split('a,b', ','); }
    function dynamicBareBuiltin() { return eval("split('a,b', ',')"); }
    function nativeSplit() { return native.split('a,b', ','); }
    function localSplit() { const split = x => [x]; return split('local'); }
    function paramSplit() { return (function (split) { return split('param'); })(x => [x]); }
    function globalSplitType() { return typeof split; }
    function methodSplit() { return 'a,b'.split(','); }
    function caughtBareBuiltin() { try { split('a,b', ','); } catch (e) { return e.name; } }
    function addAll() { return Array.prototype.slice.call(arguments).reduce((a, b) => a + b, 0); }
    function decode(cipher) { return native.fromBytes(native.decrypt('AES/CBC/PKCS5Padding', native.base64Bytes(cipher), '0123456789abcdef', 'fedcba9876543210')); }
  `;
  const expr = new NativeExpr(host).loadLibrary('fn libTwice(x) { return twice(x) + 0 }').loadScript(vmLibrary(code));
  const scope = new NativeScope().set('item', JSON.stringify({ name: '斗破' })).set('baseUrl', 'https://example.com/');
  const ev = (source) => expr.evaluate(source, scope);

  equal(ev("sign('/search', 'salt')"), ev("substring(md5('/search' + 'salt'), 0, 8)"), 'JS 函数经 native 调内置摘要');
  equal(ev('twice(21)'), 42, '顶层 const 箭头函数可调用');
  equal(ev('libTwice(5)'), 10, 'lib 函数里可以调 JS 函数');
  equal([ev('bump()'), ev('bump()')], [1, 2], '全局变量在多次调用之间保留');
  equal(ev('pickName()'), '斗破', 'native.sel 不给内容时用当前 item');
  equal(ev(`pickFrom('{"name":"凡人"}')`), '凡人', 'native.sel 可以指定内容');
  equal(ev("viaBytes('中文😀')"), ev("bytesBase64(bytes('中文😀'))"), '字节列表在 JS 与内置函数之间往返');
  equal(ev('shape()'), { list: [1, '二', null], ok: true }, '对象与数组按 JSON 返回');
  equal(ev('nothing()'), null, '没有返回值时为 null');
  equal(ev('addAll(1, 2, 3)'), 6, '多个参数');
  equal(ev('lambdaBuiltin()'), false, '需要匿名函数的内置函数不经 native 提供');
  equal(ev('nativeAsJson()'), 'string', 'native 对象可以被 JSON.stringify');
  const encrypted = ev("bytesBase64(encrypt('AES/CBC/PKCS5Padding', '正文', '0123456789abcdef', 'fedcba9876543210'))");
  scope.set('cipher', encrypted);
  equal(ev('decode(cipher)'), '正文', 'JS 里用 native 解密');
  throws(() => ev('boom()'), /boom.*坏了/, 'JS 抛出的错误带函数名和原因');
  throws(() => ev('badBuiltin()'), /badBuiltin.*native\.nope 不是可用的内置函数/, 'native 上没有的名字说明是哪个');
  throws(() => ev('bareBuiltin()'), /bareBuiltin.*ReferenceError: split is not defined.*native\.split/, '裸调用提示 native 写法');
  throws(() => ev('dynamicBareBuiltin()'), /ReferenceError: split is not defined.*native\.split/, 'eval 中的裸调用也有提示');
  equal(ev('nativeSplit()'), ['a', 'b'], 'native.split 正常调用');
  equal(ev('methodSplit()'), ['a', 'b'], '字符串自带方法保持原样');
  equal(ev('localSplit()'), ['local'], '局部同名变量不受影响');
  equal(ev('paramSplit()'), ['param'], '同名参数不受影响');
  equal(ev('globalSplitType()'), 'undefined', '不向全局注入内置函数桩');
  equal(ev('caughtBareBuiltin()'), 'ReferenceError', '脚本内部捕获到的异常类型不变');
  equal(vmLibrary('function ok() {}').has('split'), false, '函数存在性检查不误认内置函数');
  throws(() => vmLibrary("split('a,b', ',');"), /^js：ReferenceError: split is not defined.*native\.split/,
    '顶层代码载入失败也提供提示');
  throws(() => ev('missingFn()'), /没有名为 “missingFn” 的内置函数/, 'JS 里也没有的函数');
  throws(() => new NativeExpr(host).loadScript(null).evaluate('twice(1)', scope), /没有名为/, '没有 js 时照旧报错');

  equal(NativeExpr.scriptBuiltinNames().includes('md5'), true, 'native 提供 md5');
  equal(NativeExpr.scriptBuiltinNames().includes('filter'), false, 'native 不提供 filter');
  equal(NativeExpr.libraryFunctionNames('fn a() { return 1 }\nfn b(x) { return x }'), ['a', 'b'], 'lib 函数名');
  throws(() => vmLibrary("native.md5('x')"), /顶层代码里不能调用 native/, '顶层代码不能调 native');

  // ---------- 导入检查（与 NativeJsLibrary.check 相同的流程） ----------
  const vmCheck = (source, libNames) => {
    const context = vm.createContext({});
    context.__host = () => { throw new Error('js 顶层代码里不能调用 native，请放到函数里'); };
    vm.runInContext(NativeJsPrelude.source(NativeExpr.scriptBuiltinNames()), context);
    vm.runInContext(source, context);
    const builtins = NativeExpr.builtinNames();
    const found = vm.runInContext(NativeJsPrelude.definedSource(builtins.concat(libNames)), context);
    return NativeJsPrelude.clashMessage(JSON.parse(found), builtins);
  };
  equal(NativeExpr.builtinNames().includes('default'), true, '内置函数里有 JS 保留字 default');
  equal(NativeJsPrelude.isIdentifier('default'), false, '保留字不当作函数名');
  equal(vmCheck('const ok = () => 1;', []), '', '正常代码通过检查（检查代码里不能出现保留字）');
  equal(vmCheck('function md5(x) { return x; }', []), 'js 里的函数 “md5” 与内置函数重名', '与内置函数重名');
  equal(vmCheck('const sign = () => 1;', ['sign']), 'js 里的函数 “sign” 与 lib 里的函数重名', '与 lib 函数重名');

  // ---------- 定义校验 ----------
  const base = {
    sourceFormat: 'native', version: 1, name: 'JS 示例', url: 'https://api.example.com',
    js: "function sign(key) { return native.md5('k=' + key).slice(0, 6); }",
    search: {
      url: "{{source.url}}/search?key={{urlencode(key)}}&sign={{sign(key)}}",
      list: '$.data.list',
      fields: { name: '$.name', bookUrl: "= source.url + '/b/' + $.id", author: '= upperName($.author)' }
    }
  };
  base.js += "\nfunction upperName(name) { return String(name || '').toUpperCase(); }";
  equal(NativeSourceSpec.validate(NativeSourceSpec.fromObject(JSON.parse(JSON.stringify(base)))), [], '带 js 的定义通过校验');
  const notString = JSON.parse(JSON.stringify(base));
  notString.js = 42;
  throws(() => NativeSourceSpec.fromObject(notString), /js 必须是字符串/, 'js 不是字符串');
  const tooLong = JSON.parse(JSON.stringify(base));
  tooLong.js = 'x'.repeat(NativeJsPrelude.MAX_CODE_LENGTH + 1);
  throws(() => NativeSourceSpec.fromObject(tooLong), /js 太长/, 'js 超过长度上限');
  const definition = NativeSourceSpec.fromObject(JSON.parse(JSON.stringify(base)));
  equal(NativeSourceSpec.unpack(NativeSourceSpec.pack(definition)).js, base.js, 'js 随定义打包与还原');
  equal(NativeSourceSpec.toExportObject(definition).js, base.js, '导出保留 js');

  // ---------- 阶段执行 ----------
  const respond = async (request) => {
    if (request.url.includes('/search')) return { data: { list: [{ id: '1', name: '斗破', author: 'tudou' }] } };
    return null;
  };
  const runHost = createTestHost(JsonPathEvaluator, respond);
  runHost.scriptLibrary = (source) => vmLibrary(source);
  const books = await new NativeSourceRunner(definition, runHost, {}).search('斗破', 1);
  const expectedSign = new NativeExpr(host).evaluate("substring(md5('k=斗破'), 0, 6)", new NativeScope());
  equal(runHost.requests[0].url, `https://api.example.com/search?key=${encodeURIComponent('斗破')}&sign=${expectedSign}`,
    '请求地址模板里调用 JS 函数');
  equal(books.map((b) => [b.name, b.author]), [['斗破', 'TUDOU']], '字段规则里调用 JS 函数');

  // Exercise the optional expression host: the legacy scriptLibrary-only host above skips batching.
  // Evaluate generated expressions as real JS as well as NativeExpr, which accepts bare object lambdas.
  for (const count of [1, 19]) {
    for (const multipleFields of [false, true]) {
      const items = Array.from({ length: count }, (_, index) => ({ name: `Book ${index}`, id: String(index) }));
      const batchSource = NativeSourceSpec.fromObject({
        sourceFormat: 'native', version: 1, name: 'Batch regression', url: 'https://example.com',
        js: 'function label(name, index) { return name + " #" + index; } function author(index) { return "Author " + index; }',
        search: { url: 'https://example.com/search', list: '$[*]', fields: {
          name: '= label(item.name, index)', bookUrl: "= '/book/' + item.id",
          author: multipleFields ? '= author(index)' : "= 'fixed author'"
        } }
      });
      const expected = items.map((item, index) =>
        [`${item.name} #${index}`, multipleFields ? `Author ${index}` : 'fixed author', `https://example.com/book/${index}`]);
      for (const runtime of ['javascript', 'native']) {
        const batchHost = createTestHost(JsonPathEvaluator, async () => items);
        batchHost.scriptLibrary = (source) => vmLibrary(source);
        let batchCalls = 0;
        batchHost.evaluateExpression = async (source, library, expression, values, template) => {
          equal(template, false, '批处理表达式不是模板');
          batchCalls++;
          if (runtime === 'javascript') {
            const context = vm.createContext({ ...values, map: (list, callback) => list.map(callback) });
            vm.runInContext(source, context, { timeout: 300 });
            return vm.runInContext(`(${expression})`, context, { timeout: 300 });
          }
          const scope = new NativeScope();
          for (const [name, value] of Object.entries(values)) scope.set(name, value);
          return new NativeExpr(batchHost).loadLibrary(library).loadScript(vmLibrary(source)).evaluate(expression, scope);
        };
        const result = await new NativeSourceRunner(batchSource, batchHost, {}).search('Book', 1);
        equal(result.map((book) => [book.name, book.author, book.bookUrl]), expected,
          `${runtime} 批处理 ${count} 本、${multipleFields ? '多个' : '单个'} JS 字段保留值和全局索引`);
        equal(batchCalls, Math.ceil(count / 16), '每批只调用一次表达式宿主，包含末尾不足 16 本的批次');
      }
    }
  }

  const plainHost = createTestHost(JsonPathEvaluator, respond);
  let plainError = '';
  try {
    await new NativeSourceRunner(definition, plainHost, {}).search('斗破', 1);
  } catch (e) {
    plainError = e.message;
  }
  assertions++;
  if (!/不支持 JS 函数库/.test(plainError) && plainHost.traces.every((t) => !/不支持 JS 函数库/.test(t.error || ''))) {
    throw new Error(`宿主没有脚本引擎时应说明原因，实际：${plainError || JSON.stringify(plainHost.traces.map((t) => t.error))}`);
  }

  console.log(`Native JS library check passed: ${assertions} assertions.`);
} finally {
  mods.cleanup();
}
