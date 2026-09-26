# EchoFlow Code Mobile

EchoFlow Code Mobile is a native Kotlin Android client for EchoFlow Code. It
provides a focused connection screen and hosts the existing EchoFlow H5
workspace in Android WebView, so chat and session features stay aligned with
the desktop web experience.

## Included

- Native Kotlin Android app with no JavaScript runtime or React Native layer.
- Manual server URL and H5 Token entry, clipboard paste, and QR link scanning.
- Server health and H5 token verification before opening the workspace.
- H5 credentials encrypted with Android Keystore AES-GCM.
- WebView support for H5 navigation, loading feedback, and native file picking.
- Native confirmation prompts for Agent tool permission requests.
- Origin-allowlisted WebView bridge for discovering the active session safely.
- Trusted LAN HTTP support for existing self-hosted installations.

The Android shell uses platform APIs, plus Google Play Services Code Scanner
for QR scanning. The scanner downloads its module on demand and does not need
the app to request camera permission.

## Development

JDK 17 and Android SDK Platform 35 are required for local APK builds.

```bash
cd mobile
bun install
bun run check
bun run android
```

The Android Gradle project is independent of Bun at runtime. Bun is used only
for the small repository contract check. Release builds use the checked-in
Gradle wrapper and the signing config supplied by CI.

## Connect

1. Start EchoFlow Desktop or the EchoFlow server and enable H5 access.
2. Generate a connection QR code or copy its launch link.
3. Connect the Android device to the same trusted LAN, or use an HTTPS endpoint.
4. Scan the code, paste the link, or enter the server URL and H5 Token.
5. After health and token checks pass, the H5 workspace opens in the app.

The H5 handoff currently includes `h5Token` in the initial URL as required by
the existing server flow. Plain HTTP can expose that token on the network, so
use it only on a trusted LAN. Use HTTPS through a private tunnel, VPN, or
reverse proxy for connections over untrusted networks.

## Current boundaries

- Mobile is a remote client; it does not run an agent or sidecar on Android.
- The existing H5 remains responsible for chat, tools, and session rendering.
- Native connection status and session-specific actions need device smoke tests
  before expanding the shell further.
- iOS packaging is not part of this Android client.
