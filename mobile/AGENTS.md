# Mobile Instructions

These rules apply to `mobile/` changes in addition to the root instructions.

`mobile/` is a self-contained Expo React Native Android shell. It connects to a
desktop/server instance, verifies the H5 token, then renders the existing H5 UI
in a WebView. It shares no tsconfig, no module graph, and no coverage
configuration with the rest of the repository: nothing under `src/`, `desktop/`,
or `adapters/` imports it. Treat it as its own product, not as part of `desktop/`.

- Run `cd mobile && bun run check` — the Expo TypeScript check, the test
  TypeScript check, and the Bun unit tests. From the repository root the same
  gate is `bun run check:mobile`, and a `mobile/` diff selects it automatically.
- Put unit tests beside the helper they cover (`src/lib/*.test.ts`). A product
  file change with no matching mobile test blocks the PR unless the author
  applies `allow-missing-tests`.
- Credentials go in `expo-secure-store`. Nothing sensitive belongs in
  AsyncStorage, in a log line, or in a URL that outlives the handoff to the
  WebView beyond the documented `h5Token` query parameter.
- Plain HTTP is a deliberate trusted-LAN allowance, not a default. `app.json`
  sets `usesCleartextTraffic` and `plugins/withAndroidCleartext` narrows it. Do
  not widen either, and do not read a working cleartext connection as evidence
  that the transport is acceptable on an untrusted network.
- `mobile/package.json` and `mobile/app.json` both carry the version, and
  `release-mobile-apk.yml` fails the release when they disagree. Bump both.
- JDK 17 is the tested Android toolchain. Newer is not automatically better:
  JDK 26 fails here with `Unsupported class file major version 70`.
- The new architecture is off (`newArchEnabled: false`). Turning it on is a
  migration with its own verification, not a config toggle.
- The WebView stays the compatibility layer for complex chat, tool, and
  permission rendering. Native screens are added incrementally; do not port a
  desktop page into the shell as a side effect of fixing a mobile bug.

`README.md` in this directory carries the connection procedure, the MVP 0 scope,
and the manual verification checklist. This file carries the rules.
