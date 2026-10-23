# 公共书源规则开发文档

本文是 `harmony-book-source-engine` 的书源格式和规则语义参考，由轻页与简听共同使用；字段、表达式、选择器和规则示例只在本仓库维护。两端各自固定一个引擎提交，升级子模块后才获得新增能力。

## 适用范围与宿主差异

| 内容 | 维护位置与适用范围 |
| --- | --- |
| JSON 格式、表达式、选择器、阶段规则 | 本文，共用同一份定义，不为轻页或简听另建规则方言 |
| 公共引擎代码路径 | 相对本仓库根目录，如 `sourceengine/src/main/ets` |
| 页面入口、编辑器、调试页和宿主辅助代码 | 正文里的操作说明以轻页为参考；`entry/` 路径属于轻页宿主，不属于公共 HAR |
| 简听的导入限制、安全预算、UI 和缓存 | [简听宿主说明](https://github.com/end-web/HarmonyOS-book/blob/main/docs/BOOK_SOURCE_RULES.md) |
| 封面解密 | 本文 `coverDecode` 字段；宿主还需接入 [SourceCoverLoader](cover-decoding.md)，不能仅靠更新文档或 JSON 获得显示能力 |

本文最近一次按代码核对时轻页为 4.3.929（2026-10-23）。文中的界面、视频播放和调试说明以轻页为准，不代表所有宿主都已实现。简听与轻页（4.0.921 起）都已接入封面解密。

> 示例只使用 `example.com`、本地测试服务和虚构数据，不发布实际站点书源或登录凭据。

## 两种书源格式

公共引擎支持两种书源，一条书源只能是其中一种：

| | 原生书源 | 兼容书源 |
| --- | --- | --- |
| 状态 | **推荐**，新书源请用这种格式 | **已过时**，仅为存量书源保留 |
| 来历 | 开源轻页自己定义 | Android「阅读」（Legado）的书源格式 |
| 规则语言 | 声明式规则、自定表达式语言与函数库（`lib`，或用 JavaScript 写的 `js`） | 选择器规则加 JavaScript |
| 执行方式 | 规则由 ArkTS 执行；`js` 在 QuickJS 运行（表达式调用在主线程，`script` 在后台线程）；显式网页抓取另用 ArkWeb | 轻量解释器、ArkWeb、QuickJS 分层执行 |
| 识别方式 | JSON 里带 `"sourceFormat": "native"` | 其余情况 |
| 文档位置 | [第一部分](#第一部分原生书源) | [第二部分](#第二部分兼容书源已过时) |

两种书源在搜索、发现、书架、阅读里混用，用户不需要区分；书源管理页可以按类型筛选。两种格式共用同一个请求层（限流、Cookie、编码识别、验证页处理）和同一个选择器解析器，所以选择器写法、请求行为在两边一致。

## 阅读路线

- **第一次写书源**：按顺序读[开发流程](#开发流程)、[最小示例](#最小示例)、[值的三种写法](#值的三种写法)、[选择器规则](#选择器规则)、[表达式语言](#表达式语言)和[各阶段](#各阶段)。照着[网页书站示例](#网页书站示例)或[综合示例](#综合示例)改，比从空白开始快。
- **查某个字段怎么写**：直接看[字段速查](#字段速查)，再跳到对应小节。
- **导入或校验报错**：看[导入校验与常见报错](#导入校验与常见报错)。
- **需要多步请求、脚本登录、动态分类**：读[脚本阶段](#脚本阶段-script)，再看[完整脚本示例](#完整脚本示例)、[状态的作用域](#状态的作用域)和[原生脚本排错](#原生脚本排错)。
- **把兼容书源改写成原生书源**：先看[从兼容书源改写](#从兼容书源改写)和[与兼容书源的差异](#与兼容书源的差异)。已有的 JavaScript 函数可以直接放进 [JS 函数库](#js-函数库-js)。
- **维护存量的兼容书源**：读[第二部分](#第二部分兼容书源已过时)，从[快速入门](#快速入门)开始；迁移 Android 阅读书源重点看 [JavaScript 兼容层](#javascript-兼容层)、[登录与网页验证](#登录cookie-与网页验证)和[兼容性与迁移](#兼容性与迁移)。
- **扩展应用能力**：原生书源从[实现与验证](#实现与验证)、兼容书源从[实现索引](#实现索引)进入对应 ArkTS 模块。

---

# 第一部分：原生书源

原生书源是开源轻页自己定义的书源格式。一条原生书源是一个 JSON 对象：顶层声明名称、地址、变量、登录等，`search`、`explore`、`detail`、`toc`、`content` 五个阶段各自声明“请求什么地址、从响应里取哪些字段”。

大多数站点只用声明式规则就够了：地址和字段用模板、选择器或表达式写，条件判断、拼接、查表用表达式写。签名、解密这类算法写进函数库 `lib`，或者把现成的 JavaScript 放进 `js`。请求顺序要由代码决定时（先取令牌再搜索、按结果循环翻页、多步登录），把整个阶段交给 `js` 里的函数，即[脚本阶段](#脚本阶段-script)。原生书源不经过兼容书源的轻量解释器或 ArkWeb 阶段运行时；只有显式的 `webView` / `browser.render` 网页抓取需要 ArkWeb。

## 在应用里的位置

以下以轻页为准，入口在「我的 → 书源管理」。

| 操作 | 入口与说明 |
| --- | --- |
| 新建 | 书源管理的新建菜单里选「新建原生书源」。编辑页预填一份可用的模板（JSON 接口的搜索、详情、目录、正文），改地址和规则即可 |
| 编辑 | 编辑页直接编辑完整 JSON。「校验」只检查定义本身（字段是否齐全、表达式语法、函数名等），通过后才能保存；校验通过不代表站点能取到数据，还要用调试验证 |
| 导入 | 支持网址、剪贴板、本地文件（可多选，合并后统一勾选）和系统「打开方式」。JSON 里带 `"sourceFormat": "native"` 的按原生书源处理，导入时做整份校验，表达式写错、混入 `@js:` 或 `<js>` 都会当场报出原因（一次最多列 5 条）。可以一次导入一个对象，也可以是数组 |
| 导出 | 导出的就是带 `sourceFormat` 的定义本身，可以直接再导入 |
| 调试 | 书源操作菜单里的「调试」。默认跑全链路：搜索 → 发现 → 详情 → 目录 → 正文；也可以只跑一个阶段，搜索输入关键词，详情和目录输入书籍或目录地址，正文输入章节地址。执行明细列出每次请求、每条规则取到的结果和出错的规则，可以「导出报告」 |
| 书源设置 | 书源操作菜单里的「书源设置」，发现页长按书源也能进入。集中放书源变量、账号登录、动作按钮 |
| 筛选 | 书源管理顶部可按「全部 / 原生 / 兼容」筛选，列表里每条书源带类型角标 |

修改并保存书源后，该书源的发现分类缓存和发现列表缓存立即失效；已经加入书架的书要重新获取详情，才会用上新的 `keep`、封面参数等。

## 开发流程

1. **先摸清接口**。用浏览器开发者工具或抓包，记下搜索、详情、目录、正文各自的请求地址、方法、请求头、请求体和响应格式（JSON 还是 HTML）。确认哪些接口要登录、要签名，哪些字段在列表里就有、哪些要进详情才有。
2. **写最小可用的四个阶段**。从编辑页模板或下面的[最小示例](#最小示例)开始，只写 `search`、`detail`、`toc`、`content`，字段先写 `name`、`bookUrl`、章节 `title`、`url` 和正文。每写完一个阶段就「校验」并保存。
3. **逐阶段调试**。在「调试」里只跑搜索，看执行明细里的请求地址和每个字段的结果；搜索正确后把一本书的地址填进去跑详情和目录，再拿一个章节地址跑正文。规则取空时，执行明细会显示那条规则和取到的内容。
4. **补齐展示字段**。作者、封面、简介、分类、字数、最新章节、状态、更新时间；目录的卷名、VIP 标记；正文的净化规则。
5. **加发现页**。写 `explore` 的固定分类或动态分类，需要筛选时用带 `filter` 的变量。
6. **加设置项**。服务器地址、线路、模式这类让用户改的值写成 `vars`；要登录的站点写 `login`；签到这类操作写 `actions`。
7. **在应用里验收**。搜索、加入书架、打开阅读、翻章、刷新目录、切换变量后再搜一次、退出登录后再试。听书、漫画、视频分别进对应的页面验证。

## 媒体类型

书源顶层的 `type` 给出默认类型，搜索、发现、详情的 `fields.type` 可以逐本覆盖（以详情阶段的结果为准）。

| 类型 | 用于 | 打开后进入 | 正文阶段取的规则 |
|---|---|---|---|
| `text` | 小说等文字内容 | 阅读器 | `content.text` |
| `audio` | 有声书 | 听书页（详情页的「开始听书」直接进入） | `content.audio` |
| `comic` | 漫画（也可写 `image`） | 阅读器的漫画形态 | `content.images` |
| `video` | 短剧等视频 | 应用自带的播放页 | `content.video` |

正文阶段按书籍类型选规则；对应规则没写时依次退回 `text`、`images`、`audio`、`video` 里写了的第一个。

视频类型没有阅读形态：详情页显示为「剧集详情 / 选集 / 开始观看」，点「开始观看」或从书架打开都直接进入播放页。播放页全屏播放，可在页内选集、上一集和下一集、连播、调倍速、拖动进度，并记住看到第几集第几秒。

同一个站点的有声版和小说版不要共用同一个书籍地址：书籍按地址识别，类型以最后一次详情结果为准。

## 最小示例

一个 JSON 接口站点的最小可用书源。搜索接口返回 `{ "data": { "list": [{ "id": 1, "name": "书名", "author": "作者" }] } }`，详情、目录、正文类似：

```json
{
  "sourceFormat": "native",
  "version": 1,
  "name": "示例书源",
  "url": "https://api.example.com",
  "search": {
    "url": "{{source.url}}/search?q={{urlencode(key)}}&page={{page}}",
    "list": "$.data.list[*]",
    "fields": {
      "name": "$.name",
      "author": "$.author",
      "bookUrl": "{{source.url}}/book/{{$.id}}"
    }
  },
  "detail": {
    "fields": {
      "intro": "$.data.intro",
      "tocUrl": "{{source.url}}/book/{{$.data.id}}/chapters"
    }
  },
  "toc": {
    "list": "$.data[*]",
    "fields": { "title": "$.title", "url": "{{source.url}}/chapter/{{$.id}}" }
  },
  "content": { "text": "$.data.content" }
}
```

逐项说明：

- `sourceFormat` 和 `version` 固定这样写；`url` 是书源的唯一标识，同一地址再次导入会覆盖原书源。
- `search.url` 是模板：`{{ }}` 里是表达式，`key` 是用户输入的关键词，`page` 是页码。
- `search.list` 从响应里选出“每本书”，`fields` 在每本书上取字段。`name` 和 `bookUrl` 必填。
- `detail` 没写 `url`，默认请求书籍的 `bookUrl`；`tocUrl` 记下目录地址，目录阶段默认请求它。
- `toc.fields` 必须有 `title` 和 `url`；`content.text` 取正文。
- 相对地址会按响应地址补全，所以 `bookUrl` 也可以写成 `/book/{{$.id}}`。

### 网页书站示例

站点只有 HTML 页面时，用 CSS 选择器取值。这个示例的搜索结果页每本书是一个 `li`，目录页每章是一个 `li`，正文分段在 `#content p` 里：

```json
{
  "sourceFormat": "native",
  "version": 1,
  "name": "示例网页书站",
  "url": "https://www.example.com",
  "headers": { "Referer": "https://www.example.com/" },
  "search": {
    "url": "/search?q={{urlencode(key)}}&page={{page}}",
    "list": ".result-list li",
    "fields": {
      "name": "h3 a@text",
      "author": ".author@text##^作者[:：]\\s*",
      "kind": ".tags span@text",
      "coverUrl": "img@data-src||img@src",
      "intro": ".intro@text",
      "bookUrl": "h3 a@href"
    }
  },
  "detail": {
    "fields": {
      "name": "h1@text",
      "author": ".book-info .author@text##^作者[:：]\\s*",
      "intro": "#intro@text",
      "coverUrl": ".cover img@src",
      "status": ".book-info .status@text",
      "lastChapter": ".latest a@text",
      "tocUrl": "a.all-chapters@href"
    }
  },
  "toc": {
    "list": "#chapters li",
    "fields": { "title": "a@text", "url": "a@href" }
  },
  "content": {
    "text": "#content p@text",
    "nextUrl": "= sel('a.next@text') == '下一页' ? sel('a.next@href') : ''",
    "replace": [{ "pattern": "本章未完，请点击下一页继续阅读" }]
  }
}
```

要点：

- 选择器写在“当前元素”上：`search.fields` 在每个 `li` 上取，`detail.fields` 在整页上取。
- `##^作者[:：]\\s*` 是字段后处理，把匹配到的前缀删掉。JSON 里的反斜杠要写两次。
- `img@data-src||img@src`：前一条取空时取后一条，适合懒加载图片。
- `tocUrl` 取不到时为空，目录阶段就请求详情页本身，适合目录和详情在同一页的站点。
- `#content p@text` 命中多段时按行连起来，正好是分段正文。
- 正文翻页链接在章末会变成“下一章”，所以 `nextUrl` 先判断链接文字，只在“下一页”时翻页，否则返回空串结束。

### 示例里的约定

为了让片段短一些，后面的片段默认书源顶层有：

```json
"vars": [{ "key": "server", "label": "服务器", "default": "https://api.example.com" }],
"let": { "server": "= vars.server" }
```

所以片段里的 `{{server}}`、`server` 指服务器地址。写自己的书源时，没有这两行就要换成 `{{source.url}}` 或 `{{vars.server}}`；直接用没有定义的名称会报“未定义的名称 “server””。

片段（不是以 `{` 开头的完整书源）需要合并到完整定义里才能导入。

## 值的三种写法

规则里的每个字符串值按开头判断写法：

| 写法 | 判断方式 | 例子 | 结果 |
|---|---|---|---|
| 表达式 | 以 `=` 开头 | `= $.score > 0 ? $.score + '分' : ''` | 表达式的值，可以是文本、数字、列表、对象 |
| 模板 | 含有 `{{ }}` | `{{server}}/book/{{urlencode($.id)}}` | 文本：每个 `{{ }}` 里的表达式求值后拼进去 |
| 选择器规则 | 其余情况 | `$.data.name`、`.title@text`、`//a/@href` | 在当前元素上执行选择器取到的内容 |

- 模板里的 `{{ }}` 按花括号层数配对，所以 `{"page":{{page}}}` 这类 JSON 请求体可以直接写，`{{ }}` 里含对象字面量时也能正确找到结束位置。
- 模板里的值是列表或对象时按 JSON 文本拼接，是 `null` 时拼成空串。
- 请求地址、请求头、分类标题、`when` 这些位置没有“当前元素”，只接受表达式或模板。在这些位置写选择器会被当成普通文本。
- 要写一个固定文本，用表达式：`= '固定文本'`。唯一的例外是 `fields.type`，可以直接写 `text`、`audio`、`comic`、`video`。
- 规则字段也可以直接写 JSON 的数字、布尔值（例如 `"reverse": true`），它们不按上面三种写法处理。
- 原生书源不认 `@js:`、`<js>`、`@put`、`@get`。需要计算时写表达式，需要传值时用 `let`、`keep`。

## 选择器规则

选择器规则与兼容书源共用同一个解析器（`AnalyzeRule`），完整语法见第二部分的[规则语法](#规则语法)。原生书源常用的部分如下。

### 按响应选写法

| 响应 | 写法 | 例子 |
| --- | --- | --- |
| JSON | JSONPath，以 `$` 开头 | `$.data.list[*]`、`$.name`、`$['a-b']`、`$..chapters[*]`、`$.items[?(@.vip == 0)]` |
| HTML | CSS 选择器，末尾加提取后缀 | `.book-item`、`h3 a@text`、`a.cover@href`、`img@data-src` |
| HTML | 简单 XPath | `//div[@class='book']/a/text()`、`//a[contains(@href,'book')]/@href` |
| 任意文本 | `##正则##替换` 直接处理整段 | `##var bookId = "(\d+)"##$1###` |

JSONPath 支持通配 `*`、递归 `..`、下标（含负数）、下标列表、切片 `[1:5]`、过滤 `[?(...)]`（含 `&&`、`||`、比较和 `=~ /正则/i`）。JSON 里没有 `$` 前缀的路径会按根路径处理，但推荐显式写 `$.`。

### CSS 提取后缀

| 后缀 | 结果 |
| --- | --- |
| 不写 | 普通字段返回文本；`list` 返回元素本身，供 `fields` 继续取值 |
| `@text` | 去掉标签后的全部文本 |
| `@ownText` | 元素自身的直接文本，不含子元素 |
| `@textNodes` | 直接文本节点，按换行连接 |
| `@html` | 元素的外层 HTML，包含元素自己的标签，例如 `#content@html` 以 `<div id="content">` 开头 |
| `@href`、`@src`、`@content`、`@data-src` 等 | 对应属性值 |

CSS 支持标签、`#id`、`.class`、后代和 `>` 子代、逗号分组、属性选择（`=`、`^=`、`$=`、`*=`、`~=`、`|=`）、`:contains()`、单层 `:has()`、`:not()`、`:first`、`:last`、`:eq(n)`、`:lt(n)`、`:gt(n)`、数字形式的 `:nth-child(n)` 和 `:nth-of-type(n)`。它不是完整的浏览器 CSS 引擎，不支持 `an+b`、伪元素和复杂嵌套伪类。

两处容易写错，写错时只会静默取空：

- `:first-child`、`:nth-child(n)` 按元素在父元素里的位置判断。`span:first-child` 要求这个 `span` 是父元素的第一个子元素，前面有别的标签就取不到。要取“匹配结果里的第几个”，用 `:first`、`:last`、`:eq(n)`，或索引简写 `span.0@text`。
- `@html` 返回外层 HTML。只要里面的文字时用 `@text`，要逐段保留时取段落，例如 `#content p@text`。

### 索引与排除

选择器末尾可以用点号选第几个、用感叹号排除第几个，从 0 开始，负数从末尾倒数，多个用冒号分隔：

```text
span.0@text            第 0 个
span.-1@text           最后一个
span.0:1:2@text        第 0、1、2 个
span!0:-1@text         去掉第一个和最后一个
span.0:5@text          只有两个数字时表示范围：第 0 到第 4 个
```

### 组合与后处理

| 写法 | 行为 | 例子 |
| --- | --- | --- |
| `规则1\|\|规则2` | 依次尝试，取第一个非空结果 | `.title@text\|\|h1@text` |
| `规则1&&规则2` | 把各规则的结果按顺序合并 | `.name@text&&.alias@text` |
| `规则##正则##替换` | 先取值，再做全局正则替换；省略替换文本时删除匹配部分 | `$.author##^作者：`、`.status@text##^1$##连载` |

正则按 Android 阅读的 Java 方言书写也可以（如 `(?i)`），会自动转换；`\d`、`\w` 按 Unicode 语义匹配，只要 ASCII 数字时写 `[0-9]`。替换文本里用 `$1` 引用分组。

### 选择器取到多个结果时

- 文本字段把各项按行连起来（多段简介、多段正文）。
- 地址字段（`bookUrl`、`tocUrl`、`coverUrl`，目录的 `url`，正文的 `audio`、`video`）只取第一个，并按响应地址补全为绝对地址。
- 只想要其中一项的文本时，用索引简写，或写成表达式 `= first(selAll('…'))`。

## 表达式语言

表达式只能读数据、做运算、调用函数，没有 `java`、`source.getVariable()` 这类宿主对象。箭头函数只能作为 `map`、`flatMap`、`filter`、`find`、`replace` 的参数出现。需要循环和中间变量时，把逻辑写进[函数库](#函数库-lib)或 [JS 函数库](#js-函数库-js)。

### 取值

- `$.path`：在当前元素上执行 JSONPath。路径确定时返回单个值，带 `*`、`..`、过滤条件时返回列表，取不到时为 `null`。键名里有特殊字符时写 `$['a-b']`。
- `名称.字段`、`名称[下标]`、`名称['键']`：访问对象和列表，下标可为负数。在 `null` 上取字段仍是 `null`，不会报错。
- 字面量：数字（可写十六进制 `0xff`）、`'字符串'` 或 `"字符串"`、`true`、`false`、`null`、`[1, 2]`、`{键: 值}`。
- 字符串里只转义 `\n`、`\t`、`\r`、`\\`、`\'`、`\"`，其他反斜杠原样保留。所以正则可以直接写 `'\d+'`；放进 JSON 时按 JSON 规则再转义一次，即 `"= match(body, '\\d+')"`。

### 运算

`+ - * / %`、`== != < > <= >=`、`&& || !`、`条件 ? 甲 : 乙`、`??`（左侧为 `null` 时取右侧），以及位运算 `& | ^ ~ << >> >>>`（按 32 位整数计算）。

- `+` 两侧都是数字时相加，否则按文本拼接，`null` 当作空串。
- `==` 把数字和数字字符串视为相等（接口里 `"3"` 和 `3` 混用很常见）。
- `null`、`false`、`0`、`NaN`、空串、空列表为假，其余为真（空对象 `{}` 为真）。
- `&&`、`||` 返回参与运算的值本身，所以 `$.alias || $.name` 可以取默认值。
- `??` 只在左侧为 `null` 时取右侧；左侧是空串或 `0` 时仍取左侧。要把空串也当成没有，用 `||` 或 `default()`。

### 可用的名称

| 名称 | 含义 | 在哪里可用 |
|---|---|---|
| `vars` | 书源变量的当前值，如 `vars.mode`（都是文本） | 全部 |
| `source` | `source.url`、`source.name` | 全部 |
| `login` | `login.token`、`login.user`：表单或脚本登录保存的凭据，未登录为空串 | 全部 |
| `let` 里的名称 | 顶层 `let` 在每次操作开始时求值；阶段 `let` 在拿到该阶段响应后求值 | 顶层的全部可用；阶段的只在本阶段 |
| `cache` 里的名称 | 顶层 `cache` 声明的值，见[复用的值](#复用的值-cache) | 全部（`cache` 自己的请求里除外） |
| `key` | 搜索关键词（未编码，拼进地址时用 `urlencode(key)`） | 搜索 |
| `page` | 页码，从 1 开始。目录、正文里是分页的第几页 | 搜索、发现、目录、正文 |
| `book` | `bookUrl`、`tocUrl`、`name`、`author`、`kind`、`type`、`vars`（书籍变量） | 详情、目录、正文 |
| `chapter` | `url`、`title`、`index`（从 0 开始） | 正文 |
| `body` | 响应原文 | 拿到响应之后 |
| `data` | 响应解析出的 JSON；响应不是 JSON 时为 `null` | 拿到响应之后 |
| `baseUrl` | 当前响应的最终地址（跟随跳转之后），相对地址按它补全 | 拿到响应之后 |
| `item`、`index` | 列表里的当前元素及其序号（从 0 开始）。`fields` 里的 `$.x` 就是在 `item` 上取值 | 列表的 `fields` |
| `fetch` 里的名称 | 附加请求的结果，JSON 时为对象，否则为文本，失败时为 `null` | 详情、正文 |
| `form` | 登录表单填写的值，如 `form.user` | `login.submit`、`login.sendCode` |
| `stats`、`para`、`total` | 评论统计结果、当前段落、各段评论数之和 | `content.comments` |
| `server` 等自定义名称 | 只有在 `let`、`cache` 里定义过才可用 | 见上 |

用到没有定义的名称时报错，错误信息指出是哪条规则，例如“规则 search.fields.kind 出错：未定义的名称 “x””。

### 内置函数

参数里写“文本”的位置传入其他类型时先转成文本（`null` 为空串，列表和对象为 JSON 文本）。

**类型与取默认值**

| 函数 | 说明 | 例子 |
| --- | --- | --- |
| `str(x)` | 转成文本 | `str(page)` → `'2'` |
| `num(x)` | 转成数字，转不了为 `NaN`（为假） | `num('3.5')` → `3.5` |
| `int(文本, 默认值)` | 按十进制取整数前缀，转不了时返回默认值（不写为 0） | `int('12章')` → `12` |
| `bool(x)` | 按真假规则转成布尔值 | `bool([])` → `false` |
| `typeOf(x)` | `'null'`、`'string'`、`'number'`、`'boolean'`、`'list'`、`'map'` | |
| `len(x)` | 文本长度、列表长度或对象键数，`null` 为 0 | |
| `default(a, b, …)` | 返回第一个为真的参数；都为假时返回最后一个。别名 `coalesce` | `default($.alias, $.name, '未知')` |

**文本**

| 函数 | 说明 |
| --- | --- |
| `trim(文本)`、`lower(文本)`、`upper(文本)` | 去首尾空白、转小写、转大写 |
| `split(文本, 分隔符)` | 按分隔文本切成列表（不是正则） |
| `lines(文本)` | 按换行切成列表 |
| `substring(文本, 起, 止?)`、`slice(文本, 起, 止?)` | 截取；`slice` 支持负数 |
| `padStart(文本, 长度, 填充?)` | 左侧补齐，默认补空格，长度最多 1024 |
| `contains(文本, 片段)`、`startsWith`、`endsWith` | 是否包含、以…开头、以…结尾；`contains` 的第一个参数是列表时判断列表里有没有这一项 |
| `indexOf(文本, 片段)` | 位置，找不到为 -1；第一个参数是列表时返回元素下标 |
| `replaceText(文本, 原文, 新文)` | 把所有“原文”换成“新文”，不是正则 |
| `stripHtml(文本)` | 去掉 HTML 标签 |
| `htmlDecode(文本)` | 解码 `&amp;`、`&#x4e00;` 这类实体 |

**正则**

正则参数写成文本，不带两边的斜杠；`标志` 如 `'i'`、`'g'`、`'m'`、`'s'`。

| 函数 | 说明 | 例子 |
| --- | --- | --- |
| `match(文本, 正则, 分组?, 标志?)` | 第一个匹配的指定分组（默认 0 为整段），没有匹配为空串 | `match(body, 'bookId=(\d+)', 1)` |
| `matchAll(文本, 正则, 分组?)` | 所有匹配的指定分组，返回列表 | `matchAll(body, 'data-id="(\d+)"', 1)` |
| `test(文本, 正则, 标志?)` | 是否匹配 | `test($.tag, '完结')` |
| `replace(文本, 正则, 替换, 标志?)` | 正则替换，默认标志 `g`。替换可以是文本（支持 `$1`），也可以是箭头函数，参数是分组列表，`m[0]` 为整段 | 见下 |

```text
= replace(d.content, '\[\[IMG:(\d+)\]\]', m => '<img src="' + get(d.images, int(m[1])).url + '">')
```

**列表**

| 函数 | 说明 |
| --- | --- |
| `join(列表, 分隔符?)` | 连成文本，默认不加分隔符 |
| `first(列表)`、`last(列表)` | 第一项、最后一项，空列表为 `null`；传入的不是列表时当作只有一项 |
| `slice(列表, 起, 止?)`、`reverse(列表)`、`concat(列表…)` | 截取、倒序、合并 |
| `compact(列表)` | 去掉为假的项（空白文本也去掉） |
| `unique(列表)` | 去重，按文本比较 |
| `map(列表, (x, i) => …)`、`filter`、`find`、`flatMap` | 映射、过滤、查找第一项、映射后摊平；箭头函数的第二个参数是下标 |
| `range(n)` | `[0, 1, …, n-1]` |
| `list(长度, 初值?)` | 指定长度的列表，初值默认 0 |
| `push(列表, 值…)` | 在列表末尾追加，返回这个列表（会改动原列表） |
| `sum(列表)`、`min(列表或多个数)`、`max(…)` | 求和、最小、最大 |

**对象**

| 函数 | 说明 |
| --- | --- |
| `get(对象, 键, 默认值?)` | 取键的值，取不到时返回默认值；键可以是数字下标。别名 `lookup` |
| `keys(对象)`、`values(对象)` | 键列表、值列表 |
| `entries(对象)` | `[{key, value}, …]` |

查表用对象字面量配合 `lookup`：

```text
= lookup({'小说': '3', '听书': '2', '漫画': '8'}, vars.mode, '3')
```

**数字**

| 函数 | 说明 |
| --- | --- |
| `abs`、`floor`、`ceil`、`pow(底, 指数)` | 常用数学函数 |
| `round(数, 小数位?)` | 四舍五入，小数位 0 到 10 |
| `u32(数)`、`imul(a, b)` | 转无符号 32 位、32 位整数乘法（移植哈希算法时用） |
| `toHex(数, 位数?)`、`parseHex(文本)` | 转十六进制文本（负数按无符号 32 位）、解析十六进制 |

**编码与字节**

字节用 0 到 255 的数字列表表示。

| 函数 | 说明 |
| --- | --- |
| `urlencode(文本)`、`urldecode(文本)` | URL 编码（同 `encodeURIComponent`）、解码（`+` 当作空格） |
| `base64(文本)`、`unbase64(文本)` | 文本按 UTF-8 做 Base64 编码、解码 |
| `hex(文本)`、`unhex(十六进制)` | 文本按 UTF-8 转十六进制、反过来 |
| `json(文本)`、`tojson(值)` | 解析 JSON（失败为 `null`）、转成 JSON 文本 |
| `bytes(文本)`、`fromBytes(字节)` | 文本与 UTF-8 字节互转 |
| `hexBytes(十六进制)`、`bytesHex(字节)` | 十六进制与字节互转 |
| `base64Bytes(文本)`、`bytesBase64(字节)` | Base64 与字节互转 |
| `charCode(文本, 位置)`、`fromCharCode(码点…或列表)` | 取字符编码、由编码组成文本 |

**摘要与加解密**

| 函数 | 说明 |
| --- | --- |
| `md5(文本)`、`sha1`、`sha256`、`sha512` | 返回小写十六进制文本 |
| `hash(算法, 数据)` | 返回字节，算法如 `'SHA256'` |
| `hmac(算法, 密钥, 数据)` | 返回字节，例如 `bytesHex(hmac('SHA256', secret, path + ts))` |
| `encrypt(算法, 数据, 密钥, IV?)`、`decrypt(…)` | 返回字节。支持 AES 和 3DES（`DESede`）的 ECB、CBC、CTR、OFB、CFB 模式，如 `'AES/CBC/PKCS5Padding'`；ECB 不传 IV |
| `rsaEncrypt(数据, 公钥 PEM, 填充?)` | RSA 公钥加密，填充为 `'PKCS1'`（默认）或 `'OAEP'`，返回字节 |

数据、密钥、IV 可以传文本（按 UTF-8）或字节：

```text
= fromBytes(decrypt('AES/CBC/PKCS5Padding', base64Bytes($.data), key, iv))
= bytesBase64(rsaEncrypt(form.pass, vars.publicKey))
```

**网页、登录与时间**

| 函数 | 说明 |
| --- | --- |
| `absUrl(地址, 基准?)` | 按基准补全为绝对地址，基准默认当前 `baseUrl` |
| `sel(规则, 目标?)`、`selAll(规则, 目标?)` | 在目标上执行选择器规则，返回第一个结果或全部结果。不写目标时用当前元素 |
| `cookie(地址, 名称)` | 读取该站点已保存的 Cookie 值 |
| `now()` | 当前时间，毫秒时间戳 |
| `formatDate(时间, 格式?)` | 格式化时间。时间可以是秒或毫秒时间戳（小于 10^11 按秒）或日期文本；格式默认 `'yyyy-MM-dd HH:mm'`，支持 `yyyy MM dd HH mm ss`；空值或 0 返回空串 |

`sel`、`selAll` 的目标可以是任何 HTML 文本，例如详情阶段用 `keep` 存下的一段页面。规则没写提取后缀时返回文本；要拿到元素、继续在元素上取字段，就在规则末尾加 `@html`，这时返回的是各元素的外层 HTML。用作目录的 `list` 时，`fields` 可以照常在每个元素上取值：

```json
"toc": {
  "list": "= selAll('.chapter-list a@html', book.vars.listHtml)",
  "fields": { "title": "a@text", "url": "a@href" }
}
```

不加 `@html` 时，`selAll('.chapter-list a', …)` 得到的是每个链接的文字，后面的 `fields` 就取不到 `href` 了。

习惯 JavaScript 写法时的对照：`String.fromCharCode` 对应 `fromCharCode`，`JSON.stringify` 对应 `tojson`，`JSON.parse` 对应 `json`，`encodeURIComponent` 对应 `urlencode`，`Date.now()` 对应 `now()`。

**限制**：一次求值最多 300 万步计算、64 层调用；生成的文本最多 8 MB、列表最多 10 万项。超出时中止并报“表达式计算量超出上限”等原因。

## 各阶段

五个阶段对应应用里的五个动作：

| 阶段 | 应用里的动作 | 默认请求地址 | 产出 |
| --- | --- | --- | --- |
| `search` | 搜索 | 必须写 `url`（或 `script`） | 书籍列表 |
| `explore` | 发现页的分类与列表 | 分类各自的地址 | 分类列表、书籍列表 |
| `detail` | 打开书籍详情、加入书架、换源、刷新详情 | 书籍的 `bookUrl` | 一本书的完整信息 |
| `toc` | 取目录、刷新目录 | 书籍的 `tocUrl`，没有时用 `bookUrl` | 章节列表 |
| `content` | 打开章节、预加载、缓存 | 章节的 `url` | 正文文字、图片、音频或视频地址 |

`search` 和 `explore` 至少要有一个。只做发现页的书源可以不写 `search`，但这样搜索时不会用到它。

### 通用字段

每个阶段都可以带这些字段：

| 字段 | 说明 |
|---|---|
| `url` | 请求地址（表达式或模板）。相对地址按书源 `url` 补全；求值结果为空时不发请求，规则在空响应上执行（配合 `list` 表达式可以直接构造结果） |
| `method` | 请求方法。不写时有 `body` 用 POST，否则 GET。可以写表达式或模板，例如 `= vars.mode == '听书' ? 'GET' : 'POST'`；求值为空时按有没有 `body` 选择，结果不是方法名时报错 |
| `headers` | 本阶段附加的请求头（值可以是模板或表达式）。值为空的请求头不发送 |
| `body` | 请求体。写成对象时其中的字符串按模板渲染，整体按 JSON 发送；写成文本时按模板渲染后原样发送 |
| `webView` | 为 `true` 时用内置浏览器加载页面，取执行完网页自身脚本后的内容。可写成 `{ "waitFor": ".chapter-content", "timeout": 15 }`，等这个选择器对应的元素出现再取整页。`timeout` 单位为秒，默认 15，取值 3 到 60；到时间还没出现时按失败处理，提示“网页等待条件未满足”。只用于必须渲染才有数据的站点，比普通请求慢得多 |
| `charset` | 请求参数和表单的编码，例如 `gbk`。要求搜索词按 GBK 编码的老站点需要它；响应的解码由应用自动识别，不用写 |
| `retry` | 请求失败后的重试次数，0 到 3，默认不重试 |
| `script` | 由 `js` 里的函数代替请求，见[脚本阶段](#脚本阶段-script) |
| `let` | 本阶段的派生值，拿到响应之后、取字段之前按书写顺序求值 |
| `fail` | 求值结果非空（且不是 `false`）时视为接口报错，文本即展示给用户的错误信息，例如 `= data.code != 0 ? data.msg : ''` |
| `list`、`fields` | 列表与字段，见各阶段 |

### 请求是怎么发出的

原生书源的请求和兼容书源走同一个请求层：

- **请求头**：顶层 `headers` 加上本阶段（或分类、附加请求、脚本 `http.*`）的请求头，同名（不区分大小写）时本阶段优先。顶层 `headers` 在每个请求上按当时的作用域求值，可以写模板和表达式，例如 `"Authorization": "{{auth}}"`；值为空的不发送，本阶段同名请求头求值为空时仍发顶层的值。取 `cache` 的请求求值较早，引用 `let` 或缓存名的顶层请求头在这一步不带，见[复用的值](#复用的值-cache)。顶层请求头求值出错时报“规则 headers.名称 出错”。
- **Content-Type**：POST 请求没有显式写 `Content-Type` 时，请求体以 `{` 开头的按 `application/json; charset=utf-8` 发送，其余按 `application/x-www-form-urlencoded` 发送。
- **Cookie**：没有显式写 `Cookie` 请求头时，自动带上该站点已保存的 Cookie（网页登录、验证页、脚本 `cookie.set` 写入的都在这里）。响应里的 `Set-Cookie` 会自动保存。
- **限流**：顶层 `rate` 对这个书源的所有请求生效，见[顶层字段](#原生书源的顶层字段)。
- **验证页**：各阶段的主请求如果拿到的是人机验证页或登录拦截页，应用提示「去验证」，用户在内置浏览器里完成后重试。附加请求（`fetch`、`comments.stats`、`cache`）不触发这个流程。
- **网络错误**：请求没有发出去或没有响应（域名解析失败、超时、连接被拒等）时，直接把原因报给用户，例如“网络连接超时”，不会误报“需要登录或网页验证”。
- **失败**：主请求失败（非 2xx、空响应）时整个阶段失败，提示“搜索请求失败（HTTP 403）”这类原因。

### 搜索 `search`

```json
"search": {
  "url": "{{server}}/search?q={{urlencode(key)}}&page={{page}}",
  "fail": "= data.code != 0 ? data.msg : ''",
  "list": "$.data.list[*]",
  "fields": {
    "name": "$.name",
    "author": "$.author",
    "kind": "= join(compact([$.category, $.status == 1 ? '完结' : '连载']), ',')",
    "coverUrl": "$.cover",
    "intro": "$.intro",
    "wordCount": "= $.words > 10000 ? round($.words / 10000, 1) + '万字' : $.words + '字'",
    "lastChapter": "$.lastChapter",
    "updateTime": "= formatDate($.updateTime)",
    "bookUrl": "{{server}}/book/{{$.id}}"
  }
}
```

`list` 取出书籍元素，`fields` 在每个元素上取字段。`list` 也可以是返回列表的表达式；配合求值为空的 `url`，可以不发请求直接构造结果，例如按书号直达：

```json
"search": {
  "url": "= test(key, '^\\d+$') ? '' : server + '/search?q=' + urlencode(key)",
  "list": "= test(key, '^\\d+$') ? [{id: key, name: '书号 ' + key}] : data.data.list",
  "fields": { "name": "$.name", "bookUrl": "{{server}}/book/{{$.id}}" }
}
```

书籍字段（搜索、发现、详情通用）：

| 字段 | 说明 |
| --- | --- |
| `name` | 书名，必填 |
| `bookUrl` | 详情地址，必填，也是书籍的唯一标识。缺少 `name` 或 `bookUrl` 的条目会被丢弃 |
| `author` | 作者 |
| `kind` | 分类、标签。求值结果是列表时用逗号连接 |
| `coverUrl` | 封面地址。需要请求头或解密时见[加密封面](#加密封面-coverdecode) |
| `intro` | 简介 |
| `wordCount` | 字数，按文本原样显示，例如 `'35.2万字'` |
| `lastChapter` | 最新章节名 |
| `updateTime` | 更新时间，按文本原样显示 |
| `status` | 连载状态，按文本原样显示，例如 `'连载'`、`'完结'` |
| `tocUrl` | 目录地址，通常在详情里给出 |
| `type` | 媒体类型 `text`、`audio`、`comic`、`video`，留空时沿用书源的 `type` |

应用侧的搜索限制（两种书源相同）：每个书源最多保留 30 条结果，按“书源 + 详情地址”去重；单个书源的请求和解析合计超过 60 秒就放弃；书名、作者约 120 字、简介约 1200 字、地址约 2048 字，超出部分截掉。

### 发现 `explore`

分类有三种来源，可以同时使用，固定分类排在前面：

```json
"explore": {
  "menus": [
    { "title": "排行榜" },
    { "title": "总榜", "url": "{{server}}/rank?page={{page}}" },
    { "title": "听书榜", "url": "{{server}}/rank/audio?page={{page}}", "when": "= vars.mode == '听书'" }
  ],
  "dynamicMenus": {
    "url": "{{server}}/nav",
    "list": "$.data[*]",
    "title": "$.title",
    "target": "= $.url ? replaceText(absUrl($.url, server + '/'), '{{page}}', str(page)) : ''"
  },
  "list": "$.data.books[*]",
  "fields": { "name": "$.name", "bookUrl": "{{server}}/book/{{$.id}}" }
}
```

**固定分类 `menus`**

- 没有 `url` 的条目是分组标题，之后的分类显示在这个标题下面；`when` 为假时该条目隐藏。
- `title`、`url` 是模板，打开分类时才渲染 `url`，所以里面可以用 `page`。
- 条目可以带 `headers`，只在打开这个分类时附加，适合个人书架这类需要登录凭据的分类。
- 条目可以带自己的 `method`、`body`，不写时沿用 `explore` 上的；`body` 写空串表示这个分类不带请求体。这样一个书源可以同时对接 GET 和 POST 接口，例如 `{ "title": "筛选", "url": "{{server}}/filter", "method": "POST", "body": "= tojson({page: page, sort: 'hot'})" }`。
- 条目可以带自己的 `list`、`fields`，分别回退到 `explore` 的同名配置。设置 `fields` 时整组替换，不逐字段合并，仍须包含 `name`、`bookUrl`。例如 `{ "title": "VIP", "url": "/api/home", "list": "$.data.vipList[*]", "fields": { "name": "$.title", "bookUrl": "$.url" } }`。所有可点击分类都写了完整规则时，可以省略 `explore` 上的 `list`、`fields`；动态分类仍使用 `explore` 上的规则。

**接口分类 `dynamicMenus`**

- 请求 `url`，`list` 选出每个分类，`title` 取分类名，`target` 给出打开分类时的请求地址。四项都要写。
- `target` 在打开分类时才求值，所以里面可以用 `page`；求值为空的条目作为分组标题。
- 接口失败时，有固定分类就只显示固定分类，没有就报出原因。

**脚本分类 `dynamicMenus.script`**

分类要按变量、缓存或别的计算得出，而不是来自某个接口时，`dynamicMenus` 写 `script`（`js` 里的函数名），不写 `url`。打开发现页时运行这个函数，返回值有两种写法：

1. 分类数组 `[{ title, url }]`。`list` 默认取数组的每一项，`title` 默认 `$.title`，`target` 默认 `$.url`；`url` 里的 `{{page}}` 在打开分类时换成页码，没有 `url` 的条目是分组标题。
2. `名称::地址` 文本，与兼容书源的 `exploreUrl` 相同：按行或 `&&` 分隔，只按第一个 `::` 切分，没有 `::` 的行是分组标题。从兼容书源迁移时，拼文本的 JS 可以原样保留。

返回 JSON 文本时按数组处理。返回值的形状不同时可以自己写 `list`、`title`、`target`，这时不再按 `::` 拆分。函数的 `ctx.stage` 是 `menus`，可以读 `ctx.vars`、发请求、读写 `cache`，但和发现阶段一样不能打开网页。函数出错时，有固定分类就只显示固定分类，没有就报出原因。

```json
"js": "function menus(ctx) {\n  var kinds = ctx.vars.mode === '女频' ? ['古言', '现言'] : ['玄幻', '都市'];\n  var lines = ['排行', '热门::/rank/hot?page={{page}}', '分类'];\n  kinds.forEach(function (k) { lines.push(k + '::/list?kind=' + encodeURIComponent(k) + '&page={{page}}'); });\n  return lines.join('\\n');\n}",
"explore": {
  "dynamicMenus": { "script": "menus" },
  "list": "$.data.books[*]",
  "fields": { "name": "$.name", "bookUrl": "{{server}}/book/{{$.id}}" }
}
```

**发现页的筛选**

带 `options` 且 `"filter": true` 的变量显示在发现页顶部，用户切换后保存变量、重新加载分类。分类和分类地址都可以读 `vars`，所以“男频 / 女频”“小说 / 听书”这类切换不用写脚本：

```json
"vars": [{ "key": "channel", "label": "频道", "options": ["男频", "女频"], "default": "男频", "filter": true }],
"explore": {
  "menus": [
    { "title": "玄幻", "url": "{{server}}/list?kind=xuanhuan&page={{page}}", "when": "= vars.channel == '男频'" },
    { "title": "古言", "url": "{{server}}/list?kind=guyan&page={{page}}", "when": "= vars.channel == '女频'" }
  ],
  "list": "$.data.books[*]",
  "fields": { "name": "$.name", "bookUrl": "{{server}}/book/{{$.id}}" }
}
```

**缓存**：分类列表按“书源 + 变量的值”缓存 5 分钟，变量切换、书源保存后立即失效；脚本里调用 `ui.refreshExplore()` 也会清掉。调试页不使用缓存。

`list` 和 `fields` 的写法与搜索相同。

### 详情 `detail`

`fields` 与搜索相同，在整个响应上取值；不写 `url` 时请求书籍的 `bookUrl`。另有 `keep`，用来把值存进书籍，后续阶段通过 `book.vars.名称` 读取：

```json
"detail": {
  "let": { "d": "= data.data ?? data" },
  "fields": {
    "name": "= d.name",
    "author": "= d.author",
    "intro": "= stripHtml(d.intro)",
    "lastChapter": "= d.lastChapter.title",
    "tocUrl": "{{server}}/book/{{d.id}}/chapters"
  },
  "keep": { "bookId": "= d.id" }
}
```

- 详情里取到的字段会覆盖搜索列表里的同名字段；取空的字段保留原值。
- 搜索列表里标为有声、漫画、视频的书，如果详情给出的是另一种 `type`，按详情的类型处理。

**目录复用详情响应**：没有给出 `tocUrl` 时，目录阶段请求详情地址。打开书、换源时都是取完详情立即取目录，这时如果目录第一页的请求与详情请求完全相同（地址、方法、请求头、请求体都一样），会直接复用详情页的响应，不再请求一次。复用只有一次，并且只在取完详情后一分钟内有效；刷新目录照常请求。目录阶段的 `let`、`fail`、`list` 照常在这份响应上执行。

**`keep` 的时机**：`keep` 的值存在书籍上，只有详情阶段成功执行过才有。书籍加入书架、换源时都会先取详情，之后每次重新取详情都会更新这些值。书源在书籍加入书架之后才加上某个 `keep`，或者那次详情请求失败了，`book.vars.名称` 就会是空的。目录、正文里依赖它时要写回退，例如 `= default(book.vars.bookId, match(book.bookUrl, 'id=(\d+)', 1))`。

**附加请求 `fetch`**：详情数据分散在几个接口里时（例如作者在一个接口、最新章节在另一个接口），用 `fetch` 声明附加请求。它在主请求之后按声明顺序发出，结果按名称绑定为变量，`fields`、`keep` 里可以直接读取；后一个附加请求可以用前一个的结果。请求失败或 `when` 为假时该变量为 `null`：

```json
"detail": {
  "let": { "d": "= data.data ?? data" },
  "fetch": {
    "latest": { "url": "{{server}}/book/{{d.id}}/latest" }
  },
  "fields": { "name": "= d.name", "lastChapter": "= latest.data.title ?? ''" }
}
```

### 目录 `toc`

目录第一页地址按以下顺序选择：显式 `toc.url` 的求值结果 → 没写 `toc.url` 时用 `book.tocUrl`（通常由 `detail.fields.tocUrl` 保存）→ `book.bookUrl`。引擎不会自动拼接两个配置。详情已经保存完整目录地址时，省略 `toc.url` 或写 `= book.tocUrl`；需要从书籍地址构造时写 `= book.bookUrl + '/chapters'`。不要再给已经含 `/chapters` 的 `book.tocUrl` 追加相同后缀。

书籍详情地址统一使用 `book.bookUrl`，没有 `book.url` 别名。表达式或模板误用 `book.url`（包括 `book['url']` 和 `get(book, 'url')`）时，会提示「book.url 不存在，请使用 book.bookUrl（书籍详情地址）；目录地址请使用 book.tocUrl」，阻止继续请求错误地址。

| 字段 | 说明 |
|---|---|
| `list` | 章节元素，必填（脚本阶段除外） |
| `fields.title`、`fields.url` | 章节名与章节地址，必填 |
| `fields.isVip`、`fields.isPay` | 布尔标记：VIP 章节、付费章节 |
| `fields.isVolume` | 为真时该元素是分卷标题，不需要 `url`。它不占章节位置，目录会把卷名显示在它后面第一章的上方 |
| `fields.tag` | 章节附加信息，一般放更新时间 |
| `nextUrl` | 目录分页地址，见下 |
| `batch` | `nextUrl` 用列表写法时每批并发请求的页数，1 到 16 的整数，默认 4 |
| `reverse` | 为 `true` 时把整个目录倒序（接口按最新在前返回时用） |

**目录分页 `nextUrl`** 有两种写法：

- 返回一个地址，表示“下一页”。逐页请求，地址为空或与已请求过的重复时停止。适合只能从当前页看出下一页的站点。
- 返回列表（或多行文本），表示“剩余全部目录页”。按列出顺序每批 `batch` 页并发请求，不再跟随这些页自己的 `nextUrl`，已请求过的地址自动跳过。已知总页数时优先用这种写法，例如 `= map(range(int(data.pages) - 1), i => server + '/toc?page=' + (i + 2))`。要一次列全剩余页，漏掉的页不会再被发现。

合计最多 1000 页。`batch` 调大能明显加快长目录（40 页目录从 10 批变成 3 批），容易被封的站点保持默认或调小；顶层 `rate` 同时生效。目录逐章取字段时会分片让出主线程，几千章的目录不会长时间卡住界面。

接口把章节嵌在分卷里时，用 `flatMap` 把卷名和章节摊平成一个列表：

```json
"toc": {
  "list": "= flatMap(data.volumes, v => concat([{volume: v.title}], v.chapters))",
  "fields": {
    "title": "= default($.volume, $.title)",
    "url": "= $.id ? server + '/chapter/' + $.id : ''",
    "isVolume": "= $.volume != null"
  }
}
```

### 正文 `content`

按书籍类型取对应的规则：听书取 `audio`，漫画取 `images`，视频取 `video`，其余取 `text`。不写 `url` 时请求章节的 `url`。

| 字段 | 说明 |
|---|---|
| `text` | 正文文本。多段用换行分隔；可以包含 `<img src="…">`，阅读器会显示为插图 |
| `images` | 图片地址列表（漫画）。也可以是 `data:image/…;base64,…` 内嵌图片，应用会解码后存成缓存文件，`imageDecode` 同样作用于它 |
| `audio` | 音频地址（听书） |
| `video` | 这一集的视频流地址（如 mp4、m3u8），由应用自带的播放页播放。每次切集都会重新请求，地址带时效也没关系 |
| `mediaError` | 可选。`audio` / `video` 求值为空时显示给用户的原因，可以读取附加请求的结果（例如「这本书没有真人录音版」）。不写或求值为空时，应用从附加请求和主请求里第一个 `code` 不为 0 的响应归纳原因（如「音频接口返回失败：ILLEGAL_ACCESS（code=110）」） |
| `mediaHeaders` | 取漫画图片和音频时附带的请求头，例如 `{ "Referer": "{{server}}/" }`。只接受 Referer、Origin、User-Agent、Accept、Accept-Language、Authorization、Cookie、Range。对正文文字里夹带的插图和视频不生效 |
| `replace` | 净化规则列表：`{ "pattern": "正则", "with": "替换文本", "flags": "g" }`。按顺序作用于 `text`；`with` 不写时删除匹配内容，`flags` 默认 `g` |
| `nextUrl` | 正文分页地址，见下 |
| `batch` | `nextUrl` 用列表写法时每批并发请求的页数，1 到 16 的整数，默认 4 |
| `fetch` | 附加请求，见[正文的附加请求与评论](#正文的附加请求与评论) |
| `imageDecode` | 漫画图片解密，见下 |
| `links` | 正文末尾的按钮，见下 |
| `comments` | 段评与章末评论入口，见下 |

**正文分页 `nextUrl`** 与目录的写法相同：

- 返回一个地址表示“下一页”，逐页请求，为空、重复或指回第一页时停止。站点在章末把翻页链接换成“下一章”时，要判断链接文字，参见[网页书站示例](#网页书站示例)。
- 返回列表（或多行文本）表示“本章剩余全部分页”，按列出顺序每批 `batch` 页并发请求。第一页上能看出总页数（例如“第 1/22 页”）时优先用列表写法，例如 `= map(range(int(match(body, '/\s*(\d+)\s*页', 1)) - 1), i => replaceText(baseUrl, '.html', '_' + (i + 2) + '.html'))`，几十页的长章节会快得多。列表里只放本章的分页，选择器不要把“下一章”链接也选进来。

连第一页在内最多 200 页，拼接后的正文最多 8 MB，超出部分不取，调试页会记下还有几页没取。

### 正文的附加请求与评论

**附加请求 `fetch`** 在主请求之后依次执行，结果以名称绑定为变量。响应是 JSON 时为解析后的对象，否则为文本；请求失败或 `when` 为假时为 `null`，由规则自行降级：

```json
"content": {
  "let": { "d": "= data.data ?? {}" },
  "fetch": {
    "toned": { "when": "= vars.tone", "url": "{{server}}/audio?id={{d.id}}&tone={{urlencode(vars.tone)}}" }
  },
  "audio": "= default(toned.data.url, d.url)"
}
```

**图片解密 `imageDecode`** 用于图片本身被加密的漫画源。密钥和 IV 在取正文时算好，应用下载每张图片后用系统加密框架解密再显示：

```json
"content": {
  "let": { "d": "= data.data ?? {}" },
  "images": "= map(d.images, x => x.url)",
  "imageDecode": { "algorithm": "AES/CBC/PKCS5Padding", "key": "= hexBytes(d.key)", "iv": "= hexBytes(d.iv)" }
}
```

- `algorithm` 支持 AES 和 3DES 的 ECB、CBC、CTR、OFB、CFB 模式。`key`、`iv` 可以是文本（按 UTF-8）或字节。
- `iv` 总是按表达式求值（没有 `ivEncoding`）：文本 IV 写 `"iv": "= '97b60394abc2fbe1'"`，16 个字符即 16 字节；十六进制 IV 写 `"iv": "= hexBytes('39376236303339346162633266626531')"`。不要把文本 IV 交给 `hexBytes`，`hexBytes('97b60394abc2fbe1')` 只得到 8 字节。
- 一章里的图片共用同一组参数。下载到的内容本身已经是图片时不解密。
- 不写 `keyEncoding` 时保留既有规则语义：固定文本须写成 `"key": "= '0123456789abcdef'"`，十六进制密钥可写成 `"key": "= hexBytes(d.key)"`。裸文本是选择器，不是密钥字面值；求值为空会明确报错。
- 显式设置 `keyEncoding: "utf8"` 或 `"hex"` 后，`key` 接受字面文本、模板或表达式，并按指定编码转换。hex 必须是完整的十六进制字节。静态密钥在导入时校验长度，动态密钥在取正文时校验；AES 支持 16/24/32 字节，3DES 为 24 字节。
- 只能做标准的对称解密。按规律打乱像素块这类自定义混淆做不了；文件格式特殊时用下面的字节脚本。

每张图片独立随机 IV、文件前 16 字节存放 IV 时，可以省略 `iv` 并添加 `ivPrefixBytes:16`：

```json
"content": {
  "images": "= map(data.images, x => x.url)",
  "imageDecode": {
    "algorithm": "AES/CBC/PKCS7Padding",
    "key": "0123456789abcdef0123456789abcdef",
    "keyEncoding": "utf8",
    "ivPrefixBytes": 16
  }
}
```

示例密钥仅用于说明格式，请换成实际密钥。`ivPrefixBytes` 只接受数字 `16`，不能同时声明 `iv`（空字符串也不允许），算法限 AES/CBC/PKCS5Padding 或 PKCS7Padding。每张图片独立截取 IV，章内只共用密钥；普通 JPEG/PNG/GIF/BMP/WebP/AVIF/HEIF 会直接保存，允许加密与明文混合。单张下载限 20 MiB，公共正文辅助层的默认完整物化管线每批最多 4 张并发，使用异步系统加密接口；按需阅读的并发由宿主调度。截断密文、错误密钥或解密后不是支持的图片时，这一张图片显示「图片未能显示」和具体原因（如「正文图片解密失败：…」），本章其余图片照常显示，不把密文地址交给图片控件；有图片失败的章节不写入正文缓存，刷新本章或重新打开会重试。解密参数和请求头都参与图片缓存标识。

#### 自定义图片字节脚本

标准算法配置不足以描述文件格式时，可把 `content.imageDecode` 改为脚本形式。函数定义在书源已有的顶层 `js` 中：

```json
{
  "js": "function decodeImage(bytes, ctx) { const iv = Array.from(bytes.subarray(0, 16), b => b.toString(16).padStart(2, '0')).join(''); return image.decrypt('AES/CBC/PKCS7Padding', bytes.subarray(16), ctx.params.key, iv); }",
  "content": {
    "images": "= data.images",
    "imageDecode": {
      "script": "decodeImage",
      "params": { "key": "= data.imageKey" }
    }
  }
}
```

这是合并到完整书源中的片段。示例要求 `data.imageKey` 是十六进制密钥；前 16 字节是 IV。该格式也可直接用前述 `ivPrefixBytes` 配置。脚本适合额外存在自定义头、异或、字节重排或多步加解密的格式。

函数签名为 `decodeImage(bytes, ctx)`。`bytes` 是下载到的 `Uint8Array`；返回 `Uint8Array`、`Int8Array`、`Uint8ClampedArray` 或 `ArrayBuffer`，切片按实际偏移和长度读取。字符串、数字数组、16/32 位数组、空返回值不接受。允许已经能在脚本内部完成的 Promise/async 计算，不提供定时器。最终结果必须是受支持图片文件的完整字节，不支持直接返回像素/RGBA 数据或 Canvas 对象。

| 上下文/配置 | 含义 |
| --- | --- |
| `ctx.url` | 当前图片的请求地址（不带附加选项） |
| `ctx.index` | 本章规范化、去重后的图片列表索引，从 0 开始；宿主逐张加载时须保留该原始序号，不能将每次单图请求都重置为 0 |
| `ctx.params` | `params` 中在正文第一页作用域求值后的 JSON 对象；可用嵌套对象、数组、表达式和模板传递章节密钥等，序列化后最多 16384 字符 |
| `processPlainImages` | 默认 `false`，识别为正常图片时跳过脚本；确实需要处理正常图片文件时设为 `true` |

`script` 与 `algorithm`、`key`、`iv`、`keyEncoding`、`ivPrefixBytes` 互斥。脚本参数统一放在 `params`；没有 `script` 时不能使用 `params` 或 `processPlainImages`。配置错误会显示具体字段，不自动接受别名。修改书源后请重新加载正文以生成新的图片参数。

图片脚本拥有独立的 `image` 助手（同步返回 `Uint8Array`，底层通过异步系统加密接口完成）：

```javascript
image.decrypt('AES/CBC/PKCS7Padding', bytes, keyHex, ivHex)
image.encrypt('AES/CBC/PKCS7Padding', bytes, keyHex, ivHex)
image.hash('SHA256', bytes)
image.hmac('SHA256', bytes, keyHex)
```

分片打乱但文件本身仍是正常图片时，可使用 `image.reorderStrips(bytes, options)`，并设置
`processPlainImages: true`。该方法只操作当前图片，不请求任何网站：

```js
function restoreImage(bytes, ctx) {
  return image.reorderStrips(bytes, {
    count: ctx.params.count,
    remainder: 'last',
    format: 'image/png'
  });
}
```

`count` 是 1～256 的整数；输入横条从上到下编号 0～count-1，`order` 指定输出顺序，
省略时倒序。`order` 必须包含每个序号且不能重复。高度除不尽时，`remainder` 指定输入
图中额外像素所在的条，支持 `first` / `last`（默认 `last`）。例如高度 11、count=3，
默认输入条高为 3/3/5，倒序后为 5/3/3，条内行方向保持不变。输出默认 PNG，保持原始
尺寸；也可指定 `image/jpeg` / `image/webp` 和 0～100 的 `quality`（默认 95）。
单图最多 4 Mi 像素，宽高最多 16384，分片数不能大于高度，编码输入/输出各最多
20 MiB；count=1 原样返回，动图不重排。章节 ID、摘要及段数等站点算法由导入的源计算。
内核自带执行器通过 `NativeImageTransform` 提供该操作；安装了自定义图片脚本执行器时，自定义执行器也须实现同名操作。旧内核或执行器不支持此接口时，仅更新书源规则不能增加本地重排能力。

`keyHex`、`ivHex` 必须由完整十六进制字节组成。加解密支持 AES/3DES/DESEDE、ECB/CBC/CTR/OFB/CFB 模式及 NoPadding/PKCS5Padding/PKCS7Padding，最终可用组合由设备系统加密框架决定；ECB 不传 IV，其他模式的 IV 必须匹配块长度。摘要支持 MD5、SHA1、SHA224、SHA256、SHA384、SHA512、SM3；HMAC 组合以设备支持为准。不要在函数库顶层执行图片处理，或声明与图片助手 `image` 冲突的顶层变量；在处理函数内调用它。

每张图使用独立的后台有界脚本会话，执行后释放，不共享全局状态。图片脚本不提供正文阶段的 `native`/网络/Cookie/文件/登录接口。宿主安装的 `SourceEngineHost.imageScripts` 自定义执行器优先使用；未安装时，[`NativeImageScriptRunner`](../sourceengine/src/main/ets/core/nativesource/NativeImageScriptRunner.ts) 会使用内核自带的 `JSScriptSession` 执行器，不会因缺少自定义执行器而报错。内核约束单图输入和输出各不超过 20 MiB；执行器的队列、内存、超时及助手调用预算不属于书源 JSON 字段。取消或失败不会缓存处理结果。

内核自带执行器一次运行 1 项，运行与等待共最多 4 项，满额时等待空位；排队总等待最长 60 秒。每张图的会话内存上限 96 MiB、脚本求值超时 2 秒、总耗时上限 10 秒。自定义执行器可设置自己的预算，阅读宿主负责下载并发、后台预加载和可见页优先级，并在自身接入文档中说明实际限制。系统加密和图片编解码无法在调用中途抢占，返回后继续检查取消与超时。

#### 图片清单与按需加载

正文阶段通过 `content.images` 返回按阅读顺序排列的原始图片地址，图片下载、解密及重排由宿主逐张完成。`content.script` 不应为了生成清单而下载和处理整章图片；分片算法在 `content.imageDecode.script` 内针对当前图片运行。图片文件本身可被系统识别但内容条带乱序时，须开启 `processPlainImages: true`。

支持按需显示的阅读宿主可对本次源实例调用 `SourceEngineHost.setReaderImagesDeferred(source, true)`，使公共正文辅助层先返回完整 ReaderImageMarker。宿主须在后续图片请求中保留请求头、`decode`、`params`、`imageIndex` 和尺寸，并使用原有图片管线物化；每张完成后即可显示。这个策略仅由可信宿主设置，源对象复制时继承，不属于 JSON 字段，不向规则脚本开放。未开启时仍按默认流程完整物化图片；下载、导出等需要完整本地内容的调用应保留默认策略。

轻页 4.3.929 的漫画阅读已采用逐张显示：全局最多 4 个图片处理名额，可见图片优先；前台繁忙时后台最多占 1 个名额，空闲时最多 2 个。手动缓存仍等待完整结果。其他宿主的调度策略可能不同。漫画 OCR 与繁→简是轻页对图片的本地显示处理，不改变本节字段，也不属于 `imageDecode.script` 的职责；日／英／韩翻译尚未接入。

更新电脑上的 JSON 不会自动替换 App 已导入的定义。修改脚本或解码配置后，应覆盖导入同一书源、确认图片模式并刷新章节；仅修改宿主并发上限不需要重新导入。

缓存标识包含书源、图片 URL、请求头、脚本代码、函数名、配置、参数、索引和普通图片处理开关。脚本报错、超限、返回错误类型或无效图片时，只有这一张图片失败：它的位置显示原因（带 `content.imageDecode.script` 与函数名），供书源作者定位，本章其余图片照常显示。应用「后台脚本线程验证」包含二进制边界、宿主隔离、系统加密和取消恢复的真机验证项。

#### 正文末尾的按钮 `links`

`links` 在正文末尾加按钮。按钮有两种：打开一个网页，或者发一个请求。

```json
"content": {
  "text": "= d.type == 'video' ? '本章是视频内容，点下方按钮播放。' : d.content",
  "links": [
    { "label": "▶ 打开播放器", "when": "= d.type == 'video'", "url": "{{server}}/player?id={{d.id}}" }
  ]
}
```

`label` 和 `url` 是模板，`when` 为假时不显示；地址必须是 http(s)。按钮只对文本正文生效。

发请求的按钮把 `url` 换成 `request`，用于点赞、收藏这类操作，结果用 `message` 提示：

```json
"links": [
  { "label": "点赞本章", "request": { "url": "{{server}}/api/like?id={{d.id}}", "method": "POST" }, "message": "= data.msg" }
]
```

请求的地址、请求头、请求体在取正文时就已确定，点击时原样发出；`message` 在收到响应后求值，不写时提示“已完成”。涉及扣费的购买动作不在支持范围内。

#### 段评与章末评论 `comments`

`comments` 声明段评和章末评论入口。书源只提供数据和地址，气泡与入口由应用绘制，点开后在应用内显示评论页：

```json
"comments": {
  "when": "= vars.bubbles != '关'",
  "stats": { "url": "{{server}}/api/para/stats?chapter={{d.id}}" },
  "counts": "= stats.data.paras",
  "paragraphUrl": "{{server}}/comment?chapter={{d.id}}&para={{para.index}}",
  "chapterUrl": "{{server}}/comment?chapter={{d.id}}",
  "max": 60
}
```

| 字段 | 说明 |
|---|---|
| `when` | 为假时整个评论功能不生效，也不发统计请求 |
| `stats` | 统计接口，结果绑定为 `stats` |
| `counts` | 每段评论数：对象的键（或列表下标）是正文行号，值是条数。行号按 `text` 结果的换行切分，从 0 开始。写了 `paragraphUrl` 时必填 |
| `paragraphUrl` | 段评页地址，可用 `para.index`、`para.count`、`para.text`（该段前 90 个字） |
| `chapterUrl` | 整章评论页地址，可用 `total`（各段条数之和）。有值时章末显示「本章说」入口 |
| `max` | 一章最多显示多少个气泡，默认 60，上限 300 |

`paragraphUrl` 和 `chapterUrl` 至少写一个。统计接口失败时正文照常显示，只是没有气泡。评论只对文本正文生效。

## 原生书源的顶层字段

| 字段 | 说明 |
|---|---|
| `sourceFormat` | 固定为 `"native"` |
| `version` | 格式版本，目前为 `1`。比应用支持的版本新时拒绝导入，提示“该原生书源需要更新版本的应用” |
| `name` | 书源名称，必填 |
| `url` | 书源地址，必填，必须以 `http://` 或 `https://` 开头。它是书源的唯一标识，也是相对地址的基准 |
| `group`、`comment` | 分组与说明，显示在书源管理里 |
| `type` | 默认媒体类型：`text`（默认）、`audio`、`comic`（或 `image`）、`video`，见[媒体类型](#媒体类型) |
| `enabled`、`enabledExplore` | 首次导入时是否启用、是否在发现页显示，默认都为 `true`。再次导入同一书源时保留用户在应用里的设置 |
| `rate` | 限流。`次数/毫秒` 表示窗口内最多几次，例如 `"20/60000"`；纯数字是两次请求的最小间隔毫秒数，例如 `"1000"`。对整个书源的所有请求生效，并发抓目录页也要排队；纯数字间隔会让 N 页目录至少耗时 N × 间隔，站点不限流时不要写。搜索时单个请求最多排队 60 秒 |
| `headers` | 每个请求都带的请求头，值可以是模板或表达式，每次请求时求值，见[请求是怎么发出的](#请求是怎么发出的)。书源记录的 `header` 字段只保存其中的字面值，供应用的其他功能（如听书播放）使用 |
| `coverHeaders` | 封面专用请求头，见[加密封面](#加密封面-coverdecode) |
| `coverDecode` | 封面 AES 解密声明，见[加密封面](#加密封面-coverdecode) |
| `vars` | 书源变量，见下 |
| `let` | 全局派生值，按书写顺序求值，每次操作开始时计算一次，所有阶段都能用 |
| `cache` | 先取一次、之后复用的值，见下 |
| `login` | 账号登录，见下 |
| `actions` | 书源设置页里的动作按钮，见下 |
| `voices` | 听书音色列表，见下 |
| `lib` | 函数库，见[函数库](#函数库-lib) |
| `js` | JS 函数库，见 [JS 函数库](#js-函数库-js) |
| `scriptLimits` | 脚本阶段的预算，见[脚本阶段](#脚本阶段-script) |
| `search`、`explore`、`detail`、`toc`、`content` | 五个阶段。`search` 和 `explore` 至少要有一个 |

不认识的顶层字段会原样保存、导出，但不起作用。

### 加密封面 `coverDecode`

顶层声明统一用于搜索、发现和详情的 `fields.coverUrl`，不会改变书籍 URL 或正文规则：

```json
{
  "coverDecode": {
    "algorithm": "AES/CBC/PKCS7Padding",
    "key": "0123456789abcdef",
    "keyEncoding": "utf8",
    "ivPrefixBytes": 16
  }
}
```

以上是顶层字段片段，需与 `sourceFormat`、`name`、`url` 和阶段规则组成完整定义。加密参数只接收字面值，不计算表达式或执行 JavaScript。

| 字段 | 语义 |
| --- | --- |
| `algorithm` | `AES/CBC/PKCS7Padding`，也接受同等填充的 `AES/CBC/PKCS5Padding` |
| `key` | AES 密钥，解码后必须为 16、24 或 32 字节 |
| `keyEncoding` | 默认 `hex`（严格十六进制），也支持 `utf8` |
| `ivPrefixBytes` | 设为 `16` 时，文件前 16 字节是 IV，其余字节是 AES 密文 |
| `iv` | 固定 IV 的 32 位十六进制写法；不能与 `ivPrefixBytes:16` 同时使用 |

固定 IV 示例：`"iv": "000102030405060708090a0b0c0d0e0f"`，此时删除 `ivPrefixBytes`。
图片地址仍由 `fields.coverUrl` 提取；HTML 延迟加载图片可使用 `img@data-src`，JSON 则使用对应字段规则。
正文漫画的 `content.imageDecode` 也支持 `ivPrefixBytes:16` 和显式 `keyEncoding`，但它的 key/iv 按表达式求值，不能直接套用封面裸写十六进制的写法：IV 是 16 个字符的文本时写 `"iv": "= '97b60394abc2fbe1'"`（按 UTF-8 取字节），是十六进制时写 `"iv": "= hexBytes('3937…')"`。详见[正文](#正文的附加请求与评论)小节。

封面请求会继承顶层 `headers` 中的 `Accept`、`Accept-Language`、`User-Agent`、`Referer`、`Origin`、`Cookie`、`Authorization`。可用顶层 `coverHeaders` 单独覆盖（头名称不区分大小写），普通封面和加密封面均适用：

```json
"coverHeaders": {
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Referer": "= source.url + '/'"
}
```

`coverHeaders` 和继承来的顶层 `headers` 都支持表达式和模板，在搜索、发现、详情解析封面时求值。带请求头的封面经应用下载缓存；头参数参与缓存标识，只在本地地址片段中传递，不作为图片 HTTP 地址发送。修改书源后重新获取书籍信息以更新封面参数。未设置语言头时，应用封面下载默认使用 `zh-CN,zh;q=0.9,en;q=0.8`。

输入最多 8 MiB，支持加密封面与普通图片混用。解密后检查 JPEG/PNG/GIF/BMP/WebP/AVIF/HEIF 文件头；密钥长度在导入时即校验，非法密钥、截断密文或非图片结果返回错误。
引擎输出 `#source-cover-v1=` 标记，片段只携带书源标识，不保存密钥或账号。解密结果按封面地址缓存，书源改了 `coverDecode` 参数后，已缓存的封面不会自动重新解密。
宿主须按源会话调用公共加载器，持久化原地址并按需显示解密后的图片；未接入加载器的应用不能直接显示该地址。接入和缓存职责见[公共封面解密宿主接口](cover-decoding.md)。

### 书源变量 `vars`

```json
"vars": [
  { "key": "mode", "label": "模式", "options": ["小说", "听书", "漫画"], "default": "小说", "filter": true },
  { "key": "server", "label": "服务器", "default": "https://api.example.com" }
]
```

| 字段 | 说明 |
| --- | --- |
| `key` | 变量名，只能用字母、数字和下划线，不能重复。规则里用 `vars.key` 读取 |
| `label` | 设置页和筛选栏上显示的名称，不写时用 `key` |
| `options` | 可选值列表。写了就在设置页显示为下拉，否则是输入框 |
| `default` | 默认值。不写时取 `options` 的第一项，没有 `options` 时为空串 |
| `filter` | 为 `true` 且有 `options` 时，显示在发现页顶部作为筛选项，切换后立即生效 |
| `optionsScript` | `js` 里的函数名，打开书源设置页时运行它取选项列表，见下 |

- 所有变量都能在「书源设置」里修改：有 `options` 的是下拉，其余是输入框。
- 变量的值按书源保存，都是文本。同一地址的书源在原生与兼容格式之间替换时，旧的变量和登录状态不会沿用。
- 已保存的值不在 `options` 里时回退到默认值；写了 `optionsScript` 的变量除外，见下条。
- 写了 `optionsScript: "函数名"` 的变量，打开书源设置页时会运行 `js` 里的这个函数取选项列表（例如测速后列出可用线路），函数返回字符串数组；失败或返回空列表时仍用 `options`，并在变量下面显示原因。函数的 `ctx.key` 是变量名，可以使用脚本阶段的全部接口。成功加载后，如果原来的值不在新列表里，设置页会选中第一项并标记待保存。脚本给出的值（例如测速得到的新线路）选中保存后，规则里的 `vars.名称` 就是这个值，不要求出现在静态 `options` 里。筛选栏不运行 `optionsScript`，只列静态 `options`；当前值不在其中时补在末尾并高亮。

### 听书音色 `voices`

```json
"voices": [
  { "id": "1", "name": "甜美少女" },
  { "id": "4", "name": "成熟大叔" }
]
```

声明后，听书页的「音色」按钮会弹出这个列表（最前面自动加一项「默认」）。用户选中的 `id` 按书保存，规则里通过 `book.vars.custom` 读取，没选时为空：

```json
"content": {
  "let": { "d": "= data.data ?? {}" },
  "fetch": {
    "toned": { "when": "= book.vars.custom", "url": "{{server}}/audio?id={{d.id}}&tone={{book.vars.custom}}" }
  },
  "audio": "= default(toned.data.url, d.url)"
}
```

切换音色后应用会从本章开头重新取音频。没有声明 `voices` 的书源，「音色」按钮仍是手动填写代码，填写的值同样在 `book.vars.custom` 里。

音色是否生效取决于接口：有的接口只对合成朗读的内容区分音色，真人录制的有声书换音色返回的是同一个音频。

### 复用的值 `cache`

有些接口要先换一个令牌，之后每个请求都带上它。把这一步声明在 `cache` 里：

```json
"cache": {
  "token": { "url": "{{vars.server}}/api/token", "value": "= data.data.token", "ttl": 3600 }
},
"let": { "auth": "= token ? 'Bearer ' + token : ''" },
"search": { "url": "…", "headers": { "Authorization": "{{auth}}" } }
```

| 字段 | 说明 |
|---|---|
| `url`、`method`、`headers`、`body` | 取值用的请求，写法同各阶段，必填 `url` |
| `value` | 从响应里取出要保存的值，必填 |
| `ttl` | 有效期（秒），默认 600，最长 7 天。到期后下次用到时重新获取 |
| `when` | 为假时不取，值为 `null` |

- 名称只能用字母、数字和下划线。值按名称绑定，`let` 和各阶段都能直接用。
- `cache` 在 `let` 之前求值，所以它的请求里只能用 `vars`、`source`、`login` 和 `cookie()`，不能用 `let` 里的名称。顶层 `headers` 也会带到这些请求上，但其中引用 `let` 或缓存名（还没有值）的请求头这一步不带，取到之后的请求照常带上；所以上例的 `Authorization` 也可以直接写在顶层 `headers` 里。
- 取值失败时为 `null`，不会被保存，下次还会再取。
- 书源变量变了、书源被修改或重新导入、退出登录后，缓存的值作废。
- 值只保存在内存里，应用重启后重新获取。
- 表达式和在表达式中调用的函数不能写入持久状态；顶层 `cache` 提供声明式预取。需要程序控制写入时，使用后台脚本的 `cache`、`vars`、`login` 或详情阶段 `keep`，见[状态的作用域](#状态的作用域)。

### 账号登录 `login`

登录有三种方式，可以同时声明，设置页会都提供：

| 方式 | 写法 | 适用 |
| --- | --- | --- |
| 网页登录 | `url` | 站点有登录网页，登录后靠 Cookie 识别 |
| 表单登录 | `form` + `submit` | 账号密码调接口换令牌 |
| 脚本登录 | `form` + `script` | 多步请求、密码加密、先取验证参数这类声明写不出来的登录 |

**网页登录**

```json
"login": {
  "url": "https://example.com/login",
  "cookies": ["sessionid"],
  "check": {
    "url": "{{server}}/api/user",
    "headers": { "Cookie": "sessionid={{cookie('https://example.com/', 'sessionid')}}" },
    "ok": "= data.code == 0",
    "name": "= data.data.name"
  }
}
```

- 用户在「书源设置」里点登录，应用用内置浏览器打开 `url`（必须是完整的 http(s) 地址），登录完成后保存该站点的 Cookie。
- `cookies` 列出登录后应当存在的 Cookie 名，用来判断登录状态；不写时只要该站点有 Cookie 就算已登录。
- `check` 可选，对应设置页的「检查登录」：请求 `url`，`ok` 为真表示登录有效，`name` 是显示的账号名。
- 之后对同一站点的请求自动带上 Cookie。要把登录凭据发给另一个域名时，用 `cookie(地址, 名称)` 取值，写进那个请求的 `headers`。
- 需要支持手动填令牌时，加一个普通变量，规则里写 `default(cookie(…), vars.token)`。

**表单登录**：站点用账号密码调接口登录时，声明表单和提交请求，界面由应用生成：

```json
"login": {
  "form": [
    { "key": "user", "label": "账号" },
    { "key": "pass", "label": "密码", "secret": true }
  ],
  "submit": {
    "url": "{{vars.server}}/api/login",
    "body": { "username": "{{form.user}}", "password": "{{md5(form.pass)}}" },
    "ok": "= data.code == 0",
    "token": "= data.data.token",
    "user": "= data.data.name",
    "message": "= data.msg"
  },
  "sendCode": { "label": "发送验证码", "url": "{{vars.server}}/api/code?phone={{form.user}}", "message": "= data.msg" }
},
"let": { "auth": "= login.token ? 'Bearer ' + login.token : ''" }
```

| 字段 | 说明 |
|---|---|
| `form` | 要用户填写的项。`key` 只能用字母、数字和下划线；`secret` 为 `true` 的按密码输入，不显示也不保存 |
| `submit` | 提交登录的请求，必填 `url` 和 `ok`。`ok` 为真表示成功；`token`、`user` 是登录后保存的凭据和显示名；`message` 是提示给用户的文字，失败时尤其有用 |
| `sendCode` | 可选的辅助请求（发送验证码等），按钮文字用 `label`，结果用 `message` 提示；也可以写 `script` |
| `script` | 脚本登录的函数名，代替 `submit`，见下 |

- 填写的值在 `submit` 和 `sendCode` 里通过 `form.名称` 读取，其他地方读不到。
- 登录成功后，规则里用 `login.token` 和 `login.user` 读取凭据；未登录时为空串。
- 应用只保存登录换来的凭据，**不保存用户填写的账号和密码**；凭据失效后需要重新登录。凭据不进入备份和云同步。

**脚本登录**：写 `script: "函数名"` 代替 `submit`。函数的 `ctx.form` 是用户填写的表单，可以使用脚本阶段接口（`keep` 除外），包括 `browser.verify` 让用户完成验证。成功时调用 `login.save(令牌, 用户名)`，建议返回 `{ ok: true, message: "登录成功" }`。没有返回 `ok` 时，仅凭据变为非空且不同于调用前的令牌才判定成功；重新保存相同令牌应显式返回 `ok`。密码只在这次调用里使用，不应写入变量、缓存或日志。

### 动作按钮 `actions`

签到、领取、打开个人中心、切换线路这类“点一下做一件事”的操作，声明成设置页里的按钮：

```json
"actions": [
  { "label": "每日签到", "url": "{{server}}/api/checkin", "headers": { "Authorization": "{{auth}}" },
    "message": "= data.msg", "when": "= login.token" },
  { "label": "个人中心", "open": "{{server}}/user" }
]
```

| 字段 | 说明 |
|---|---|
| `label` | 按钮文字，必填 |
| `url`、`method`、`headers`、`body` | 点击后发出的请求，写法同各阶段 |
| `message` | 请求完成后提示给用户的文字；不写时提示“已完成” |
| `open` | 写了它就不发请求，改为在应用内打开这个网页 |
| `when` | 为假时按钮不显示 |
| `script` | `js` 里的函数名：点击后运行它，返回的字符串作为提示（返回对象时取 `message`）。写了 `script` 就不发 `url` 请求。函数的 `ctx.action` 是按钮文字，可以使用脚本阶段的全部接口，例如测速后 `vars.set` 切换线路再 `ui.refreshExplore()` |

`url`、`open`、`script` 至少写一个。不写 `script` 时，按钮只会做声明里写明的那一个请求或打开那一个网页。按钮运行中显示忙碌状态并防止重复点击，结束后刷新登录状态和按钮列表。

## 函数库 `lib`

内置函数拼不出来的算法（站点自定义的签名、混淆、解密），可以写成函数放在顶层的 `lib` 里，之后任何表达式和模板都能调用。`lib` 是原生书源自己的小语言，不需要 JavaScript 引擎；已经有现成 JavaScript 代码时，直接用下一节的 `js` 更省事。

```text
fn sign(path, ts) {
  let h = 0
  for b in bytes(path + ts + 'salt') {
    h = (imul(h, 31) + b) >>> 0
  }
  return toHex(h, 8)
}
```

```json
"search": { "url": "{{server}}/search?q={{urlencode(key)}}&sign={{sign('/search' + key, now())}}" }
```

`lib` 在 JSON 里是一个字符串，换行写成 `\n`。语法：

| 语句 | 写法 |
|---|---|
| 定义函数 | `fn 名称(参数, …) { … }` |
| 声明变量 | `let 名称 = 表达式` |
| 赋值 | `名称 = 表达式`、`列表[下标] = 表达式`、`对象.字段 = 表达式`（没有 `+=`） |
| 条件 | `if 条件 { … } else if 条件 { … } else { … }` |
| 遍历 | `for 项 in 列表 { … }`、`for 项, 序号 in 列表 { … }`；遍历对象时依次得到键和值 |
| 循环 | `while 条件 { … }`，可用 `break`、`continue` |
| 返回 | `return 表达式`；没有 `return` 时结果为 `null` |
| 注释 | `// 单行`、`/* 多行 */` |

语句之间用换行或 `;` 分隔。函数体里的表达式与[表达式语言](#表达式语言)相同，可以调用内置函数。

限制：

- 函数只能做纯计算，只看得到自己的参数，读不到 `vars`、`data` 等书源数据，需要的值由调用方传入。
- 函数没有网络、Cookie、文件能力；请求只能由各阶段的声明式字段发出。
- 函数名不能与内置函数重名，可以相互调用和递归，调用深度上限为 64 层。
- 一次求值的计算量有上限，死循环会被中止并报“表达式计算量超出上限”。

## JS 函数库 `js`

已有的纯 JavaScript 算法（例如有权使用的签名、解密函数或不依赖浏览器的库代码）可以放进顶层 `js`，不必改写成 `lib` 的语法。依赖 DOM、Node.js、模块加载或 Android `java.*` 的代码仍需改写。顶层用 `function`、`const`、`let` 定义的函数，在表达式和模板里按函数名直接调用，用法与 `lib` 函数相同。下面是定义片段，需合并到完整书源：

```json
"js": "function sign(path, ts) {\n  return native.md5(path + ts + 'salt').slice(0, 16);\n}",
"let": { "ts": "= now()" },
"search": {
  "url": "{{source.url}}/search?q={{urlencode(key)}}&ts={{ts}}&sign={{sign('/search', ts)}}",
  "list": "$[*]",
  "fields": { "name": "$.name", "bookUrl": "$.url" }
}
```

- 引擎是 QuickJS，支持较新的语法：`class`（含私有字段）、箭头函数、解构、正则命名分组、`replaceAll`、`BigInt` 等。
- JS 里通过 `native.名称(…)` 使用内置函数，例如 `native.md5(text)`、`native.sel('@css:.title@text', html)`、`native.decrypt(…)`。除 `map`、`flatMap`、`filter`、`find` 外的内置函数都能用；这四个请改用数组自带的方法。`native.sel`、`native.selAll` 不传内容时，取发起调用的那条规则当前的 `item`。写错名字时报“native.xxx 不是可用的内置函数”。
- `uuid()` 返回随机 UUID，在 `js` 函数里可以直接调用（表达式本身没有 `uuid`，需要时写一个 `js` 函数返回它）。
- 参数和返回值按 JSON 传递：字符串、数字、布尔、`null`、数组、对象都可以；字节数据和内置函数一样用 0 到 255 的数字列表。`undefined` 会变成 `null`，函数和 `BigInt` 传不出来。
- 查找顺序是 `lib` 函数、内置函数、`js` 函数。导入时会检查重名：`js` 里的函数不能与内置函数或 `lib` 函数同名。`lib` 函数里也可以调用 `js` 函数。
- 顶层代码在每个上下文载入时执行一次，导入校验也可能载入它；表达式上下文按代码复用，最多缓存 4 份，淘汰后会重新载入。不要靠全局变量保存用户状态；跨请求缓存或持久化应使用声明式 `cache` 或脚本状态接口。顶层代码里不能调用 `native`、网络或状态接口，要放到函数里。
- 只做纯计算：没有网络、Cookie 写入、文件、定时器和网页对象；不支持 `async` 函数或返回 Promise。
- 单次调用最多 300 ms，载入顶层代码最多 2 秒，内存上限 32 MiB、栈上限 512 KiB；`js` 长度上限 512 × 1024 个字符。超时或出错时，错误信息里带函数名，例如“JS 函数 “sign” 出错：…”，调试页里对应的规则记录也会标出来。
- 宿主关闭了主线程同步 QuickJS（`allowSynchronousQuickJs: false`）时，`js` 不可用，调用会报“当前环境不支持 JS 函数库”。
- 在表达式里调用的函数不能用下一节的 `http`、`vars` 等接口，一用就报“表达式里不能发请求或读写状态，请改用阶段的 script”。

`js` 必须是 JSON 字符串，不能直接把多行 JS 粘贴成未转义的字符串。换行用 `\n`，双引号用 `\"`，JS 里本身的 `'\n'` 要写成 `'\\n'`；编写较长函数时，先单独编辑 JS，再用 `JSON.stringify` 生成字段值。表达式中的 `key`、`book`、`vars` 等上下文不会自动变成 JS 全局变量，纯函数需要的数据应通过参数传入。

## 脚本阶段 `script`

请求顺序要由代码决定的站点（先取令牌再搜索、按结果循环翻页、批量取详情），可以把一个阶段整个交给 `js` 里的一个函数。在阶段上写 `script: "函数名"`：

```json
"js": "function search(ctx) {\n  const ids = http.get('/api/search?q=' + encodeURIComponent(ctx.key)).json().ids;\n  return http.all(ids.map(id => '/api/book?id=' + id)).map(r => r.json());\n}",
"search": {
  "script": "search",
  "fields": { "name": "$.title", "author": "$.author", "bookUrl": "= '/book/' + $.id" }
}
```

**函数的返回值就是这个阶段的“页面”**，之后的 `let`、`fail`、`list`、`fields`、`text` 等规则照常在上面求值：

| 返回 | 当作 |
|---|---|
| 字符串 | 页面原文，选择器照常可用（以 `{` 或 `[` 开头且是合法 JSON 时同时解析为 `data`） |
| 数组或对象 | 已解析的 JSON（`data`），JSONPath 照常可用 |
| `page(原文, 地址)` | 原文加上它的地址，相对链接按这个地址补全 |

为了少写样板：脚本阶段不写 `list` 时，返回数组的每一项就是一条结果；不写 `fields` 时按同名键取值（书籍取 `name`、`author`、`kind`、`intro`、`coverUrl`、`wordCount`、`lastChapter`、`updateTime`、`status`、`bookUrl`、`tocUrl`、`type`，章节取 `title`、`url`、`isVip`、`isPay`、`isVolume`、`tag`）。写了 `fields` 就要写全必填字段。正文不写 `text`、`images`、`audio`、`video` 时，返回字符串就是正文，返回对象时按书籍类型取同名键。

- 可以写 `script` 的阶段：`search`、`explore`、`detail`、`toc`、`content`。写了 `script` 的阶段不用写 `url`；`toc` 和 `content` 的翻页由脚本自己处理，**不再跟随 `nextUrl`**。
- 发现页的分类用 `menus` 声明（没有 `url` 的仍是分组标题），要在脚本里算出分类就用 [`dynamicMenus.script`](#发现-explore)。发现阶段写了 `script` 时，分类的 `url` 可以写任意标识，函数从 `ctx.url` 读到，`ctx.title` 是分类名，动态分类的条目在 `ctx.menu`。
- 函数的参数 `ctx` 里有 `stage`、`key`、`page`、`book`、`chapter`、`vars`、`source`、`login`、`baseUrl`、`url`、`title`、`menu`，以及顶层 `cache`、`let` 算出的值。`book.vars` 是书籍变量（只读）。
- 函数可以是 `async` 的；里面的宿主调用都是同步的，不需要 `await`。

脚本阶段在后台线程运行，可以使用这些接口（只在脚本阶段、登录、按钮、动态选项和脚本分类里可用）：

| 接口 | 说明 |
|---|---|
| `http.get(地址, 选项?)`、`http.post(地址, 请求体, 选项?)`、`http.request({ url, method, headers, body, charset, retry, webView })` | 同步发请求，返回 `{ ok, status, body, url, error }`，`json()` 解析正文（不是 JSON 时抛错）。相对地址按书源地址补全，也接受 `data:` 地址；请求体是对象时按 JSON 发送并自动加 `Content-Type: application/json`。请求失败不抛错，看 `ok` 和 `status`。响应头拿不到，`Set-Cookie` 会自动保存，用 `cookie.get` 读取 |
| `http.all([请求, …])` | 一组请求并发发出（每批 8 个），按顺序返回。每项可以是地址或请求对象 |
| `vars.get(名)`、`vars.set(名, 值)` | 书源变量，写入后保存（和书源设置页是同一份），可以写没有在 `vars` 里声明的键 |
| `temp.get(名)`、`temp.set(名, 值)` | 当前 `NativeSourceRunner` 实例内的临时值；轻页按操作创建运行器，不能依赖它把详情数据传给后续目录操作 |
| `cache.get(名)`、`cache.put(名, 值, 有效秒数?)` | 内存缓存，按书源分开，有效期默认 600 秒，1 秒到 7 天；重启应用后失效。`cache.set` 是 `put` 的别名 |
| `cookie.get(地址, 名?)`、`cookie.set(地址, "a=1; b=2")`、`cookie.remove(地址, 名?)` | 读写这个书源的 Cookie；不写名字时读整条、删全部 |
| `login.token`、`login.user`、`login.save(令牌, 用户名)` | 读取与保存登录凭据（与表单登录同一份） |
| `keep(名, 值)` | 只在详情阶段：记进书籍变量，之后的阶段通过 `book.vars.名` 读取 |
| `log(…)` | 写进调试页的执行明细，非文本参数转成 JSON |
| `device.id`、`device.ua` | 设备标识（系统提供的 ODID：同一开发者的应用相同，重装不变）、书源请求用的 User-Agent（顶层 `headers` 里的 `User-Agent` 求值后的值，没写时为应用默认值） |
| `sleep(毫秒)` | 等待，单次最多 5 秒 |
| `uuid()` | 随机 UUID |
| `native.名称(…)` | 内置函数，同上一节 |
| `page(原文, 地址)` | 见上 |
| `ui.toast(文字)` | 在应用里弹提示 |
| `ui.refreshExplore()` | 清掉这个书源的发现页缓存，让发现页重新加载（例如切换线路之后） |
| `browser.verify(地址, 提示?)` | 打开内置浏览器让用户过验证或登录，用户点「完成」后返回页面 HTML，网页里得到的 Cookie 一并保存；用户返回或取消时抛出“网页操作已取消”。只在用户主动发起的操作里弹出（打开书籍的详情、目录、正文，设置页按钮，登录）；搜索和发现里不弹网页，而是抛出“需要网页验证”，界面上照常出现「去验证」 |
| `browser.open(地址, 标题?)` | 打开网页，不等结果。搜索和发现里不能用 |
| `browser.render(地址, { waitFor, timeout, js, headers })` | 在内置浏览器里加载页面（等 `waitFor` 对应的元素出现），在页面里求值 `js` 表达式并返回结果，对象会转成 JSON 文本；不写 `js` 时返回渲染后的整页 HTML。`timeout` 单位为秒，默认 15，范围 3 到 60；`js` 是一个表达式，多条语句需包成立即执行的函数。计入请求次数，失败会抛错 |

脚本里的请求和声明式请求走同一条请求层：书源请求头、Cookie、限流、编码识别和重试都一样，但遇到验证页不会自动提示“去验证”，需要时由脚本调用 `browser.verify`。

预算按每次后台函数运行计算，登录、动作按钮、动态选项与脚本分类也适用：

| 项目 | 默认 / 限制 |
| --- | --- |
| 请求数 | 30；顶层 `scriptLimits.requests` 可设 1 到 100。`http.all` 按每个请求计数，`browser.render` 也计入 |
| 累计响应文本 | `16 × 1024 × 1024`，当前实现按 `body.length` 累计字符串长度，并非网络传输字节数；单次请求还受请求层限制 |
| 脚本计算 | 2 秒，不包含等待宿主调用的时间 |
| 整体运行 | 60 秒，网络、等待与重试都需考虑；`sleep` 单次最多 5000 ms |
| 取消 | 收到宿主取消信号后后台会话中止；离开页面是否发出取消取决于宿主接入，不能保证所有入口都立即取消 |

轻页验证页自身最长等待 10 分钟。当前后台会话的网页等待扣时在 `browser.verify` 返回后才累计，等待过程中仍可能先触发 60 秒总时长限制；不要把 10 分钟当成脚本必然可等待的时长。发生超时后，完成验证再重试原操作。

报错时说明阶段和函数，例如“搜索脚本 search：Error: 接口返回错误”。调试页里每个请求、`log` 和返回值摘要都记成一条执行明细。

同一份 `js` 的后台空闲会话会复用（每份代码最多保留 2 个，全部代码合计最多保留 8 个；这是空闲缓存数量，不是并发上限）。全局变量可能随会话保留，但并发时可能使用不同会话；它们与表达式调用的主线程上下文也互不相通。需要跨阶段、跨操作保存的值请用 `vars`、`cache` 或 `keep`。

### 完整脚本示例

以下完整 JSON 展示搜索交给 JS、其他阶段仍用声明式解析的写法。地址为虚构测试服务，需替换为自有测试接口；搜索接口约定返回 `{ "items": [{ "id": "1", "title": "示例书", "author": "示例作者" }] }`。

```json
{
  "sourceFormat": "native",
  "version": 1,
  "name": "脚本搜索示例",
  "url": "https://api.example.com",
  "type": "text",
  "js": "function searchBooks(ctx) {\n  const response = http.get('/search?q=' + encodeURIComponent(ctx.key) + '&page=' + ctx.page);\n  if (!response.ok) throw new Error('搜索失败：HTTP ' + response.status + ' ' + response.error);\n  const payload = response.json();\n  if (!Array.isArray(payload.items)) throw new Error('搜索结果缺少 items 数组');\n  log('结果数量', payload.items.length);\n  return payload.items;\n}",
  "scriptLimits": { "requests": 10 },
  "search": {
    "script": "searchBooks",
    "fields": {
      "name": "$.title",
      "author": "$.author",
      "bookUrl": "{{source.url}}/book/{{urlencode($.id)}}"
    }
  },
  "detail": {
    "fields": {
      "name": "$.title",
      "author": "$.author",
      "intro": "$.intro",
      "tocUrl": "$.tocUrl"
    }
  },
  "toc": {
    "list": "$.chapters[*]",
    "fields": { "title": "$.title", "url": "$.url" }
  },
  "content": { "text": "$.text" }
}
```

此例省略了搜索 `list`，返回数组会逐项解析。详情接口返回 `title/author/intro/tocUrl`，目录返回 `chapters` 数组，正文返回 `text`。HTTP 失败不会自动抛异常，所以先检查 `ok`，再调用 `json()`；返回非 JSON 时 `json()` 会抛错。脚本应显式处理业务失败，不能把失败响应当成空搜索结果。

一个按页合并目录的目录脚本：

```json
"js": "function toc(ctx) {\n  const first = http.get('/book/' + ctx.book.vars.bookId + '/toc?page=1').json();\n  let chapters = first.list;\n  const rest = [];\n  for (let p = 2; p <= first.pages; p++) rest.push('/book/' + ctx.book.vars.bookId + '/toc?page=' + p);\n  http.all(rest).forEach(r => { if (r.ok) chapters = chapters.concat(r.json().list); });\n  return chapters.map(c => ({ title: c.name, url: '/chapter/' + c.id, isVip: c.vip == 1 }));\n}",
"toc": { "script": "toc" }
```

返回的每一项按同名键取 `title`、`url`、`isVip`，不用写 `list` 和 `fields`。注意请求数预算：100 页以上的目录要调大 `scriptLimits.requests` 或改用声明式 `nextUrl` 列表写法。

### 状态的作用域

| 需求 | 使用方式 | 生命周期与注意事项 |
| --- | --- | --- |
| 函数中的中间值 | 局部变量 | 本次函数调用 |
| 当前运行器内共享 | `temp.get/set` | 运行器结束即丢失，不保证跨详情、目录和正文操作 |
| 可过期的请求结果 | 脚本 `cache.get/put` | 按书源隔离的内存缓存，默认 600 秒，最长 7 天；应用重启或书源缓存失效后丢失 |
| 声明式预取值 | 顶层 `cache` 字段 | 预先请求并绑定到表达式作用域、脚本 `ctx`；与脚本 `cache` 键空间不同 |
| 用户设置或需保存的值 | `vars.get/set` | 与书源设置共用，宿主持久化；已声明的设置项按文本使用，结构化值建议自行 JSON 编解码 |
| 登录凭据 | `login.save`，读取 `login.token/user` | 与登录表单共用；只传需要保存的令牌和用户标识，不保存密码 |
| 某本书后续章节需要的值 | 详情脚本 `keep`，后续读 `ctx.book.vars` | 随书籍保存；其他阶段不能调用 `keep` |

`ctx.vars`、`ctx.login` 是进入函数时的快照，修改 `ctx` 不等于写回宿主。调用 `vars.set` 或 `login.save` 后要读最新值，应使用 `vars.get` 或全局 `login.token/user`。Cookie 由 `cookie.*` 管理，不要放入全局变量；同一份 JS 代码的会话可能被复用。

### 设置页与登录脚本

| 定义位置 | 参数与返回约定 |
| --- | --- |
| `login.script` | `fn(ctx)` 从 `ctx.form` 取表单，成功后 `login.save(token, user)`，建议显式返回 `{ ok: true, message: "登录成功" }` |
| `login.sendCode.script` | 从 `ctx.form` 取账号等，返回提示字符串或带 `message` 的对象 |
| `actions[].script` | `ctx.action` 是按钮文字，返回字符串或 `{ message }`；可写变量后调用 `ui.refreshExplore()` |
| `vars[].optionsScript` | `ctx.key` 是变量名，返回非空字符串数组；失败或空结果时由设置页回退到静态 `options` |
| `explore.dynamicMenus.script` | `ctx.stage` 是 `menus`，返回分类数组 `[{ title, url }]` 或 `名称::地址` 文本；不发 `url` 请求，不能打开网页 |

这些函数同样写在顶层 `js` 中，通过字段引用函数名，不能在 `script` 字段直接塞一段 JS。设置布局仍由应用绘制，脚本不能新增任意控件。`browser.verify`、`ui.toast`、`ui.refreshExplore` 依赖宿主的 `NativeSourceInteraction` 接入；`browser.render` 依赖网页抓取宿主。轻页已接入，其他宿主需单独确认。

### 原生脚本排错

| 现象 | 检查与处理 |
| --- | --- |
| JSON 无法导入 | 检查 `js` 字符串内的换行、引号、反斜杠转义；不能混用 `@js:` 或 `<js>` |
| 阶段写了 `script`，但书源没有 `js` / 找不到函数 | 添加顶层 `js`，确保指定名称是已定义的顶层函数，且不与内置或 `lib` 函数重名 |
| 表达式里不能发请求或读写状态 | 将需要 `http`、`vars`、`cookie` 等接口的流程移到后台 `script` |
| 当前环境不支持 JS 函数库 / 脚本阶段 | 检查宿主版本、QuickJS 可用性、同步 QuickJS 策略及后台引擎端口；开启兼容迁移模式不能补齐这些端口 |
| `json()` 解析失败 | 先检查响应 `ok/status`，确认返回的是 JSON，排查登录页、验证码页或业务错误 |
| 脚本请求次数 / 计算时间 / 总时长超过上限 | 减少循环和请求，复用缓存；仅请求数可通过 `scriptLimits.requests` 调到最多 100 |
| 目录或正文只返回一页 | 启用 `script` 后 `nextUrl` 不再自动翻页，需脚本自己合并所有页并返回 |
| 搜索或发现提示需要网页验证 | 点“去验证”，完成后重新搜索或刷新发现；脚本请求不会自动识别并弹出验证页，需要显式 `browser.verify` |
| 搜索和发现时不能打开网页 | `browser.open` 只能在详情、目录、正文、按钮、登录里用；搜索和发现里改用 `browser.verify`（会转成「去验证」） |
| 状态偶尔丢失或串用 | 不用 JS 全局变量做持久化；核对 `temp` 生命周期、`cache` 过期及 `ctx` 快照语义 |

调试使用 `log(...)` 记录必要的计数和阶段，不要记录密码、完整令牌、Cookie 或整份表单。报告导出后仍应检查脚本自写日志是否包含敏感内容。

## 综合示例

下面是一份把常用能力放在一起的 JSON 接口书源：服务器地址可改、带频道筛选和固定分类、表单登录换令牌、详情记下书号、目录一次列出全部分页、正文按类型取文字或音频。接口都是虚构的，照着替换路径和字段名即可。

```json
{
  "sourceFormat": "native",
  "version": 1,
  "name": "综合示例",
  "url": "https://api.example.com",
  "group": "示例",
  "type": "text",
  "rate": "10/1000",
  "headers": { "Accept": "application/json" },
  "vars": [
    { "key": "server", "label": "服务器", "default": "https://api.example.com" },
    { "key": "channel", "label": "频道", "options": ["男频", "女频"], "default": "男频", "filter": true }
  ],
  "login": {
    "form": [
      { "key": "user", "label": "账号" },
      { "key": "pass", "label": "密码", "secret": true }
    ],
    "submit": {
      "url": "{{vars.server}}/api/login",
      "body": { "username": "{{form.user}}", "password": "{{md5(form.pass)}}" },
      "ok": "= data.code == 0",
      "token": "= data.data.token",
      "user": "= data.data.nickname",
      "message": "= data.msg"
    }
  },
  "let": {
    "server": "= vars.server",
    "auth": "= login.token ? 'Bearer ' + login.token : ''",
    "gender": "= vars.channel == '女频' ? 2 : 1"
  },
  "search": {
    "url": "{{server}}/api/search?q={{urlencode(key)}}&page={{page}}",
    "headers": { "Authorization": "{{auth}}" },
    "fail": "= data.code != 0 ? data.msg : ''",
    "list": "$.data.list[*]",
    "fields": {
      "name": "$.title",
      "author": "$.author",
      "kind": "= join(compact([$.category, $.finished ? '完结' : '连载']), ',')",
      "coverUrl": "$.cover",
      "intro": "$.summary",
      "wordCount": "= $.words > 10000 ? round($.words / 10000, 1) + '万字' : str($.words) + '字'",
      "lastChapter": "$.lastChapter",
      "updateTime": "= formatDate($.updatedAt)",
      "type": "= $.audio ? 'audio' : 'text'",
      "bookUrl": "{{server}}/api/book/{{$.id}}"
    }
  },
  "explore": {
    "menus": [
      { "title": "榜单" },
      { "title": "热门", "url": "{{server}}/api/rank?type=hot&gender={{gender}}&page={{page}}" },
      { "title": "完结", "url": "{{server}}/api/rank?type=end&gender={{gender}}&page={{page}}" },
      { "title": "我的" },
      { "title": "书架", "url": "{{server}}/api/shelf?page={{page}}", "headers": { "Authorization": "{{auth}}" }, "when": "= login.token" }
    ],
    "list": "$.data.list[*]",
    "fields": {
      "name": "$.title",
      "author": "$.author",
      "coverUrl": "$.cover",
      "intro": "$.summary",
      "bookUrl": "{{server}}/api/book/{{$.id}}"
    }
  },
  "detail": {
    "headers": { "Authorization": "{{auth}}" },
    "fail": "= data.code != 0 ? data.msg : ''",
    "let": { "d": "= data.data" },
    "fields": {
      "name": "= d.title",
      "author": "= d.author",
      "intro": "= stripHtml(d.summary)",
      "coverUrl": "= d.cover",
      "status": "= d.finished ? '完结' : '连载'",
      "lastChapter": "= d.lastChapter",
      "tocUrl": "{{server}}/api/book/{{d.id}}/toc?page=1"
    },
    "keep": { "bookId": "= d.id" }
  },
  "toc": {
    "headers": { "Authorization": "{{auth}}" },
    "list": "$.data.list[*]",
    "fields": {
      "title": "$.title",
      "url": "{{server}}/api/chapter/{{$.id}}",
      "isVip": "= $.vip == 1",
      "tag": "= formatDate($.updatedAt, 'yyyy-MM-dd')"
    },
    "nextUrl": "= map(range(int(data.data.pages) - 1), i => server + '/api/book/' + book.vars.bookId + '/toc?page=' + (i + 2))",
    "batch": 8
  },
  "content": {
    "headers": { "Authorization": "{{auth}}" },
    "fail": "= data.code == 401 ? '本章需要登录后阅读' : (data.code != 0 ? data.msg : '')",
    "let": { "d": "= data.data" },
    "text": "= d.content",
    "audio": "= d.audioUrl",
    "mediaHeaders": { "Referer": "{{server}}/" },
    "replace": [{ "pattern": "（本章完）$" }]
  }
}
```

读这个示例时注意：

- `let.server` 来自变量 `server`，用户在书源设置里换服务器后所有地址跟着变。
- `auth` 依赖登录凭据，没登录时为空串，空的请求头不发送。
- 目录的 `nextUrl` 在第一页上列出剩余全部页，按 `batch` 每批 8 页并发请求；列出的页不再跟随自己的 `nextUrl`。`book.vars.bookId` 来自详情的 `keep`。
- `书架` 分类只在登录后显示，它的 `headers` 只附加在这个分类的请求上。
- `search.fields.type` 逐本声明有声书，正文阶段按类型选 `text` 或 `audio`。

## 导入校验与常见报错

导入、编辑页「校验」和保存时会做整份校验，一次最多列 5 条原因。常见报错：

| 报错 | 原因与处理 |
| --- | --- |
| 不是原生书源：缺少 "sourceFormat": "native" | 顶层没有 `sourceFormat`，或者拼错了 |
| 该原生书源需要更新版本的应用（格式版本 N） | `version` 比应用支持的新，升级应用或改回 `1` |
| 缺少书源名称 name / 书源地址 url 必须以 http:// 或 https:// 开头 | 补上 `name`，`url` 写完整地址 |
| 至少需要 search 或 explore 其中之一 | 两个阶段都没写 |
| search 缺少 url / search 缺少 list / search.fields 缺少 name、bookUrl | 搜索阶段的必填项；脚本阶段可以不写 `url`、`list` |
| explore 需要 menus 或 dynamicMenus | 发现阶段没有任何分类来源 |
| explore.dynamicMenus 需要 url、list、title 和 target，或者写 script | 接口分类四项要写全；脚本分类只写 `script` |
| explore.dynamicMenus 写了 script 就不要写 url | 两种写法只能选一种 |
| explore.menus[N].fields 缺少 name | 这个分类自己写了 `fields`，要写全 `name`、`bookUrl` |
| toc 缺少 list / toc.fields 缺少 title、url | 目录阶段的必填项 |
| content 需要 text、images、audio 或 video 之一 | 正文阶段没有任何取值规则 |
| xxx.batch 必须是 1 到 16 的整数 | `batch` 写了范围外的值或小数 |
| type 只能是 text、audio、comic 或 video | `type` 拼错 |
| vars 里的 key 只能用字母、数字和下划线 / vars 里的 key 重复 | 变量名不合法或重复 |
| 某字段：原生书源不支持脚本，请改用 = 表达式 | 值里有 `@js:`、`js:` 或 `<js>` |
| 某字段：表达式语法错误… | 以 `=` 开头的值或 `{{ }}` 里的表达式写错，信息里有出错位置 |
| xxx.script 必须是 js 里的函数名 / 需要在 js 里定义函数 | 函数名不是合法标识符，或者没有 `js` |
| js 里没有阶段 script 用到的函数 “xxx” | `js` 里没有定义这个函数（导入时载入 `js` 检查） |
| login 需要 url（网页登录）、submit（表单登录）或 script（脚本登录） | `login` 里三种方式一种都没有 |
| login.url 必须是以 http:// 或 https:// 开头的登录页地址 | 网页登录地址要写完整 |
| 表单登录需要 login.form / login.submit 需要 url 和 ok | 表单登录的必填项 |
| actions 的每一项都需要 label，以及 url、open 或 script | 按钮缺少文字或动作 |
| cache.xxx 需要 url 和 value | 复用值缺少请求或取值规则 |
| content.comments 需要 paragraphUrl 或 chapterUrl / 使用 paragraphUrl 时需要 counts | 评论入口的必填项 |
| content.imageDecode … | 见[图片解密](#正文的附加请求与评论)，报错里写明了哪个字段 |
| coverDecode 需要 AES/CBC/PKCS7Padding、16/24/32 字节的 key，以及 iv 或 ivPrefixBytes:16 | 封面解密参数不完整或密钥长度不对 |

运行时出错时，错误信息指出是哪条规则，例如“规则 search.fields.kind 出错：未定义的名称 “x””，调试页里对应的记录也会标出来。常见运行时问题：

| 现象 | 检查与处理 |
| --- | --- |
| 字段取空 | 调试页看这条规则在什么内容上执行。HTML 用了 JSONPath、JSON 用了 CSS、`fields` 里写了从根开始的路径（应写相对当前元素的 `$.x`）都会取空 |
| 列表只有一条或为空 | `list` 应选出“每一项”而不是外层容器，例如 `$.data.list[*]` 而不是 `$.data.list` |
| 地址拼成了 `.../undefined` 或 `null` | 模板里的名称取空了；先在 `let` 里算好再拼，或用 `default()` 给回退值 |
| 未定义的名称 “server” | 示例里的 `server` 需要在 `let` 里定义，见[示例里的约定](#示例里的约定) |
| 请求被拒绝（403 / 401） | 检查 `Referer`、`User-Agent`、`Authorization`；登录后的接口确认已登录、请求头写在顶层或阶段的 `headers` 里 |
| 出现「去验证」 | 主请求拿到了验证页或登录页，完成验证后重试；反复出现时检查是否缺 Cookie 或请求头 |
| 正文乱码 | 响应编码一般自动识别；请求参数需要 GBK 时写 `charset` |
| 目录很慢 | 改用 `nextUrl` 列表写法并调大 `batch`；检查 `rate` 是否设得太严 |

## 字段速查

`*` 表示必填。

| 位置 | 字段 |
| --- | --- |
| 顶层 | `sourceFormat`\*、`version`、`name`\*、`url`\*、`group`、`comment`、`type`、`enabled`、`enabledExplore`、`rate`、`headers`、`coverHeaders`、`coverDecode`、`vars`、`let`、`cache`、`login`、`actions`、`voices`、`lib`、`js`、`scriptLimits`、`search`、`explore`、`detail`、`toc`、`content` |
| 请求（各阶段、`cache`、`fetch`、`check`、`submit`、`actions`、`dynamicMenus`、`links[].request`、`comments.stats`） | `url`、`method`、`headers`、`body`、`webView`（`true` 或 `{ waitFor, timeout }`）、`charset`、`retry` |
| 各阶段通用 | 请求字段、`script`、`let`、`fail`、`list`、`fields` |
| `search` | 通用字段；`url`\*（或 `script`）、`list`\*、`fields.name`\*、`fields.bookUrl`\* |
| `explore` | 通用字段、`menus`、`dynamicMenus`（至少一个） |
| `explore.menus[]` | `title`\*、`url`、`when`、`headers`、`method`、`body`、`list`、`fields` |
| `explore.dynamicMenus` | 请求字段、`list`、`title`、`target`（不写 `script` 时四项必填）、`script` |
| `detail` | 通用字段、`keep`、`fetch` |
| `toc` | 通用字段、`nextUrl`、`batch`、`reverse`；`list`\*、`fields.title`\*、`fields.url`\* |
| 书籍 `fields` | `name`、`author`、`kind`、`intro`、`coverUrl`、`wordCount`、`lastChapter`、`updateTime`、`status`、`bookUrl`、`tocUrl`、`type` |
| 章节 `fields` | `title`、`url`、`isVip`、`isPay`、`isVolume`、`tag` |
| `content` | 通用字段；`text`、`images`、`audio`、`video`（至少一个）、`mediaError`、`mediaHeaders`、`replace`、`nextUrl`、`batch`、`fetch`、`imageDecode`、`links`、`comments` |
| `fetch.名称` | 请求字段、`when` |
| `content.replace[]` | `pattern`\*、`with`、`flags` |
| `content.imageDecode` | `algorithm`\*、`key`\*、`iv`、`keyEncoding`、`ivPrefixBytes`；或 `script`\*、`params`、`processPlainImages` |
| `content.links[]` | `label`\*、`url` 或 `request`\*、`when`、`message` |
| `content.comments` | `when`、`stats`、`counts`、`paragraphUrl`、`chapterUrl`（两个地址至少一个）、`max` |
| `vars[]` | `key`\*、`label`、`options`、`default`、`filter`、`optionsScript` |
| `voices[]` | `id`\*、`name`\* |
| `cache.名称` | 请求字段（`url`\*）、`value`\*、`ttl`、`when` |
| `login` | `url`、`cookies`、`check`、`form`、`submit`、`script`、`sendCode`（`url`、`submit`、`script` 至少一个） |
| `login.form[]` | `key`\*、`label`、`secret` |
| `login.submit` | 请求字段（`url`\*）、`ok`\*、`token`、`user`、`message` |
| `login.check` | 请求字段（`url`\*）、`ok`\*、`name` |
| `login.sendCode` | `label`、请求字段或 `script`、`message` |
| `actions[]` | `label`\*、请求字段、`open`、`script`、`when`、`message` |
| `coverDecode` | `algorithm`\*、`key`\*、`keyEncoding`、`iv`、`ivPrefixBytes` |
| `scriptLimits` | `requests`（1 到 100） |

## 从兼容书源改写

| 兼容书源 | 原生书源 |
| --- | --- |
| `bookSourceUrl`、`bookSourceName`、`bookSourceGroup`、`bookSourceComment` | `url`、`name`、`group`、`comment` |
| `bookSourceType`（0 / 1 / 2） | `type`：`text`、`audio`、`comic` |
| `header` | `headers`（JSON 对象）；`@js:` 动态请求头改成值里的 `=` 表达式或 `{{ }}` 模板，每次请求时求值 |
| `concurrentRate` | `rate` |
| `searchUrl` 里的 `{{key}}`、`{{page}}` | `search.url` 里的 `{{urlencode(key)}}`、`{{page}}`；`key` 是未编码的原文 |
| URL 后的 `,{"method":"POST","body":…}` | 阶段的 `method`、`body`、`headers`、`charset`、`retry`、`webView` |
| `ruleSearch.bookList` 等 | `search.list`、`search.fields.name` 等 |
| `exploreUrl` 的 `名称::地址` | `explore.menus`；需要计算时用 `dynamicMenus.script` 返回同样的文本 |
| `ruleBookInfo.init`、`ruleToc.preUpdateJs` 一类预处理 | 阶段的 `let` |
| `ruleToc.nextTocUrl`、`ruleContent.nextContentUrl` | `toc.nextUrl`、`content.nextUrl` |
| `ruleContent.replaceRegex` | `content.replace` |
| `@put` / `@get` | 详情 `keep` 加 `book.vars.名称`；同一阶段内用 `let` |
| `@js:`、`<js>` 里的拼接、判断 | `=` 表达式 |
| `jsLib` 里的算法函数 | `js`（按名调用）或 `lib` |
| `java.ajax`、`java.post`、多步请求 | 详情 `fetch`、顶层 `cache`，或阶段 `script` 里的 `http.*` |
| `java.md5Encode`、`java.base64Encode`、`java.aesDecode…` | `md5`、`base64`、`decrypt` 等内置函数 |
| `source.getVariable()` / `setVariable()` | `vars` 声明；脚本里 `vars.get` / `vars.set` |
| `loginUrl` 网页登录 | `login.url` |
| `loginUi` + `login()` 脚本 | `login.form` + `login.submit` 或 `login.script` |
| `loginCheckJs` | `login.check` |
| `java.toast`、`java.startBrowserAwait` | 脚本里的 `ui.toast`、`browser.verify` |

改写时先搬“请求 + 列表 + 字段”这些声明式部分，再处理脚本：拼接、判断换成表达式，算法换成内置函数或放进 `js`，多步请求换成 `fetch`、`cache` 或脚本阶段。改完用调试页逐阶段对比两个书源的结果。

## 与兼容书源的差异

| 能力 | 原生书源 | 兼容书源 |
|---|---|---|
| JavaScript | 顶层 `js`：表达式按名调用时只做纯计算，阶段 `script` 可使用受控宿主接口；不写 `@js:`、`<js>` | 任意规则字段都可以写脚本 |
| 选择器（JSONPath、CSS、XPath、正则） | 支持，同一个解析器 | 支持 |
| 条件、拼接、查表、字段整理 | 表达式 | 脚本 |
| 自定义签名、解密算法 | 内置加解密函数，`lib` 里的自定语法，或原样放进 `js` 的 JavaScript | 脚本 |
| 追加请求 | `detail.fetch`、`content.fetch`、`comments.stats`；或在脚本阶段里用 `http.*` | `java.ajax` |
| 发现页分类 | `menus`、`dynamicMenus`（接口或脚本，脚本可返回 `名称::地址` 文本） | `exploreUrl` 文本或脚本 |
| 发现页筛选与变量设置 | `vars` 声明，界面由应用生成 | 脚本生成 |
| 账号登录 | `login` 声明，内置浏览器登录 | 登录面板脚本 |
| 段评、章末评论入口 | `comments` 声明，应用绘制 | 脚本生成 |
| 网页渲染抓取 | 请求上加 `webView`，可等待指定元素出现 | 支持，另可注入 `webJs` |
| 请求编码与重试 | `charset`、`retry` | URL 选项里的同名字段 |
| 验证页、登录拦截页 | 主请求自动提示「去验证」 | 同样支持 |
| 图片、音频的请求头 | `content.mediaHeaders` | 地址后跟选项对象 |
| 跨请求保存的值（令牌等） | `cache` 声明，带有效期；脚本阶段里的 `cache`、`vars`、`temp` | 脚本读写缓存和书源变量 |
| 图片解密 | `content.imageDecode`，标准对称解密或受限字节脚本 | `imageDecode` 脚本 |
| 用账号密码调接口登录 | `login.form` 加 `login.submit` 或 `login.script`，只保存凭据 | 登录面板脚本 |
| 设置页里的操作按钮 | `actions` 声明 | 登录面板里的按钮脚本 |
| 正文里点按钮调接口 | `content.links` 的 `request` | 脚本生成卡片 |
| 调试页执行明细 | 支持，并指出出错的是哪条规则 | 支持 |
| 分卷标题 | `fields.isVolume` | 暂不支持 |
| 视频内容（短剧等） | `type: video` 加 `content.video`，应用自带播放页 | 只能在正文里放链接，跳到网页播放 |
| 听书音色 | `voices` 声明列表，听书页点选 | 手动填写音色代码 |
| 正文里打开网页（如视频播放页） | `content.links` | 脚本生成卡片 |
| 脚本按需发请求、读写变量与 Cookie | 脚本阶段 `script`，同步写法，不需要重放 | 支持（`java.ajax` 等，经 ArkWeb 推测执行和重放） |
| 脚本弹出提示、刷新发现页、打开验证页 | `ui.toast`、`ui.refreshExplore`、`browser.verify/open`，设置页按钮和登录可以运行脚本 | 支持 |
| 脚本生成任意布局的设置面板 | 不支持：变量（可以由脚本给出选项）、按钮、登录表单由应用绘制 | `loginUi` |
| 脚本刷新目录、正文 | 暂不支持 | `refreshToc`、`refreshContent` |
| 向网页注入脚本 | 后台阶段 `browser.render(url, { js })` 可在页面中求值；声明式 `webView` 不提供此字段 | `webJs` |
| 付费购买章节 | 不支持 | 不支持 |

一条书源只能是一种格式。原生书源算法和流程函数写在顶层 `js`；表达式调用只做纯计算，需要请求和状态时由阶段、登录或动作的 `script` 调用。仅 `browser.render` 的 `js` 选项在网页自己的上下文求值，不能在其中使用原生脚本的 `http`、`vars` 等对象。

## 已知限制

- 编辑页是 JSON 文本编辑，没有按字段拆开的表单。
- 脚本 `http.*` 的结果里没有响应头；需要 Cookie 时用 `cookie.get` 读取自动保存的值。
- 调试页的执行明细里，列表中只记录第一个元素的各字段结果，其余元素不逐条记录。
- 声明式 `webView` 可等待指定元素，但没有脚本注入字段；后台脚本需要在网页求值时使用 `browser.render` 的 `js` 选项，等待时间受请求与脚本预算限制。
- 表单登录后的列表角标：只声明了表单登录、没有网页登录地址的书源，书源列表上不显示“已登录 / 未登录”标记，登录状态要进「书源设置」看。
- 正文图片解密的标准算法整章共用一组密钥（`ivPrefixBytes` 时每张图各自取 IV）；封面另使用顶层 `coverDecode`，当前只支持 AES-CBC。
- 段评和正文链接按钮只对文本正文生效。
- 正文分页连第一页在内最多 200 页、拼接后最多 8 MB。逐页跟随时每页都要等上一页返回，几十页的长章节很慢，能算出总页数的站点请用列表写法。
- 播放页播放的是书源给出的视频流地址，没有弹幕、清晰度切换和手势调节亮度音量。
- 脚本还不能刷新已打开的目录和正文，也不能画任意布局的设置面板（设置页由变量、按钮、登录表单组成）。
- 脚本阶段只有详情阶段能写书籍变量（`keep`），其他阶段只能读。

## 实现与验证

- 表达式引擎：`sourceengine/src/main/ets/core/nativesource/NativeExpr.ts`
- JS 函数库：`NativeJsLibrary.ts`（QuickJS 执行与缓存）、`NativeJsPrelude.ts`（`native` 对象与调用约定，Node 回归共用）
- 脚本阶段：`NativeScriptHost.ts`（宿主接口的分发与预算）、`NativeScriptSessions.ts`（后台 QuickJS 会话池）；线程模型在 `quickjs/src/main/cpp/script_session.cpp`
- 定义的解析、校验与存储：`NativeSourceSpec.ts`、`NativeSourceImport.ts`
- 阶段执行器：`NativeSourceRunner.ts`
- 接入请求层与数据模型：`NativeSourceService.ts`（请求经 `core/rule/AnalyzeUrl.ts`，选择器经 `core/rule/AnalyzeRule.ts`）
- 加解密的系统实现：`NativeSourceCrypto.ts`
- 编辑页与设置页：`entry/src/main/ets/pages/NativeSourceEdit.ets`、`NativeSourceSettings.ets`
- 调试页：`entry/src/main/ets/pages/BookSourceDebug.ets`
- 视频播放页：`entry/src/main/ets/pages/VideoPlayer.ets`，入口封装在 `utils/VideoBookPlayer.ets`
- 分流点：`core/book/WebBookService.ts`（详情、目录、正文）、`SearchCoordinator.ts`（搜索）、`ExploreCoordinator.ts`（发现分类、列表、筛选）。原生书源在这些入口处被分流，不进入兼容书源的任何脚本引擎

原生书源不新增数据库列：完整定义以 JSON 存在书源记录的 `jsLib` 字段里，并以 `"nativeSource"` 键开头作为标记，因此备份、云同步和导入导出沿用现有通道。应用里有些地方按兼容书源的规则字段判断“能否搜索、有没有发现”，读取原生书源时会给这些字段补上占位值 `native`，它们不会被当成规则执行。

分卷同样不改数据库：卷名记在该卷第一章的附加信息里，不占章节位置，章节序号和阅读进度不受影响。

回归脚本（不需要设备）：

```bash
node --experimental-strip-types scripts/native-source-check.mjs
node --experimental-strip-types scripts/native-js-check.mjs
node --experimental-strip-types scripts/native-script-check.mjs
node --experimental-strip-types scripts/source-cover-check.mjs
```

Node 回归的宿主只支持 JSONPath，不验证 CSS/XPath、真机 QuickJS、系统网页控件或实际站点登录；这些要在应用里用调试页验证。

本文最初迁自轻页 `a7e6c2f94fa0db1b325bc8564e5baa4c177e0939` 的 `docs/book-source-development.md`，保留历史章节锚点，遵循项目 GPL-3.0 许可。

---

# 第二部分：兼容书源（已过时）

> [!WARNING]
> 兼容书源格式已过时。应用仍然可以导入和运行这类书源，现有书源不受影响；但新书源请按[第一部分](#第一部分原生书源)写成原生书源。
> 视频播放页、听书音色列表、分卷标题等能力目前只有原生书源支持，见[与兼容书源的差异](#与兼容书源的差异)。
> 本部分作为存量书源的维护参考保留，描述的仍是当前代码的实际行为。

兼容书源沿用 Android「阅读」（Legado）的书源 JSON 格式，规则里可以使用 JavaScript。

文档中的能力状态按以下口径描述：

- **已支持/已使用**：当前通用执行链已经读取并产生实际行为。
- **可导入/可编辑**：字段能保存和导出，但不代表通用执行链会消费。
- **部分兼容**：仅覆盖文中列出的语法、阶段或受控桥接，不应推断为完整 Android、Java、WebView 或浏览器环境。

当前规则执行由几类职责不同的组件共同完成：

| 组件 | 当前状态 | 负责范围 |
| --- | --- | --- |
| 原生选择器与规则解析器 | 正式执行 | JSONPath、CSS、基础 XPath、模板、正则、URL 和字段提取。 |
| 轻量 JavaScript 兼容引擎 | 正式执行且结果有效 | 常见表达式、Android/Java 别名及已映射的 `java/source/book/cache/cookie` 主机函数。 |
| 分阶段 ArkWeb | 按能力路由正式执行 | 搜索、发现、详情、目录、正文和登录中的复杂 ECMAScript，以及受控异步主机桥。 |
| 隐藏 ArkWeb 请求传输 | 仅在 URL 显式配置时执行 | `webView: true` 的 HTTP(S) GET/POST 页面加载、DOM 返回及 `webJs`（含返回 Promise 的异步脚本）。 |
| 原生 QuickJS | 默认 `SHADOW`，支持灰度 | 启动自检后持久化比对无副作用短纯表达式；合格指纹可灰度接管，异常自动回退和熔断。 |

因此，“已经接入 QuickJS”不表示所有书源 JavaScript 都由 QuickJS 执行，也不表示选择器或 WebView 规则需要改写成 JavaScript。网络、Cookie、持久化、DOM 和应用对象仍必须经过对应的受控主机桥。

## 快速入门

### 书源与执行模型

书源是一份 JSON 配置。它告诉应用：

1. 去哪里搜索书籍；
2. 如何从搜索或发现响应中找出每一本书；
3. 如何打开详情页并提取书籍信息和目录地址；
4. 如何从目录响应中提取章节；
5. 如何请求章节并提取、净化正文。

一条书源的典型数据流如下：

```text
搜索地址 / 发现地址
  -> HTTP 响应
  -> bookList 选出“书籍元素”
  -> 在每个元素内解析 name / author / bookUrl 等
  -> 请求 bookUrl
  -> init 可选地缩小详情解析范围
  -> 解析详情字段和 tocUrl
  -> 请求 tocUrl
  -> chapterList 选出“章节元素”
  -> 在每个元素内解析 chapterName / chapterUrl
  -> 请求 chapterUrl
  -> content / images 提取正文、漫画图片或音频地址
  -> replaceRegex 净化
  -> 交互后处理（可选：段评、本章说、图片、视频/媒体动作）
  -> 文本阅读 / 漫画阅读 / 有声书播放
```

书源可以使用 `data:`/Base64 地址承载文本或显式请求元数据。应用只解码书源给出的值，或执行其中明确声明的 HTTP(S) 请求；不会选择镜像、补造第三方接口或执行站点专用解密。普通 HTTP/HTML/JSON 书源沿用同一通用解析路径。

这里最重要的概念是“当前元素”：

- `bookList`、`chapterList` 在完整响应上运行，返回多个元素；
- 书名、作者、章节名等子规则分别在单个元素上运行；
- JSON、HTML 元素、正则捕获组和 JavaScript 对象会以带类型的中间值进入字段规则，直到公开字符串结果边界才转换；HTML 元素保留完整外层 HTML，JSON/JS 对象进入脚本时保持对象结构；
- 所以子规则通常从 `$.字段` 或元素内部的 CSS 选择器开始，而不必重复列表的完整路径。

### 最小可用书源

下面是一个 JSON API 书源骨架。实际开发时优先从这种小配置开始，先跑通“搜索 → 详情 → 目录 → 正文”，再补发现和可选字段。

```json
[
  {
    "bookSourceName": "示例小说",
    "bookSourceGroup": "API",
    "bookSourceUrl": "https://api.example.com",
    "enabled": true,
    "enabledExplore": true,
    "header": "{\"User-Agent\":\"Mozilla/5.0\"}",
    "searchUrl": "/search?keyword={{key}}&page={{page}}",
    "exploreUrl": "热门::/books/hot?page={{page}}",
    "ruleSearch": {
      "bookList": "$.data.books[*]",
      "name": "$.title",
      "author": "$.author",
      "coverUrl": "$.cover",
      "intro": "$.intro",
      "kind": "$.category",
      "lastChapter": "$.lastChapter",
      "bookUrl": "/book/{{$.id}}",
      "wordCount": "$.wordCount",
      "status": "$.status",
      "updateTime": "$.updateTime"
    },
    "ruleExplore": {
      "bookList": "$.data.books[*]",
      "name": "$.title",
      "author": "$.author",
      "coverUrl": "$.cover",
      "intro": "$.intro",
      "kind": "$.category",
      "lastChapter": "$.lastChapter",
      "bookUrl": "/book/{{$.id}}",
      "wordCount": "$.wordCount",
      "status": "$.status",
      "updateTime": "$.updateTime"
    },
    "ruleBookInfo": {
      "init": "$.data",
      "name": "$.title",
      "author": "$.author",
      "coverUrl": "$.cover",
      "intro": "$.intro",
      "kind": "$.category",
      "status": "$.status",
      "lastChapter": "$.lastChapter",
      "wordCount": "$.wordCount",
      "updateTime": "$.updateTime",
      "tocUrl": "/book/{{$.id}}/chapters"
    },
    "ruleToc": {
      "chapterList": "$.data.chapters[*]",
      "chapterName": "$.title",
      "chapterUrl": "/chapter/{{$.id}}",
      "isVip": "$.isVip",
      "isPay": "$.isPay",
      "updateTime": "$.updateTime"
    },
    "ruleContent": {
      "content": "$.data.content",
      "replaceRegex": "本章未完，请点击下一页继续阅读"
    }
  }
]
```

搜索阶段目前固定使用第 1 页，因此 `{{page}}` 在搜索地址中为 `1`；发现页会传入实际页码。

## 数据格式与请求

### 导入格式与持久化

应用支持四种常见导入外壳：

```json
[{ "bookSourceUrl": "...", "bookSourceName": "..." }]
```

```json
{ "value": [{ "bookSourceUrl": "...", "bookSourceName": "..." }] }
```

```json
{ "bookSourceUrl": "...", "bookSourceName": "..." }
```

以及剪贴板或分享文本中的 HTTP/HTTPS 导入地址。URL 导入不是简单调用一次下载接口，而是按顺序尝试：

1. 应用 HTTP 客户端（含 HTTPS 候选和响应大小限制）；
2. 明文 HTTP 的受控 TCP 兜底；
3. ArkWeb 下载回调；
4. HarmonyOS 系统下载服务。

每一层都会先校验响应确实是 JSON 对象或数组，错误信息会尽量保留 HTTP、网络或下载服务原因，而不是显示 `[object Object]`。

只有同时具有 `bookSourceUrl` 和 `bookSourceName` 的项目才会被写入数据库。`bookSourceUrl` 也是书源的唯一身份标识；修改它通常会被视为另一个书源。导入后会重新读取数据库并核对原始 JSON、脚本库、登录配置、各规则组和运行字段，避免“提示成功但复杂字段被截断或漏存”。

应用同时保存导入对象的完整 `rawSourceJson`。已识别字段进入结构化数据库列；尚未映射的未来字段仍保留在原始对象中，导出时再与当前结构化值合并。因此“完整保存”不等于“所有未知字段都已具备执行语义”。

#### 多书源导入选择

当文件或 URL 返回 JSON 数组、`{"value":[...]}` 等包含多个有效书源的内容时，解析完成后会打开书源选择面板，不会直接把全部项目写入数据库。面板默认全部勾选，可逐项取消或通过“全选/取消全选”批量操作；点击“导入所选”后才执行写入，点击“取消”则放弃本次导入。只有一个有效书源时仍直接导入。

选择状态以 `bookSourceUrl`（书源唯一身份）为键；同一地址的重复项目会视为同一书源。导入结果中的成功、失败、锁定和需登录数量只统计最终选中的项目。

#### 规则组键名与紧凑格式

规则组导出时会先保留原始规则对象中的未知键，再覆盖当前结构化字段，减少编辑后扩展规则丢失。

规则组推荐使用 Android 阅读常见的导出键名：

- `ruleSearch`
- `ruleExplore`
- `ruleBookInfo`
- `ruleToc`
- `ruleContent`

导入器也接受本项目内部键名 `searchRule`、`exploreRule`、`bookInfoRule`、`tocRule`、`contentRule`。规则组既可为对象，也可为紧凑字符串；为便于审阅、转义和版本管理，推荐使用对象。

紧凑字符串示例：

```text
@{bookList=$.data;name=$.title;author=$.author;bookUrl=/book/{{$.id}}}
```

字段以顶层分号分隔，字段名和值以第一个 `=` 分隔。复杂 JS、正则或包含分号的值更容易产生歧义，不建议新书源使用此格式。

### 顶层字段

| JSON 字段 | 编辑器名称 | 类型/默认值 | 当前作用 |
| --- | --- | --- | --- |
| `bookSourceName` | 书源名称 | 字符串，必填 | UI 展示名称。 |
| `bookSourceUrl` | 书源地址 | 字符串，必填 | 书源唯一键，也是相对请求地址的基础地址。建议写协议和主机，不带末尾业务路径。 |
| `bookSourceType` | 书源类型 | 数字，默认 `0` | `0` 普通书，`1` 有声书，`2` 漫画，`3` 文本/Web 文件；还会结合书籍 `type`、标签和编码协议推断。 |
| `bookSourceGroup` | 书源分组 | 字符串 | 搜索筛选和管理分组。 |
| `bookSourceComment` | 书源备注 | 字符串 | 管理页说明，也会注入规则上下文。 |
| `loginUrl` | 登录地址 | 字符串 | 网页登录/验证入口。检测到登录或验证页时可打开该地址并同步 Cookie。 |
| `loginUi` | 登录界面 | JSON 字符串或动态 JS | 管理页可渲染文本、密码、开关、选择项和按钮；控件值、开关状态与按钮状态可持久化。 |
| `loginCheckJs` | 登录检测JS | 字符串 | 可导入、编辑、保存和导出，并参与“该源是否需要登录”的识别；脚本本身当前不会被执行，登录结果不会据此判定，搜索、详情、目录和正文请求后也没有对应的响应检查。 |
| `loginHeader` | 登录密钥 | 字符串 | 可用于特定登录源；通用请求头仍应写在 `header`。 |
| `loginInfo` | 登录运行信息 | JSON 字符串 | 保存登录控件值及受控运行状态。导出公共书源时不应携带账号、Token 或 Cookie。 |
| `bookUrlPattern` | URL正则 | 字符串 | 保存和导入支持，用于描述书籍 URL；当前主解析链不依赖它。 |
| `searchUrl` | 搜索地址 | 字符串 | 搜索请求模板。 |
| `exploreUrl` | 发现地址 | 字符串 | 发现分类及请求模板。 |
| `jsLib` | JS库 | 字符串 | 搜索、发现、详情、目录、正文和登录动作共用。简单代码走轻量引擎，复杂语义可按阶段路由到 ArkWeb，但只开放受控主机能力。 |
| `header` | 请求头 | 字符串 | 书源全局 HTTP 请求头。支持 JSON/宽松对象或每行一个 `名称: 值`；以 `@js:`/`js:` 开头时按脚本动态计算请求头对象，详见[动态 `@js:` 请求头](#动态-js-请求头)。 |
| `variableComment` | 暂无编辑项 | 字符串 | 书源变量的说明文本。 |
| `variable` | 书源变量 | 字符串 | 作为 `source.variable` 注入上下文并独立持久化，登录按钮可通过 `source.setVariable()` 修改。 |
| `enabledCookieJar` | 启用 Cookie | 布尔，默认 `true` | 导入并保存 Cookie 偏好；登录 Cookie 仍按实际请求域名隔离和附加。 |
| `enabled` | 启用书源 | 布尔，默认 `true` | 是否参与搜索和书源选择。 |
| `enabledExplore` | 启用发现 | 布尔，默认 `true` | 是否显示此源的发现入口。 |
| `weight` | 权重 | 数字，默认 `0` | 搜索相关度相同时，权重较大者优先。 |
| `customOrder` | 暂无编辑项 | 数字 | 可导入、保存和导出，并作为结果排序的次级依据。 |
| `lastUpdateTime` | 暂无编辑项 | 数字 | 可导入、保存和导出；缺失时使用导入时间。 |
| `respondTime` | 暂无编辑项 | 数字，默认 `180000` | 可导入、保存和导出，作为书源响应时间/超时相关运行字段。 |
| `concurrentRate` | 暂无编辑项 | 字符串 | 导入并保存。两种写法：`次数/毫秒窗口`，例如 `20/60000` 表示每 60 秒最多 20 次；纯数字是请求间隔毫秒数，例如 `1000` 表示两次请求至少相隔 1 秒。留空、`0` 或无法识别的值不限流。普通 HTTP 请求、重试和重定向都会按书源限流。搜索时单个请求在限流队列里最多等 60 秒，超时按“书源限流”报告并让出并发槽；取消搜索或开始新一轮搜索后，仍在排队的请求立即退出。阅读、目录、缓存等其他场景的限流等待不设这个上限。 |
| `isPinned` / `isLocked` | 置顶/锁定 | 布尔 | 可导入并持久化；锁定源不会被同地址导入直接覆盖。 |
| `customButton` / `eventListener` | 扩展标记 | 布尔 | 可导入、保存和导出；目前主要用于保留 Android 阅读书源元数据。 |

原始 JSON 中的其他未知字段会被保留，但只有进入模型、规则组或专用兼容层的字段才会影响执行。

### URL 与 HTTP 请求

#### 相对地址

请求地址可以是：

- 完整地址：`https://api.example.com/search`；
- 协议相对地址：`//cdn.example.com/cover.jpg`，解析为 HTTPS；
- 根相对地址：`/search`，拼到 `bookSourceUrl` 的主机；
- 普通相对地址：`search`，拼到基础地址后；
- 查询相对地址：`?name=book&page=1`，保留当前文档路径，只替换查询字符串；
- 片段相对地址：`#chapter-1`，保留当前文档 URL，只替换片段；
- `data:` URL，支持普通百分号编码和 Base64 内容。

列表中提取的详情地址、封面地址和章节地址也会按响应最终 URL 解析相对路径。HTTP 3xx 最多跟随 3 次；301、302、303 对非 GET/HEAD 请求会切换为 GET。

例如当前响应 URL 为 `https://example.com/read.php?name=old&page=1`，目录链接为 `?name=new&page=1`，最终地址应为 `https://example.com/read.php?name=new&page=1`，不能把路径退回站点根目录而丢掉 `read.php`。书源规则不需要手工补路径。

章节、正文和封面地址不会被应用统一自动套用 `encodeURI`。只有规则显式调用 `encodeURI`、`encodeURIComponent`、`java.urlEncode` 或 `java.encodeURI` 时才会编码。`encodeURI` 适合保留 URL 分隔符的完整地址；`encodeURIComponent` 只应编码单个参数值，不能对完整 URL 使用，否则会破坏 `https://`、`/`、`?`、`&` 和 `=`。

为了避免不同阶段对“普通相对路径”的基准处理差异，书源地址建议只写站点根地址，业务请求和规则生成的 URL 优先写 `/` 开头的根相对地址；尤其是详情规则的 `tocUrl`，不要依赖 `chapters/list` 这类无前导斜杠的路径。

#### 搜索变量

搜索地址可使用：

| 模板 | 值 |
| --- | --- |
| `{{key}}` | `encodeURIComponent` 编码后的关键字。 |
| `{{searchKey}}` | 同 `key`。 |
| `{{keyword}}` | 同 `key`。 |
| `{{searchKeyRaw}}` | 未编码的原始关键字。最终 URL 参数仍会按请求字符集编码。 |
| `{{page}}` | 当前实现为 `1`。 |
| `{{source.bookSourceUrl}}` | 当前书源地址。 |
| `{{source.bookSourceName}}` | 当前书源名称。 |
| `{{source.bookSourceGroup}}` | 当前书源分组。 |

示例：

```text
/search?q={{key}}&page={{page}}
/search.asp?word={{searchKeyRaw}},{"charset":"gb2312"}
```

避免对 `{{key}}` 再手工 URL 编码，否则可能双重编码。目标站要求 GBK/GB2312 时，使用 `searchKeyRaw` 配合 `charset`。

搜索地址也可以是 `@js:`/`<js>` 脚本，返回最终请求地址；此时返回值中的 `{{key}}`、`{{page-1}}` 等模板仍会按上面同一组变量再做一次替换，不会把字面花括号原样发给站点。

#### 发现变量与分类格式

发现页支持 `{{page}}` 和 `{{pageIndex}}`。最稳定的配置是一行一个分类：

```text
热门::/rank/hot?page={{page}}
完结::/rank/finished?page={{page}}
```

也支持 JSON 数组：

```json
[
  { "title": "排行榜", "url": "" },
  { "title": "热门", "url": "/rank/hot?page={{page}}" },
  { "title": "完结", "url": "/rank/finished?page={{page}}" }
]
```

数组中没有 `url` 的条目会成为后续条目的分组标题。指向“我的书架”、用户页或登录页的个人入口会被过滤。

这类分组会按两级结构显示：无 URL 的标题作为一级“源站/平台”，其后的有 URL 条目作为该站点内的二级分类。一级标题发生变化后，后续分类归入新的分组。例如：

```json
[
  { "title": "示例源站 A", "url": "" },
  { "title": "热门", "url": "/a/hot?page={{page}}" },
  { "title": "完结", "url": "/a/finished?page={{page}}" },
  { "title": "示例源站 B", "url": "" },
  { "title": "新书", "url": "/b/new?page={{page}}" }
]
```

动态发现脚本返回的 `select` 控件也可映射为原生筛选。控件只需具有非空标题，候选值来自 `chars`。支持两种动作写法：动作形如 `show(值, '变量名')` 时，选择后写入书源变量并重新执行该源的发现规则；动作是自带脚本时，应用会先把所选值写入 `infoMap[控件名]`，再原样执行该脚本（通常配合 `source.setVariable()` 持久化），脚本中的 toast 会作为提示显示。复杂脚本仍需逐源验证，不应只依赖标题推断。

#### 页码候选写法

搜索地址和发现地址支持 Android 阅读的页码候选写法：尖括号内用逗号分隔若干候选，第 N 页取第 N 个，页码超过候选数后一直沿用最后一个。

```text
/yanqing/<,index_{{page}}.html>
/top/<index,index_2,index_3>.html
/list?<offset=0,offset={{(page-1)*20}}>
```

| 地址 | 第 1 页 | 第 2 页 | 第 3 页及以后 |
| --- | --- | --- | --- |
| `/yanqing/<,index_{{page}}.html>` | `/yanqing/` | `/yanqing/index_2.html` | `/yanqing/index_3.html`… |
| `/top/<index,index_2,index_3>.html` | `/top/index.html` | `/top/index_2.html` | `/top/index_3.html`（之后不变） |

- 候选可以为空，也可以包含 `{{page}}` 一类模板；模板内部的逗号和括号不会拆分候选。
- 候选两端的空白会被去掉。一个地址里可以有多组候选，各自独立取值。
- 搜索固定请求第 1 页，因此搜索地址总是取第一个候选。
- 候选在地址脚本和 `{{…}}` 求值之后解析。地址本身是 `@js:`/`<js>` 脚本时，源码里只有提到 `{{page}}`/`{{pageIndex}}` 的分组会被提前改写，脚本返回的地址则按完整规则处理。
- 分组在模板之外含有圆括号、引号或换行时不视为页码候选，保持原样。

#### URL 选项对象

在 URL 后追加逗号和对象可配置请求：

```text
/api/search,{"method":"POST","body":"keyword={{searchKeyRaw}}&page={{page}}","charset":"utf-8","headers":{"Referer":"https://example.com/"},"retry":1}
```

支持的选项：

| 选项 | 说明 |
| --- | --- |
| `method` | HTTP 方法，默认 `GET`。 |
| `body` | 字符串或对象；对象会 JSON 序列化。 |
| `charset` | URL 查询和表单编码字符集，如 `utf-8`、`gbk`、`gb2312`、`gb18030`、`escape`。 |
| `headers` | 本次请求头；同名项覆盖书源全局请求头。 |
| `retry` | 响应不可用时的额外重试次数。 |
| `type` | 声明负载类型。章节地址为 `data:` 且尾部选项声明了 `type` 时，正文阶段会把解码后的字节以十六进制文本提供给规则脚本，对齐 Android 阅读的字节串约定（脚本内通常用 `java.hexDecodeToString` 还原）。 |
| `webView` | 为 `true` 时，HTTP(S) GET/POST 请求交给隐藏 ArkWeb，沿用书源 URL、Cookie 与 UA（GET 也传入可用的额外 Header），等待页面脚本渲染稳定后返回 DOM。 |
| `webJs` | 与 `webView: true` 配合，在已加载页面上下文执行；有效返回值作为响应正文，否则使用页面 DOM。脚本的结果是 Promise 时会等待其兑现，见下文。 |
| `rawBody` | 为 `true` 时请求体不做表单编码，按 `charset` 原样转成字节发送；用于书源已自行编码或拼好的请求体。 |
| `bodyJs` | 对本次响应正文做转换的脚本，输入是响应文本，返回值替换响应正文后再进入列表规则。目前只有发现列表请求会执行；搜索、详情、目录和正文请求中写了不会生效。 |
| `session` | 可选的通用会话规则；仅操作当前请求目标的 Cookie，并可在未声明 Referer 时按规则补充。详见下文。 |

选项对象支持单引号、无引号键和尾逗号等宽松写法，但推荐使用标准 JSON，减少转义差异。

##### `webView` 请求的执行方式

`webView` 请求在同一个隐藏 ArkWeb 中串行执行，默认约 20 秒超时（实现会把单次超时限制在 3～60 秒），最多排队 32 个任务。页面需达到 `document.readyState === 'complete'` 且 DOM 连续稳定后才返回。隐藏 ArkWeb 必须已随当前应用页面挂载；若提示“抓取环境未挂载”，重新进入搜索、发现或相关页面后重试。预览器或缺少 Web 能力的环境下，应用不会挂载隐藏 ArkWeb 宿主，`webView` 请求和依赖 ArkWeb 的阶段脚本在这类环境中不可用。

页面宿主切换时，尚未完成的请求会迁移到新宿主继续执行，并忽略新宿主首次 `about:blank` 回调；请求超时后仍需按普通失败流程重试。

该选项只负责执行书源明确给出的页面请求，不会自动点击验证码、替用户选择不受信任证书、伪造浏览器指纹或保证通过所有反自动化挑战。需要用户交互的登录/验证仍应使用验证页或 `startBrowserAwait`，并遵守目标服务的授权与访问规则。

##### `webJs` 返回 Promise

`webJs` 最后一个表达式的值如果是 Promise（`async` 函数调用、`fetch(...).then(...)` 链等），应用会等它兑现，再把兑现值作为响应正文。页面自己已经带好 Cookie、请求头或请求参数的接口，可以直接在页面上下文里请求，书源不必重新实现这些参数的生成逻辑：

```text
/book/{{$.id}}, {"webView":true,"webJs":"fetch('/api/chapter'+location.search,{credentials:'include'}).then(function(r){return r.text()})"}
```

- 脚本在已加载页面内运行，网络请求受浏览器同源策略和目标站点 CORS 约束；跨域接口需要目标站点允许，或把 `webView` 请求的地址直接指向接口所在站点的页面。
- 兑现值建议是字符串；对象请先 `JSON.stringify`。兑现为空值、`undefined` 或 `null` 时回退为页面 DOM。
- Promise 被拒绝时本次请求失败，错误提示为“webJs 执行失败: 原因”。一直不兑现的 Promise 由 `webView` 请求的整体超时（默认约 20 秒）结束。
- 等待期间页面发生跳转时，脚本会在新页面稳定后重新执行一次。
- 同步的 `webJs` 行为不变。页面的内容安全策略禁止 `eval` 时，脚本按原样执行且不等待 Promise，这类页面只能使用同步脚本。

##### POST 简写

POST 还有一种简写：地址以 `@` 开头，`?` 后内容作为 body。

```text
@/api/search?keyword={{searchKeyRaw}}&page={{page}}
```

表单 body 会编码为空格使用 `+` 的形式。未显式提供 `Content-Type` 时：JSON 对象 body 使用 `application/json; charset=utf-8`，其他 body 使用 `application/x-www-form-urlencoded`。

#### 请求头

推荐 JSON：

```json
{
  "User-Agent": "Mozilla/5.0",
  "Accept": "application/json",
  "Referer": "https://example.com/"
}
```

也支持逐行格式：

```text
User-Agent: Mozilla/5.0
Accept: application/json
```

URL 内还支持：

```text
/path@Header:{"Referer":"https://example.com/"}@End
```

普通请求头的合并顺序是“书源全局请求头 → 本次请求头”，因此本次请求头优先。若未显式设置 Cookie，应用会按请求地址从登录/验证 Cookie 存储中补充。配置 `session` 后，Cookie 的最终优先级见[通用会话选项 `session`](#通用会话选项-session)；已有 Referer 始终优先于 `session.referer`。

##### 动态 `@js:` 请求头

书源 `header` 以 `@js:`/`js:` 开头时视为动态请求头规则：脚本在受控分阶段运行时中执行（按 URL 阶段预算限制），返回 JSON 对象或 JSON 编码的对象字符串，例如 `"@js:'{\"Referer\": baseUrl + \'/\', \"Cookie\": source.getVariable()}'"`。

- 脚本可以读取书源变量、登录状态并调用 `jsLib` 函数。
- 结果按“书源地址 + 书源变量”缓存约 5 分钟，变量变化后自动重算。
- 返回对象里可以带保留项 `"@cache"` 调整缓存：`false` 或 `0` 表示不缓存，每次请求前重新执行脚本；正数表示缓存秒数，最长仍为 5 分钟。该项只是指令，不会作为请求头发出。时间戳、随机串这类每次请求都要变化的值需要关闭缓存，例如 `"@js:JSON.stringify({\"X-Time\": String(Date.now()), \"@cache\": false})"`。
- 关闭缓存后，每个请求都会多执行一次分阶段脚本，只在确实需要时使用。脚本拿不到本次请求的地址和请求体；依赖具体地址或请求体计算的值，应在生成该地址的规则里计算，并写进 URL 选项的 `headers`。
- 动态结果与登录密钥一样只在书源自己的主机（`bookSourceUrl`、`loginUrl` 及同主机地址）上发送，不会附加到第三方图片或内容主机。
- URL 选项中的显式 `headers` 仍覆盖同名项；运行时不可用时回退为静态字面量解析。

#### 通用会话选项 `session`

需要匿名会话、查询令牌与 Cookie 对照校验的接口，可在 URL 选项中显式声明 `session`。请求层不识别站点名称，也不会为任何平台内置 Cookie 名称或接口路径。

```text
/api/list?csrfToken={{csrf}},
{"session":{"queryCookies":["csrfToken"],"generatedCookies":{"visitorId":"@uuid"},"referer":"origin"}}
```

完整结构如下，所有字段均可省略：

```json
{
  "session": {
    "queryCookies": {
      "cookieToken": "queryToken"
    },
    "generatedCookies": {
      "visitorId": "@timestamp_random"
    },
    "referer": "origin"
  }
}
```

支持字段：

| 字段 | 说明 |
| --- | --- |
| `queryCookies` | 字符串、字符串数组，或 `{ "Cookie名": "查询参数名" }` 映射。读取本次 URL 的非空查询值并同步到当前目标域 Cookie；数组形式表示二者同名。 |
| `generatedCookies` | `{ "Cookie名": "生成规则" }`。仅在当前目标域和显式 Cookie 请求头都缺少该 Cookie 时生成，并按一年有效期写入；支持 `@uuid`、`@timestamp_random`、`@random`，也可直接填写书源产生的值。 |
| `referer` | `origin` 表示当前目标源，`request` 表示完整请求地址，也可填写书源明确给出的地址；已有 Referer 不会被覆盖。 |

`queryCookies` 的映射方向固定为“Cookie 名 → URL 查询参数名”。例如：

```json
{
  "session": {
    "queryCookies": {
      "csrfCookie": "csrfQuery"
    }
  }
}
```

当请求地址包含 `?csrfQuery=abc` 时，本次请求会携带 `csrfCookie=abc`，同时写入当前目标域的 Cookie 容器。同名场景可简写为字符串或数组：

```json
{"session":{"queryCookies":"csrfToken"}}
```

```json
{"session":{"queryCookies":["csrfToken","requestToken"]}}
```

Cookie 合并顺序为：当前目标域 Cookie 容器 → 书源/本次请求显式 Cookie → `queryCookies` 对应的查询值；`generatedCookies` 只补缺失项，不覆盖以上任何值。Cookie 名只接受字母、数字、下划线、点和连字符，查询参数不存在或值为空时不会写入。

`session` 是显式会话操作：即使书源关闭了普通 Cookie Jar，只要本次 URL 仍声明 `session`，声明的会话规则就会执行。若请求必须完全无 Cookie，不要配置 `session`，也不要在请求头中声明 Cookie。

会话规则只对声明它的这次请求生效，Cookie 读取和写入均以请求 URL 为作用域，不会从其他域复制；发生跨主机重定向时，Cookie、Authorization、Proxy-Authorization、Host、Origin 和 Referer 等目标相关请求头会先被移除，再由新目标自己的 Cookie 容器处理。同一主机内重定向会保留本次会话头。

若接口需要签名、固定设备标识或服务端发放的会话值，应由书源脚本或登录流程取得，不能依赖 `generatedCookies` 猜测。历史书源如果曾依赖请求层自动补充某个平台的字段，应把相应名称和值迁移到 URL 的 `session`、`headers` 或登录脚本中；应用不再保留隐式站点规则。

## 规则语法

一个字段规则通常由三部分构成：

```text
提取规则##正则##替换文本@js:后处理
```

并非每部分都必须存在。执行顺序是先提取，再执行 `@js:` 后处理，最后执行 `##` 正则替换。尽量让规则保持单一职责，复杂转换分成 `init`、字段提取和净化三步。

### JSONPath

JSON 响应优先使用 JSONPath（单次求值最多返回 50000 条结果、遍历 200000 个节点，超出部分被截断）：

```text
$.data.books[*]
$.title
$['data']['title']
$..chapters[*]
$.items[0]
$.items[-1]
$.items[0,2,4]
$.items[1:5]
$.items[::-1]
$.items[?(@.status == 1)]
$.items[?(@.name =~ /小说/i)]
```

当前支持：

- 点号属性、方括号引号属性；
- `*` 通配；
- `..` 递归属性和递归通配；
- 正负数组下标、下标列表；
- `[start:end:step]` 切片；
- 过滤器中的 `&&`、`||`、`!`；
- 比较操作 `==`、`!=`、`>`、`<`、`>=`、`<=`；
- 正则比较 `=~ /pattern/i`；
- 属性是否存在判断。

`@.field` 会按当前 JSON 对象的 `$.field` 处理。JSON 内容中还允许 `.field` 或简单裸字段 `field`，缺少 `$`/`@.` 前缀的 JSONPath（例如 `data.list[*]`）会按根相对的 `$.data.list[*]` 求值，不再返回空值；但推荐显式写 `$.field`，可读性和可移植性更好。`@json:路径` 可以强制按 JSONPath 解析。

### CSS 选择器

HTML 响应优先使用 CSS 风格规则：

```text
.book-item
.book-item .title@text
a.detail@href
img.cover@data-src
meta[name=description]@content
ul.list > li
li:contains(完结)
li:has(a[href*=book])
a:not(.disabled)
a:not([rel=nofollow])
text.下一页@href
li:first
li:last
li:eq(2)
li:lt(5)
li:gt(2)
li:nth-child(2)
li:nth-of-type(2)
```

已实现的主要能力：

- 标签、`#id`、`.class`，可组合多个 class；
- 后代和直接子代 `>`；
- 逗号分组；
- 属性存在及 `=`、`^=`、`$=`、`*=`、`~=`、`|=`；
- `:contains()`、单层 `:has()`、`:not()`；
- `:first`、`:last`、`:eq(n)`、`:lt(n)`、`:gt(n)`；
- 数字形式的 `:nth-child(n)`、`:nth-of-type(n)`；
- `@text`、`@html`、`@ownText`、`@textNodes` 和属性提取。
- 旧式 `text.关键字` 从当前 HTML 中查找自身直接文本包含该关键字的元素；只存在于后代节点中的文字不算命中，可继续追加 `@text`、`@ownText`、`@html` 或属性提取。

#### 元素索引与排除简写

选择器末尾可以使用点号选择索引，或使用感叹号排除索引。索引从 `0` 开始，负数从末尾倒数（`-1` 表示最后一个元素）。多个索引使用冒号分隔：

```text
span.0:1:2:3@text
span!0:-1:-2:-3@text
```

上面的第一条规则只返回第 0、1、2、3 个 `span` 的文本；第二条规则排除第 0、倒数第 1、倒数第 2、倒数第 3 个 `span`，再返回剩余文本。索引列表可以按需要混合正数和负数，也可以只写一个索引：

```text
span.0@text
span!0@text
```

为兼容原有书源，只有两个数字的形式仍表示范围：`span.0:5@text` 返回索引 0（含）到 5（不含）的元素。三个及以上数字才表示显式索引列表，因此不会与旧范围写法冲突。`@text` 是提取后缀；“选取”“排除”等说明文字不要写入规则本身。

`text.下一页@href` 是 Android 阅读书源中常见的正文翻页写法。它按“自身文本包含”匹配，而不是精确相等，因此“下一页”“下一页继续阅读”都可命中，URL 字段取第一个非空 `href` 并按当前响应最终地址补全相对路径。如果链接文字全部包在 `<span>` 等后代节点中，元素自身文本为空，这条规则不会命中；此时应改用稳定的 CSS，例如 `a.next@href`，或在确实需要后代文字匹配时使用 `a:contains(下一页)@href`。

未写提取后缀时，普通 CSS 字段默认返回文本；列表规则会保留完整元素供子规则继续解析属性、文本或正则。明确的列表规则没有命中时返回空列表，不再把整页响应伪装成一个列表元素。

常用提取后缀：

| 后缀 | 结果 |
| --- | --- |
| `@text` | 去标签后的全部文本。 |
| `@ownText` | 元素自身直接文本，尽量排除子元素内容。 |
| `@textNodes` | 直接文本节点按换行连接。 |
| `@html` | 完整元素 HTML。 |
| `@href`、`@src`、`@content`、`@title` 等 | 对应属性值。自定义合法属性名也可提取。 |

选择器解析由项目内轻量解析器完成，并非完整浏览器 DOM/CSS 引擎。不要依赖复杂嵌套伪类、`an+b` 形式的 `nth-child`、伪元素或现代 CSS 全集。单个 HTML 响应超过 4 MiB 时，列表 CSS/正则解析会受保护性限制；大接口优先使用 JSONPath 或缩小响应。

### 基础 XPath

支持一部分可转换为 CSS 的 XPath：

```text
//div[@class='book']/a/text()
//a[contains(@href,'book')]/@href
//li[contains(.,'完结')]
//ul/li[1]
//li[last()]
```

支持属性相等、`contains(@attr, ...)`、`starts-with(@attr, ...)`、文本包含、数字位置、`last()`、属性存在以及末尾 `/@attr`、`/text()`。复杂轴、函数、变量和完整 XPath 表达式不受支持；新源推荐 JSONPath 或 CSS。

### 组合规则

| 运算符 | 行为 | 示例 |
| --- | --- | --- |
| `规则1||规则2` | 依次尝试，返回第一个非空结果。 | `.title@text||h1@text` |
| `规则1&&规则2` | 将各规则的结果顺序拼接为一个结果列表。 | `.name@text&&.alias@text` |
| `规则1%%规则2` | 按索引交错合并多个结果列表。 | `.name@text%%.url@href` |

分隔符在引号、圆括号、方括号和花括号内不会拆分，因此 JSONPath 过滤器中的 `&&`、`||` 可以正常使用。

普通字符串字段会与 Android 阅读保持一致，把同一规则的多个命中项（包括 `&&` 合并后的结果）用换行连接；例如 `.content@p@html` 会保留全部 `p`。URL 字段只使用第一个非空命中项。

### 模板拼接

双花括号会在当前元素中求值：

```text
/book/{{$.book_id}}
{{$.category}},{{$.status}}
https://cdn.example.com/{{$.cover}}
```

同时兼容部分单花括号 JSONPath：

```text
/book/{$.book_id}
```

模板中可读取上下文变量：

```text
{{source.bookSourceUrl}}
{{source.bookSourceName}}
{{source.bookSourceGroup}}
{{source.bookSourceComment}}
{{source.getKey()}}
{{source.getVariable()}}
```

模板表达式中的 `@@选择器` 会按当前 HTML 元素继续执行普通提取规则，而不是作为 JavaScript 文本处理。例如 `{{@@a@href}}` 可读取当前卡片内链接。

详情、目录、正文阶段还会注入 `book.bookUrl`、`bookUrl`，并尽量从详情 URL 提取 `book`、`book_id`、`id`。

### 正则提取与替换

字段后处理使用：

```text
原规则##正则##替换文本
原规则##正则
```

示例：

```text
$.author##^作者：
title@text##^《|》$
$.status##^1$##连载
```

正则以 JavaScript `RegExp` 的全局模式执行，但规则可以先按 Android 阅读的 Java/Kotlin 方言书写，编译前会由 `JavaRegexCompat` 转换。第三段省略时替换为空字符串；替换文本支持 `$1` 等捕获组引用，其中 Java 的 `$0`（整个匹配）会映射为 JavaScript 的 `$&`，反斜杠按 Java 语义作为转义符。字面量 `##` 可写成 `\##`。

转换覆盖的方言差异：

| Android 写法 | 转换结果 |
| --- | --- |
| `(?i)`、`(?m)`、`(?s)`、`(?is)` 等内联标志（含出现在规则中间的情况） | 提升为 `RegExp` 的 flags |
| `a*+`、`a++`、`a?+`、`a{2,3}+` 占有量词 | 降级为贪婪量词 |
| `(?>…)` 原子组 | 降级为普通分组 `(?:…)` |
| `\Q…\E` | 转义为字面量 |
| `\h`、`\H`、`\v`、`\V`、`\R`、`\z`、`\Z` | 展开为等价的字符类或断言 |
| `\p{…}` | 保留并自动附加 `u` 标志 |
| `\w`、`\W`、`\d`、`\D`、`\b`、`\B` | 换成 Android（ICU）的 Unicode 字符集，见下文 |

`\w`、`\d` 和 `\b` 在 Android 上恒为 Unicode 语义，JavaScript 默认只认 ASCII。应用按 Android 的口径转换，字段规则的 `##`、`ruleContent.replaceRegex` 和阅读器“替换净化”都适用：

- `\w` 匹配字母、数字、下划线以及汉字、假名等各文种的单词字符，`\W` 是它的补集。因此 `\W*` 只会吃掉标点和空白，不会把整段中文正文当成“非单词字符”吞掉。
- `\d` 匹配所有十进制数字，包括全角 `０-９`；`\D` 是它的补集。只想匹配 ASCII 数字时请显式写 `[0-9]`。
- `\b`、`\B` 按同一套单词字符判定边界，汉字与标点之间才算边界，汉字与汉字之间不算。字符类内的 `[\b]` 仍是退格符。
- 字符表只覆盖基本多文种平面；emoji 等平面外字符按非单词、非数字处理。

如果一条规则原本是照 JavaScript 的 ASCII 语义写的（例如用 `\w+` 只匹配英文单词、用 `\W` 匹配中文），迁移后需要改成显式字符类。

仍无法完全等价的写法会按最接近的语义处理，并在替换净化配置页给出“已按 Android 正则转换”提示：内联标志的位置语义、占有量词与原子组的回溯行为、字符类交集 `[a&&b]`、Java 专有属性名（`InCJKUnifiedIdeographs` 等），以及 `(?x)`/`(?u)`/`(?d)`/`(?U)` 这类 JavaScript 没有的开关。稳定书源更适合用 CSS/JSONPath 提取后再用 `##` 净化。

#### 阅读器替换净化规则导入

阅读器里的“替换净化”规则（阅读设置 → 替换净化配置）使用同一套转换：导入 Android 阅读导出的规则文件后即可生效，无需把 `(?m)`、`(?is)` 之类改成 JavaScript 写法。

导入支持三种字段命名，按别名匹配，不要求字段顺序：

| 来源 | 示例字段 | 映射 |
| --- | --- | --- |
| 本应用导出 | `pattern` `replacement` `isRegex` `applyToTitle` | 原样 |
| 阅读/Legado 导出 | `pattern` `isEnabled` `isEnabledForTitle` `isEnabledForContent` `timeoutMillisecond` `scope` | 同名或按语义映射 |
| 阅读/YueDu 的 `Share/Rule.txt` | `regex` `replacement` `enable` `replaceSummary` `serialNumber` | `regex`→匹配规则，`replaceSummary`→规则名，`serialNumber`→应用顺序 |

文件可以是顶层数组，也可以包在 `rules`/`replaceRules`/`list`/`data` 等字段里，允许带 UTF-8 BOM。导入时缺少匹配规则的条目会被跳过并计入提示；`scope`/`excludeScope` 里的正则会自动包成 `/…/` 形式（含逗号、分号或换行时保持原样，这类值无法安全转换）。

只有识别为非本应用来源（阅读/Legado、阅读/YueDu）时才先弹确认框：标题标明来源，正文说明将做哪些转换、有多少条目会被跳过或因不支持正文范围条件而被忽略，确认后才写入规则列表；本应用自己导出的文件直接导入，不打断用户。

正文净化在后台任务中执行，并带时间预算，避免一条回溯严重的规则拖住整个应用：

- 每条规则按自己的超时设置计时（默认 3000 ms，正文净化中最多 3 秒），整章净化任务上限 8 秒。
- 超时的规则整条跳过，正文保持上一条规则处理后的结果；任务预算耗尽后，剩余规则不再执行。
- 不显式跨行的规则逐行（逐段）执行。`\W`、`\D`、`[^x]` 这类只是“顺带”能匹配换行的写法不再跨段落吞字。
- 规则显式依赖换行时仍对整段文本执行：字面的 `\n`、`\s`、`[\s\S]` 一类全字符类、`(?s)` 标志，或不带 `(?m)` 的 `^`/`$`。
- 形如 `(a+)+`、`[abc]+{2,}` 的嵌套量词规则会被直接跳过。

这套预算只作用于阅读器的替换净化规则；书源自身的 `replaceRegex` 和字段 `##` 仍是普通全局替换，写规则时应自行避免灾难性回溯。

#### 直接正则规则

规则可直接以 `##正则##替换` 开头，此时处理输入是完整当前元素。尾部再加 `###` 时只处理首个命中的子串，并返回替换后的该子串，而不是返回周围的原文本。

还支持直接正则规则：

- 以 `%` 开头时，对完整内容运行一次非全局正则，并返回完整匹配和捕获组；
- 以 `:` 开头时，可用 `&&` 串联全量正则；中间正则先拼接所有完整匹配，最后一条为每个匹配保留 `$0`、`$1` 等捕获组，供字段规则继续读取；
- 普通“像正则”的规则会以全局模式运行。有捕获组时，每个匹配会变为 `{"$0":"...","$1":"..."}`，后续可用 `$['$1']` 一类路径读取。

直接正则的兼容行为较特殊，稳定书源更适合用 CSS/JSONPath 提取后再用 `##` 净化。

### 上下文变量 `@put` / `@get`

可以在规则中保存并读取字符串变量：

```text
@put:{bookId:$.id}$.title
@get:{bookId}
/chapter/@get:{bookId}/{{$.id}}
```

`@put:{key:value}` 中可用逗号或分号分隔多项；值会先按普通规则求值。上下文会从搜索结果保存到书籍，并在详情、目录和正文阶段恢复，因此可用于跨阶段携带站点 ID。章节还会保存其解析时的 `baseUrl`。

注意：列表中的每个搜索/发现元素会创建自己的规则上下文，搜索得到的变量会写入该书籍；目录中的章节共用书籍上下文。避免用相同键保存会在章节之间互相覆盖的临时值。

### JavaScript 兼容层

规则支持以下形态：

```text
<js>表达式</js>
$.status@js:result.replace(/1/g, "连载")
@js:'https://example.com/chapter/'+$.id
js:表达式
```

字段规则还支持 `基础规则<js>处理脚本</js>后续规则`。执行顺序为：先按基础规则取得 `result`，再运行内嵌脚本，最后把脚本结果交给尾部规则继续解析。例如：

```text
$.data<js>result.items</js>$.books[*]
```

尾部规则为空时直接采用脚本结果；列表字段仍按列表语义处理。内嵌脚本及尾部规则均受当前阶段的超时、取消和输出大小限制。

普通 HTTP 抓取只解析响应文本，不会为了一个字段执行页面内的 `<script>`。例如页面使用 `renderCount('4152836')` 配合 `document.write` 显示字数时，`@text` 可能得到脚本源码，而不是浏览器最终显示的 `415万字`。可直接从局部 HTML 中提取参数并转换：

```text
.word-count@html<js>var m=result.match(/renderCount\('([0-9]+)'\)/);return m?String(Math.round(Number(m[1])/10000))+'万字':'';</js>
```

`wordCount` 是最终展示字符串，应用不会统一把裸数字自动换算为“万字”，因为不同接口可能已经携带单位或使用其他口径。仅当字段必须依赖完整页面 JavaScript、异步渲染或全局状态时，才在对应请求 URL 中显式使用 `webView: true` / `webJs`；不要为了简单的数值换算启用网页抓取。

#### 引擎分层与路由

这类组合规则会先做能力判断。普通表达式继续在每个列表元素自己的 `AnalyzeRule` 上下文中执行，以保留既有的当前元素、变量读写和尾部处理顺序；只有使用箭头函数、模板字符串插值、`try`、数组高阶函数、`Set/Map`、解构、位运算、类型化数组或超大脚本等完整 JavaScript 语义时，才会批量路由到分阶段 ArkWeb。不要因为规则中出现 `<js>` 就假定它一定由 ArkWeb 执行。

复杂组合规则在 ArkWeb 执行失败时，如果能力分析确认脚本没有网络请求、Cookie 修改或持久化写入等可观察副作用，会回退到逐元素兼容解析，不会把该字段直接当成空值。包含副作用的脚本不会再交给第二个引擎重试，以免重复请求或重复修改状态。此外，`<js>处理</js>` 内嵌后处理脚本如果调用了 `source.put/get`、`cookie.*` 或 `cache.*` 这类对象状态方法，也会直接路由到 ArkWeb，避免在轻量解释器上静默失效；`<js>` 块可以单独作为开头（没有前置基础规则），此时脚本中的 `result` 是原始元素本身，与 Android 阅读的按类型分发写法一致。

当前不是“所有代码统一交给一个 JavaScript 引擎”，而是按职责分层：

1. **轻量规则/JavaScript 兼容引擎**：正式处理模板、简单表达式和常见 Android/Java 别名，当前返回值直接参与书源执行；
2. **分阶段 ArkWeb 引擎**：能力路由器发现箭头函数、模板字符串、`try`、数组高阶函数、`Set/Map`、解构、位运算、类型化数组或较大脚本时，仅将相应阶段交给 ArkWeb 的真实 JavaScript 引擎；
3. **QuickJS 迁移运行时**：应用启动后先做原生自检，再在 TaskPool 中执行可证明无主机副作用的短纯表达式。默认 `SHADOW` 只比较结果；`CANARY` 仅接管累计至少 4 次一致且零差异、零失败的表达式指纹；`PREFER_QUICKJS` 对候选表达式优先使用 QuickJS。正式模式均保留原执行路径作为失败回退，连续 3 次路由失败会熔断 5 分钟。

搜索、发现、详情、目录和正文分别路由，启用某一阶段的 ArkWeb 不会把所有书源或所有阶段一起改道。无副作用的失败可以回退轻量引擎；含网络、Cookie 或持久化写入的动作会避免双重执行。`jsLib` 中声明的顶层函数会暴露给当前阶段规则，并在下一书源执行前清理，防止跨源污染。

轻量引擎没有位运算和二进制数据类型。脚本（含 `jsLib`）中出现 `&`、`|`、`^`、`<<`、`>>`、`>>>` 及其赋值形式，或 `Uint8Array` 等类型化数组、`ArrayBuffer`、`DataView`、`TextEncoder/TextDecoder`、`Math.imul`、`Math.clz32`、`WebAssembly` 时，该阶段会路由到 ArkWeb，哈希、校验和与自行实现的编解码可以按标准 JavaScript 书写。字符串、注释和正则字面量里的这些符号不参与判断，逻辑运算 `&&`、`||` 也不会触发路由。

`WebAssembly` 已在真机的隐藏 ArkWeb 页面中实测可用（2026-10-13，ArkWeb 7.0.0.107，Chromium 144）：模块校验、同步与异步编译实例化、导出函数调用和 `WebAssembly.Memory` 均正常。该测试直接在页面内执行，未经过书源规则的完整链路；书源自带 `.wasm` 字节并在规则中加载的写法仍需逐源实机验证，其他内核版本的表现也可能不同。

#### 随请求变化的参数

请求需要携带时间戳、随机串或由它们计算出的摘要时，按参数的来源选择写法：

| 场景 | 写法 |
| --- | --- |
| 值依赖本次请求的地址或请求体 | 在生成该地址的 `@js:`/`<js>` 规则里计算，并写进 URL 选项的 `headers` 或查询参数；规则每次请求都会重新求值。 |
| 值与具体请求无关，但每次都要变化 | 用书源 `header` 的动态 `@js:` 规则计算，并返回 `"@cache": false`，见[动态 `@js:` 请求头](#动态-js-请求头)。 |
| 参数只能由目标页面自己的脚本生成 | 用 `webView: true` 加载该页面，在 `webJs` 中由页面发起请求并返回 Promise，见[`webJs` 返回 Promise](#webjs-返回-promise)。 |

摘要可使用已覆盖的 `java.md5Encode`、SHA 系列、Base64/Hex 和 AES 等主机函数，也可以用位运算自行实现。算法、密钥和设备标识始终属于书源自身，应用不提供按站点命名的签名接口，也不保证通过目标服务的反自动化校验；请只对已获授权访问的接口使用。

#### QuickJS 迁移与回归测试

QuickJS 候选当前限制为最多 4096 字符、最多 64 个绑定和 128 KiB 绑定数据，并使用 16 MiB 内存、512 KiB 栈及 10～250 ms 的受限执行。JSON 安全的对象和数组会保持结构化绑定，因此纯表达式可读取 `$.field` 或数组下标；绑定转换另有 32 层、20000 节点保护。包含赋值、语句块、循环、函数/类声明、`new`、`Date`、随机数，或 `java/source/book/chapter/cookie/fetch/webView` 等主机对象的表达式不会进入 QuickJS。迁移诊断只持久化不可逆表达式指纹、计数和耗时，不保存书源代码、变量或解析结果。

可在“其他设置 → 脚本引擎迁移 → 书源脚本回归测试”中多选书源与搜索、发现、详情、目录、正文阶段。该工具只抽取符合上述安全边界的 `{{…}}`、独立 `<js>…</js>`、`@js:`/`js:` 纯表达式，以三组固定输入在原有表达式运行时和 TaskPool QuickJS 中分别执行并报告一致、差异或失败；它不会请求书源网站，也不会读取或修改 Cookie、登录信息、书源变量或迁移统计。异步纯脚本由统一异步路由提交，仍保留原执行结果作为失败回退。单次最多加载 50 个书源并测试 300 个候选表达式。

离线一致不会直接授权 QuickJS 接管。报告会保存候选的书源、阶段、字段和不可逆指纹，但不保存脚本、运行绑定或结果值。当前已接入异步路由的独立纯脚本会进入“待真实验证”；`{{…}}` URL/字段模板及 `@js:` 后处理表达式仍标记为“仅离线通过”，在对应同步解析链路完成异步化前不会被错误晋级。点击“开始真实验证”后，应用切回 `SHADOW`，用户照常搜索、浏览发现或阅读；命中的可路由候选使用真实上下文在 TaskPool 中后台比对，旧引擎结果始终生效。每个候选累计至少 4 次真实一致且零差异、零失败后才显示“灰度合格”，此时页面才允许开启 `CANARY`。真实差异或失败会阻止该候选晋级；清除迁移统计也会同步清除真实验证进度。该流程是渐进迁移门禁，仍不能代替书源功能、网络与登录流程的人工验收。

复杂脚本的网络、Cookie、密码学和持久化动作采用引擎无关的“动作请求 → 原生统一执行 → 结果回放”协议，并由执行日志去重。请求仍通过通用 `AnalyzeUrl/HttpClient`，Cookie 仍按目标域隔离；QuickJS 不直接获得这些宿主能力，也不存在按站点名称开放的专用接口。

QuickJS 不能直接替代 JSONPath/CSS/XPath：选择器需要解析 HTML/JSON 节点和维护“当前元素”上下文，而 QuickJS 影子运行时故意不开放 DOM、网络、Cookie、文件或平台对象。需要这些能力时，应继续使用原生选择器、受控主机函数或分阶段 ArkWeb，而不是把规则整体转写为 JavaScript。

#### 已覆盖的主机函数

轻量层和桥接层合计覆盖的常用能力包括：

- `java.timeFormat(value, pattern)` 按设备本地时区格式化时间；
- `java.timeFormatUTC(value, pattern, zone)` 先按给定小时偏移调整时间，再使用 UTC 字段输出 `yyyy`、`MM`、`dd`、`HH`、`mm`、`ss`；
- `java.put(key, java.timeFormatUTC(java.getString(path), pattern, zone))` 等嵌套调用会先计算内层取值和格式化结果，再写入共享规则上下文；
- 字符串拼接和简单变量赋值；
- `result.replace(/正则/g, "文本")` 等常见替换链；
- 简单数值 `+ - * / %` 和 `Math.round/floor/ceil`；
- `Date.now()`、部分 `new Date()` 取值；
- `encodeURIComponent`、`encodeURI`；
- `java.urlEncode/urlDecode`；
- Base64、Hex、MD5、SHA-1、SHA-256；
- SHA-512、Base64 URL、HTML 实体编解码；
- AES、DES/3DES 的常见 Base64 加解密；
- `java.getString`、`java.getStringList` 读取当前内容：`$.` 开头的 JSON 路径直接取值，其他规则由原生规则引擎按完整规则语法求值；
- `java.getCookie`、`cookie.getCookie/setCookie/removeCookie`；
- `java.toast` / `java.longToast`：详情、目录、正文阶段弹出的提示交给宿主显示（宿主通过 `SourceScriptNotice.setHandler` 接收，轻页显示为应用内提示），同一书源的同一条提示 15 秒内只转发一次；搜索、发现和登录界面有各自的提示方式，不经过这里；
- `java.randomUUID()`、`java.androidId()`；
- `java.put/get`、`source.get/put/getVariable/setVariable`、`source.key`（与 Android 端 `source.key` 属性一致，取书源地址）、`book.getVariable/putVariable`；轻量引擎处理完 `java.*` 调用后，剩余的字符串链、三元和正则字面量表达式会交给 QuickJS 兜底求值，修复字面 `\n` 被展开、时间戳显示为 1970 之类的问题；
- `baseUrl` 会随当前规则解析地址注入；分阶段 ArkWeb 还提供带 `get/put/save` 的临时 `infoMap`；
- `source.getLoginInfo/getLoginInfoMap/putLoginInfo`、`source.getLoginHeader` 和 `cache.get/put/delete`；
- `android.util.Base64`、`java.util.Base64`、`URLEncoder/URLDecoder`、`System.currentTimeMillis` 等常见 Java/Android 别名；
- `StringBuilder`、`HashMap`、`ArrayList` 及常用 Java 字符串/集合方法；
- 使用 `MessageDigest` 或 `Cipher/SecretKeySpec/IvParameterSpec` 封装的常见摘要、AES、DES/3DES 函数。

ArkWeb 提供真实 ECMAScript 语义，但**不等于完整 Android、Rhino、Node.js 或无限制浏览器环境**。阶段脚本的网络必须经过 `java.ajax` 等受控桥接；`fetch`、`XMLHttpRequest`、`WebSocket` 会被判定为未托管网络。任意 Java 导入、文件、进程、反射、系统组件和第三方原生库不会自动可用。DOM 主要用于登录面板生成的页面；普通搜索/目录/正文规则不应假定目标网页已在可操作 DOM 中。

`java.getString`/`java.getStringList` 支持完整规则语法（CSS/`class.`/`id.`/`tag.` 选择器、`@text`/`@html`/`@@`、`##` 替换链），由原生规则引擎按“收集规则 → 求值 → 重放脚本”的同一套主机动作机制执行，结果按规则缓存；`$.` 开头的 JSON 路径仍直接取值，不需要重放。若阶段脚本最终没有返回任何内容，应用不会再静默地把它替换成规则输入内容（例如把正文规则变成章节页本身），而是记录警告，并在正文阶段把服务端返回的错误信息（如“仅支持网页端访问”“Token验证失败”）作为正文错误上报。

阶段脚本还提供 `java.getElement(规则)` 与 `java.setContent(值)`：`getElement` 按完整规则语法收集元素（内部按 `@html` 取外层 HTML），返回轻量元素对象，支持 `attr(name)`、`hasAttr(name)`、`text()`、`ownText()`、`html()` 和 `toString()`，可用于元素级脚本处理；`setContent` 会替换当前上下文内容，后续 `$.` 路径与规则按新内容求值。`java.ajax` 返回的 `responseObject.headers()` 现在返回真实响应头（`get(name)` 大小写不敏感、`names()` 列出全部名称），不再是恒空对象；登录与调试动作中的 `java.refreshExplore()` 会真正刷新该源发现页，`java.showBrowser(url)` 只传 URL 不传 HTML 时，应用直接打开该地址而不是渲染空白文档。

能力路由会分析 `java`、`source`、`cache` 和 `cookie` 方法，并在登录动作失败时提示缺少的桥接方法。复杂源仍应逐阶段实机验证；书源中的私有函数、接口和凭据始终属于该书源配置，不会成为应用内置 API。

分阶段运行时自带稳定性保护：隐藏 ArkWeb 宿主失联时会自动探测并重建（自愈看门狗 + 挂载轮询兜底），等待期内不再直接失败；同一请求规格的重复次数与不同请求的总数分开限额，多分类、多分页源不容易触发“网络请求次数过多”，但同地址死循环仍会被拦截；网络层报告 `statusCode === 0`（无连接、超时等）时，桥接会把人性化错误作为 `{code:599}` 响应交给脚本继续重放，书源脚本里的 `try/catch` 可以自行吸收可选接口的失败，而不会中断整个阶段；搜索/发现菜单/URL 阶段的单请求超时约为 15 秒。登录面板保存的书源变量、登录密钥和登录信息以数据库为准，立即对下一次阶段执行生效。

### 编码 `data:` 地址与显式请求

应用支持标准 `data:` 文本以及 `data:;base64,<负载>,{...}` 形式。Base64 负载和尾部选项会分别解析，避免把请求选项误当成正文；编码章节地址中的 `/` 或形似 `name=value` 的 Base64 片段不会再被旧式虚拟章节参数解析截断。

尾部选项对象显式声明 `type` 时，正文阶段按 Android 阅读的字节串约定，把解码后的内容以十六进制文本交给规则脚本，脚本内通常用 `java.hexDecodeToString(result)` 还原；未声明 `type`、但正文规则自身调用 `java.hexDecodeToString(result)` 等字节串函数的旧写法，也会得到同样的十六进制输入。

编码请求只有在选项明确使用通用 `type: "request"`，并明确提供 HTTP(S) `url`/`requestUrl` 时才会执行。方法、请求体和请求头也必须来自书源配置。应用不会：

- 根据书源名称、平台名或负载类型推断内容站点；
- 选择内置聚合后端、镜像、代理或回退主机；
- 自动加入第三方 API Key、账号、设备标识或平台参数；
- 把一个站点的 Cookie 自动复制到另一个站点；
- 在规则之外实现第三方接口签名、付费内容解密或评论接口适配。

请求层只提供 URL 选项中的通用 `session` 能力，且必须由书源显式声明。应用没有目标主机名单，不会因地址属于某个平台而自动补充 Cookie 名称、访客标识、Referer 或查询参数。

需要加密、摘要、Cookie、音频或图片处理时，应把相应逻辑和有权使用的参数明确写在书源规则中。`BookSourceInteractionPostProcessor` 不再识别具体平台，只保留规则已经产出的正文。

## 各阶段规则

### 搜索规则 `ruleSearch`

当前要让书源参与搜索，至少必须配置：`searchUrl`、`bookList`、`name`、`bookUrl`。

| 字段 | 必需 | 解析上下文 | 当前用途 |
| --- | --- | --- | --- |
| `bookList` | 是 | 完整搜索响应 | 选出书籍元素。 |
| `name` | 是 | 单个书籍元素 | 书名；空书名的结果会被丢弃。 |
| `author` | 否 | 单个书籍元素 | 作者。 |
| `coverUrl` | 否 | 单个书籍元素 | 封面；相对地址会解析。 |
| `intro` | 否 | 单个书籍元素 | 简介。 |
| `kind` | 否 | 单个书籍元素 | 分类/标签。 |
| `lastChapter` | 否 | 单个书籍元素 | 最新章节标题。 |
| `bookUrl` | 是 | 单个书籍元素 | 详情页；空地址的结果会被丢弃。 |
| `wordCount` | 否 | 单个书籍元素 | 搜索结果字数；常规搜索链会解析并写入结果，精简校验模式会省略该展示字段。 |
| `status` | 否 | 单个书籍元素 | 书籍状态/连载状态文本。 |
| `updateTime` | 否 | 单个书籍元素 | 书籍更新时间文本；写入搜索结果，并可在详情和书架中显示。 |

每个源常规搜索最多保留 30 条有效结果，总搜索最多保留 300 条，并按“来源 + URL”去重。搜索并发数最大为 12，换源、获取网络封面和“搜索能力”校验共用这个并发数；单个书源的请求、脚本与结果解析合计超过 60 秒即放弃并把并发槽让给下一个书源（配置了 `concurrentRate` 的书源另加最多 60 秒的限流排队时间），这类超时按“暂时异常”报告，不会在书源校验中被判为规则失效。后台结果每约 500 ms 合并一次，避免每条回调都打断列表手势，因此搜索未结束时仍可滑动已出现的结果。搜索会清理超长或异常字段；书名约 120 字符、作者约 120、简介约 1200、URL 约 2048 字符。

### 发现规则 `ruleExplore`

至少需要：`exploreUrl`、`bookList`、`name`、`bookUrl`。字段语义与搜索相同。发现链会读取 `wordCount`、`status` 和 `updateTime`，并按“来源 + 详情 URL”去重。

搜索/发现通用卡片显示书名、作者、状态/分类标签、字数、最新章节、更新时间、来源和封面。详情页会再次请求 `ruleBookInfo`，用详情结果补全列表缺失字段。如果 `.author@text` 同时命中“作者、字数、阅读量”等多个同 class 节点，解析器会用换行连接它们，卡片看起来像是在显示三个独立字段，实际它们都属于 `author`。语义正确的书源应尽量分别提取作者和字数；若为兼容现有卡片而有意把多行元数据放进 `author`，必须先把 `renderCount(...)` 一类脚本文本转换为最终可读值，并接受作者聚合、书籍匹配和入架元数据可能受到影响的代价。

当 `ruleExplore` 为 `null`、空数组、空对象或缺少必要字段时，会自动回退到 `ruleSearch`。`exploreUrl` 以 `@js:` / `js:` 开头时会按能力路由执行，结果应为分类对象数组的 JSON 字符串；简单表达式可由轻量引擎处理，完整脚本或带 `jsLib` 函数的模板可进入分阶段 ArkWeb。阶段脚本返回 `/api/...` 等相对地址时会以 `bookSourceUrl` 补全后再请求。两条路径都有代码、输出、操作或响应大小限制。

发现菜单脚本的结果会按“书源 + 平台/分类 + 变量”缓存约 5 分钟，切换分类或书源时不再重复执行菜单脚本，筛选动作（写变量/执行脚本）会立即清除该源缓存。在书源管理中删除、导入或保存编辑书源后，对应书源的发现列表缓存和菜单缓存也会立即失效，发现页下次显示时重新加载，调试 `exploreUrl` 时不需要等缓存过期。发现脚本可以通过 `source.put('type', …)` 为分类声明媒体类型，取值为 `audio`（或 `听书`/`有声`）、`comic`（或 `漫画`）、`novel`/`text`（或 `小说`），书籍会按声明进入对应阅读模式，无需依赖标签推断。

### 详情规则 `ruleBookInfo`

详情请求地址来自搜索/发现的 `bookUrl`。

| 字段 | 当前用途 |
| --- | --- |
| `init` | 先在完整详情响应上执行；非空结果成为其余详情字段的新解析内容。适合 `$.data` 或 `.book-info@html`。 |
| `name` | 更新书名；空结果保留列表页值。 |
| `author` | 更新作者；空结果保留列表页值。 |
| `coverUrl` | 补充封面。当前逻辑优先保留列表页已有封面。 |
| `intro` | 更新简介，经过字段清理后择优保留。 |
| `kind` | 更新分类。 |
| `status` | 更新连载/完结等状态；作为独立字段保存，不要求混入 `kind`。旧书源若仍将状态写在 `kind` 中，仍会按分类标签兼容显示。 |
| `lastChapter` | 更新最新章节。 |
| `wordCount` | 更新字数。 |
| `updateTime` | 详情链会写入 `Book.updateTime`，保存到书架数据库并用于显示最后更新时间；旧书没有该字段时会保留列表阶段已有值。 |
| `tocUrl` | 目录请求地址；以 URL 模式解析相对地址。为空时会尝试依据书籍 URL 和规则模板兜底。 |

#### 书籍元数据字段兼容映射

搜索、发现和详情阶段使用同一套书籍元数据语义。书源规则中的字段名与应用对象的映射如下：

| 书源字段 | 书籍对象 | 搜索/发现列表 | 详情页 | 书架 |
| --- | --- | --- | --- | --- |
| `name` | `Book.name` / `SearchBook.name` | 显示 | 更新 | 显示 |
| `author` | `author` | 显示 | 更新 | 显示 |
| `kind` | `kind` | 分类标签 | 更新 | 分类标签 |
| `status` | `status` | 状态标签 | 更新 | 状态标签 |
| `wordCount` | `wordCount` | 元数据行 | 标签/元数据 | 可用于详情 |
| `lastChapter` | `latestChapterTitle` | 最新章节元数据 | 最新章节区块 | 书架最新章节 |
| `intro` | `intro` | 进入详情后显示 | 简介区块 | 详情/阅读上下文 |
| `updateTime` | `updateTime` | 更新时间元数据 | 更新时间标签 | 最后更新时间 |

`lastChapter` 是 Android 阅读书源中常见的旧字段，本项目继续接受它，并统一写入 `latestChapterTitle`。`status` 不再需要借用 `kind`；不过旧书源把“连载中/完结”等文本放入 `kind` 时仍可正常显示。`updateTime` 应返回站点原始的日期或时间文本，应用不会擅自把它转换成时间戳或替换成设备本地时间。

HTML 书源示例：

```json
{
  "ruleSearch": {
    "bookList": ".book-item",
    "name": ".title@text",
    "author": ".author@text",
    "kind": ".category@text",
    "status": ".status@text",
    "wordCount": ".word-count@text",
    "lastChapter": ".latest@text",
    "intro": ".intro@text",
    "updateTime": ".updated@text",
    "bookUrl": "a.detail@href"
  },
  "ruleBookInfo": {
    "status": ".book-status@text",
    "lastChapter": ".last-chapter@text",
    "wordCount": ".word-count@text",
    "intro": ".description@text",
    "updateTime": ".update-time@text"
  }
}
```

JSON 书源示例：

```json
{
  "ruleExplore": {
    "bookList": "$.data.books[*]",
    "name": "$.title",
    "author": "$.author",
    "kind": "$.category",
    "status": "$.status",
    "wordCount": "$.wordCount",
    "lastChapter": "$.latestChapter",
    "intro": "$.intro",
    "updateTime": "$.updatedAt",
    "bookUrl": "$.url"
  },
  "ruleBookInfo": {
    "status": "$.status",
    "lastChapter": "$.latestChapter",
    "wordCount": "$.wordCount",
    "intro": "$.description",
    "updateTime": "$.updatedAt",
    "tocUrl": "$.catalogUrl"
  }
}
```

如果接口字段名不同，只需把右侧 JSONPath/CSS 选择器替换为实际字段；不要把多个语义字段都写到 `author`。状态和更新时间为空时，详情链会保留列表阶段已有值，不会用空值覆盖已有数据。

`init` 返回的是字符串。如果 JSONPath 命中对象，会被序列化成 JSON，因此后续仍可用 JSONPath；如果 CSS 命中元素，建议显式用 `@html` 保留 HTML。

封面规则应返回可直接加载的图片地址，而不是详情页地址、包裹图片的 HTML 或尚未执行的脚本。常见写法包括 `img.cover@data-src`、`img.cover@src`、`meta[property=og:image]@content`，也可根据当前元素中的书籍 ID 用模板或 `<js>` 构造地址。搜索/发现阶段会按响应最终 URL 补全相对封面地址；JSON 项的显式 `coverUrl` 为空或未解析时，还会尝试通用键 `cover`、`cover_url`、`image`、`imageUrl`、`img`、`pic`、`thumbnail`。HTML 不会猜测任意图片节点。

详情阶段只会在列表封面为空时用 `ruleBookInfo.coverUrl` 补充，**不会用详情封面覆盖一个非空但错误的列表封面**。发现页封面错误时，应先修正 `ruleExplore.coverUrl`；如果列表页没有可靠封面，可将它留空，让详情规则补齐。

### 目录规则 `ruleToc`

| 字段 | 必需 | 当前用途 |
| --- | --- | --- |
| `chapterList` | 是 | 在完整目录响应中选出章节元素；单次最多保留 50000 条。规则为脚本时，每一个目录分页都会执行一次。 |
| `chapterName` | 建议 | 章节标题；空时自动使用“第 N 章”。 |
| `chapterUrl` | 是 | 正文请求地址；规则链解析出的空地址章节会被丢弃，全部为空时目录页会提示“章节地址全部为空”。 |
| `nextTocUrl` | 否 | 目录分页地址。返回一个地址表示“下一页”，逐页请求；返回多个地址（数组或多行文本）按 Legado 语义表示“剩余全部分页”，每批 4 页并发抓取、按列出顺序解析，且不再跟随这些页自己的 `nextTocUrl`。章节按 URL 去重（脚本直接构造、没有地址的条目不参与去重），遇到空地址、重复页或 1000 页保护上限时停止。全链路校验可另传章节抽样上限提前停止。 |
| `isVip` | 否 | `true`、`1`、`yes`、`vip`、`pay`、`paid`、`付费`、`收费` 会标记为 VIP。 |
| `isPay` | 否 | 普通目录链会按与 `isVip` 相同的布尔规则写入 `BookChapter.isPay`；直接返回完整章节数组的 ArkWeb 脚本仍需实机验证付费元数据。 |
| `updateTime` | 否 | 通用目录和 ArkWeb 目录结果会解析，并保存到章节变量 `updateTime`。 |
| `chapterListAddition` | 否 | 模型字段；当前导入映射和通用目录链未使用。 |

目录字段（章节名、地址、付费标记等）的解析超时随章节数伸缩：不少于 30 秒，按每章约 15 ms 增加，数千章的长篇目录不会因固定超时整体失败。没有 `nextTocUrl` 的脚本目录原样返回脚本结果。

目录规则产生的顺序就是阅读目录顺序。负索引、切片或 CSS 位置规则可用于排除卷名、广告项。章节标题会清理多余空白。

首次打开且本地没有可用目录时，如果正式 `chapterList` 规则没有结果（包括显式 CSS、XPath、JSONPath 或直接正则规则 0 匹配），阅读链可从**首个普通 HTML 目录响应**中临时识别章节链接。该通用兜底会比较命名目录容器与全页候选；当所谓目录容器实际只是较短的“最新章节”区块时，会优先使用明显更完整的全页候选。之后先去掉页面顶部“最新章节”重复块，再按 URL 去重，并只在章节数字呈现出强烈倒序证据时调整顺序。

兜底结果会标记为临时目录，不覆盖数据库中已有的正式目录；本地已有目录时，正式规则刷新失败也不会用通用结果替换它。换源和“发现/阅读链路”书源校验会禁用该兜底，因此校验通过仍表示书源自身的目录规则有效。通用兜底只用于避免首次打开完全不可读，不是 `ruleToc` 的替代能力，也不能保证所有站点的卷结构、付费状态和更新时间正确。

### 正文规则 `ruleContent`

| 字段 | 当前用途 |
| --- | --- |
| `content` | 小说正文提取规则；纯漫画书源可留空并配置 `images`。 |
| `replaceRegex` | 对提取后的正文做全局正则替换。 |
| `title` | 可导入和编辑，当前正文返回链不读取。 |
| `images` | 漫画图片提取规则；支持返回单个地址、地址列表或图片标签，相对地址会按章节响应地址补全。 |
| `audioUrl` | 有声书专用的音频地址规则，优先于 `content`；结果为空时回退到 `content`。非有声书不读取。 |
| `sourceRegex` | 有声书媒体地址匹配规则，按 Android 阅读的 Java 正则方言书写，也可写成 `/pattern/flags`。章节地址显式设置 `webView: true` 时用于筛选页面发出的媒体请求；普通 HTTP 响应下，在正文规则没有结果时依次匹配最终响应地址、页面中的地址，最后对响应文本执行并取捕获组。 |
| `nextContentUrl` | 正文下一页地址；逐页解析并拼接，遇到空地址、重复页、50 页或 8 MiB 正文上限时停止。 |
| `imageDecode` | 图片二进制解密规则；当前允许受限的 AES-CBC-PKCS5/PKCS7 解密，不执行文件、进程或反射 API。 |
| `imageStyle` | `FULL`、`comic`、`manga`、`webtoon` 会让阅读器优先使用连续全宽漫画模式。 |
| `payAction` | 紧凑规则可导入到模型，当前通用正文链不执行。 |

阅读页或书架全文缓存取消任务时，取消信号会传入正文获取链，在缓存读取、书源刷新、HTTP 响应、分页循环、交互后处理和字段规则批处理之间检查，并取消当前 HTTP 客户端及对应的规则执行任务。被取消的结果不会写入章节缓存。这是运行控制行为，不增加书源字段，也不改变 `content`、`images` 或 `nextContentUrl` 的解析顺序。

多页正文会在每一页响应上重新执行 `content`、`nextContentUrl` 和 `images`，再按页序用空行拼接正文。普通 HTML 的常见配置是：

```jsonc
"ruleContent": {
  "content": "#chapter-content@html",
  "nextContentUrl": "text.下一页@href",
  "replaceRegex": ""
}
```

这只能跟随响应中真实存在的下一页链接。如果首屏 HTML 本身就是截断的 SSR 内容，完整正文只保存在页面 JavaScript 状态或异步渲染后的 DOM 中，`nextContentUrl` 不会自动找回缺失部分。此时应让目录的 `chapterUrl` 显式使用 `webView: true`，并用 `webJs` 返回完整正文 HTML/文本，再让 `ruleContent.content` 提取。例如：

```text
/chapter/{{$.id}}, {"webView":true,"webJs":"document.querySelector('#chapter-content')?.innerHTML||''"}
```

若站点把完整正文放在页面全局状态中，也可以由 `webJs` 读取该状态；返回值会作为本页响应正文继续进入 `content` 规则。网页抓取串行且成本高，应只用于普通 HTTP 确实拿不到完整正文的页面。

`replaceRegex` 支持两种形式：

```text
广告正则
广告正则##替换文本
```

之后应用还会执行基本 HTML 清理：`<br>` 转换为换行、`</p>` 转换为双换行、移除其他标签、解码部分实体、压缩连续空行。正文中的 `img`/SVG `image`、Markdown 图片和独立图片地址会保留为阅读器图片页；配置 `images` 时优先按该规则返回的图片顺序分页。其他复杂 HTML 布局通常不会原样保留。

在 HTML 清理前，以下交互标记会转换为阅读器内部动作，而不是作为代码显示：

```html
<p>一段正文<comment ident="https://example.com/comments" count="12" /></p>
<p><img ident="https://example.com/god-comment" src="data:image/svg+xml;base64,..." /></p>
```

阅读页会把动作显示为跟随段落的可点击气泡/入口；分页器会保证标记不被切断，TTS 和快速朗读面板会剥离内部动作编码。点击动作会打开内置动作页面或媒体播放器。普通 HTML `onclick`、任意 DOM 事件和任意 JavaScript URL 不会直接执行。

朗读送入 TTS 前还会过滤整行的装饰性符号，例如连续的 `*`、`#`、`&`、`=`、横线、下划线、波浪线、圆点、竖线、斜杠及其常见全角形式；长度不限，过滤时以等长空格替换，保证朗读分块和页面高亮偏移仍能对应原正文。只要该行含有普通文字，就不会因包含 `*`、`#`、`&` 而整行删除。这个处理只影响朗读，不修改阅读页显示内容；若正文页面本身也不应显示分隔符，仍应在 `replaceRegex` 中由书源明确清理。`p:求推荐` 一类含文字的推广语也不会被装饰符过滤自动删除。

为了避免异常书源把超长脚本或大量交互元数据塞入正文，单个动作标记最多约 16 KiB，单章最多保留 320 个有效动作，并限制标签、标题和 URL 长度。损坏、超长或超过单章预算的标记会被当作元数据丢弃，不会回退成正文、图片或朗读文本。书源应让动作只携带完成交互所需的最小参数，不要嵌入整页响应或大段 Base64 数据。

漫画图片支持阅读书源常见的请求参数写法：

```text
https://img.example/page.jpg,{"headers":{"Referer":"https://example.com/"}}
```

带参数或 `imageDecode` 的图片由应用 HTTP 客户端携带 Cookie/白名单请求头下载，在最多 20 MiB 的限制内完成解密并写入应用缓存，再以本地文件交给阅读器。公共正文辅助层的默认完整物化管线每批最多 4 张并发；按需阅读的并发和调度以宿主实现为准。

## 示例与特殊场景

### HTML 书源示例

假设搜索页结构：

```html
<div class="book-item">
  <a class="title" href="/book/123">《示例书》</a>
  <span class="author">作者：张三</span>
  <img class="cover" data-src="/cover/123.jpg">
  <p class="intro">内容简介</p>
</div>
```

对应搜索规则：

```jsonc
"ruleSearch": {
  "bookList": ".book-item",
  "name": ".title@text##^《|》$",
  "author": ".author@text##^作者：",
  "coverUrl": ".cover@data-src",
  "intro": ".intro@text",
  "kind": "",
  "lastChapter": "",
  "bookUrl": ".title@href",
  "wordCount": "",
  "status": ""
}
```

假设详情、目录、正文分别为常见 HTML：

```jsonc
"ruleBookInfo": {
  "init": ".book-detail@html",
  "name": "h1@text",
  "author": ".author@text##^作者：",
  "coverUrl": "img.cover@src",
  "intro": ".intro@text",
  "kind": ".tags a@text",
  "lastChapter": ".latest@text",
  "wordCount": ".word-count@text",
  "updateTime": "",
  "tocUrl": ".catalog-link@href"
},
"ruleToc": {
  "chapterList": ".chapter-list a[href*=chapter]",
  "chapterName": "text",
  "chapterUrl": "href",
  "isVip": "",
  "isPay": "",
  "updateTime": ""
},
"ruleContent": {
  "content": "#chapter-content@html",
  "nextContentUrl": "text.下一页@href",
  "replaceRegex": "请收藏本站|最新网址.*"
}
```

当当前元素本身就是 `<a>` 时，`text` 和 `href` 可直接操作当前元素；也可以写 `@text`、`@href` 风格，但推荐在可读性更高时写完整选择器。

### JSON API 开发要点

公开仓库不提供指向真实第三方站点的完整可导入书源。开发和测试时，请使用 `https://example.com`、本地测试服务器或开发者自行控制且明确获得授权的服务，并使用虚构数据验证以下能力：

- 搜索和发现地址可使用 `{{key}}`、`{{page}}`；
- `$.data` 可直接取得数组，列表解析器会将数组元素逐项转成当前 JSON 元素；
- 详情 `init` 可用 `$.data` 把解析根缩到实际书籍对象；
- `/api/books/{{$.book_id}}` 可在元素上下文中构造详情 URL；
- `##` 可用于清理或格式化测试文本；
- `@js:result.replace(...)` 可用于转换合成状态码。

完整字段骨架见本文末尾的模板；模板故意不包含可用的真实站点地址、接口、凭据或内容规则。

### 登录、Cookie 与网页验证

应用会综合 HTTP 状态、响应内容、规则中的验证提示以及登录字段判断是否需要网页验证。常见流程：

1. 为书源设置 `loginUrl`；
2. 搜索、发现、详情、目录或正文命中登录/验证页；
3. 应用打开验证页面；
4. 用户在 WebView 中完成登录或验证；
5. Cookie 同步到书源请求；
6. 返回后重试原操作。

#### `loginUi` 控件

静态 `loginUi` 通常是控件数组，当前识别：

| `type` | 显示/行为 |
| --- | --- |
| `text`、`input`、`email`、`number` | 普通输入框。 |
| `password` | 密码输入框。 |
| `toggle` | 开关，使用 `chars` 的第 1/2 项作为关闭/开启值。 |
| `select` | 选择框，候选值来自 `chars`。 |
| `button` 或其他带 `action` 的项 | 执行登录/接口动作。 |

控件可使用 `name`、`viewName`、`placeholder`、`value`、`default`/`defaultValue`、`chars`、`action` 和 `style`。输入、开关与选择值写入 `source.loginInfo`；重新打开面板会恢复。对于原书源把开关伪装成按钮的情况，应用还会根据名称、动作及脚本持久化状态推断“已开启/已关闭”，但新书源应优先使用明确的 `toggle`/`select`。

`loginUi` 也可以是动态 `@js:`/`<js>` 脚本，返回控件数组 JSON。动态控件生成和按钮动作均有超时、输出大小和网络响应限制。

#### 登录动作 ArkWeb 桥

登录动作使用独立 ArkWeb 运行环境，不会让搜索或正文自动改走登录页面。当前桥接包括：

- `java.ajax` 的受控 HTTP 请求与逐步响应回填；
- `source.variable`、`loginHeader`、`loginInfo`、`source.get/put` 和 `cache` 状态；
- Cookie 获取、设置、替换、按名称删除及网页 Cookie 回写；
- Base64/Base64URL、Hex、URL/HTML 编解码、字节数组和 UUID；
- `createSymmetricCrypto` 的 AES/DES/3DES 常见变换；
- `startBrowser`、`startBrowserAwait`、`showBrowser`、`openUrl`；
- 登录动作中的 `java.webView`（加载指定 URL 并执行脚本后回传结果）；
- `searchBook`、`refreshExplore`（触发该源发现页刷新）、`reLoginView` 等 UI 动作。

`startBrowserAwait` 会暂停当前脚本，打开网页，用户点击完成后将页面返回值交回同一动作继续执行。浏览器关闭、取消、网络失败或脚本超时会结束执行并恢复按钮状态，不应永久停在“执行中”。用于“书源更新”的按钮可以打开源提供的更新页面；页面是否真正更新配置取决于该脚本是否返回并保存了新数据，不能仅凭打开网页判定更新成功。

当 `loginUrl` 本身是 `<js>…</js>` 或 `@js:` 包裹的脚本时，登录动作执行前会先剥掉这层包装，脚本内定义的函数才能进入作用域；书源登录脚本定义了 `login()` 且面板存在输入项时，登录面板会出现“确认登录”按钮，点击即显式调用 `login()`。`showBrowser` 打开的同源会话页面会注入 `window.source` 桥接（`getVariable`/`putVariable`/`reLoginView`），预载脚本在每次页面加载完成后重新注入；用户点击“完成”时，变量改动会写回书源并热更新后续执行使用的运行时。

请求规则中的 `<js>startBrowserAwait(...)`、`getVerificationCode(...)` 等提示也可触发验证逻辑，但不是完整 Android WebView/Activity API。需要账号口令签名、动态参数或复杂验证码的网站，必须实机确认。应用不按站点名称提供私有接口适配，全部请求参数和解析逻辑应来自书源本身。

登录动作会通过确定性脚本重放完成多次 `java.ajax` 和网页等待。Cookie 写入、替换和删除操作会记录并去重，避免重放时重复修改会话；`cookie.setCookie()` 传入 `token=...; deviceId=...` 这类请求头形式时，会区分真正的 Cookie 属性并把多个键分别写入 ArkWeb。脚本在 AJAX 前写入的 `source`/`loginInfo` 状态会合并到当前请求上下文。`getLoginInfo`/`getLoginInfoMap` 对空格、标点差异的键名做兼容，只有一个可用 Token 类字段时也可作为回退值。

### 有声书源与音色

有声书源可通过 `bookSourceType: 1`、书籍 `type` 的音频位，或书源明确提供的类型/标签元数据标记。正文规则应最终返回一个可播放的 HTTP/HTTPS 音频地址。若 `content` 为空或只是基础地址规则，目录中的 `chapterUrl` 可直接作为播放地址；签名流不要求具有音频文件扩展名。

当章节地址显式带有 `webView: true`（写在目录的 `chapterUrl` 规则里，或由脚本拼进章节地址）时，应用可在隔离 ArkWeb 中加载书源给出的章节页，并从 `<audio>`、`<source>`、`<video>` 或页面资源中提取候选媒体 URL；失败后仍回退普通正文规则。没有 `sourceRegex` 时只接受常见媒体扩展名，并且只在没有正文规则的情况下嗅探。该行为不包含站点专用接口或解密。

音频规则还支持以下写法：

- **`@webjs:脚本`**：`audioUrl` 或 `content` 以 `@webjs:` 开头时，脚本在渲染后的章节页内执行，返回值必须是 HTTP(S) 音频地址。播放器常在页面稳定之后才写入地址，所以脚本没有返回地址时会每隔约 0.5 秒重跑一次，最多 10 次，并受整次网页请求超时约束；仍未返回地址时报错，不会把页面 DOM 当成音频。脚本应写成可重复执行的取值表达式，不要在其中做点击、提交这类有副作用的操作。
- **地址携带请求头**：规则结果或章节地址可写成 `https://cdn.example.com/1.mp3,{"headers":{"Referer":"https://audio.example.com/"}}`，其中的请求头会用于播放请求，并覆盖书源 `header` 中的同名项。
- **跨站请求头收敛**：音频与书源不在同一站点时，书源 `header` 里的 `Cookie`、`Authorization`、`Proxy-Authorization`、`Host`、`Origin` 不会发往音频主机，`Referer` 和 `User-Agent` 保留；音频主机自己的 Cookie 仍按地址从 Cookie 容器补充。跨站 CDN 需要凭据时，请用上面的地址请求头显式声明。

播放页支持：

- 播放/暂停、进度、倍速、上一章/下一章和目录跳转；
- 定时停止；
- 音色代码输入，留空表示书源默认值；
- 将音色写入 `book.getVariable('custom')`，刷新当前音频地址；
- 返回书架或进入后台继续播放，并通过全局胶囊/系统 AVSession 控制；听书页和全局朗读面板可切换目录正序/倒序，切换只改变展示索引，不改变章节的规范索引和 `chapterUrl`。

目录正序/倒序、当前章节自动定位、简介文本选择和返回书架后的阅读进度刷新属于阅读器/播放器界面行为，不需要书源增加字段，也不会改变 `chapterList`、`chapterName`、`chapterUrl` 或音频地址的解析顺序。书源只需继续返回稳定的规范章节顺序，应用在界面层进行展示排序。

音色代码只有在书源规则实际读取 `book.getVariable('custom')` 或编码协议把该值带入音频请求时才会生效。若音频接口要求账号、Token、设备 ID 或购买权限，空音色或更换音色不能替代登录；应先确认接口返回的是真实音频而不是 401/JSON 错误页。

不要把账号、密码、长期 Token 直接提交到公共书源 JSON。优先通过登录页获取短期 Cookie，或仅在本机编辑 `loginHeader`。

## 开发与验证

### 先确认接口

记录每一阶段：

- 请求 URL、方法、query、body；
- 必须的 User-Agent、Referer、Cookie、Content-Type；
- 响应编码；
- 搜索列表路径和唯一书籍 ID；
- 详情页到目录的关系；
- 章节 ID、正文路径；
- 是否有重定向、登录、验证码、签名、加密。

优先选择站点公开且稳定的 JSON 接口；HTML 结构常改，复杂 JS 签名和反爬验证的维护成本最高。

### 按阶段增量开发

1. 只写顶层字段、`searchUrl` 和 `ruleSearch`；确保至少出现一条有书名、有详情 URL 的结果。
2. 写 `ruleBookInfo`；确认详情信息和 `tocUrl` 正确。
3. 写 `ruleToc`；确认章节数、顺序、名称、URL。
4. 写 `ruleContent`；先只提正文，再添加净化正则。
5. 最后复制/调整搜索规则为发现规则，补充分类和分页。
6. 再处理登录、Cookie、字符集、加密和 JS 兼容表达式。

### 应用内验收清单

书源可从文件或 URL 导入，也可在“我的 → 书源管理 → 新建书源”逐字段填写。完整验收清单：

- [ ] JSON 可导入，书源名称和地址正确；
- [ ] 导出后 `jsLib`、`loginUrl`、`loginUi`、五组规则和原始扩展字段没有丢失；
- [ ] 启用书源后能搜索到结果；
- [ ] 搜索未结束时可以滑动结果，停止搜索后不会继续追加旧会话结果；
- [ ] 搜索中文、空格、特殊字符时编码正确；
- [ ] 书名和详情 URL 不为空；
- [ ] 相对详情 URL 和封面 URL 能正确补全；
- [ ] 搜索、发现和详情封面均为实际图片地址；列表页错误的非空封面不会指望详情规则自动覆盖；
- [ ] `author` 没有因宽泛选择器混入字数、阅读量或脚本源码，`wordCount` 已返回带正确单位的最终字符串；
- [ ] 详情字段不会被登录页或错误页污染；
- [ ] 目录 URL 正确，章节数和顺序合理；
- [ ] 目录页同时存在“最新章节”和完整目录时，没有重复或把最新章节倒插到最前面；正式规则失败时不把临时通用目录误认为校验通过；
- [ ] 第一章、中间章、最后一章都能加载；
- [ ] 随机抽查存在正文翻页的章节，确认 `nextContentUrl` 能拼接全部页面且不会循环；
- [ ] 正文没有导航、广告、脚本或整页错误信息；
- [ ] 开启段评后气泡跟随正确段落、可点击，翻页没有异常大空行；关闭段评后正文排版恢复；
- [ ] 朗读文本不包含 `LEGADO_READER_ACTION`、`<comment>` 或其他内部代码；
- [ ] 朗读不会逐个念出整行 `*****`、`#####`、`&&&&&` 等装饰符；含普通文字的特殊字符仍被保留；
- [ ] 漫画源图片顺序、请求头、长图宽度和上一/下一章行为正确；
- [ ] 有声书源能播放、暂停、切章、目录跳转、切换音色，并在后台/书架胶囊中继续控制；
- [ ] 发现分类可打开，翻页后内容变化；
- [ ] 登录/验证后 Cookie 能继续用于后续请求；
- [ ] 登录面板中的输入、开关、选择项和按钮状态关闭后重开仍保持；
- [ ] `startBrowserAwait` 完成或取消后按钮不会一直显示“执行中”；
- [ ] 站点 301/302、HTTP/HTTPS 或镜像变化时行为可接受。

运行应用时，搜索、发现和 WebBook 服务会输出包含 `[SC]`、`[ExploreCoordinator]`、`[WS]` 的日志，可重点查看：请求地址、状态码、响应长度、列表命中数量和第一条结果。日志中的请求地址只保留到路径，查询串和 URL 选项对象会被替换为长度占位（如 `?<len=128>`），避免把 Token、Cookie 参数写进日志；需要核对完整地址和参数时，使用下文的单书源调试。

### 单书源调试

书源管理页的操作菜单提供“调试”，书源编辑页在填写有效的 `bookSourceUrl` 后也可以直接进入调试页。调试页支持以下阶段：

- **搜索**：输入测试关键词，执行当前书源的搜索请求和列表字段解析。
- **发现**：输入可选关键词，使用第一个发现分类执行列表解析。
- **详情**：输入书籍或详情 URL，检查 `ruleBookInfo` 字段和 `tocUrl`。
- **目录**：输入书籍或目录 URL，最多抽样 32 章，检查章节名和章节地址。
- **正文**：输入章节 URL，检查正文规则返回的内容。
- **全链路**：从搜索或发现取得候选书，再依次执行详情、目录和首章正文。

执行明细会记录网络请求的最终地址、状态码、响应大小和摘要，以及每个字段的规则类型、输入数、匹配数、耗时、输出预览和错误。调试信息只用于当前诊断会话，不改变书源规则；调试阶段仍使用应用的正常请求、Cookie、登录和 ArkWeb 路由，因此不能替代真实账号状态下的最终验收。正文阶段的输入是章节 URL，详情和目录阶段的输入应是书源能够处理的书籍/目录 URL。

调试完成后可点击“导出报告”，通过系统文件选择器保存 JSON 诊断文件。报告包含执行阶段、网络轨迹、规则匹配和错误信息；导出时会对来源地址等字段执行脱敏处理，但规则内容和响应摘要仍可能包含站点或个人敏感信息，提交前应人工检查并删除 Cookie、Token、账号及其他私密数据。

当出现“请求成功但字段为空”时，先查看对应字段的匹配数和输出预览；当出现地址未解析、目录为空或正文为空时，按网络请求 → URL 规则 → 字段规则的顺序检查。调试日志中若出现 401/403、验证码或登录页，应先完成书源登录/网页验证，再重新运行对应阶段。

### 常见故障定位

| 现象 | 优先检查 |
| --- | --- |
| 书源完全不参与搜索 | `enabled`，以及 `searchUrl`、`bookList`、`name`、`bookUrl` 是否都非空。 |
| 浏览器能下载 JSON，但 URL 导入失败 | 确认返回体不是 HTML 跳转页；查看错误来自应用 HTTP、TCP、ArkWeb 下载还是系统下载；必要时改用本地文件导入。 |
| 导入提示 `[object Object]` | 当前版本会展开 `message/msg/reason/code`；若仍出现，保留完整错误和 URL，检查服务是否返回了非标准对象或空下载错误。 |
| HTTP 成功但列表为 0 | 响应实际是 JSON 还是 HTML；列表规则是否在完整响应运行；字符集和登录页。 |
| 提示网络错误（域名解析失败、超时、连不上） | 请求没有到达站点，与规则和登录无关；检查网络、书源地址的域名和端口。网络错误不会被当成“需要验证”，搜索与发现会直接显示具体原因。 |
| 列表命中但无结果 | 子规则上下文是否错误；最常见是 `name` 或 `bookUrl` 为空。 |
| 中文搜索乱码 | 使用 `{{searchKeyRaw}}` 并在 URL 选项中指定 `gb2312`/`gbk`。 |
| URL 中出现 `%257B`、关键字双重编码 | 不要预编码 `{{key}}`，或改用 `{{searchKeyRaw}}`。 |
| 详情能开但无目录 | `tocUrl` 是否在 `init` 后的上下文解析；是否错误拼到详情页目录；相对地址基准是否正确。 |
| 目录链接包含 `?name=...`，正文地址少了 `read.php` | 这是查询相对链接；应以章节列表响应的最终 URL 为基准。当前版本会保留文档路径；规则不要把完整 URL 再套 `encodeURIComponent`，只对参数值编码。 |
| 目录有标题但章节被丢弃 | `chapterUrl` 为空或仍含未解析的模板/JSONPath。 |
| 目录为空但不知道哪一步失败 | 当前版本会把具体原因显示在目录加载失败提示中：HTTP 状态或空响应、JSON 接口的错误信息、字段规则执行错误，或全部章节被丢弃；按提示修复对应环节。 |
| 正文多个段落被合并、行间出现很长空白 | 检查正文规则是否提取了 HTML 块而丢失段落边界。当前版本会把 `</p>`、`</div>` 转成段落分隔，并按独立段落渲染；不要在规则中把整段 HTML 先压成单行或插入大量普通空格。 |
| 正式目录规则失败但阅读页仍有目录 | 首次打开可能正在使用临时通用 HTML 目录；查看 `[WS] 通用目录兜底` 日志或“正式目录规则未匹配”提示。修好 `chapterList`，不要把临时结果当作书源有效。 |
| 目录末尾章节出现在最前面或重复 | 页面可能先渲染“最新章节”再渲染完整目录；优先让 `chapterList` 精确限制在完整目录容器，通用兜底只在正式规则 0 匹配时生效。 |
| 发现页显示 `renderCount('...')万字` | 普通 HTTP 不执行页面内脚本；从局部 `@html` 提取数字并用 `<js>` 换算，或在确实依赖渲染时使用 `webView`/`webJs`。同时确认它来自 `wordCount`，而不是宽泛的 `author` 多命中。 |
| `wordCount`、`lastChapter` 或 `updateTime` 已解析但卡片没有显示 | 确认使用的是当前版本的搜索/发现组件，并检查字段规则是否返回空字符串；卡片会以元数据行显示字数、最新章节和更新时间。不要误把多个同 class 元素都塞进 `author`，除非明确接受元数据污染。 |
| 发现有封面、详情后封面仍错误 | 详情规则不会覆盖非空列表封面；先修正 `ruleSearch`/`ruleExplore.coverUrl`，或让不可靠的列表封面返回空值。 |
| 正文返回整页文字 | `content` 选择器太宽；先缩到正文容器，再用 `replaceRegex`。若脚本最终没有返回内容，应用会改为上报正文错误而不是返回输入页。 |
| 正文是空字符串 | 请求失败、被验证拦截、提取规则为空，或提取结果被净化正则全部删除。若错误提示是服务端原文（如“仅支持网页端访问”“Token验证失败”），说明阶段脚本的 `java.ajax` 已被调用但接口拒绝了本次请求，应检查该接口要求的 UA、`Referer`、`X-Requested-With` 等请求头是否由书源写全。 |
| `java.getString`/`getStringList` 一直返回空 | 确认规则语法正确（选择器 + `@text`/`@html`，`@@` 取全部）；`$.` 开头的 JSON 路径会直接取值。规则由原生引擎在阶段重放中求值，规则过多或依赖 DOM 渲染的站点仍需检查。 |
| `@js:` 动态请求头没有生效 | 确认脚本返回 JSON 对象或 JSON 字符串；动态头只发送到书源自己的主机，第三方图片/内容域不会收到；URL 选项的 `headers` 覆盖同名项，运行时不可用时回退静态解析。 |
| 动态请求头里的时间戳几分钟内不变 | 结果默认缓存约 5 分钟；让脚本在返回对象中加入 `"@cache": false`（或缓存秒数）。 |
| 哈希、校验和脚本算出的值不对 | 位运算和类型化数组只在分阶段 ArkWeb 中可用；当前版本遇到这些语法会自动路由。若符号只出现在 `eval` 的字符串里，路由判断看不到，请把代码直接写在规则或 `jsLib` 中。 |
| `webJs` 里的 `fetch` 没有返回内容 | 确认脚本最后一个表达式就是该 Promise（不要漏掉 `return` 或把它赋给变量后结束）；兑现值应为字符串；跨域请求受 CORS 限制；错误提示“webJs 执行失败”后面是 Promise 的拒绝原因。 |
| 正文脚本拿到的是 JSON 明文且解码失败 | 章节地址为 `data:` 且尾部选项声明了 `type` 时，脚本输入是十六进制字节串，需要先 `java.hexDecodeToString(result)`；未声明 `type` 时依靠规则内调用 `java.hexDecodeToString(result)` 等字节串函数识别。 |
| `text.下一页@href` 没有继续翻页 | 检查链接的“下一页”是否为 `<a>` 自身直接文本；若文字包在子元素中，改用稳定 CSS 或 `:contains()`。还要确认下一页不是 JavaScript 点击事件。 |
| 书源脚本提示“网络请求次数过多” | 同一请求规格的重复次数与不同请求总数分开限额：重复请求同一地址按阶段预算（最多 12 次）拦截，不同地址上限至少 16 次；若在多分类/多分页场景出现，检查脚本是否在循环里重复请求同一地址且没有命中响应缓存。 |
| 有下一页规则但正文仍不完整 | `nextContentUrl` 只能跟随真实分页链接；若服务端 HTML 已截断而完整正文位于页面脚本状态/渲染 DOM，改用显式 `webView: true` / `webJs` 返回完整内容。 |
| 正文显示 `JSON.parse(undefined)` | 检查脚本变量是否由 `data:` 负载、`java.ajax` 或上一条规则提供；不要假定不存在的字段会自动变成 `{}`。 |
| 朗读一直念星号、井号或与号 | 当前版本会过滤只由常见装饰符组成的整行，也会静音正文中的长重复装饰符号（URL 中的 `://` 会保留）；若符号与推广文字混在同一行，仍可使用 `replaceRegex` 精确清理该站文本。 |
| 开启段评后正文显示内部代码 | 确认返回的是 `<comment ident count>` 或 `<img ident>` 支持格式，并在正文清理前进入统一交互后处理；TTS 必须使用剥离动作标记后的文本。 |
| 段评气泡存在但无法点击 | `ident` 必须是完整或可补全 URL，并包含正确书籍/章节 ID；同时检查段评开关、登录 Cookie 和后端返回。 |
| 章尾互动卡片显示成“段评 0” | 章尾卡片的 `data:image` 选项应携带以 `xyCommentTail` 开头的 `marker` 选项；应用据此显示“章评”且不加计数气泡。 |
| 登录按钮脚本超时 | 检查动作是否等待未完成的网页、反复请求同一 URL、调用未映射的主机方法，或超过网络/脚本限制；错误提示中的“缺少兼容能力”优先处理。 |
| 登录面板开关没有状态 | 新源使用 `type: "toggle"`/`"select"`、`chars` 和默认值；旧按钮式开关需确保动作把状态写入 `source`、`java` 或 `loginInfo`。 |
| 有声书有目录但不能播放 | 确认 `chapterUrl` 已返回可播放地址；若使用页面抓取，确认章节地址的请求选项显式包含 `webView: true`，且 `sourceRegex` 能匹配页面媒体请求（按 Java 正则书写，留空时只认常见媒体扩展名）；同时检查登录、Token、音色代码和响应是否为 401/JSON 错误。 |
| 音频在书源站点能播、换到 CDN 域名后 401/403 | 跨站播放不会携带书源 `header` 里的 `Cookie`、`Authorization` 等凭据。CDN 确实需要时，在音频地址后用 `,{"headers":{...}}` 显式声明。 |
| `@webjs:` 音频规则提示未返回 HTTP(S) 音频地址 | 脚本最多重跑 10 次仍没有取到地址：确认表达式读取的是播放器真正写入地址的属性，并且返回完整的 HTTP(S) 地址而不是相对路径或对象。 |
| 发现第 2 页仍请求第 1 页的地址 | 使用页码候选时确认尖括号内有逗号分隔的候选；分组在 `{{…}}` 之外含圆括号或引号时不会被当作页码候选。 |
| 改了 `exploreUrl` 或发现规则，发现页仍是旧内容 | 在书源管理中保存编辑、重新导入或删除书源都会让该源的发现缓存失效；若仍是旧内容，确认保存成功，且编辑的是当前 `bookSourceUrl` 对应的书源。 |
| `\w`、`\d`、`\b` 的匹配结果与在浏览器里测试的不一样 | 应用按 Android 语义转换：`\w` 包含汉字，`\d` 包含全角数字，`\b` 不会落在两个汉字之间。只需要 ASCII 时改写为 `[A-Za-z0-9_]`、`[0-9]`。 |
| 替换净化规则在规则页测试通过，阅读时却没生效 | 规则可能超时被跳过（单条最多 3 秒，整章 8 秒），或依赖 `\W`、`[^x]` 跨段落匹配；需要跨行时显式写 `\n`、`\s` 或 `(?s)`，并收紧 `.*` 一类宽泛匹配。 |
| CSS 在小页面可用、大页面失效 | HTML 超过 4 MiB 保护阈值；寻找 JSON API 或减少响应。 |
| Android 阅读中可用、此处不可用 | 查看该阶段是否路由 ArkWeb、是否调用未映射 `java/source/cache/cookie` 方法、浏览器直连网络、复杂 XPath/CSS 或未消费字段。 |

### 批量书源校验状态

书源管理提供两种校验模式：

- **搜索能力**：使用固定测试关键字检查搜索请求和最小结果字段，速度较快；只有该模式允许对“明确失败”项自动禁用或删除。
- **发现/阅读链路**：逐源执行真实的“发现分类 → 最多前 8 个分类 → 最多 4 本候选书 → 详情 → 目录抽样 → 最多 3 个非 VIP/非付费章节”。目录最多抽样 32 章，并根据书籍类型确认正文非空、漫画至少有图片或有声书得到 HTTP(S) 播放地址。该模式只报告，不自动处理书源。

校验不是简单的“成功/失败”二值：

| 状态 | 含义 |
| --- | --- |
| 通过 | 搜索模式解析出至少一条有效书籍；或发现/阅读模式完整通过发现、详情、目录和内容样本。 |
| 失败 | 缺少必要规则、明确的 4xx 请求错误、规则/选择器语法错误或预检判定不安全。 |
| 无结果 | 请求和规则执行完成，但测试关键字、发现分类或候选样本没有有效结果。 |
| 需要验证 | HTTP 401/403，响应被识别为登录/验证码页面，或全链路样本只有 VIP/付费章节而无法安全测试。 |
| 暂时异常 | 超时（含单书源搜索 60 秒整体超时和书源限流排队超时）、取消、429、5xx、空响应、响应过大或其他暂时网络问题。 |

校验模式使用更保守的限制：“搜索能力”校验的并发跟随搜索并发数设置，“发现/阅读链路”校验逐个书源执行；单响应 512 KiB、单条可执行规则 32 KiB、书源脚本配置 512 KiB，并拒绝高风险嵌套正则。日常搜索允许更大的响应和聚合脚本，因此“校验失败：配置过大”不必然等于日常链路完全不能运行，但仍应缩小测试脚本或按阶段验证。401/403 应归类为“需要验证”，不应批量禁用或删除。

校验完成后，结果面板提供两类处理方式：

- **批量禁用**：只对明确失败的书源执行，锁定书源不会被自动处理；
- **删除失败项**：批量删除明确失败的书源，锁定书源会被跳过。

“无结果”“需要验证”和“暂时异常”不会自动进入失败项，避免因为测试关键字、登录状态或临时网络问题误删书源。校验进度只展示已校验数量、状态和自动处理结果，不以“命中 X 本”作为用户可见结论。

若普通 HTTP 客户端明确报告证书校验错误，结果页可由用户选择仅信任报错的精确主机并重试。该例外只保存在本机，不扩展到子域、同级域名或重定向主机，并可从书源操作菜单撤销。跳过证书校验会增加连接被冒充或监听的风险，不能作为书源的默认配置，也不适用于隐藏 ArkWeb 的浏览器证书页面。

### 编写质量建议

- 只使用目标站授权或允许访问的内容，并遵守服务条款、版权和访问频率限制。
- `bookSourceUrl` 使用稳定的站点根地址，不要把搜索参数当作唯一键。
- 规则尽量短、确定；优先明确 ID/class/JSON 字段，少用跨整页的贪婪正则。
- 列表规则只负责选元素，字段规则只负责取字段，净化规则只负责清理文本。
- 必填字段不要依赖兜底逻辑；应用不会按站点名称补造接口、参数或解密，通用容错也不是书源 API。
- 请求头只保留必要项。伪造过多浏览器安全头可能比缺省更容易失效。
- `replaceRegex` 从小到大增加，并用第一章、VIP 章、最后一章验证，避免误删全文。
- 对 JSON 中的反斜杠进行双重转义。例如正则 `\s+` 在 JSON 字符串中写作 `"\\s+"`。
- 提交公共书源前删除 Cookie、Token、账号、设备标识和调试接口。
- 在备注中说明源类型、登录要求、已知限制和维护日期。

## 兼容性与迁移

### 字段能力矩阵

| 状态 | 字段/能力 |
| --- | --- |
| 通用链已实际使用 | 搜索/发现的列表、书名、作者、封面、简介、分类、状态、最新章节、字数、更新时间、详情 URL；发现两级分组和动态原生筛选；`jsLib` URL 构建和持久化源变量；分阶段 ArkWeb；显式 `webView`/`webJs` 请求；动态登录输入/开关/选择/按钮、同站点 Cookie、幂等 Cookie 重放、浏览器等待；详情 `init`、书籍字段、状态、`updateTime`、目录 URL；目录列表、章节名、章节 URL、下一页、VIP、付费状态、更新时间；正文内容、图片、图片请求头、书源规则内图片解码、漫画模式、下一页、净化正则和 JS；普通书/漫画/有声书类型；书源请求限流。 |
| 已接入并可安全灰度 | QuickJS 启动自检、持久化纯表达式比对、合格指纹灰度接管、失败回退和熔断；不直接执行主机函数，也不替代选择器或复杂 ArkWeb 脚本。 |
| 编码数据已实际使用 | 标准 `data:` 文本、Base64 负载，以及带明确 HTTP(S) URL 的通用 `type: "request"` 请求描述。应用不提供平台协议、候选后端或站点专用会话补丁。 |
| 可导入/编辑，但通用链目前未消费 | 正文 `title`；顶层 `loginCheckJs`（只参与是否需要登录的识别，脚本不执行）、`bookUrlPattern`。 |
| 通用链已使用，但编辑页没有输入项 | 正文 `sourceRegex`，只能通过导入 JSON 带入。 |
| 模型或紧凑格式存在，但通用导入/UI/执行不完整 | `chapterListAddition`、`payAction`、`bookListRule` 等。 |
| 不应假定与 Android 版等价 | 任意 Java/Android 类导入、全部 `java.*` API、完整 XPath/CSS、付费购买动作、交互式验证码自动处理及非白名单二进制解码流程。 |

### 尚未实现的 Android 阅读能力

下列字段和接口在 Android 阅读中有实际行为，当前既不执行也没有等价替代。书源依赖它们时，导入不会报错，但相应环节不会生效：

| 类别 | 未实现项 | 影响 |
| --- | --- | --- |
| 登录 | 请求后的 `loginCheckJs` 响应检查 | 依赖它在日常请求中续期会话或修正响应的书源，登录过期后不会自动恢复。 |
| 搜索 | `bookUrlPattern` 的详情页分派、`checkKeyWord` | 搜索直接跳到详情页的站点不会按详情解析；校验使用应用固定的测试关键词。 |
| 目录 | `ruleToc.preUpdateJs`、`ruleToc.formatJs` | 更新目录前的动态地址刷新和汇总后的标题格式化不会执行。 |
| 目录 | `isVolume` 分卷条目 | 普通目录规则不读取该字段；脚本直接返回章节数组时，标记为分卷的条目会被丢弃。原生书源支持分卷，见第一部分的[目录](#目录-toc)。 |
| 图片与文件 | `coverDecodeJs`、`downloadUrls` | 封面解码脚本和在线文件书源的下载地址不生效。 |
| 脚本接口 | `java.queryTTF`、`java.replaceFont`、压缩包读取与文件类接口、`java.ajaxTestAll`、`java.webViewGetSource`、`java.webViewGetOverrideUrl` | 字体反混淆源和压缩内容源无法解析；调用这些接口的脚本得不到结果，其中字体、文件和压缩类接口会直接被判为不支持。 |
| 请求选项 | `js`、`webViewDelayTime`、`dnsIp` | 写了不会报错，也不会生效；网页等待使用应用自己的稳定判定。 |

### 通用兜底边界

当前项目只保留与站点无关的容错和显式能力，例如清理模板残留、解析标准相对 URL、从通用字段回退详情地址、提取可读 HTML、处理明确的编码数据，以及由书源声明的 `session` 会话规则。应用不会根据站点名称或私有接口提供自动修复；书源应完整声明请求和解析规则。

### 改写为原生书源

兼容书源不会自动转换成原生书源，需要按[第一部分](#第一部分原生书源)重写。对照关系见[与兼容书源的差异](#与兼容书源的差异)，大致是：

- 选择器规则（JSONPath、CSS、XPath、`##` 正则）可以原样搬过去；
- 拼地址、条件判断、字段整理的脚本改成 `=` 表达式或 `{{ }}` 模板；
- 签名、解密这类算法用内置加解密函数，或写进 `lib` 函数库；
- `java.ajax` 追加请求改成 `content.fetch`；
- 登录面板、发现页筛选、段评卡片这些由脚本生成界面的部分，改成 `login`、`vars`、`comments` 声明，界面由应用生成。

同一个书源地址只能存一条书源。在原地址上导入原生版本会替换掉兼容版本，旧的书源变量和登录状态不会沿用。

### 与 Android 阅读书源互导

导入 Android 阅读书源时建议：

1. 保留标准对象形式的 `ruleSearch` 等规则组；
2. 删除当前不需要的字段，先验证最小链路；
3. 将复杂 XPath 改为 JSONPath/CSS；
4. 简单 JS 优先改为模板或 `##`；确需完整语义时确认该阶段已路由 ArkWeb，且只调用已桥接主机方法；
5. 普通 HTTP 可直接完成时优先使用 HTTP；页面必须执行脚本时可在该 URL 选项设置 `webView: true`，交互式验证码仍通过验证页由用户完成；
6. 对登录、Cookie、加密源逐项实机验证；
7. 对普通书、漫画、有声书和段评分别验证正文后处理与播放器；
8. 不以“导入成功”或“校验通过”作为全链路兼容的证明。

## 完整模板

下面模板列出当前可导入的主要字段，复制后删除不需要的项：

```json
[
  {
    "bookSourceName": "",
    "bookSourceUrl": "https://example.com",
    "bookSourceType": 0,
    "bookSourceGroup": "",
    "bookSourceComment": "",
    "loginUrl": "",
    "loginUi": "",
    "loginCheckJs": "",
    "loginHeader": "",
    "bookUrlPattern": "",
    "searchUrl": "",
    "exploreUrl": "",
    "jsLib": "",
    "header": "{}",
    "variableComment": "",
    "enabled": true,
    "enabledExplore": true,
    "enabledCookieJar": true,
    "isPinned": false,
    "isLocked": false,
    "weight": 0,
    "customOrder": 0,
    "respondTime": 180000,
    "concurrentRate": "",
    "customButton": false,
    "eventListener": false,
    "ruleSearch": {
      "bookList": "",
      "name": "",
      "author": "",
      "coverUrl": "",
      "intro": "",
      "kind": "",
      "lastChapter": "",
      "bookUrl": "",
      "wordCount": "",
      "status": "",
      "updateTime": ""
    },
    "ruleExplore": {
      "bookList": "",
      "name": "",
      "author": "",
      "coverUrl": "",
      "intro": "",
      "kind": "",
      "lastChapter": "",
      "bookUrl": "",
      "wordCount": "",
      "status": "",
      "updateTime": ""
    },
    "ruleBookInfo": {
      "init": "",
      "name": "",
      "author": "",
      "coverUrl": "",
      "intro": "",
      "kind": "",
      "status": "",
      "lastChapter": "",
      "wordCount": "",
      "updateTime": "",
      "tocUrl": ""
    },
    "ruleToc": {
      "chapterList": "",
      "chapterName": "",
      "chapterUrl": "",
      "nextTocUrl": "",
      "isVip": "",
      "isPay": "",
      "updateTime": "",
      "chapterListAddition": ""
    },
    "ruleContent": {
      "content": "",
      "title": "",
      "images": "",
      "sourceRegex": "",
      "audioUrl": "",
      "nextContentUrl": "",
      "replaceRegex": "",
      "imageDecode": "",
      "imageStyle": "",
      "payAction": ""
    }
  }
]
```

## 实现索引

需要继续扩展规则能力时，可从这些实现入口核对：

- 数据模型：`sourceengine/src/main/ets/model/data/Book.ts`
- JSON 导入兼容：`entry/src/main/ets/pages/BookSource.ets`
- 书源与搜索结果列表快捷操作：`entry/src/main/ets/pages/BookSource.ets`、`entry/src/main/ets/components/book/SearchBookResultList.ets`
- URL 相对地址解析：`sourceengine/src/main/ets/core/book/BookUrlResolver.ts`
- 编辑器字段：`entry/src/main/ets/pages/BookSourceEdit.ets`
- URL 和请求选项：`sourceengine/src/main/ets/core/rule/AnalyzeUrl.ts`
- 页码候选写法：`sourceengine/src/main/ets/core/rule/PageCandidateUrl.ts`，回归脚本 `scripts/page-candidate-url-check.mjs`
- 通用规则解析：`sourceengine/src/main/ets/core/rule/AnalyzeRule.ts`
- 规则中间值与执行目标：`sourceengine/src/main/ets/core/rule/RuleValue.ts`
- JSONPath：`sourceengine/src/main/ets/core/rule/JsonPathEvaluator.ts`
- Java 正则方言转换：`sourceengine/src/main/ets/core/rule/JavaRegexCompat.ts`（字符表由 `scripts/generate-java-regex-word-class.mjs` 生成）
- 带时间预算的净化替换：`sourceengine/src/main/ets/core/rule/BudgetedRegexReplace.ts`、`entry/src/main/ets/core/concurrency/ReaderContentPreprocessor.ets`
- JS 兼容层：`sourceengine/src/main/ets/core/rule/JsRuntime.ts`
- QuickJS 迁移运行时：`sourceengine/src/main/ets/core/script/QuickJsScriptRuntime.ts`、`QuickJsAsyncRouter.ts`、`QuickJsMigrationStore.ts`、`QuickJsRuntimeStatus.ts`、`QuickJsShadowExecutor.ets`
- 分阶段运行路由：`sourceengine/src/main/ets/core/book/BookSourceRuntimeRouter.ts`，回归脚本 `scripts/source-script-runtime-check.mjs`
- 动态 `@js:` 请求头：`sourceengine/src/main/ets/core/book/BookSourceHeaderRuntime.ts`
- 搜索/发现/详情/目录/正文 ArkWeb：`sourceengine/src/main/ets/core/book/BookSourceStageWebRuntime.ts`
- 显式 `webView` 请求：`sourceengine/src/main/ets/core/book/WebBookFetchRuntime.ts`；`webJs` 的 Promise 等待脚本：`sourceengine/src/main/ets/core/book/WebJsAwaitScript.ts`
- 阶段规则识别：`entry/src/main/ets/core/book/BookSourceStageRuleSupport.ts`
- 登录面板 ArkWeb：`entry/src/main/ets/core/book/BookSourceLoginWebRuntime.ts`
- 搜索流程：`entry/src/main/ets/core/book/SearchCoordinator.ts`
- 书源限流：`sourceengine/src/main/ets/core/http/BookSourceRateLimiter.ts`
- Web 能力探测：`entry/src/main/ets/utils/WebRuntimeAvailability.ets`
- 发现流程：`entry/src/main/ets/core/book/ExploreCoordinator.ts`
- 发现结果缓存与失效：`entry/src/main/ets/utils/ExploreResultCache.ets`
- 日志地址脱敏：`sourceengine/src/main/ets/utils/LogText.ts`
- 详情、目录、正文：`entry/src/main/ets/core/book/WebBookService.ts`
- 编码地址与快捷协议：`entry/src/main/ets/core/book/BookSourceDataUrlSupport.ts`、`sourceengine/src/main/ets/core/book/EncodedSourceUrl.ts`
- 正文交互后处理：`entry/src/main/ets/core/book/BookSourceInteractionPostProcessor.ts`、`sourceengine/src/main/ets/core/book/ReaderActionMarker.ts`
- 书籍类型识别：`sourceengine/src/main/ets/core/book/BookTypeSupport.ts`
- 有声书规则辅助（`sourceRegex`、地址请求头、`@webjs:`）：`entry/src/main/ets/core/book/AudioRuleSupport.ts`，回归脚本 `scripts/audio-rule-support-check.mjs`
- 有声书页面与后台播放：`entry/src/main/ets/pages/AudioBook.ets`、`entry/src/main/ets/utils/RemoteAudioPlayback.ets`、`entry/src/main/ets/utils/ReaderTtsFloatingSession.ets`
- 数据库存储：`entry/src/main/ets/model/data/AppDatabase.ts`
- 阅读器 V2 文档、分页和交互：`entry/src/main/ets/core/reader/ReaderV2Document.ets`、`ReaderV2Paginator.ets`、`ReaderV2RenderNode.ets`、`ReaderV2Interaction.ets`
- 阅读打开链路追踪：`entry/src/main/ets/utils/ReaderOpenTrace.ts`

书源校验与批量处理入口：

- 书源管理页及导入、校验、批量操作：`entry/src/main/ets/pages/BookSource.ets`
- 校验状态和后台校验任务：`BookSource.ets` 中的 `startCheckSources`、`bookSourceCheckProgressText`、`deleteFailedCheckedSources`
- 单书源调试页及阶段执行：`entry/src/main/ets/pages/BookSourceDebug.ets`、`sourceengine/src/main/ets/core/book/BookSourceDebugModels.ts`
- 调试请求和规则轨迹：`HttpClient.ts`、`RuleExecutionService.ts`、`BookSourceStageWebRuntime.ts` 中的 `BookSourceDebugContext`
- 发现/阅读全链路校验：`entry/src/main/ets/core/book/ExploreReadingValidator.ts`
- 用户控制的精确主机证书例外：`sourceengine/src/main/ets/core/http/TlsTrustStore.ts`
- 规则执行快照与阅读交互桥接：`entry/src/main/ets/core/book/BookSourceRuntimeSnapshot.ts`、`entry/src/main/ets/core/book/ReaderInteractionProvider.ts`
