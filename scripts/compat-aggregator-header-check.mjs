// 兼容书源请求头作用域的回归：bookSourceUrl 解析不出主机（聚合源，例如用名称做键）时，
// 书源 header 规则算出的动态头和 loginHeader 必须照常送出；有自有站点的书源仍只能把凭据
// 发给自己站点，不能泄露给第三方图床或代理。
//
// 这里只加载 AnalyzeUrl，并把它与请求头无关的依赖（网络、限流、调试、站点解析）换成等值替身；
// 被测路径是 parse() → loadSourceHeaders() → isTrustedRequestHost()。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEtsModule } from './lib/ets-module-staging.mjs';

const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-aggregator-header-check-'));

let assertions = 0;

function equal(actual, expected, message) {
  assertions++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function ok(condition, message) {
  assertions++;
  if (!condition) throw new Error(message);
}

const STUBS = `
class HttpRetryPolicy { static parse(p) { return p; } static delay() { return -1; } static async wait() { return true; } }
class BookSource {}
class HttpClient {}
class HttpRequest {}
class HttpResponse {}
class VerificationSupport { static sourceCookieHeader() { return ''; } }
class RequestSessionSupport { static parseConfig() { return {}; } static emptyConfig() { return {}; } static apply() {} }
class BookSourceRateLimiter { static async acquire() { return 0; } }
const RateLimitAcquireResult = { Acquired: 0, Cancelled: 1 };
const util = { TextEncoder: class { encodeInto(v) { return new TextEncoder().encode(v); } } };
class BookSourceDebugContext {}
class BookSourceHeaderRuntime { static script() { return ''; } static async resolve() { return {}; } }
class SourceEngineHost { static isCancelled() { return false; } static id() { return 0; } static end() {} static priority() { return 0; } }
class BookUrlResolver { static resolve(v) { return v; } }
`;

async function load(relative, rewrite) {
  const target = path.join(stagingDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, rewrite(readEtsModule(relative)));
  return await import(pathToFileURL(target).href);
}

const { AnalyzeUrl } = await load('core/rule/AnalyzeUrl.ts', (text) =>
  STUBS + '\n' +
  text.split(/\r?\n/).filter((line) => !/^\s*import\s/.test(line)).join('\n')
    .replace(/export class AnalyzeUrl/, 'class AnalyzeUrl') +
  '\nexport { AnalyzeUrl };\n');

/** 宿主用 @js: 头规则算出的动态头，作为第三个构造参数传入。 */
const RUNTIME_HEADERS = {
  'x-novel-token': 'eyJ1aWQiOjEyM30=',
  'x-novel-version': '10'
};

function sourceHeaders(bookSourceUrl, requestUrl, runtimeHeaders = RUNTIME_HEADERS) {
  const source = {
    bookSourceUrl: bookSourceUrl,
    header: '',
    loginHeader: '',
    loginInfo: '',
    enabledCookieJar: false
  };
  return new AnalyzeUrl(source, {}, runtimeHeaders).parse(requestUrl).sourceHeaders;
}

const AGGREGATOR_API = 'https://api.example.com/search?keyword=a&page=1';
const AGGREGATOR_IMAGE = 'https://img.other-cdn.net/cover.jpg';
const SITE_LIST = 'https://www.example.com/list?page=1';
const SITE_IMAGE = 'https://img.other-cdn.net/cover.jpg';

// ---- 聚合源：bookSourceUrl 是名称，没有自有站点可匹配 ----
// 这类书源的接口域名只出现在规则脚本里，宿主的静态站点表里根本没有它，
// 因此动态头必须放行，否则每个请求都是匿名的。
equal(sourceHeaders('云端聚合', AGGREGATOR_API)['x-novel-token'], 'eyJ1aWQiOjEyM30=',
  'bookSourceUrl 是名称时，header 规则算出的请求头必须照常送出');
equal(sourceHeaders('云端聚合', AGGREGATOR_IMAGE)['x-novel-version'], '10',
  '聚合源没有站点边界，其请求头对第三方图片主机同样放行（与脚本内 java.ajax 一致）');

// ---- 有自有站点的书源：凭据只发给自己的站点 ----
equal(sourceHeaders('https://www.example.com', SITE_IMAGE)['x-novel-token'], undefined,
  '有自有站点的书源不得把动态凭据发给第三方主机');
equal(sourceHeaders('https://www.example.com', SITE_LIST)['x-novel-token'], 'eyJ1aWQiOjEyM30=',
  '有自有站点的书源请求自己的站点时仍要带上动态凭据');
equal(sourceHeaders('https://www.example.com', SITE_IMAGE, {})['x-novel-token'], undefined,
  '没有动态头时不应凭空产生凭据');

// ---- 同注册域的子域仍算自有站点（既有判定，回归时保持） ----
equal(sourceHeaders('https://example.com', 'https://api.example.com/v1/list')['x-novel-token'], 'eyJ1aWQiOjEyM30=',
  '同一注册域的不同子域仍按自有站点处理');

// ---- loginHeader 与 @js: 头规则受到同一套作用域约束 ----
function loginHeaderHeaders(bookSourceUrl, requestUrl) {
  const source = {
    bookSourceUrl: bookSourceUrl,
    header: '',
    loginHeader: '{"Authorization":"Bearer token"}',
    loginInfo: '',
    enabledCookieJar: false
  };
  return new AnalyzeUrl(source, {}, {}).parse(requestUrl).sourceHeaders;
}
equal(loginHeaderHeaders('https://www.example.com', SITE_IMAGE)['Authorization'], undefined,
  'loginHeader 不得发给第三方主机');
equal(loginHeaderHeaders('https://www.example.com', SITE_LIST)['Authorization'], 'Bearer token',
  'loginHeader 要发给书源自己的站点');
equal(loginHeaderHeaders('云端聚合', AGGREGATOR_API)['Authorization'], 'Bearer token',
  '聚合源的 loginHeader 要能送到它调用的接口');

console.log(`compat-aggregator-header-check: ${assertions} assertions passed`);
