# Mobile Instructions

These rules apply to `mobile/` changes in addition to the root instructions.

`mobile/` is a self-contained Kotlin Android app. It connects to an EchoFlow
server, verifies the H5 token, and renders the existing H5 UI in Android
WebView. Keep business features in the H5 app; add native code for device
integration and mobile-specific presentation. Prefer Android platform APIs.

- Run `cd mobile && bun run check`; from the repository root the same gate is
  `bun run check:mobile`. This checks mobile metadata and Android integration
  contracts. Build with `cd mobile && bun run android` when JDK 17 and the
  Android SDK are available.
- Keep credentials encrypted with Android Keystore AES-GCM. Never log secrets.
  The H5 handoff currently uses its documented `h5Token` query parameter.
- Plain HTTP supports trusted LAN use. Keep cleartext support aligned between
  `app.json` and the Android manifest; do not present HTTP as safe on untrusted
  networks.
- `mobile/package.json` and `mobile/app.json` both carry the version, and the
  mobile release workflow checks they match. Bump both.
- JDK 17 is the tested Android build toolchain. Check AGP and Gradle compatibility
  before changing their pinned versions.
- WebView remains the compatibility layer for chat, tools, and sessions. Add
  mobile-specific flows incrementally and preserve H5 navigation and file input.
