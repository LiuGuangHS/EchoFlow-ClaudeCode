# Android Mobile Client

EchoFlow Code Mobile is a remote Android client. It does not run the coding agent or desktop sidecar on the phone. Instead, it connects to a running EchoFlow Desktop / local server by scanning a launch link or entering a Server URL and H5 Token, then opens the existing H5 chat UI in a WebView.

It fits these workflows:

- Continue sessions, send messages, and approve tool permissions from a phone on a trusted LAN.
- Reach your own desktop through HTTPS reverse proxy, VPN, Tailscale, frp, or Cloudflare Tunnel.
- Use a native shell for QR scanning, credential storage, file picker, clipboard, and approval prompts.

## Scope

| Capability | Status |
| --- | --- |
| Native Android connect screen | Server URL + H5 Token |
| Desktop QR launch link | Supported |
| H5 Token verification | Checks `/health` and `/api/h5-access/verify` before WebView |
| Credential storage | SecureStore |
| Permission approvals | Native approval modal bridge |
| File input | Native document picker bridge |
| Clipboard | Native clipboard bridge |
| iOS | Not release-validated yet |
| Running sidecar on phone | Not supported |

## Connect

1. Start EchoFlow Desktop or the local server on your computer.
2. Open `Settings -> General -> H5 Access`, enable H5, and generate a Token.
3. Make sure the Android device can reach the service, for example `http://<desktop LAN IP>:<port>/health`.
4. Show or copy the desktop H5 QR launch link.
5. Open EchoFlow Code Mobile and scan the link, or enter the Server URL and H5 Token manually.
6. After verification, the app opens the H5 WebView with chat, tool calls, approvals, and attachments.

If the launch link contains `127.0.0.1` or `localhost`, the phone cannot reach it. Use the computer's LAN IP, VPN address, or HTTPS domain instead.

## Network Notes

| Scenario | Recommended path |
| --- | --- |
| Same Wi-Fi testing | Desktop LAN IP + H5 Token |
| Personal remote access | VPN, Tailscale, frp, or Cloudflare Tunnel |
| Small-team access | HTTPS reverse proxy with explicit allowed origins |
| Public Internet exposure | Avoid direct exposure; use HTTPS, strong Token handling, trusted members, and minimal origin allowlists |

The H5 Token is sent with REST and WebSocket requests. Plain HTTP is acceptable only on trusted LANs; use HTTPS for untrusted networks.

## Development

Mobile source lives in `mobile/`. MVP 0 is tested with JDK 17:

```bash
cd mobile
bun install
bun run check
bun run start
bun run android
```

If Expo CLI is unstable under Bun on Windows, use `npx expo start` and `npx expo run:android` as a fallback.

## Mobile vs IM Adapters

| Need | Best entry |
| --- | --- |
| Full chat UI, approvals, and file upload on a phone | Android client or mobile browser H5 |
| Quick task submission, progress checks, and stop commands in chat tools | Telegram / Feishu / WeChat / DingTalk adapters |
| Shared team access | HTTPS reverse proxy + H5 origin allowlist, or IM user pairing |

The Android client and IM adapters can be used together: mobile H5 is best for continuing the UI, while IM is best for lightweight commands and async notifications.
