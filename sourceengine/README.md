# @legado/sourceengine

书源解析内核，以 HAR 形式供应用模块依赖，最初是[开源轻页](https://github.com/wip3l/qingye-reader)的一部分。它包含：

- 兼容书源（阅读格式）的规则解析：`AnalyzeUrl`、`AnalyzeRule`、`JsonPathEvaluator`、`JavaRegexCompat` 与 JS 兼容层。
- 请求层：`HttpClient`、`CookieStore`、`TlsTrustStore`、`HttpAuth`、限流与网页验证支持。
- 原生书源：`NativeSourceSpec`、`NativeExpr`、`NativeSourceRunner`、`NativeSourceService`，以及 JS 函数库 `NativeJsLibrary`、后台会话 `NativeScriptSessions` 和受控接口 `NativeScriptHost`。
- 脚本运行时：QuickJS 运行、迁移与诊断，以及需要 ArkWeb 的阶段脚本运行时 `BookSourceStageWebRuntime` 和网页抓取 `WebBookFetchRuntime`。
- 数据模型：`model/data/Book.ts` 里的 `Book`、`BookChapter`、`BookSource` 等。

搜索、发现以及详情/目录/正文的调度（`SearchCoordinator`、`ExploreCoordinator`、`WebBookService`）不在本包里，由宿主应用实现；可参考开源轻页 `entry/src/main/ets/core/book/` 下的同名文件。

## 引入

```json5
// 应用模块的 oh-package.json5
"dependencies": {
  "@legado/sourceengine": "file:../sourceengine"
}
```

`build-profile.json5` 的 `modules` 里还要注册 `sourceengine`。

`Index.ts` 是主入口，只导出 `.ts` 文件，`.ts` 和 `.ets` 都可以从这里导入。`QuickJsDiagnostics` 和 `QuickJsShadowExecutor` 用到了 `@Concurrent`，必须是 `.ets` 文件，所以单独从子入口导入：

```ts
import { QuickJsDiagnostics } from '@legado/sourceengine/Diagnostics';
```

新增公开类型时，把它追加到 `Index.ts`（或 `Diagnostics.ets`）对应的文件分组里。

## 宿主应用需要接入的部分

内核不访问应用数据库，也不包含界面。下面这些由宿主提供：

| 接入点 | 做法 |
| --- | --- |
| 书源运行时状态持久化 | 实现 `BookSourceRuntimePersistence`（读取书源、写回 `variable` / `loginHeader` / `loginInfo`），在启动时调用 `BookSourceRuntimeStore.install(...)`。不安装时读到 `null`，写入被跳过。 |
| ArkWeb 宿主 | `BookSourceStageWebRuntime.get().attach(controller)`、`WebBookFetchRuntime` 需要页面里挂一个 `Web` 组件提供控制器；参考开源轻页的 [`BookSourceStageRuntimeHost.ets`](https://github.com/wip3l/qingye-reader/blob/main/entry/src/main/ets/components/BookSourceStageRuntimeHost.ets)、[`WebBookFetchRuntimeHost.ets`](https://github.com/wip3l/qingye-reader/blob/main/entry/src/main/ets/components/WebBookFetchRuntimeHost.ets)。 |
| Context | `TlsTrustStore.load(context)`、`QuickJsDiagnostics.initialize(context)` 等 Preferences 存储需要传入应用上下文。 |
| 网页验证 | 遇到验证页时 `VerificationSupport` 写入 AppStorage：`pendingVerificationUrl`、`pendingVerificationTitle`、`pendingVerificationTime`、`pendingVerificationSourceUrl`、`pendingVerificationLoginUrl`。宿主的验证页读取这些值。 |
| 原生脚本界面交互 | 启动时调用 `NativeSourceInteraction.setHandler(handler)`，实现 `toast`、`refreshExplore`、`openBrowser`。`openBrowser(request, true)` 应等待用户点“完成”并返回 `{ body, error }`，取消时返回错误；网页 Cookie 需按书源保存。轻页实现见 `AppSourceInteraction.ets`。 |
| QuickJS 诊断刷新 | 存储变化时更新 AppStorage 的 `quickJsMigrationRevision`、`quickJsValidationRevision`、`quickJsRegressionArtifactRevision`，界面可以监听这些值来刷新。 |

## 可选宿主端口

另一个应用复用本包时，可以通过 `SourceEngineHost.install(adapter)` 替换下面这些能力。这个调用在启动时、执行任何书源之前做一次，任务执行期间不要更换 adapter。每个端口都可以不提供；开源轻页不安装这个 adapter，但会独立安装 `BookSourceRuntimeStore` 和 `NativeSourceInteraction`。

端口都是可信的宿主代码，绝不能暴露给书源脚本。

| 端口 | 作用 | 不提供时 |
| --- | --- | --- |
| `imageScripts` | 运行 `content.imageDecode.script` 图片字节脚本：只拿到图片字节和受限的加解密能力，返回处理后的字节 | 内核自带的 QuickJS 执行器（一次运行 1 项，运行与等待合计最多 4 项） |
| `nativeScripts` | 为原生书源提供 JS 执行（脚本阶段与表达式里调用的 `js` 函数） | 内核自带的 QuickJS 会话 |
| `cookies(sourceUrl)` | 按书源返回 Cookie 存储（`SourceCookieJar`），实现按书源或按账号隔离 | 全局 `CookieStore` |
| `persistence(source)` | 按书源读写运行时登录状态 | `BookSourceRuntimeStore.install` 安装的实现 |
| `scripts` | 用宿主的执行器运行兼容书源阶段脚本。只有每次都在独立、有预算限制的上下文里执行时才能声明 `concurrent: true`；`forceFullScripts` 控制兼容脚本完整执行层；`allowSynchronousQuickJs: false` 禁止同步 QuickJS，也会使原生表达式中的 `js` 函数库不可用 | 兼容阶段默认隐藏 ArkWeb 串行执行；原生后台 `script` 使用 `NativeScriptSessions` |
| `requests` | 决定同一书源下等待者的先后和取消状态。请求频率窗口仍由本包维护，优先级只改变排队顺序，不会额外放出额度 | 按到达顺序等待窗口 |
| `web` | 网页会话租约，WebView 抓取与听书音频嗅探在租约内执行 | 直接执行 |
| `state` | 按书源记录最近一次失败原因 | 写入 AppStorage 的 `bookSourceStageLastError` |
| `diagnostics` | 接收分段耗时（HTTP 传输与首字节、限流等待、脚本拼装等） | 不记录，也不拼接耗时明细 |

`SourceEngineHost.setReaderImagesDeferred(source, true)` 不是端口，而是宿主对单个书源实例的开关：打开后正文辅助层先返回完整的图片标记，图片的下载、解密和重排由宿主按需逐张完成（见书源开发文档“图片清单与按需加载”）。它只能由宿主代码调用，不暴露给书源规则。

`NativeSourceImport.importObject` / `toBookSource` 只做定义转换，不清缓存、不访问网络或数据库；应用内导入仍用 `NativeSourceService.importObject`，它会清掉该书源的缓存。原生书源的声明式缓存按“定义 + 请求头 + 登录头 + 登录信息”分开，所以只用 `NativeSourceImport` 换了定义也不会读到旧值；登录站点的 Cookie 不参与分区，网页登录与退出登录时各自清缓存。

## 原生 JS 接入与验证

`NativeSourceService` 默认提供主线程 JS 函数库和后台脚本引擎，无需启用兼容书源的迁移开关。直接使用 `NativeSourceRunner` 的宿主则需提供 `scriptLibrary(code)` 与 `scriptEngine(code)`；请求、状态保存和交互接口通过 `NativeRunnerHost` 提供。缺少相应端口时，相关调用会明确报错。

`ui.refreshExplore()` 只通知宿主清理该书源发现缓存，列表重载由应用处理；`browser.verify/open` 需要可见网页界面，`browser.render` 则依赖 `WebBookFetchRuntime` 的隐藏网页宿主。原生脚本无法直接访问 ArkUI 或构造任意设置界面。完整接口与预算见[脚本阶段](../docs/book-source-development.md#脚本阶段-script)。

## 宿主兼容性回归

把 `DEVECO_HOME` 设为 DevEco Studio 的安装目录后执行 `node scripts/source-engine-host-check.cjs`。它覆盖默认串行与注入并发执行、Cookie、持久化、取消和原生书源导入；平台 API 用测试替身，不能代替真机验证。

## 回归检查

`scripts/` 里的 Node 回归脚本通过 `scripts/lib/ets-module-staging.mjs` 加载本模块的源码。这个工具把 `entry` 和 `sourceengine` 两个源码根合并成同一棵目录树，并把 `@legado/sourceengine` 的导入按名字改写成指向定义文件的相对导入。改动内核后至少运行：

```bash
node --experimental-strip-types scripts/native-source-check.mjs
node --experimental-strip-types scripts/native-js-check.mjs
node --experimental-strip-types scripts/native-script-check.mjs
node scripts/neutral-source-engine-check.mjs
```

改动 `AnalyzeRule`（选择器、属性提取、旧式写法）后再运行 `node --experimental-strip-types scripts/analyze-rule-check.mjs`。它用 `scripts/lib/load-analyze-rule.mjs` 把 AnalyzeRule 及其依赖加载进 Node（系统模块换成空桩，脚本会自动加上 `--experimental-transform-types` 重跑），把一组页面 × 规则的结果与 `scripts/fixtures/analyze-rule-golden.json` 比对，并打印 HTML 目录取字段的参考耗时。确认是有意改变选择器行为时，加 `--update` 重写基准。

## 可选的后台纯解析与定义缓存

`SourceEngineHostAdapter.nativeParsing(input, source)` 是可信宿主的后台解析端口，输入输出均为 JSON 字符串。当前仅对宿主通过 `setReaderImagesDeferred(source, true)` 标记的阅读请求启用；未接入时保持原有行为，下载调用不受影响。书源 JSON、规则语法和导入格式不变，不需要重新编写或迁移书源。

宿主在自己的 taskpool/Worker 中调用导出的 `NativePureParser.run(input)`，自行管理队列、优先级和工作线程生命周期。仅把 JSON 请求传入工作线程，不传递 `BookSource` 实例。工作线程启动时初始化一次 `SourceEngineHost`，其 `scripts.allowSynchronousQuickJs` 必须为 `false`；纯解析线程的脚本执行器应拒绝执行。解析器不会安装或替换宿主配置。输入和输出各限制为 8 × 1024 × 1024 个 UTF-16 代码单元；这不是字节数或 CPU 时间预算，宿主仍需限制并发和任务生命周期。

运行器只把纯选择器（`select`、`items`）送到后台；表达式、带 JS/模板标记的选择器，以及 `AnalyzeRule` 会隐式当 JS 求值的写法（同时含 `result` 和 `+`、`java.` 调用），都留在原执行上下文，判断规则见 `NativePureRule.isPure`。请求超过上限时不派发，后台出错时打一条警告并回到本线程按原路径解析，所以宿主侧失败不会让规则失败；只有取消会直接抛出，服务在后台任务前后都检查取消状态。`NativePureParser.run` 仍支持 `expression` 请求，供宿主自行使用。后台解析是可选的宿主优化，不会自动创建工作线程，也不保证单独接入就能消除全部滑动卡顿。

`SourceDefinitionCache` 缓存不可变的定义转换字符串，默认最多 8 条且键和值合计不超过 2 Mi 个 UTF-16 代码单元。每个实例绑定一个转换函数，完整原始定义作为键，转换失败不缓存，超大结果直接返回。`NativeSourceImport.importObject` 已接入该缓存，每次仍返回独立的 `BookSource` 实例并刷新转换时间；传入已有书源时保留原合并行为。不要把账号、Cookie、运行变量或可变执行对象放入定义缓存。
