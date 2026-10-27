# harmony-book-source-engine

HarmonyOS（ArkTS）书源解析内核，从[开源轻页（qingye-reader）](https://github.com/wip3l/qingye-reader)中拆出，供其他鸿蒙阅读类应用复用。

- **兼容书源**：读取阅读（Legado）格式书源，支持 CSS / XPath / JSONPath / 正则规则、Java 正则方言转换、`@js:` 与 `<js>` 脚本、登录与网页验证。
- **原生书源**：声明式规则、表达式与 `lib` 函数库；支持顶层 `js` JavaScript 函数库，以及搜索、发现、详情、目录、正文的后台 `script` 阶段；图片可按标准算法或 `imageDecode.script` 字节脚本解密，封面支持 `coverDecode` 与 `coverHeaders`；正文可声明点击后才取数的内联段评、章评页面（`content.comments.page` / `chapterPage`）。
- **请求层**：HTTP 客户端、Cookie、TLS 例外、Basic / Digest 认证、书源限流与重试。
- **脚本运行时**：原生书源使用 QuickJS 函数库与后台会话，受控接口提供请求、状态、登录和网页交互；兼容书源保留轻量解释器、分阶段 ArkWeb 与 QuickJS 影子/灰度迁移。
- **原生书源设置**：支持脚本登录、发送验证码、动作按钮与动态变量选项；提示、刷新发现页和网页验证由宿主接入 `NativeSourceInteraction`。
- **可选宿主端口**：Cookie、持久化、脚本执行器、请求调度、网页会话、错误状态与耗时诊断都可以由宿主替换。

内核不包含界面，也不访问应用数据库。搜索、发现、详情/目录/正文的调度由宿主应用实现。目前开源轻页和简听都以本仓库为书源内核。

## 轻页 4.3.929 接入说明

- 原生图片脚本提供 `image.reorderStrips` 横条重排；可解码的乱序图片须声明 `processPlainImages: true`，参数与限制见[书源开发文档](docs/book-source-development.md)。
- 宿主可选择先获取完整图片标记，再调度逐张下载与处理；完整缓存和导出保留默认物化流程。图片并发、可见页优先级和取消由宿主负责。
- 轻页新增的漫画本地 OCR、繁→简与主题包分享属于应用功能，不属于书源内核，也未增加翻译字段。接入差异见[轻页宿主文档](https://github.com/wip3l/qingye-reader/blob/main/docs/book-source-development.md)。

## 文档

| 文档 | 读者 |
| --- | --- |
| [书源规则开发文档](docs/book-source-development.md) | 书源作者。原生书源与兼容书源的字段、表达式、选择器、示例与调试方法，在本仓库统一维护，轻页和简听的文档入口都指向这里；宿主界面与安全策略由各应用自己说明 |
| [sourceengine/README.md](sourceengine/README.md) | 宿主开发者。HAR 的入口约束、必须接入的部分与可选宿主端口 |
| [封面解密接入](docs/cover-decoding.md) | 宿主开发者。原生书源可声明 `coverDecode`，宿主用公共 `SourceCoverLoader` 按需加载，支持 AES-CBC 文件前缀 IV |

原生 JS 有两条调用路径：表达式中按名调用 `js` 函数只做纯计算；阶段 `script: "函数名"` 在后台执行，可同步调用 `http`、`vars`、`cache` 等受控接口。它们不受兼容书源的 QuickJS 迁移模式控制。详见 [JS 函数库](docs/book-source-development.md#js-函数库-js)与[脚本阶段](docs/book-source-development.md#脚本阶段-script)。

## 仓库结构

```text
harmony-book-source-engine/
├── sourceengine/      # 书源解析内核 HAR，包名 @legado/sourceengine
├── quickjs/           # 修改版 ohos_quickjs HAR（@devzeng/quickjs），sourceengine 依赖它
├── scripts/           # Node 回归脚本
└── AppScope/ …        # 仅用于编译两个 HAR 的工程骨架，没有应用模块
```

`quickjs/` 是在 [ohos_quickjs](https://github.com/hhtczengjing/ohos_quickjs) 基础上修改的版本（增加了带时间与内存上限的受限执行等），不能换成 ohpm 上的公开版本。

## 在应用里使用

**方式一：源码模块（推荐）。** 把本仓库作为 git 子模块或直接复制到应用工程里，然后：

```json5
// 应用工程根目录 build-profile.json5 的 modules 里注册两个模块
{ "name": "sourceengine", "srcPath": "./harmony-book-source-engine/sourceengine" },
{ "name": "quickjs", "srcPath": "./harmony-book-source-engine/quickjs" }

// 应用模块的 oh-package.json5
"dependencies": {
  "@legado/sourceengine": "file:../harmony-book-source-engine/sourceengine",
  "@devzeng/quickjs": "file:../harmony-book-source-engine/quickjs"
}
```

**方式二：预编译 HAR。** 按下面的方法编译出 `sourceengine.har` 和 `quickjs.har`，放进应用工程后用 `file:` 引用这两个文件。注意子入口 `@legado/sourceengine/Diagnostics`（QuickJS 诊断）目前没有打进 HAR 的对外声明，需要它时请用源码模块。

宿主需要接入的部分（运行时状态持久化、ArkWeb 宿主组件、Context、网页验证）和可选宿主端口见 [sourceengine/README.md](sourceengine/README.md)。

## 编译

需要 DevEco Studio（HarmonyOS SDK API 20 及以上）。在 Git Bash 里：

```bash
export DEVECO_SDK_HOME="/c/Program Files/Huawei/DevEco Studio/sdk"
"/c/Program Files/Huawei/DevEco Studio/tools/ohpm/bin/ohpm" install --all
"/c/Program Files/Huawei/DevEco Studio/tools/hvigor/bin/hvigorw" assembleHar --mode module -p module=sourceengine@default,quickjs@default -p product=default -p buildMode=release --no-daemon
```

产物在 `sourceengine/build/default/outputs/default/sourceengine.har` 和 `quickjs/build/default/outputs/default/quickjs.har`。

## 回归检查

需要 Node.js 22 及以上：

```bash
for f in scripts/*-check.mjs; do node --experimental-strip-types "$f" || exit 1; done
DEVECO_HOME="/c/Program Files/Huawei/DevEco Studio" node scripts/source-engine-host-check.cjs
DEVECO_HOME="/c/Program Files/Huawei/DevEco Studio" node scripts/web-book-fetch-wait-check.cjs
```

| 脚本 | 检查内容 |
| --- | --- |
| `native-source-check` | 原生书源：表达式、各阶段字段、附加请求、目录分页、媒体错误原因 |
| `native-js-check` | JS 函数库：表达式调用、`native` 内置函数、参数返回值、定义校验与错误 |
| `native-comment-page-check` | 原生内联评论页：点击后才取数、字段校验、冷热上下文、过期操作、回退、取消、UTF-8 上限与安全注入 |
| `native-script-check` | 后台脚本：阶段返回值、请求与状态、登录和界面交互、动态选项、预算与取消 |
| `analyze-rule-check` | 兼容书源选择器与属性提取，结果与 `scripts/fixtures/analyze-rule-golden.json` 比对，并打印取字段耗时 |
| `source-cover-check` | 封面解密参数校验、图片嗅探与解密 |
| `image-strip-check` | 图片条带重排 `image.reorderStrips`：余数分片、排列、行填充、尺寸与动图处理、参数校验与资源释放 |
| `source-image-options-check` | 图片解密选项：`ivPrefixBytes` 与 `keyEncoding` 校验、图片字节脚本声明、分类菜单的 `list`/`fields` 覆盖、`book.url` 误用提示、目录首页地址优先级与 `coverHeaders` |
| `page-candidate-url-check` | 搜索与发现地址的页码候选写法 |
| `source-request-support-check` | 请求层：`Set-Cookie` 拆分、相对地址解析、`concurrentRate` 解析、规则变量表 |
| `source-script-runtime-check` | 脚本路由、异步 `webJs`、动态请求头缓存控制 |
| `http-auth-check` | Basic / Digest 认证质询解析与应答（RFC 2617 / 7616 标准向量） |
| `java-regex-compat-check` / `budgeted-regex-replace-check` / `replace-rule-import-check` | Java 正则方言转换、带时间预算的净化替换、净化规则导入 |
| `neutral-source-engine-check` | 内核里没有固定内容接口、默认凭据或站点专用后端 |
| `source-engine-host-check.cjs` | 可选宿主端口：串行与并发执行器、Cookie、持久化、取消、原生书源导入 |
| `web-book-fetch-wait-check.cjs` | 网页抓取的等待条件：等待时长、条件未满足时保留页面、无效条件立即失败 |

这些脚本只在 Node 里跑纯逻辑，平台 API 用替身代替，不能代替真机验证。`scripts/image-binary-probe.mjs` 是另一类工具：用 OpenHarmony native SDK 编译生产用的 QuickJS 图片字节提取代码，通过 hdc 在真机上直接运行，不需要安装应用：

```bash
node scripts/image-binary-probe.mjs <OpenHarmony native SDK 路径> <hdc 路径> <设备 ID>
```

## 许可

本项目以 [GNU General Public License v3.0](LICENSE) 发布。使用、修改或分发本项目（包括把它链接进你的应用）时，需要遵守 GPL-3.0 的条款。

LICENSE 末尾附有一条 GPL-3.0 第 7 条附加许可（Harmony Book AI Engine 链接例外 1.0）：允许本项目与 Harmony Book AI Engine 链接并一起分发，AI 引擎部分不受 GPL 约束。这条例外只针对 Harmony Book AI Engine，不适用于其他库或程序；本项目其余部分仍完全按 GPL-3.0 授权。

第三方组件（ohos_quickjs、QuickJS、部分 Huawei N-API 封装代码）分别遵循 MIT 与 Apache-2.0 许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt)。

## 当前宿主验收

轻页 4.2.925 已接入原生 JS 函数库、后台脚本阶段与 NativeSourceInteraction。宿主应分别验收提示、发现缓存刷新、网页验证、脚本按钮忙碌状态和动态选项；Node 回归不能替代真机网页及 QuickJS 验证。书源格式仍以公共书源规则开发文档为准。

## 4.4.935 接入核对

轻页 4.4.935 纳入原生脚本响应头与请求编号、严格批量请求、条件重试、数字变量以及媒体跳转保护，并修复书列表 JS 字段批处理的对象返回表达式。字段语义与限制见[公共书源开发文档](docs/book-source-development.md)；历史真机验收记录不等同于所有宿主或设备均已验证。

## 4.4.936 接入核对

- 原生视频规则新增可选的 `content.videoPage`，返回当前集的原站播放网页；原生播放失败后的自动或手动回退、网页生命周期及选集操作由宿主接入，不保证绕过格式、登录或站点限制。
- 原生 JS 调用内置规则函数时使用 `native.函数名(...)`，错误提示补充此调用方式。字段示例和边界见公共书源开发文档。
