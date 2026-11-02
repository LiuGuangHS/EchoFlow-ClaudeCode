# 配置分享 / Config Sharing

EchoFlow Code 桌面端支持从可信来源打开 `echoflowcode://` 配置导入链接。链接由外部管理员或服务提供方生成；应用不再内置链接生成器。导入前会显示确认窗口，同名且服务地址相同的 Provider 会跳过，不覆盖本机配置。

配置模板分享 Provider 连接参数和模型映射，不携带 API Key。兼容的 `provider/add` 链接可以单独携带 API Key；只打开可信来源发送的链接。

## 打开与导入

接收者需安装 EchoFlow Code 桌面应用，并通过可信渠道收到链接。打开链接后核对来源、Provider 名称和服务地址，再确认导入。普通配置模板导入后需自行填写 API Key；带有 `provider/add` API Key 的链接会将该密钥用于新 Provider。

链接创建者可填写来源标识用于预览，但该值没有签名，不能证明创建者身份。完整格式和校验规则见[深链接协议](../../docs/desktop/deep-link-protocol.md)。

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

下面展示链接格式；`data` 部分是压缩后的 URL-safe payload：

```text
echoflowcode://config/import?v=1&data=eJw...（URL-safe 压缩数据）
```

导入端由桌面协议处理器解码、验证，并显示确认弹窗。完整字段与验证规则见[深链接协议](../../docs/desktop/deep-link-protocol.md)。
