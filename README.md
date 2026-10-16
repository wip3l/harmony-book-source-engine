# harmony-book-source-engine

HarmonyOS（ArkTS）书源解析内核，从[开源轻页（legado-harmony）](https://github.com/wip3l/legado-harmony)中拆出，供其他鸿蒙阅读类应用复用。

- **兼容书源**：读取阅读（Legado）格式书源，支持 CSS / XPath / JSONPath / 正则规则、Java 正则方言转换、`@js:` 与 `<js>` 脚本、登录与网页验证。
- **原生书源**：开源轻页自定的声明式书源格式，带一套只做纯计算的表达式语言，不执行 JavaScript。
- **请求层**：HTTP 客户端、Cookie、TLS 例外、Basic / Digest 认证、书源限流与重试。
- **脚本运行时**：受限 QuickJS，以及需要完整 JavaScript 语义时的分阶段 ArkWeb 运行层。
- **可选宿主端口**：Cookie、持久化、脚本执行器、请求调度、网页会话、错误状态与耗时诊断都可以由宿主替换。

内核不包含界面，也不访问应用数据库。搜索、发现、详情/目录/正文的调度由宿主应用实现。

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
```

这些脚本只在 Node 里跑纯逻辑，平台 API 用替身代替，不能代替真机验证。

## 许可

本项目以 [GNU General Public License v3.0](LICENSE) 发布。使用、修改或分发本项目（包括把它链接进你的应用）时，需要遵守 GPL-3.0 的条款。

第三方组件（ohos_quickjs、QuickJS、部分 Huawei N-API 封装代码）分别遵循 MIT 与 Apache-2.0 许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt)。
封面解密接入见 [公共封面解密](docs/cover-decoding.md)：原生书源可声明 `coverDecode`，宿主使用公共 `SourceCoverLoader` 按需加载，支持 AES-CBC 文件前缀 IV。

书源作者请阅读[公共书源规则开发文档](docs/book-source-development.md)。规则格式与示例在此统一维护，轻页和简听的文档入口共同引用，宿主 UI 与安全策略由各应用维护。
