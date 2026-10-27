// 原生书源引擎回归：表达式语言、定义校验与打包、五个阶段的执行流程。
// 运行：node --experimental-strip-types scripts/native-source-check.mjs

import { createTestHost, loadNativeSourceModules } from './lib/load-native-source-modules.mjs';

const mods = await loadNativeSourceModules();
const { NativeExpr, NativeScope, NativeSourceSpec, NativeSourceRunner, JsonPathEvaluator, NetworkErrorText } = mods;

let assertions = 0;
function equal(actual, expected, message) {
  assertions++;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected: ${b}\n  actual:   ${a}`);
}
async function rejectsWith(promise, pattern, message) {
  assertions++;
  let text = '';
  try {
    await promise;
  } catch (e) {
    text = e.message;
  }
  if (!pattern.test(text)) throw new Error(`${message}：应当报错，实际：${text || '未报错'}`);
}

try {
  // ---------- 表达式 ----------
  const host = createTestHost(JsonPathEvaluator, async () => null);
  const expr = new NativeExpr(host);
  const item = {
    id: 7, name: ' 测试 ', tags: ['a', '', 'b'], n: '25000', nested: { list: [{ v: 1 }, { v: 2 }] },
    html: '<p>一&amp;二</p><p>三</p>'
  };
  const scope = new NativeScope().set('item', item).set('key', '斗破').set('page', 3)
    .set('vars', { mode: '听书' }).set('baseUrl', 'https://example.com/a/b.html');
  const ev = (source) => expr.evaluate(source, scope);

  const dependency = new NativeExpr(host).loadLibrary('fn pure(x) { return str(x); } fn nested(x) { return custom(x); } fn recursive(x) { if (x) { return recursive(x-1); } return nested(x); }');
  equal(dependency.requiresScript('静态分类', true), false, '静态模板不启动 JS');
  equal(dependency.requiresScript('{{(page-1)*30}}/{{urlencode(key)}}', true), false, '内置函数模板不启动 JS');
  equal(dependency.requiresScript("$.url ? replaceText(absUrl($.url, baseUrl), '{{page}}', str(page)) : ''"), false, '动态菜单普通表达式不启动 JS');
  equal(dependency.requiresScript('pure(page)'), false, '纯 lib 函数沿原解释器执行');
  equal(dependency.requiresScript('recursive(page)'), true, '追踪 lib 递归到 JS 函数');
  equal(dependency.requiresScript('map([1,2], x => custom(x))'), true, '回调中 JS 调用仍进入沙箱');
  equal(dependency.requiresScript("{{tojson({a: custom('}}')})}}", true), true, '按模板语法检查嵌套对象和字符串');
  dependency.loadLibrary('fn nested(x) { return str(x); }');
  equal(dependency.requiresScript('nested(page)'), false, '更换 lib 后清理依赖缓存');

  equal(ev('1 + 2 * 3'), 7, '算术优先级');
  equal(ev('(page - 1) * 10'), 20, '括号与变量');
  equal(ev("'a' + 1 + null"), 'a1', '字符串拼接，null 视为空');
  equal(ev('$.id'), 7, 'JSONPath 取单值');
  equal(ev('$.nested.list[*].v'), [1, 2], 'JSONPath 通配返回列表');
  equal(ev('$.missing.deep'), null, '缺失路径为 null');
  equal(ev('$.id - 1'), 6, 'JSONPath 后接减法');
  equal(ev('item.nested.list[1].v'), 2, '成员与下标访问');
  equal(ev('item.nested.list[-1].v'), 2, '负下标');
  equal(ev('item.none.more'), null, 'null 上取成员不报错');
  equal(ev("vars.mode == '听书' ? 'audio' : 'text'"), 'audio', '三元');
  equal(ev("'3' == 3"), true, '数字与数字字符串相等');
  equal(ev('$.n >= 10000'), true, '数字字符串比较');
  equal(ev("$.missing ?? 'x'"), 'x', '空值合并');
  equal(ev("'' || 'fallback'"), 'fallback', '逻辑或返回操作数');
  equal(ev("join(compact($.tags), '/')"), 'a/b', 'compact + join');
  equal(ev('trim($.name)'), '测试', 'trim');
  equal(ev("lookup({'小说': '3', '听书': '2'}, vars.mode, '3')"), '2', '对象字面量查表');
  equal(ev("lookup({'小说': '3'}, vars.mode, '3')"), '3', '查表默认值');
  equal(ev("replace('a1b22', '\\d+', '#')"), 'a#b#', '正则替换，反斜杠原样保留');
  equal(ev("replace('[[IMG:1]]x', '\\[\\[IMG:(\\d+)\\]\\]', m => '<' + m[1] + '>')"), '<1>x', '替换回调拿到分组');
  equal(ev("match('book_id=42&x=1', 'book_id=([^&]+)', 1)"), '42', 'match 取分组');
  equal(ev("test(key, '^\\d{19}$')"), false, 'test');
  equal(ev('map($.nested.list, x => x.v * 2)'), [2, 4], 'map');
  equal(ev('filter($.nested.list, (x, i) => i > 0)'), [{ v: 2 }], 'filter 带下标');
  equal(ev('urlencode(key)'), '%E6%96%97%E7%A0%B4', 'urlencode');
  equal(ev("unbase64(base64('中文 abc'))"), '中文 abc', 'base64 往返');
  equal(ev("base64('中文 abc')"), Buffer.from('中文 abc', 'utf8').toString('base64'), 'base64 与标准实现一致');
  equal(ev("md5('abc')"), '900150983cd24fb0d6963f7d28e17f72', 'md5 走宿主摘要');
  equal(ev('stripHtml($.html)'), '一&二\n三\n', 'stripHtml');
  equal(ev("round(num($.n) / 10000, 1) + '万字'"), '2.5万字', '字数换算');
  equal(ev("absUrl('../c?x=1/2')"), 'https://example.com/c?x=1/2', '相对地址解析');
  equal(ev("absUrl('/root')"), 'https://example.com/root', '根相对地址');
  equal(ev("formatDate('')"), '', '空时间不输出 1970');
  equal(ev("formatDate(1700000000, 'yyyy')"), String(new Date(1700000000000).getFullYear()), '秒级时间戳');
  equal(ev('json(\'{"a":[1,2]}\').a[1]'), 2, 'json 解析');
  equal(ev('len(range(3))'), 3, 'range');
  equal(expr.render('{{vars.mode}}/p{{page}}?k={{urlencode(key)}}', scope), '听书/p3?k=%E6%96%97%E7%A0%B4', '模板');
  equal(expr.render('{{ tojson({a: 1}) }}', scope), '{"a":1}', '模板内以对象字面量结尾');
  equal(expr.render('{{ tojson({a: 1})}}', scope), '{"a":1}', '对象字面量与结束的 }} 相连');
  equal(expr.render('{{tojson({a: {b: page}})}}', scope), '{"a":{"b":3}}', '嵌套对象字面量');
  equal(expr.render('{"page":{{page}}}', scope), '{"page":3}', '模板外的 JSON 结尾花括号原样保留');
  equal(expr.render('{"a":{"b":{{page}}},"k":"{{key}}"}', scope), '{"a":{"b":3},"k":"斗破"}', '嵌在多层 JSON 里的模板');
  equal(expr.render("{{ '}}' + page }}", scope), '}}3', '字符串里的 }} 不结束模板');
  equal(NativeExpr.checkTemplate('{"page":{{page}}}'), '', '模板外的 JSON 通过语法检查');

  const mustFail = (source, hint) => {
    assertions++;
    let failed = false;
    try {
      ev(source);
    } catch (e) {
      failed = true;
    }
    if (!failed) throw new Error(`应当报错：${hint}`);
  };
  mustFail('undefinedName + 1', '未定义的名称');
  mustFail('nothing(1)', '未知函数');
  mustFail('1 +', '语法不完整');
  mustFail("join(map(range(10000), a => join(map(range(10000), b => b), '')), '')", '计算量上限');
  equal(NativeExpr.check('a = 1') !== '', true, '不支持赋值');
  equal(NativeExpr.check('x => x') === '', true, '箭头函数可解析');

  // ---------- 定义：校验与打包 ----------
  const sample = {
    sourceFormat: 'native',
    version: 1,
    name: '示例原生书源',
    url: 'https://api.example.com',
    type: 'text',
    headers: { 'User-Agent': 'check' },
    vars: [
      { key: 'mode', label: '模式', options: ['小说', '听书', '漫画'], default: '小说', filter: true },
      { key: 'server', label: '服务器', default: 'https://api.example.com' }
    ],
    let: {
      server: "= replace(default(vars.server, source.url), '/+$', '')",
      tabType: "= lookup({'小说': '3', '听书': '2', '漫画': '8'}, vars.mode, '3')"
    },
    search: {
      url: "= test(key, '^\\d{6}$') ? '' : server + '/search?key=' + urlencode(key) + '&offset=' + (page - 1) * 10 + '&tab=' + tabType",
      list: "= test(key, '^\\d{6}$') ? [{book_id: key, name: '书号 ' + key}] : $.data.list",
      fields: {
        name: '$.name',
        author: '$.author||$.writer',
        coverUrl: '$.cover',
        kind: "= compact([$.category, $.score ? $.score + '分' : ''])",
        wordCount: "= num($.words) >= 10000 ? round(num($.words) / 10000, 1) + '万字' : ($.words ? $.words + '字' : '')",
        bookUrl: '{{server}}/detail?book_id={{urlencode($.book_id)}}',
        type: "= lookup({'2': 'audio', '8': 'comic'}, str($.book_type), 'text')"
      }
    },
    explore: {
      menus: [
        { title: '推荐' },
        { title: '{{vars.mode}}榜', url: '{{server}}/rank?tab={{tabType}}&page={{page}}' },
        { title: '仅听书', url: '{{server}}/audio', when: "= vars.mode == '听书'" }
      ],
      dynamicMenus: {
        url: '{{server}}/nav?tab={{tabType}}',
        list: '$.data[*]',
        title: '$.title',
        target: "= $.url ? replaceText(absUrl($.url, server), '{{page}}', str(page)) : ''"
      },
      list: '$.data.books[*]||$.data[*]',
      fields: { name: '$.book_name||$.name', bookUrl: '{{server}}/detail?book_id={{$.book_id}}' }
    },
    detail: {
      let: { d: '= data.data ?? data' },
      fail: "= data.code != 0 ? default(data.message, '未知错误') : ''",
      fields: {
        name: '= d.name',
        author: '= default(d.author, d.author_info.user_name)',
        intro: "= default(d.intro, '暂无简介')",
        tocUrl: '{{server}}/book?book_id={{d.book_id}}',
        type: "= lookup({'2': 'audio', '8': 'comic'}, str(d.book_type), 'text')"
      },
      keep: { bookId: '= d.book_id' }
    },
    toc: {
      let: { bookId: '= str(default(data.data.book_id, book.vars.bookId))' },
      list: '$.data.volumes[*].chapters[*]',
      fields: {
        title: '$.title',
        url: "= $.item_id ? server + '/content?item_id=' + $.item_id + '&book_id=' + bookId : ''",
        tag: '= formatDate($.update_time)',
        isVip: '$.vip'
      },
      nextUrl: '= data.data.next'
    },
    content: {
      let: { d: '= data.data ?? {}' },
      fetch: {
        tone: { when: "= d.content_type == 'audio'", url: '{{server}}/tone?item_id={{d.item_id}}' },
        broken: { url: '{{server}}/broken' }
      },
      text: "= replace(str(d.content), '\\[\\[IMG:(\\d+)\\]\\]', m => '<img src=\"' + get(d.images, int(m[1])).url + '\">') + (broken ? 'x' : '')",
      images: "= map(d.images, x => server + '/image?url=' + urlencode(x.url))",
      audio: '= default(tone.data.url, d.content)',
      nextUrl: '= d.next',
      replace: [{ pattern: '广告\\d+' }]
    }
  };

  const definition = NativeSourceSpec.fromObject(JSON.parse(JSON.stringify(sample)));
  equal(NativeSourceSpec.validate(definition), [], '示例定义通过校验');
  const packed = NativeSourceSpec.pack(definition);
  equal(NativeSourceSpec.isPacked(packed), true, '打包结果带原生标记');
  equal(NativeSourceSpec.isPacked('function a(){}'), false, '脚本库不是原生书源');
  equal(NativeSourceSpec.isPacked('{"host":1}'), false, '普通 JSON 不是原生书源');
  equal(NativeSourceSpec.unpack(packed).search.list, sample.search.list, '还原后内容一致');
  equal(NativeSourceSpec.toExportObject(definition).sourceFormat, 'native', '导出带 sourceFormat');
  equal(NativeSourceSpec.toExportObject(definition).nativeSource, undefined, '导出不带内部标记');
  equal(NativeSourceSpec.isDefinitionObject({ bookSourceUrl: 'x', jsLib: '' }), false, '兼容书源对象不被误判');

  const invalid = (mutate, hint) => {
    assertions++;
    const copy = JSON.parse(JSON.stringify(sample));
    mutate(copy);
    let message = '';
    try {
      NativeSourceSpec.fromObject(copy);
    } catch (e) {
      message = e.message;
    }
    if (!message) throw new Error(`应当校验失败：${hint}`);
  };
  invalid((s) => { s.name = ''; }, '缺名称');
  invalid((s) => { s.url = 'ftp://x'; }, '地址协议');
  invalid((s) => { s.search.fields.kind = '@js: result'; }, '混入脚本');
  invalid((s) => { s.search.fields.kind = '$.a<js>1</js>'; }, '混入内嵌脚本');
  invalid((s) => { s.search.url = '= 1 +'; }, '表达式语法');
  invalid((s) => { s.search.fields.bookUrl = '{{ a b }}'; }, '模板语法');
  invalid((s) => { delete s.search.fields.bookUrl; }, '缺 bookUrl');
  invalid((s) => { s.version = 99; }, '版本过高');
  invalid((s) => { s.content.replace = [{ pattern: '(' }]; }, '替换正则');
  invalid((s) => { delete s.search; delete s.explore; }, '既无搜索也无发现');

  // ---------- 执行 ----------
  const responses = {
    '/search': { data: { list: [
      { book_id: '11', name: '斗破', author: '', writer: '土豆', cover: '/c/11.jpg', category: '玄幻', score: 9.1, words: 25000, book_type: 3 },
      { book_id: '12', name: '听斗破', author: '主播', words: 900, book_type: 2 },
      { book_id: '13', name: '', author: '无名' }
    ] } },
    '/nav': { data: [{ title: '玄幻', url: '/list?c=1&page={{page}}' }, { title: '分隔', url: '' }] },
    '/rank': { data: { books: [{ book_name: '榜一', book_id: 'r1' }] } },
    '/list': { data: [{ name: '分类书', book_id: 'l1' }] },
    '/detail': { code: 0, data: { book_id: '11', name: '斗破', author_info: { user_name: '土豆' }, book_type: 3 } },
    '/book?book_id=11&p=2': { data: { book_id: '11', volumes: [{ chapters: [{ title: '第三章', item_id: 'c3' }] }] } },
    '/book': { data: { book_id: '11', next: '/book?book_id=11&p=2', volumes: [
      { chapters: [{ title: '第一章', item_id: 'c1', update_time: 1700000000, vip: false }, { title: '', item_id: 'cx' }] },
      { chapters: [{ title: '第二章', item_id: 'c2', vip: true }, { title: '无地址' }] }
    ] } },
    '/content?item_id=c1&p=2': { data: { content: '第二页' } },
    '/content?item_id=c1': { data: {
      item_id: 'c1', content_type: 'novel', content: '第一页[[IMG:0]]广告123',
      images: [{ url: 'https://img.example.com/1.jpg' }], next: '/content?item_id=c1&p=2'
    } },
    '/content?item_id=a1': { data: { item_id: 'a1', content_type: 'audio', content: 'https://cdn.example.com/default.mp3' } },
    '/tone': { data: { url: 'https://cdn.example.com/tone.mp3' } },
    '/content?item_id=m1': { data: {
      item_id: 'm1', content_type: 'comic', images: [{ url: 'https://i/1.png' }, { url: 'https://i/2.png' }]
    } },
  };
  const respond = async (request) => {
    const pathAndQuery = request.url.replace(/^https?:\/\/[^/]+/, '');
    for (const prefix of Object.keys(responses)) {
      if (pathAndQuery.startsWith(prefix)) return responses[prefix];
    }
    return null;
  };

  const runHost = createTestHost(JsonPathEvaluator, respond);
  const runner = new NativeSourceRunner(definition, runHost, { mode: '听书', server: 'https://api.example.com/' });

  const found = await runner.search('斗破', 2);
  equal(runHost.requests[0].url, 'https://api.example.com/search?key=%E6%96%97%E7%A0%B4&offset=10&tab=2',
    '搜索地址：变量、页码与尾斜杠处理');
  equal(runHost.requests[0].method, 'GET', '默认 GET');
  equal(found.length, 2, '缺名称的条目被丢弃');
  equal(found[0].author, '土豆', '|| 备选路径');
  equal(mods.SourceCoverUrl.address(found[0].coverUrl), 'https://api.example.com/c/11.jpg', '封面相对地址补全');
  equal(mods.SourceCoverUrl.headers(found[0].coverUrl), { 'User-Agent': 'check' }, '封面继承书源请求头');
  equal(found[0].kind, '玄幻,9.1分', '列表字段用逗号连接');
  equal(found[0].wordCount, '2.5万字', '字数换算');
  equal(found[0].bookUrl, 'https://api.example.com/detail?book_id=11', '模板字段');
  equal([found[0].type, found[1].type], ['text', 'audio'], '逐本声明媒体类型');
  equal(found[1].wordCount, '900字', '小字数');

  const before = runHost.requests.length;
  const byId = await runner.search('123456', 1);
  equal(runHost.requests.length, before, '地址为空时不发请求');
  equal(byId.map((b) => b.name), ['书号 123456'], '表达式直接给出列表');

  const menus = await runner.exploreMenus();
  equal(menus.map((m) => m.title), ['推荐', '听书榜', '仅听书', '玄幻', '分隔'], '静态与动态分类，when 生效');
  equal([menus[0].target, menus[4].target], ['', ''], '没有地址的是分组标题');
  const rank = await runner.explore(menus[1].target, 3);
  equal(runHost.requests[runHost.requests.length - 1].url, 'https://api.example.com/rank?tab=2&page=3', '静态分类按页渲染');
  equal(rank.map((b) => b.name), ['榜一'], '发现列表 || 备选');
  const listed = await runner.explore(menus[3].target, 4);
  equal(runHost.requests[runHost.requests.length - 1].url, 'https://api.example.com/list?c=1&page=4', '动态分类按页渲染');
  equal(listed[0].bookUrl, 'https://api.example.com/detail?book_id=l1', '动态分类结果');

  // 静态分类各自的请求方法与请求体；请求方法可以写表达式。
  const methodMenus = JSON.parse(JSON.stringify(sample));
  methodMenus.explore.body = '{"from":"explore"}';
  methodMenus.explore.menus = [
    { title: '沿用', url: '{{server}}/rank?page={{page}}' },
    { title: 'GET 不带体', url: '{{server}}/rank?page={{page}}', method: 'get', body: '' },
    { title: '按页切换', url: '{{server}}/rank', method: "= page > 1 ? 'PUT' : 'POST'", body: '= tojson({page: page})' },
    { title: '坏方法', url: '{{server}}/rank', method: '= "G T"' }
  ];
  equal(NativeSourceSpec.validate(NativeSourceSpec.fromObject(JSON.parse(JSON.stringify(methodMenus)))), [],
    '分类的 method/body 通过校验');
  const methodHost = createTestHost(JsonPathEvaluator, respond);
  const methodRunner = new NativeSourceRunner(NativeSourceSpec.fromObject(methodMenus), methodHost,
    { server: 'https://api.example.com' });
  const methodTargets = (await methodRunner.exploreMenus()).map((m) => m.target);
  const lastRequest = () => {
    const r = methodHost.requests[methodHost.requests.length - 1];
    return [r.method, r.body];
  };
  await methodRunner.explore(methodTargets[0], 1);
  equal(lastRequest(), ['POST', '{"from":"explore"}'], '不写时沿用 explore 的请求体，默认 POST');
  await methodRunner.explore(methodTargets[1], 1);
  equal(lastRequest(), ['GET', ''], '分类改为 GET，body 空串表示不带请求体');
  await methodRunner.explore(methodTargets[2], 1);
  equal(lastRequest(), ['POST', '{"page":1}'], '请求方法表达式（第 1 页）');
  await methodRunner.explore(methodTargets[2], 2);
  equal(lastRequest(), ['PUT', '{"page":2}'], '请求方法表达式（第 2 页）');
  let badMethod = '';
  try {
    await methodRunner.explore(methodTargets[3], 1);
  } catch (e) {
    badMethod = e.message;
  }
  equal(badMethod, '请求方法无效：G T', '无效的请求方法给出明确报错');

  const hidden = new NativeSourceRunner(definition, runHost, { mode: '不存在的值' });
  equal((await hidden.exploreMenus()).map((m) => m.title).includes('仅听书'), false, '非法变量值回退默认值');

  const book = { bookUrl: found[0].bookUrl, tocUrl: '', name: '斗破', author: '', kind: '', type: 'text', vars: {} };
  const info = await runner.detail(book);
  equal([info.author, info.intro, info.tocUrl], ['土豆', '暂无简介', 'https://api.example.com/book?book_id=11'], '详情字段');
  equal(info.keep, { bookId: '11' }, '书籍变量');

  // 详情附加请求：作者在详情接口、最新章节在另一个接口；请求失败或 when 为假时变量为 null。
  const detailFetch = JSON.parse(JSON.stringify(sample));
  detailFetch.detail.fetch = {
    units: { url: '{{server}}/units?book_id={{d.book_id}}&order=2' },
    missing: { url: '{{server}}/missing' },
    skipped: { when: '= false', url: '{{server}}/units' }
  };
  detailFetch.detail.fields.lastChapter = "= str(units.data[0].title) + (missing ? 'x' : '') + (skipped ? 'y' : '')";
  equal(NativeSourceSpec.validate(NativeSourceSpec.fromObject(JSON.parse(JSON.stringify(detailFetch)))), [],
    '详情附加请求通过校验');
  responses['/units'] = { data: [{ title: '第九十九章' }] };
  const detailFetchHost = createTestHost(JsonPathEvaluator, respond);
  const fetchedInfo = await new NativeSourceRunner(NativeSourceSpec.fromObject(detailFetch), detailFetchHost,
    { server: 'https://api.example.com' }).detail(book);
  equal([fetchedInfo.author, fetchedInfo.lastChapter], ['土豆', '第九十九章'], '详情同时取主接口与附加接口');
  equal(detailFetchHost.requests.map((r) => r.url.replace('https://api.example.com', '')),
    [book.bookUrl.replace('https://api.example.com', ''), '/units?book_id=11&order=2', '/missing'],
    '附加请求按声明顺序发出，when 为假的不发');
  delete responses['/units'];
  book.tocUrl = info.tocUrl;
  book.vars = info.keep;

  const chapters = await runner.toc(book);
  equal(chapters.map((c) => c.title), ['第一章', '第二章', '第三章'], '目录翻页，空标题与无地址章节被丢弃');
  equal(chapters[0].url, 'https://api.example.com/content?item_id=c1&book_id=11', '章节地址');
  equal([chapters[0].isVip, chapters[1].isVip], [false, true], 'VIP 标记');
  equal(chapters[0].tag.length > 0, true, '更新时间');
  equal((await runner.toc(book, 1)).length, 1, '目录条数上限');

  // nextUrl 一次给出多个地址：剩余目录页每批 4 页并发、按列出顺序解析，不跟随这些页自己的 nextUrl。
  const paged = JSON.parse(JSON.stringify(sample));
  paged.toc = {
    url: '{{server}}/pages?p=1',
    list: '$.data.chapters[*]',
    fields: { title: '$.title', url: '= server + "/content?item_id=" + $.id' },
    nextUrl: "= data.data.total ? map(range(data.data.total), i => '/pages?p=' + (i + 1)) : data.data.next"
  };
  let inFlight = 0;
  let peak = 0;
  const pagedHost = createTestHost(JsonPathEvaluator, async (request) => {
    const p = Number(/[?&]p=(\d+)/.exec(request.url)[1]);
    inFlight++;
    peak = Math.max(peak, inFlight);
    // 页码越小返回越慢，验证结果仍按列出顺序拼接。
    await new Promise((resolve) => setTimeout(resolve, (12 - p) * 3));
    inFlight--;
    return { data: { total: p === 1 ? 10 : 0, next: p === 1 ? '' : '/pages?p=99',
      chapters: [{ title: `第${p}页`, id: `p${p}` }] } };
  });
  const pagedChapters = await new NativeSourceRunner(NativeSourceSpec.fromObject(paged), pagedHost,
    { server: 'https://api.example.com' }).toc({ ...book, tocUrl: '' });
  equal(pagedChapters.map((c) => c.title), Array.from({ length: 10 }, (_, i) => `第${i + 1}页`),
    '目录分页列表按列出顺序拼接');
  equal(pagedHost.requests.length, 10, '列出的页不再跟随各自的 nextUrl');
  equal(peak, 4, '剩余目录页每批 4 页并发');
  paged.toc.nextUrl = "= data.data.total ? join(map(range(3), i => '/pages?p=' + (i + 1)), '\\n') : ''";
  const linesChapters = await new NativeSourceRunner(NativeSourceSpec.fromObject(paged), pagedHost,
    { server: 'https://api.example.com' }).toc({ ...book, tocUrl: '' });
  equal(linesChapters.map((c) => c.title), ['第1页', '第2页', '第3页'], '多行文本同样视为分页列表');

  // toc.batch：书源自己定每批并发页数。
  paged.toc.nextUrl = "= data.data.total ? map(range(data.data.total), i => '/pages?p=' + (i + 1)) : data.data.next";
  paged.toc.batch = 8;
  equal(NativeSourceSpec.validate(NativeSourceSpec.fromObject(JSON.parse(JSON.stringify(paged)))), [],
    'toc.batch 通过校验');
  peak = 0;
  const batchedChapters = await new NativeSourceRunner(NativeSourceSpec.fromObject(paged), pagedHost,
    { server: 'https://api.example.com' }).toc({ ...book, tocUrl: '' });
  equal(batchedChapters.length, 10, '调大并发后章节不变');
  equal(peak, 8, 'toc.batch 决定每批并发页数');
  for (const bad of [0, 17, 2.5, '8']) invalid((s) => { s.toc.batch = bad; }, `toc.batch 非法值 ${JSON.stringify(bad)}`);

  // 目录与详情是同一个请求：目录第一页复用详情页响应，只复用一次；请求有任何不同都照常请求。
  const samePage = JSON.parse(JSON.stringify(sample));
  samePage.name = '同页书源';
  samePage.detail = { fields: { name: '$.name' } };
  samePage.toc = { list: '$.chapters[*]', fields: { title: '$.title', url: '$.url' } };
  const sameHost = createTestHost(JsonPathEvaluator, async () => ({
    name: '同页', chapters: [{ title: '第一章', url: '/c/1' }]
  }));
  const sameRun = () => new NativeSourceRunner(NativeSourceSpec.fromObject(samePage), sameHost,
    { server: 'https://api.example.com' });
  const sameBook = { ...book, bookUrl: 'https://api.example.com/same/1', tocUrl: '', vars: {} };
  await sameRun().detail(sameBook);
  const sameChapters = await sameRun().toc({ ...sameBook, tocUrl: sameBook.bookUrl });
  equal(sameChapters.map((c) => [c.title, c.url]), [['第一章', 'https://api.example.com/c/1']],
    '复用的响应照常解析，地址按详情页补全');
  equal(sameHost.requests.length, 1, '目录与详情同址时不再请求');
  equal(sameHost.traces.filter((t) => t.type === 'reuse').map((t) => t.field), ['目录请求'], '调试记录标出复用');
  await sameRun().toc({ ...sameBook, tocUrl: sameBook.bookUrl });
  equal(sameHost.requests.length, 2, '详情页只复用一次，再取目录照常请求');
  samePage.toc.headers = { 'X-Toc': '1' };
  await sameRun().detail(sameBook);
  await sameRun().toc({ ...sameBook, tocUrl: sameBook.bookUrl });
  equal(sameHost.requests.length, 4, '请求头不同不复用');
  delete samePage.toc.headers;
  await sameRun().detail(sameBook);
  await sameRun().toc({ ...sameBook, tocUrl: 'https://api.example.com/same/1/toc' });
  equal(sameHost.requests.length, 6, '地址不同不复用');

  // 逐章取字段很慢时分片让出主线程：解析途中定时器能执行，结果顺序不变；让出后发现已取消则返回空。
  const slowCount = 400;
  const slowToc = JSON.parse(JSON.stringify(sample));
  slowToc.toc = { url: '{{server}}/slow', list: '$.data[*]', fields: { title: '$.title', url: '$.url' } };
  const slowBase = createTestHost(JsonPathEvaluator, async () => ({
    data: Array.from({ length: slowCount }, (_, i) => ({ title: `第${i + 1}章`, url: `/c/${i + 1}` }))
  }));
  const slowHost = {
    ...slowBase,
    jsonPath: (root, rule) => {
      const until = performance.now() + 0.1;
      while (performance.now() < until) { /* 模拟慢规则 */ }
      return slowBase.jsonPath(root, rule);
    }
  };
  let ticks = 0;
  const ticker = setInterval(() => { ticks++; }, 1);
  const slowChapters = await new NativeSourceRunner(NativeSourceSpec.fromObject(slowToc), slowHost,
    { server: 'https://api.example.com' }).toc({ ...book, tocUrl: '' });
  clearInterval(ticker);
  equal(slowChapters.length, slowCount, '慢目录完整解析');
  equal(slowChapters[slowCount - 1].title, `第${slowCount}章`, '分片让出后顺序不变');
  equal(ticks > 3, true, '解析途中让出主线程，定时器得以执行');
  let cancelAfter = 0;
  const cancelledRunner = new NativeSourceRunner(NativeSourceSpec.fromObject(slowToc), slowHost,
    { server: 'https://api.example.com' }).setCancelCheck(() => ++cancelAfter > 3);
  equal((await cancelledRunner.toc({ ...book, tocUrl: '' })).length, 0, '让出后发现已取消，返回空目录');

  const text = await runner.content(book, { url: chapters[0].url, title: '第一章', index: 0 });
  equal(text.kind, 'text', '文本正文');
  equal(text.text, '第一页<img src="https://img.example.com/1.jpg">\n第二页',
    '正文翻页、占位符还原、净化替换、附加请求失败降级');

  const audio = await runner.content({ ...book, type: 'audio' },
    { url: 'https://api.example.com/content?item_id=a1', title: '', index: 0 });
  equal([audio.kind, audio.text], ['audio', 'https://cdn.example.com/tone.mp3'], '听书：附加请求结果优先');

  const comic = await runner.content({ ...book, type: 'comic' },
    { url: 'https://api.example.com/content?item_id=m1', title: '', index: 0 });
  equal(comic.text, '<img src="https://api.example.com/image?url=https%3A%2F%2Fi%2F1.png">\n' +
    '<img src="https://api.example.com/image?url=https%3A%2F%2Fi%2F2.png">', '漫画图片列表');

  // 正文分页：逐页跟随超过 30 页；列表写法分批并发；指回第一页不重复请求；超过 200 页截断并记入调试。
  const longChapter = JSON.parse(JSON.stringify(sample));
  longChapter.content = {
    text: '= data.text',
    nextUrl: "= data.total ? map(range(data.total - 1), i => '/long?p=' + (i + 2)) : data.next"
  };
  let longInFlight = 0;
  let longPeak = 0;
  const longHost = createTestHost(JsonPathEvaluator, async (request) => {
    const url = new URL(request.url);
    const p = Number(url.searchParams.get('p') || 1);
    const pages = Number(url.searchParams.get('n') || 0);
    const listed = url.searchParams.get('list') === '1';
    longInFlight++;
    longPeak = Math.max(longPeak, longInFlight);
    await new Promise((resolve) => setTimeout(resolve, listed ? (20 - p) % 7 : 0));
    longInFlight--;
    const next = url.searchParams.get('loop') === '1' ? `/long?n=${pages}&loop=1` :
      (p < pages ? `/long?n=${pages}&p=${p + 1}` : '');
    return { text: `第${p}页`, total: listed && p === 1 ? pages : 0, next: next };
  });
  const longRun = (definitionObject) => new NativeSourceRunner(NativeSourceSpec.fromObject(definitionObject), longHost,
    { server: 'https://api.example.com' });
  const longPages = (n) => Array.from({ length: n }, (_, i) => `第${i + 1}页`).join('\n');
  const sixty = await longRun(longChapter).content(book, { url: 'https://api.example.com/long?n=60', title: '', index: 0 });
  equal(sixty.text, longPages(60), '逐页跟随超过 30 页');
  longHost.requests.length = 0;
  const looped = await longRun(longChapter).content(book,
    { url: 'https://api.example.com/long?n=5&loop=1', title: '', index: 0 });
  equal([looped.text, longHost.requests.length], ['第1页', 1], 'nextUrl 指回第一页时停止');
  longChapter.content.nextUrl = "= data.total ? map(range(data.total - 1), i => '/long?list=1&p=' + (i + 2)) : ''";
  longChapter.content.batch = 6;
  longHost.requests.length = 0;
  longPeak = 0;
  const listedChapter = await longRun(longChapter).content(book,
    { url: 'https://api.example.com/long?list=1&n=20', title: '', index: 0 });
  equal(listedChapter.text, longPages(20), '列表写法按列出顺序拼接');
  equal([longHost.requests.length, longPeak], [20, 6], 'content.batch 决定每批并发页数');
  delete longChapter.content.batch;
  longChapter.content.nextUrl = '= data.next';
  longHost.traces.length = 0;
  const capped = await longRun(longChapter).content(book, { url: 'https://api.example.com/long?n=250', title: '', index: 0 });
  equal(capped.text, longPages(200), '最多跟随 200 页');
  equal(longHost.traces.filter((t) => t.type === 'limit').map((t) => [t.field, t.count]), [['content.nextUrl', 1]],
    '截断时调试记录说明还有页没取');
  invalid((s) => { s.content.batch = 0; }, 'content.batch 非法值');

  responses['/detail'] = { code: 3, message: '书籍不存在' };
  let failure = '';
  try {
    await runner.detail(book);
  } catch (e) {
    failure = e.message;
  }
  equal(failure, '详情接口返回失败：书籍不存在', 'fail 规则上报接口错误');

  delete responses['/search'];
  failure = '';
  try {
    await runner.search('x', 1);
  } catch (e) {
    failure = e.message;
  }
  equal(failure, '搜索请求失败（HTTP 500）', '请求失败上报');

  // ---------- 函数库（脚本层） ----------
  const sha1Library = `
    // 用脚本层实现标准 SHA-1，与系统摘要比对
    fn rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0 }

    fn sha1hex(text) {
      let msg = bytes(text)
      let bitLen = len(msg) * 8
      push(msg, 0x80)
      while len(msg) % 64 != 56 { push(msg, 0) }
      for i in range(8) {
        push(msg, i < 4 ? 0 : (bitLen >>> (8 * (7 - i))) & 255)
      }
      let h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]
      let offset = 0
      while offset < len(msg) {
        let w = list(80, 0)
        for i in range(16) {
          let at = offset + i * 4
          w[i] = ((msg[at] << 24) | (msg[at + 1] << 16) | (msg[at + 2] << 8) | msg[at + 3]) >>> 0
        }
        let i = 16
        while i < 80 {
          w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1); i = i + 1
        }
        let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3]; let e = h[4]
        for t in range(80) {
          let f = 0
          let k = 0
          if t < 20 { f = (b & c) | (~b & d); k = 0x5A827999 }
          else if t < 40 { f = b ^ c ^ d; k = 0x6ED9EBA1 }
          else if t < 60 { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC }
          else { f = b ^ c ^ d; k = 0xCA62C1D6 }
          let temp = (rotl(a, 5) + (f >>> 0) + e + k + w[t]) >>> 0
          e = d; d = c; c = rotl(b, 30); b = a; a = temp
        }
        h[0] = (h[0] + a) >>> 0
        h[1] = (h[1] + b) >>> 0
        h[2] = (h[2] + c) >>> 0
        h[3] = (h[3] + d) >>> 0
        h[4] = (h[4] + e) >>> 0
        offset = offset + 64
      }
      return join(map(h, x => toHex(x, 8)), '')
    }

    fn firstEven(items) {
      for item, position in items {
        if item % 2 != 0 { continue }
        return { value: item, at: position }
      }
      return null
    }

    fn countUntil(limit) {
      let n = 0
      while true {
        n = n + 1
        if n >= limit { break }
      }
      return n
    }

    fn fact(n) { return n <= 1 ? 1 : n * fact(n - 1) }
    fn spin() { while true { } }
    fn dive(n) { return dive(n + 1) }
    fn undeclared() { missing = 1 }
    fn peek() { return vars }
  `;
  equal(NativeExpr.checkLibrary(sha1Library), '', '函数库语法检查通过');
  const scripted = new NativeExpr(host).loadLibrary(sha1Library);
  const run = (source) => scripted.evaluate(source, scope);
  for (const input of ['', 'abc', '中文与 emoji 😀', 'x'.repeat(200)]) {
    scope.set('input', input);
    equal(run('sha1hex(input)'), run('sha1(input)'), `脚本实现的 SHA-1 与系统摘要一致（长度 ${input.length}）`);
  }
  equal(run('firstEven([3, 5, 8, 10])'), { value: 8, at: 2 }, 'for 带下标、continue、提前 return');
  equal(run('firstEven([1, 3])'), null, '没有 return 时为 null');
  equal(run('countUntil(7)'), 7, 'while 与 break');
  equal(run('fact(10)'), 3628800, '递归');
  equal(run('0xff & 0x0f | 0x100'), 0x10f, '位运算优先级');
  equal(run('u32(~0)'), 4294967295, '按位取反与无符号');
  equal(run("bytesHex(hexBytes('00ff10'))"), '00ff10', '十六进制与字节互转');
  equal(run("fromBytes(base64Bytes(bytesBase64(bytes('中文'))))"), '中文', 'Base64 与字节互转');
  equal(run("bytesHex(hmac('SHA256', 'key', 'data'))"),
    '5031fe3d989c6d1537a013fa6e739da23463fdaec3b70137d828e36ace221bd0', 'HMAC');
  equal(run("fromBytes(decrypt('AES/CBC/PKCS5Padding', encrypt('AES/CBC/PKCS5Padding', '正文', '0123456789abcdef', 'fedcba9876543210'), '0123456789abcdef', 'fedcba9876543210'))"),
    '正文', 'AES 加解密往返');
  equal(run("bytesHex(hash('MD5', 'abc'))"), '900150983cd24fb0d6963f7d28e17f72', 'hash 返回字节');
  equal(run("cookie('https://example.com/', 'sessionid')"), 'abc123', '读取 Cookie');

  const scriptFails = (source, pattern, hint) => {
    assertions++;
    let message = '';
    try {
      run(source);
    } catch (e) {
      message = e.message;
    }
    if (!pattern.test(message)) throw new Error(`应当报错（${hint}），实际：${message || '未报错'}`);
  };
  scriptFails('spin()', /计算量/, '死循环被中止');
  scriptFails('dive(0)', /调用层数/, '无限递归被中止');
  scriptFails('undeclared()', /let 声明/, '未声明就赋值');
  scriptFails('peek()', /未定义的名称/, '函数读不到书源变量');
  equal(NativeExpr.checkLibrary('fn md5(x) { return x }') !== '', true, '不能与内置函数重名');
  equal(NativeExpr.checkLibrary('fn a() { return 1 } fn a() { return 2 }') !== '', true, '不能重复定义');
  equal(NativeExpr.checkLibrary('let x = 1') !== '', true, 'lib 里只能写函数定义');
  equal(NativeExpr.checkLibrary('fn a() { if x { return 1 }') !== '', true, '缺少右花括号');
  invalid((s) => { s.lib = 'fn broken( {'; }, '函数库语法错误');

  const signed = JSON.parse(JSON.stringify(sample));
  signed.lib = "fn sign(path, salt) { let h = 0\n for b in bytes(path + salt) { h = (imul(h, 31) + b) >>> 0 }\n return toHex(h, 8) }";
  signed.search.url = "{{server}}/search?key={{urlencode(key)}}&sign={{sign('/search' + key, 'salt')}}";
  responses['/search'] = { data: { list: [{ book_id: '1', name: '签名' }] } };
  const signedHost = createTestHost(JsonPathEvaluator, respond);
  await new NativeSourceRunner(NativeSourceSpec.fromObject(signed), signedHost, {}).search('ab', 1);
  let expectedHash = 0;
  for (const b of Buffer.from('/searchabsalt', 'utf8')) expectedHash = (Math.imul(expectedHash, 31) + b) >>> 0;
  equal(signedHost.requests[0].url, `https://api.example.com/search?key=ab&sign=${expectedHash.toString(16).padStart(8, '0')}`,
    '请求地址里调用函数库做签名');

  // ---------- 登录、分类请求头、网页渲染、段评 ----------
  const social = JSON.parse(JSON.stringify(sample));
  social.vars.push({ key: 'bubbles', label: '段评', options: ['开', '关'], default: '开' });
  social.let.session = "= cookie('https://example.com/', 'sessionid')";
  social.login = {
    url: 'https://example.com/login',
    cookies: ['sessionid'],
    check: { url: '{{server}}/me', headers: { Cookie: 'sessionid={{session}}' }, ok: '= data.code == 0', name: '= data.name' }
  };
  social.explore.menus.push({
    title: '我的书架', url: '{{server}}/shelf', when: '= session', headers: { Cookie: 'sessionid={{session}}' }
  });
  social.detail.webView = true;
  social.content.comments = {
    when: "= vars.bubbles == '开'",
    stats: { url: '{{server}}/stats?item={{d.item_id}}' },
    counts: '= stats.paras',
    paragraphUrl: '{{server}}/para?item={{d.item_id}}&i={{para.index}}&t={{urlencode(para.text)}}&n={{para.count}}',
    chapterUrl: '{{server}}/chapter-comments?item={{d.item_id}}&total={{total}}',
    max: 2
  };
  responses['/me'] = { code: 0, name: '读者甲' };
  responses['/shelf'] = { data: [{ name: '书架上的书', book_id: 's1' }] };
  responses['/detail'] = { code: 0, data: { book_id: '11', name: '斗破' } };
  responses['/stats'] = { paras: { '0': 3, '1': 0, '2': 150, '3': 7, '9': 1 } };
  responses['/content?item_id=p1'] = { data: { item_id: 'p1', content: '第一段\n第二段\n<b>第三段</b>\n第四段' } };
  const socialDefinition = NativeSourceSpec.fromObject(social);
  const socialHost = createTestHost(JsonPathEvaluator, respond);
  const socialRunner = new NativeSourceRunner(socialDefinition, socialHost, {});

  equal(await socialRunner.checkLogin(), { ok: true, name: '读者甲', message: '' }, '登录检查');
  equal(socialHost.requests[0].headers, { 'User-Agent': 'check', Cookie: 'sessionid=abc123' }, '登录检查带上已保存的 Cookie，并带顶层请求头');
  responses['/me'] = { code: 401 };
  equal((await socialRunner.checkLogin()).ok, false, '登录失效');

  const socialMenus = await socialRunner.exploreMenus();
  const shelf = socialMenus.find((m) => m.title === '我的书架');
  equal(!!shelf, true, '登录后出现个人分类');
  await socialRunner.explore(shelf.target, 1);
  equal(socialHost.requests[socialHost.requests.length - 1].headers, { 'User-Agent': 'check', Cookie: 'sessionid=abc123' }, '个人分类附带请求头');
  await socialRunner.explore(socialMenus.find((m) => m.title === '小说榜').target, 1);
  equal(socialHost.requests[socialHost.requests.length - 1].headers, { 'User-Agent': 'check' }, '其他分类不带登录凭据');

  await socialRunner.detail(book);
  equal(socialHost.requests[socialHost.requests.length - 1].webView, true, '详情请求声明网页渲染');
  equal(socialHost.requests[0].webView, false, '未声明时不走网页渲染');

  const commented = await socialRunner.content(book, { url: 'https://api.example.com/content?item_id=p1', title: '', index: 0 });
  equal(commented.paragraphComments, [
    { line: 0, count: 3, url: 'https://api.example.com/para?item=p1&i=0&t=%E7%AC%AC%E4%B8%80%E6%AE%B5&n=3' },
    { line: 2, count: 150, url: 'https://api.example.com/para?item=p1&i=2&t=%E7%AC%AC%E4%B8%89%E6%AE%B5&n=150' }
  ], '段评：跳过 0 条、去掉标签、遵守条数上限');
  equal(commented.chapterCommentUrl, 'https://api.example.com/chapter-comments?item=p1&total=161', '章评地址与总条数');
  equal(commented.text, '第一段\n第二段\n<b>第三段</b>\n第四段', '执行器不改动正文，标记由接入层写入');

  const quiet = await new NativeSourceRunner(socialDefinition, socialHost, { bubbles: '关' })
    .content(book, { url: 'https://api.example.com/content?item_id=p1', title: '', index: 0 });
  equal([quiet.paragraphComments.length, quiet.chapterCommentUrl], [0, ''], '关闭后不请求也不生成');
  delete responses['/stats'];
  const statless = await socialRunner.content(book, { url: 'https://api.example.com/content?item_id=p1', title: '', index: 0 });
  equal([statless.text.length > 0, statless.paragraphComments.length], [true, 0], '统计接口失败不影响正文');
  invalid((s) => { s.login = { url: 'not-a-url' }; }, '登录地址不合法');
  invalid((s) => { s.content.comments = { stats: { url: 'x' } }; }, '评论缺少地址');

  // ---------- 正文末尾的链接按钮 ----------
  const linked = JSON.parse(JSON.stringify(sample));
  linked.content.links = [
    { label: '▶ 播放{{d.item_id}}', url: '/player?item={{d.item_id}}', when: "= d.content_type == 'novel'" },
    { label: '不显示', url: '{{server}}/x', when: '= false' },
    { label: '地址无效', url: 'javascript:alert(1)' }
  ];
  const linkedContent = await new NativeSourceRunner(NativeSourceSpec.fromObject(linked), runHost, {})
    .content(book, { url: 'https://api.example.com/content?item_id=c1', title: '', index: 0 });
  equal(linkedContent.links, [{ label: '▶ 播放c1', url: 'https://api.example.com/player?item=c1', request: null, message: '' }],
    '链接按钮：模板、when、相对地址补全，非 http 地址被丢弃');
  invalid((s) => { s.content.links = [{ label: '缺地址' }]; }, '链接缺少地址');

  // ---------- 字符集、重试、媒体请求头、声明式缓存 ----------
  const extended = JSON.parse(JSON.stringify(sample));
  extended.search.charset = 'gbk';
  extended.search.retry = 9;
  extended.cache = {
    token: { url: '{{vars.server}}/token', value: '= data.token', ttl: 60 }
  };
  extended.let.auth = "= token ? 'Bearer ' + token : ''";
  extended.detail.headers = { Authorization: '{{auth}}' };
  extended.content.mediaHeaders = { Referer: '{{server}}/', Empty: '' };
  responses['/token'] = { token: 'T1' };
  responses['/detail'] = { code: 0, data: { book_id: '11', name: '斗破' } };
  responses['/search'] = { data: { list: [{ book_id: '1', name: '书' }] } };
  const extendedHost = createTestHost(JsonPathEvaluator, respond);
  const extendedRunner = new NativeSourceRunner(NativeSourceSpec.fromObject(extended), extendedHost, {});
  await extendedRunner.search('书', 1);
  const searchRequest = extendedHost.requests.find((request) => request.url.includes('/search?'));
  equal([searchRequest.charset, searchRequest.retry, searchRequest.primary], ['gbk', 3, true],
    '字符集、重试上限，主请求带验证标记');
  await extendedRunner.detail(book);
  equal(extendedHost.requests[extendedHost.requests.length - 1].headers, { 'User-Agent': 'check', Authorization: 'Bearer T1' },
    '缓存值可用于后续请求');
  const tokenRequests = extendedHost.requests.filter((request) => request.url.includes('/token'));
  equal([tokenRequests.length, tokenRequests[0].primary], [1, false], '有效期内只取一次，取值请求不触发验证');
  extendedHost.clearCache();
  delete responses['/token'];
  await extendedRunner.detail(book);
  equal(extendedHost.requests[extendedHost.requests.length - 1].headers, { 'User-Agent': 'check' }, '取值失败时为 null，值为空的请求头不发送');
  const comicWithHeaders = await extendedRunner.content({ ...book, type: 'comic' },
    { url: 'https://api.example.com/content?item_id=m1', title: '', index: 0 });
  equal(comicWithHeaders.images.length, 2, '漫画返回图片地址列表');
  equal(comicWithHeaders.mediaHeaders, { Referer: 'https://api.example.com/' }, '媒体请求头按模板渲染');
  invalid((s) => { s.cache = { token: { url: 'x' } }; }, '缓存缺少取值规则');

  // ---------- 顶层 headers：每个请求按当前作用域求值，与本次请求的请求头合并 ----------
  const dynamicHeaders = JSON.parse(JSON.stringify(sample));
  dynamicHeaders.cache = { token: { url: '{{vars.server}}/token', value: '= data.token', ttl: 60 } };
  dynamicHeaders.headers = {
    'User-Agent': 'check',
    'X-Mode': '{{vars.mode}}',
    Authorization: "= token ? 'Bearer ' + token : ''",
    Referer: '{{server}}/',
    'X-Empty': '{{vars.nothing}}'
  };
  dynamicHeaders.detail.headers = { referer: 'https://detail.example.com/', 'x-mode': '' };
  responses['/token'] = { token: 'T9' };
  const dynamicHost = createTestHost(JsonPathEvaluator, respond);
  const dynamicDefinition = NativeSourceSpec.fromObject(dynamicHeaders);
  const dynamicRunner = new NativeSourceRunner(dynamicDefinition, dynamicHost, { mode: '听书' });
  await dynamicRunner.search('书', 1);
  equal(dynamicHost.requests.find((request) => request.url.includes('/token')).headers,
    { 'User-Agent': 'check', 'X-Mode': '听书' }, '取缓存时引用缓存名和 let 的顶层请求头先不带');
  equal(dynamicHost.requests.find((request) => request.url.includes('/search?')).headers, {
    'User-Agent': 'check', 'X-Mode': '听书', Authorization: 'Bearer T9', Referer: 'https://api.example.com/'
  }, '顶层请求头的模板与表达式按作用域求值，值为空的不发送');
  await dynamicRunner.detail(book);
  equal(dynamicHost.requests[dynamicHost.requests.length - 1].headers, {
    'User-Agent': 'check', 'X-Mode': '听书', Authorization: 'Bearer T9', referer: 'https://detail.example.com/'
  }, '阶段同名请求头（不分大小写）优先，阶段里值为空的不覆盖顶层');
  const scriptedHeaders = JSON.parse(JSON.stringify(dynamicHeaders));
  scriptedHeaders.headers = { 'X-Bad': '= missingName + 1' };
  await rejectsWith(new NativeSourceRunner(NativeSourceSpec.fromObject(scriptedHeaders), createTestHost(JsonPathEvaluator, respond), {})
    .search('书', 1), /规则 headers\.X-Bad 出错/, '顶层请求头求值出错时指出是哪一个');
  const importedSource = mods.NativeSourceImport.toBookSource(dynamicDefinition);
  equal(JSON.parse(importedSource.header), { 'User-Agent': 'check' }, '书源记录的 header 只留字面值，模板与表达式不原样写入');
  equal(mods.NativeSourceImport.toBookSource(NativeSourceSpec.fromObject({ ...dynamicHeaders, headers: { A: '{{vars.mode}}' } })).header,
    '', '全是动态请求头时记录里不写 header');
  delete responses['/token'];
  invalid((s) => { s.cache = { 'bad-name': { url: 'x', value: '= 1' } }; }, '缓存名称不合法');

  // 状态码正常但被判为失败时（例如验证页），提示里用给出的原因
  const blockedHost = createTestHost(JsonPathEvaluator, respond);
  blockedHost.fetch = async (request) => ({ ok: false, status: 200, body: '', url: request.url, error: '需要登录或网页验证' });
  let blocked = '';
  try {
    await new NativeSourceRunner(definition, blockedHost, {}).search('x', 1);
  } catch (e) {
    blocked = e.message;
  }
  equal(blocked, '搜索请求失败：需要登录或网页验证', '验证拦截的提示');

  // ---------- 调试记录与出错定位 ----------
  const tracedHost = createTestHost(JsonPathEvaluator, respond);
  responses['/search'] = { data: { list: [{ book_id: '1', name: '甲', author: 'A' }, { book_id: '2', name: '乙', author: 'B' }] } };
  await new NativeSourceRunner(definition, tracedHost, {}).search('甲', 1);
  const listTrace = tracedHost.traces.find((t) => t.field === 'search.list');
  equal([listTrace.count, listTrace.type], [2, 'expression'], '调试记录列表规则与匹配数量');
  const nameTraces = tracedHost.traces.filter((t) => t.field === 'search.fields.name');
  equal([nameTraces.length, nameTraces[0].preview, nameTraces[0].type], [1, '甲', 'selector'], '字段只记第一个元素');
  equal(tracedHost.traces.find((t) => t.field === 'search.fields.bookUrl').type, 'template', '模板规则的类型');
  equal(tracedHost.traces.some((t) => t.field === 'let.server'), true, '派生值也有记录');

  const broken = JSON.parse(JSON.stringify(sample));
  broken.search.fields.kind = '= $.category + missingName';
  const brokenHost = createTestHost(JsonPathEvaluator, respond);
  let located = '';
  try {
    await new NativeSourceRunner(NativeSourceSpec.fromObject(broken), brokenHost, {}).search('甲', 1);
  } catch (e) {
    located = e.message;
  }
  equal(located, '规则 search.fields.kind 出错：未定义的名称 “missingName”', '运行时出错指明是哪条规则');
  equal(brokenHost.traces.find((t) => t.field === 'search.fields.kind').error, '未定义的名称 “missingName”', '错误也记入调试信息');

  // ---------- 表单登录、动作按钮、正文请求按钮 ----------
  const interactive = JSON.parse(JSON.stringify(sample));
  interactive.login = {
    form: [{ key: 'user', label: '账号' }, { key: 'pass', label: '密码', secret: true }],
    submit: {
      url: '{{vars.server}}/login', body: { username: '{{form.user}}', password: '{{md5(form.pass)}}' },
      ok: '= data.code == 0', token: '= data.token', user: '= data.name', message: '= data.msg'
    },
    sendCode: { label: '发送验证码', url: '{{vars.server}}/code?phone={{form.user}}', message: '= data.msg' }
  };
  interactive.let.auth = "= login.token ? 'Bearer ' + login.token : ''";
  interactive.actions = [
    { label: '签到', url: '{{server}}/checkin', headers: { Authorization: '{{auth}}' }, message: "= '签到结果：' + data.msg", when: '= login.token' },
    { label: '个人中心', open: '/user' },
    { label: '隐藏', url: '{{server}}/x', when: '= false' }
  ];
  interactive.content.links = [
    { label: '点赞', request: { url: '{{server}}/like?item={{d.item_id}}', method: 'POST', headers: { Authorization: '{{auth}}' } }, message: '= data.msg' }
  ];
  interactive.detail.webView = { waitFor: '.book-info', timeout: 500 };
  responses['/login'] = { code: 0, token: 'TK', name: '读者乙', msg: '欢迎' };
  responses['/code'] = { msg: '验证码已发送' };
  responses['/checkin'] = { msg: '获得 5 积分' };
  responses['/like'] = { msg: '已点赞' };
  responses['/detail'] = { code: 0, data: { book_id: '11', name: '斗破' } };
  const interactiveDefinition = NativeSourceSpec.fromObject(interactive);
  const interactiveHost = createTestHost(JsonPathEvaluator, respond);
  const anonymous = new NativeSourceRunner(interactiveDefinition, interactiveHost, {});

  const loginResult = await anonymous.submitLogin({ user: 'u1', pass: 'secret' });
  equal(loginResult, { ok: true, token: 'TK', user: '读者乙', message: '欢迎' }, '表单登录成功，取到凭据');
  const loginRequest = interactiveHost.requests[interactiveHost.requests.length - 1];
  equal([loginRequest.method, loginRequest.body],
    ['POST', '{"username":"u1","password":"5ebe2294ecd0e0f08eab7690d2a6ee69"}'], '表单值进入请求体，密码可先做摘要');
  equal(await anonymous.sendLoginCode({ user: '138' }), '验证码已发送', '辅助请求返回提示文字');
  responses['/login'] = { code: 1, msg: '密码错误' };
  equal(await anonymous.submitLogin({ user: 'u1', pass: 'x' }), { ok: false, token: '', user: '', message: '密码错误' },
    '登录失败给出接口的提示');
  equal((await anonymous.actions()).map((x) => x.label), ['个人中心'], '未登录时依赖凭据的按钮不显示');

  const signedIn = new NativeSourceRunner(interactiveDefinition, interactiveHost, {}).setCredential({ token: 'TK', user: '读者乙' });
  const actionEntries = await signedIn.actions();
  equal(actionEntries, [
    { index: 0, label: '签到', open: '' },
    { index: 1, label: '个人中心', open: 'https://api.example.com/user' }
  ], '动作按钮：when 生效，open 补全为绝对地址');
  equal(await signedIn.runAction(0), '签到结果：获得 5 积分', '执行动作并返回提示');
  equal(interactiveHost.requests[interactiveHost.requests.length - 1].headers, { 'User-Agent': 'check', Authorization: 'Bearer TK' },
    '动作请求带上登录凭据');

  const withButton = await signedIn.content(book, { url: 'https://api.example.com/content?item_id=c1', title: '', index: 0 });
  equal([withButton.links[0].label, withButton.links[0].url, withButton.links[0].request.url, withButton.links[0].request.method],
    ['点赞', '', 'https://api.example.com/like?item=c1', 'POST'], '正文请求按钮：请求在取正文时渲染好');
  equal(await signedIn.runLinkAction(withButton.links[0].request, withButton.links[0].message), '已点赞', '点击后执行并提示');

  await signedIn.detail(book);
  const waited = interactiveHost.requests[interactiveHost.requests.length - 1];
  equal([waited.webView, waited.webWaitFor, waited.webTimeout], [true, '.book-info', 60], '网页渲染等待指定元素，超时有上限');

  // ---------- 图片解密参数 ----------
  const encrypted = JSON.parse(JSON.stringify(sample));
  encrypted.content.imageDecode = { algorithm: 'AES/CBC/PKCS5Padding', key: "= hexBytes('00ff10')", iv: "= 'ab'" };
  const encryptedComic = await new NativeSourceRunner(NativeSourceSpec.fromObject(encrypted), runHost, {})
    .content({ ...book, type: 'comic' }, { url: 'https://api.example.com/content?item_id=m1', title: '', index: 0 });
  equal(encryptedComic.imageDecode, { algorithm: 'AES/CBC/PKCS5Padding', key: '00ff10', iv: '6162' },
    '解密参数：字节和文本都转成十六进制');

  invalid((s) => { s.login = { form: [{ key: 'user' }] }; }, '登录既没有网页地址也没有提交请求');
  invalid((s) => { s.login = { submit: { url: 'x', ok: '= true' } }; }, '表单登录缺少表单项');
  invalid((s) => { s.actions = [{ label: '缺地址' }]; }, '动作缺少地址');
  invalid((s) => { s.content.imageDecode = { algorithm: 'RC4', key: '= 1' }; }, '不支持的图片解密算法');
  invalid((s) => { s.content.links = [{ label: '缺目标' }]; }, '链接既没有地址也没有请求');

  // ---------- 听书音色 ----------
  const voiced = JSON.parse(JSON.stringify(sample));
  voiced.voices = [{ id: '1', name: '甜美少女' }, { id: 4, name: '成熟大叔' }];
  voiced.content.fetch.tone = {
    when: "= d.content_type == 'audio' && book.vars.custom", url: '{{server}}/tone?item_id={{d.item_id}}&voice={{book.vars.custom}}'
  };
  const voicedRunner = new NativeSourceRunner(NativeSourceSpec.fromObject(voiced), runHost, {});
  const audioChapter = { url: 'https://api.example.com/content?item_id=a1', title: '', index: 0 };
  const defaultVoice = await voicedRunner.content({ ...book, type: 'audio', vars: {} }, audioChapter);
  equal(defaultVoice.text, 'https://cdn.example.com/default.mp3', '没选音色时用默认音频');
  const pickedVoice = await voicedRunner.content({ ...book, type: 'audio', vars: { custom: '4' } }, audioChapter);
  equal(pickedVoice.text, 'https://cdn.example.com/tone.mp3', '选了音色后走音色请求');
  equal(runHost.requests.filter((request) => request.url.includes('/tone?')).pop().url,
    'https://api.example.com/tone?item_id=a1&voice=4', '音色 id 来自书籍变量');
  invalid((s) => { s.voices = [{ id: '1' }]; }, '音色缺少名称');

  // 音频地址为空：书源说明优先，否则归纳接口报错，都没有时给通用原因。
  const contentFailure = async (runnerToUse, vars) => {
    try {
      await runnerToUse.content({ ...book, type: 'audio', vars: vars }, audioChapter);
    } catch (e) {
      return e.message;
    }
    return '';
  };
  const savedAudio = responses['/content?item_id=a1'];
  const savedTone = responses['/tone'];
  responses['/content?item_id=a1'] = { data: { item_id: 'a1', content_type: 'audio', content: '' } };
  responses['/tone'] = { code: 110, message: 'ILLEGAL_ACCESS', data: null };
  equal(await contentFailure(voicedRunner, { custom: '4' }), '音频接口返回失败：ILLEGAL_ACCESS（code=110）',
    '音频为空时归纳附加请求的报错');
  responses['/tone'] = { code: 0, message: 'SUCCESS', data: {} };
  equal(await contentFailure(voicedRunner, { custom: '4' }), '正文规则没有返回音频地址', '接口没报错时给通用原因');
  const explained = JSON.parse(JSON.stringify(voiced));
  explained.content.mediaError = "= book.vars.custom == '4' ? '这本书没有成熟大叔音色' : ''";
  equal(await contentFailure(new NativeSourceRunner(NativeSourceSpec.fromObject(explained), runHost, {}),
    { custom: '4' }), '这本书没有成熟大叔音色', 'mediaError 由书源说明原因');
  responses['/content?item_id=a1'] = savedAudio;
  responses['/tone'] = savedTone;

  // ---------- 视频类型 ----------
  const video = JSON.parse(JSON.stringify(sample));
  video.search.fields.type = 'video';
  video.content.video = '{{server}}/player?item={{d.item_id}}';
  const videoRunner = new NativeSourceRunner(NativeSourceSpec.fromObject(video), runHost, {});
  responses['/search'] = { data: { list: [{ book_id: 'v1', name: '短剧' }] } };
  equal((await videoRunner.search('剧', 1))[0].type, 'video', '字段里直接写 video');
  const played = await videoRunner.content({ ...book, type: 'video' },
    { url: 'https://api.example.com/content?item_id=c1', title: '', index: 0 });
  equal([played.kind, played.text], ['video', 'https://api.example.com/player?item=c1'], '视频类书籍返回播放页地址');
  const readAsText = await videoRunner.content(book, { url: 'https://api.example.com/content?item_id=c1', title: '', index: 0 });
  equal(readAsText.kind, 'text', '非视频书籍不受 video 规则影响');
  const videoChapter = { url: 'https://api.example.com/content?item_id=c1', title: '第1集', index: 0 };
  const fallbackDefinition = JSON.parse(JSON.stringify(video));
  fallbackDefinition.content.videoPage = '/watch/{{d.item_id}}';
  fallbackDefinition.content.mediaHeaders = { Referer: 'https://example.com/' };
  const fallbackRunner = () => new NativeSourceRunner(NativeSourceSpec.fromObject(fallbackDefinition), runHost, {});
  const fallbackResult = await fallbackRunner().content({ ...book, type: 'video' }, videoChapter, true);
  equal(fallbackResult.videoPage, 'https://api.example.com/watch/c1', '网页地址按响应地址补全');
  equal(fallbackResult.mediaHeaders, { Referer: 'https://example.com/' }, '视频专用结果保留媒体头');
  fallbackDefinition.content.videoPage = '= missingFunction()';
  equal((await fallbackRunner().content({ ...book, type: 'video' }, videoChapter, true)).text, played.text,
    '可选网页规则错误不阻断有效直链');
  fallbackDefinition.content.videoPage = '/watch/{{d.item_id}}';
  equal((await fallbackRunner().content({ ...book, type: 'video' }, videoChapter)).videoPage, '',
    '通用正文入口不启用网页回退');
  fallbackDefinition.content.video = '= ""';
  fallbackDefinition.content.mediaError = '= "请先登录"';
  const pageOnly = await fallbackRunner().content({ ...book, type: 'video' }, videoChapter, true);
  equal([pageOnly.text, pageOnly.videoPage, pageOnly.mediaError],
    ['', 'https://api.example.com/watch/c1', '请先登录'], '直链为空时仍保留网页和原因');
  await rejectsWith(fallbackRunner().content({ ...book, type: 'video' }, videoChapter), /请先登录/,
    '通用入口保持原来的失败语义');
  for (const page of ['javascript:alert(1)', 'file:///data/test', 'data:text/html,hello', '']) {
    fallbackDefinition.content.videoPage = '= ' + JSON.stringify(page);
    await rejectsWith(fallbackRunner().content({ ...book, type: 'video' }, videoChapter, true), /请先登录/,
      '无网页时不回退章节接口：' + page);
  }
  fallbackDefinition.content = { videoPage: '= "https://api.example.com/watch/1"' };
  equal((await fallbackRunner().content({ ...book, type: 'video' }, videoChapter, true)).kind, 'video',
    '支持只提供网页的视频书源');
  fallbackDefinition.content.video = '= missingFunction()';
  const brokenDirect = await fallbackRunner().content({ ...book, type: 'video' }, videoChapter, true);
  equal(brokenDirect.videoPage, 'https://api.example.com/watch/1', '直链规则抛错仍保留有效网页');
  equal(!!brokenDirect.mediaError, true, '直链规则抛错保留原因');
  invalid((s) => { s.content.videoPage = { url: '/watch' }; }, '网页规则必须为字符串');
  invalid((s) => { s.type = 'movie'; }, '不认识的类型');

  // ---------- 分卷 ----------
  const volumed = JSON.parse(JSON.stringify(sample));
  volumed.toc = {
    list: '= flatMap(data.data.volumes, v => concat([{volume: v.title}], v.chapters))',
    fields: {
      title: '= default($.volume, $.title)',
      url: "= $.item_id ? server + '/content?item_id=' + $.item_id : ''",
      isVolume: '= $.volume != null'
    }
  };
  responses['/book'] = { data: { volumes: [
    { title: '第一卷', chapters: [{ title: '第一章', item_id: 'c1' }, { title: '第二章', item_id: 'c2' }] },
    { title: '第二卷', chapters: [{ title: '第三章', item_id: 'c3' }] }
  ] } };
  const volumeChapters = await new NativeSourceRunner(NativeSourceSpec.fromObject(volumed), runHost, {}).toc(book);
  equal(volumeChapters.map((c) => `${c.isVolume ? '#' : ''}${c.title}`),
    ['#第一卷', '第一章', '第二章', '#第二卷', '第三章'], '分卷标题与章节按原顺序输出，分卷不需要地址');
  equal(ev('flatMap([[1, 2], [3]], x => x)'), [1, 2, 3], 'flatMap');

  // ---------- 网络错误不当成需要登录 ----------
  const api = 'https://fq.example.org:8443/content?item_id=1,{"headers":{"a":"b"}}';
  equal(NetworkErrorText.describe('Failed to resolve the host name (2300006)', api),
    '无法解析域名 fq.example.org，请检查网络或代理', 'DNS 失败给出域名');
  equal(NetworkErrorText.describe('Timeout was reached (2300028)', api), '连接 fq.example.org 超时，请检查网络', '超时');
  equal(NetworkErrorText.describe("Couldn't connect to server (2300007)", api),
    '无法连接 fq.example.org，请检查网络或代理', '连不上');
  equal(NetworkErrorText.describe('SSL connect error (2300035)', api), '与 fq.example.org 建立安全连接失败', 'TLS');
  equal(NetworkErrorText.describe('Server returned nothing (2300052)', api),
    'fq.example.org 没有返回数据，请稍后重试', '空响应');
  equal(NetworkErrorText.describe('', api), '', '没有错误信息时交回原有判定');
  equal(NetworkErrorText.describe('request failed', api), '', '认不出的错误交回原有判定');
  equal(NetworkErrorText.hostOf('http://user:pw@h.example.com:80/x'), 'h.example.com', '去掉账号与端口');

  console.log(`Native source check passed: ${assertions} assertions.`);
} finally {
  mods.cleanup();
}
