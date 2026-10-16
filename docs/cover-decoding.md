# 公共封面解密

书源字段、示例、算法和大小限制统一维护在[公共书源规则开发文档：加密封面](book-source-development.md#加密封面-coverdecode)。本页仅描述宿主加载协议。

引擎返回带 `#source-cover-v1=` 的 HTTP 封面地址，仅保存书源标识，不携带密钥或登录凭据。
宿主应保留该地址用于收藏/备份，并用 `SourceCoverUrl.isEncoded/source` 查找已导入书源，
在该源隔离会话中调用 `SourceCoverLoader.load(http, source, raw)` 获取明文 Uint8Array。
请求不发送片段、不自动添加 Referer；Cookie 使用现有 source + origin 隔离。
宿主负责按需调度、限制并发、缓存配额、登录/书源配置变化后的缓存隔离及图片解码。
请勿将编码地址直接交给系统 Image 或普通预下载器。

`SourceImageDecoder.decode(bytes, spec)` 可独立复用于其他图片入口，`SourceCoverUrl` 无平台依赖。
该实现不包含网站域名、网站密钥或网站专用选择器。其他宿主需要完成上述加载接入才可显示加密封面。

回归：`node --experimental-strip-types scripts/source-cover-check.mjs`。
