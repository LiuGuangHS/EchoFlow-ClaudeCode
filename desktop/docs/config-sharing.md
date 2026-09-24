# 配置分享 / Config Sharing

配置生成器用于分发可导入的 Provider 模板。它只分享用户选择的 Provider 连接参数，不分享 API Key、访问令牌、本机 ID 或应用设置。导入时 API Key 留空；同名且服务地址相同的 Provider 会跳过，不覆盖本机配置。

## 生成与导入

在 **设置 → 配置生成器** 中选择 Provider，可填写一个来源标识，然后生成链接。来源标识由链接创建者填写，仅用于导入预览，不代表经过认证的管理员身份。

接收者打开链接后会看到导入确认窗口。确认后新增 Provider；接收者需要自行填写 API Key。只导入来自可信来源的链接，因为模板包含服务商名称、地址和模型映射。

## 深链接格式

```text
echoflowcode://config/import?v=1&data=<url-safe-deflate-base64>
```

`data` 不是明文 JSON，也不是 AionUI 的 `{aionuiConfig}`。它是下方 v1 JSON payload 经 DEFLATE 压缩后，再进行 URL-safe Base64 编码的内容。`echoflowcode` 是桌面应用注册的协议；`config/import` 是配置包导入动作。

```typescript
{
  version: 1,
  source: 'team-admin',
  timestamp: 1234567890000,
  config: {
    providers: [{
      presetId: 'deepseek',
      name: 'DeepSeek (Team)',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      models: {
        main: 'deepseek-chat',
        haiku: 'deepseek-chat',
        sonnet: 'deepseek-chat',
        opus: 'deepseek-chat',
      },
    }],
  },
}
```

验证会检查 v1、时间戳、Provider 必填字段、协议和敏感字段。链接有效 30 天，并容忍最多 5 分钟的设备时钟偏差。时间戳与来源都由链接创建者提供，链接没有签名；它们不能证明创建者身份。

## EchoFlow 链接示例

下面展示真实格式；`data` 部分由实际 Provider 数据压缩生成，每条链接都不同：

```text
echoflowcode://config/import?v=1&data=eJw...（URL-safe 压缩数据）
```

可用 `generateDeepLinkUrl(config)` 生成完整链接，导入端由桌面协议处理器解码、验证，并显示确认弹窗。
