---
title: 深链接协议
nav_title: 深链接
description: echoflowcode:// 配置导入链接的格式、payload 字段、验证规则与安全边界。
order: 15
---

# 深链接协议

这一篇写给需要对接或排查配置分享链接的人：链接长什么样、里面装了什么、验证时查哪几项。只是想分享或导入配置的话，看[配置分享](./config-sharing.md)就够了。

## URL 结构

```text
echoflowcode://config/import?v=1&data=<url-safe-deflate-base64>
```

| 段 | 含义 |
|---|---|
| `echoflowcode` | 桌面应用注册的自定义 URL scheme |
| `config/import` | 动作：导入一个配置包（可含多个 Provider） |
| `v` | payload 版本，当前为 `1` |
| `data` | DEFLATE 压缩后再做 URL-safe Base64 编码的 payload，**不是**明文 JSON |

`data` 部分由实际 Provider 数据压缩生成，每条链接都不同。

这套形式和 `aionui://provider/add?...` 看起来相似，但属于不同应用、不同协议，payload 结构也不一样——它不是 AionUI 的 `{aionuiConfig}`。

## Payload v1

解压后的 JSON：

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

| 字段 | 说明 |
|---|---|
| `version` | 固定 `1` |
| `source` | 创建者自填的来源标识，只用于导入预览 |
| `timestamp` | 生成时间，毫秒 |
| `config.providers` | Provider 数组，含连接参数与模型映射 |

**payload 里没有 API Key、访问令牌或本机标识。** 这是设计上的边界，不是"当前恰好没带"。

## 验证规则

导入端会逐项检查，任何一项不过就直接拒绝：

1. 版本必须是 `1`；
2. 时间戳在有效期内；
3. Provider 的必填字段齐全；
4. 接口协议是受支持的；
5. 没有夹带敏感字段。

| 项 | 值 |
|---|---|
| 有效时长 | **30 天**，自 `timestamp` 起算 |
| 时钟偏差容忍 | 最多 **5 分钟** |

设备时钟差太多会导致验证失败，两台机器时间对不上时先校准系统时钟。

## 安全边界

:::warning
链接**没有签名**。`source` 和 `timestamp` 都由创建者自己填写，链接本身**不能证明创建者身份**——它不能用来认证"这份配置确实出自你们的团队管理员"。只导入来自可信来源的链接。
:::

导入端的另一条保护：**已有同名且服务地址相同的 Provider 会被跳过**，不覆盖本机已有配置。导入是增量操作，API Key 一律留空由接收者自填。

## 相关

- [配置分享](./config-sharing.md) — 怎么生成和导入一条链接
- [设置速查](./settings.md) — 「配置生成器」入口在哪
- [连接模型服务](../start/models.md) — Provider 与 API Key 怎么配
