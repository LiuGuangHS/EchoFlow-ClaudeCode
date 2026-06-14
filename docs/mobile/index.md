# 移动端 Android 客户端

EchoFlow Code Mobile 是面向 Android 的远程客户端。它不会在手机上运行 Coding Agent 或桌面 sidecar，而是通过扫码或手动输入连接到已经运行的 EchoFlow Desktop / 本地服务，并在 WebView 中复用现有 H5 聊天界面。

适合的场景：

- 在可信局域网内用手机继续查看会话、发送消息和审批工具权限。
- 通过自建 HTTPS 反向代理、VPN、Tailscale、frp 或 Cloudflare Tunnel 远程连接自己的桌面端。
- 需要比手机浏览器更顺手的扫码、凭据保存、文件选择、剪贴板和原生权限审批体验。

## 能力范围

| 能力 | 状态 |
| --- | --- |
| Android 原生连接页 | 已支持 Server URL + H5 Token |
| 桌面端二维码 | 已支持扫码读取 H5 启动链接 |
| H5 Token 校验 | 打开 WebView 前校验 `/health` 与 `/api/h5-access/verify` |
| 凭据保存 | 使用 SecureStore 保存已验证连接 |
| 权限审批 | 工具权限请求可转发到原生审批弹窗 |
| 文件选择 | WebView 文件输入会调用原生 Document Picker |
| 剪贴板 | WebView 可通过原生桥接复制/粘贴 |
| iOS | 暂未做正式发布验证 |
| 手机本地运行 sidecar | 暂不支持 |

## 连接步骤

1. 在电脑上启动 EchoFlow Desktop 或本地服务。
2. 打开桌面端 `设置 -> General -> H5 访问`，启用 H5 并生成 Token。
3. 确保 Android 设备能访问电脑服务，例如在同一可信局域网打开 `http://<电脑局域网 IP>:<端口>/health`。
4. 在桌面端复制或展示 H5 扫码启动链接。
5. 打开 EchoFlow Code Mobile，扫码连接；也可以手动输入 Server URL 和 H5 Token。
6. 客户端校验成功后进入 H5 WebView，继续使用聊天、工具调用、权限审批和附件能力。

如果二维码里的 Server URL 是 `127.0.0.1` 或 `localhost`，手机无法访问电脑服务。请改用电脑的局域网 IP、VPN 地址或 HTTPS 域名。

## 网络建议

| 场景 | 推荐方式 |
| --- | --- |
| 同一 Wi-Fi 测试 | 使用电脑局域网 IP + H5 Token |
| 远程个人使用 | 使用 VPN、Tailscale、frp 或 Cloudflare Tunnel |
| 小团队访问 | 使用 HTTPS 反向代理，显式配置允许来源 |
| 公网开放 | 不推荐直接暴露；至少使用 HTTPS、强 Token、可信成员和最小来源白名单 |

H5 Token 会随 REST 和 WebSocket 请求发送。可信局域网可以临时使用 HTTP；跨公网或不可信网络时，请优先使用 HTTPS。

## 本地开发

移动端源码位于 `mobile/`。MVP 0 推荐使用 JDK 17：

```bash
cd mobile
bun install
bun run check
bun run start
bun run android
```

如果 Windows 上 Expo CLI 在 Bun 下不稳定，可以使用 `npx expo start` 和 `npx expo run:android` 作为 fallback。

## 和 IM 适配器怎么选

| 你想要 | 推荐入口 |
| --- | --- |
| 在手机上看到完整聊天 UI、审批权限、上传文件 | Android 客户端或手机浏览器 H5 |
| 在聊天工具里快速发任务、看进度、停任务 | Telegram / 飞书 / 微信 / 钉钉等 IM 适配器 |
| 团队成员共享入口 | HTTPS 反向代理 + H5 来源白名单，或按 IM 平台做用户配对 |

移动端和 IM 不是二选一：Android 客户端适合继续操作同一套 UI，IM 适合轻量命令和异步提醒。
