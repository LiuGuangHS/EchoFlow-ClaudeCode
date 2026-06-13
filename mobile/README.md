# EchoFlow CodeMobile

CodeMobile is an Expo React Native mobile client for EchoFlow-ClaudeCode. It provides a native mobile shell for connecting to an EchoFlow Desktop/server instance, then displays the existing H5 UI in a WebView for compatibility with the current chat, tool, permission, and WebSocket flows.

## MVP 0 scope

Included:

- Expo React Native Android app.
- Native connection screen for Server URL + H5 Token.
- QR launch URL scanning for desktop-generated CodeMobile links.
- Native H5 token verification before opening WebView.
- Secure credential storage with `expo-secure-store`.
- WebView compatibility layer for the existing H5 UI.
- Native approval prompt forwarding for tool permission requests.
- WebView file input bridge using the native document picker.
- WebView clipboard bridge for copy/paste compatibility.
- Recent server history for repeat LAN connections.
- Trusted LAN HTTP support for existing H5 workflows.

Not included yet:

- Per-device token binding.
- Official relay.
- Native task dashboard.
- Native chat/Diff replacement.
- iOS release validation.
- Running the desktop sidecar on Android.

## Development

JDK 17 is the tested Android build toolchain for MVP 0 and is the safest default. Newer JDKs can work only when Gradle, the Android Gradle Plugin, and the Expo/React Native toolchain all support them; JDK 26 is currently too new here and fails with `Unsupported class file major version 70`.

```bash
cd mobile
bun install
bun run check
bun run start
bun run android
```

`bun run check` runs the Expo TypeScript check, test TypeScript check, and the Bun unit tests for the connection and credential helpers.

If Expo CLI has issues under Bun on Windows, use npm/npx as a fallback:

```bash
cd mobile
npx expo start
npx expo run:android
```

## Connecting to a desktop service

1. Start EchoFlow Desktop or the EchoFlow server.
2. Enable H5 access in desktop settings.
3. Generate or copy the H5 Token.
4. Ensure the Android device can reach the server, for example `http://192.168.1.10:3456/health` on a trusted LAN.
5. Open CodeMobile and scan the desktop QR launch link, or enter the Server URL and H5 Token manually.
6. CodeMobile verifies `/health` and `/api/h5-access/verify`, stores credentials in SecureStore, then opens the H5 UI in WebView.

## Network notes

MVP 0 supports plain HTTP on trusted LANs to match the existing H5 access flow. The H5 token is sent with REST and WebSocket requests and is initially passed to H5 with the existing `h5Token` query parameter, so do not expose plain HTTP access on public or untrusted networks.

For Internet access, prefer HTTPS through a reverse proxy, private tunnel, VPN, or a future CodeMobile HTTPS/certificate mode.

## MVP 0 verification checklist

- [ ] EchoFlow Desktop/server is running and reachable from the Android device.
- [ ] H5 access is enabled.
- [ ] H5 token is generated and copied.
- [ ] The Android device can open `http://<desktop-lan-ip>:<port>/health` on the same trusted network.
- [ ] CodeMobile native Connect screen appears.
- [ ] CodeMobile accepts a QR launch link or manual Server URL and H5 token.
- [ ] Native `/health` check succeeds.
- [ ] Native `/api/h5-access/verify` check succeeds.
- [ ] WebView loads the existing H5 UI.
- [ ] Existing sessions/chat UI loads.
- [ ] WebSocket streaming works in a session.
- [ ] Permission prompts appear in the native approval modal and responses reach the desktop session.
- [ ] WebView file inputs open the native document picker.
- [ ] WebView copy/paste actions use the native clipboard bridge where supported.
- [ ] Disconnect clears saved credentials and returns to the Connect screen.

## Known MVP limitations

- CodeMobile MVP 0 is a remote client only. It does not run Claude Code locally on Android.
- Public Internet access is not automatic. Use LAN, VPN, Tailscale, frp, Cloudflare Tunnel, or your own reverse proxy.
- Plain HTTP is allowed for trusted LAN compatibility. Prefer HTTPS for untrusted networks.
- The H5 WebView remains the compatibility layer for complex chat/tool rendering. Native mobile pages will be added incrementally.
