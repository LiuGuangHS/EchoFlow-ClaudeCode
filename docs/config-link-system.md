# 深链接配置分发

配置生成器分发可导入的 Provider 模板。它分享所选 Provider 的连接参数和模型映射，不包含 API Key、访问令牌或本机标识。导入确认后 API Key 为空；已有同名且服务地址相同的 Provider 会跳过，不覆盖本机数据。

## EchoFlow 深链接

```text
echoflowcode://config/import?v=1&data=<url-safe-deflate-base64>
```

这与 `aionui://provider/add?...` 使用相似的自定义 URL scheme 形式，但属于不同应用。EchoFlow 注册的是 `echoflowcode` 协议；`config/import` 表示导入一个包含多个 Provider 的配置包。`data` 是 DEFLATE 压缩后的 URL-safe Base64 payload，不是 URL 中的明文 JSON。

Payload v1 包含 `version`、自填的 `source`、生成时间 `timestamp`，以及 `config.providers`。来源和时间戳没有签名，不能用来认证分享者。链接默认 30 天过期，验证时允许 5 分钟设备时钟偏差。

查看 [桌面配置分享说明](../desktop/docs/config-sharing.md) 了解字段和安全行为。
