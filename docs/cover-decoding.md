# 公共封面解密

原生书源可在顶层声明 `coverDecode`，统一作用于搜索、发现和详情的 `fields.coverUrl`：

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

参数为字面值，不执行脚本。keyEncoding 默认 hex，也支持 utf8；AES 密钥为 16/24/32 字节。
`ivPrefixBytes:16` 表示文件前 16 字节是 IV，其余为密文；固定 IV 使用 32 位十六进制 `iv`，与前缀模式互斥。
算法支持 AES/CBC/PKCS5Padding 和 AES/CBC/PKCS7Padding。普通 JPEG/PNG/GIF/BMP/WebP/AVIF 图片直接通过；输入限 8 MiB，解密结果必须具有图片文件头。

引擎返回带 `#source-cover-v1=` 的 HTTP 封面地址，仅保存书源标识，不携带密钥或登录凭据。
宿主应保留该地址用于收藏/备份，并用 `SourceCoverUrl.isEncoded/source` 查找已导入书源，
在该源隔离会话中调用 `SourceCoverLoader.load(http, source, raw)` 获取明文 Uint8Array。
请求不发送片段、不自动添加 Referer；Cookie 使用现有 source + origin 隔离。
宿主负责按需调度、限制并发、缓存配额、登录/书源配置变化后的缓存隔离及图片解码。
请勿将编码地址直接交给系统 Image 或普通预下载器。

`SourceImageDecoder.decode(bytes, spec)` 可独立复用于其他图片入口，`SourceCoverUrl` 无平台依赖。
该实现不包含网站域名、网站密钥或网站专用选择器。其他宿主需要完成上述加载接入才可显示加密封面。

回归：`node --experimental-strip-types scripts/source-cover-check.mjs`。
