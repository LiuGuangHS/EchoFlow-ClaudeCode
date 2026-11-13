---
title: Release and Windows Packaging
nav_title: Release and Windows Packaging
description: Maintainer workflow for version alignment, packaging, signing, and desktop release verification.
order: 11
---

# Release and Windows Packaging

This is a maintainer workflow. Finish merges on `main` and start from a clean worktree. Never commit `artifacts/`, `build-artifacts/`, `dist/`, `electron-dist/`, or `node_modules/`.

## Version, release notes, and tag

EchoFlow Code uses its own version line. A release must satisfy all of these conditions:

- the desktop version comes from `desktop/package.json`; mobile releases independently, so only `mobile/package.json` and `mobile/app.json` `expo.version` must match each other, not the desktop version;
- `release-notes/vX.Y.Z.md` exists and starts with `# EchoFlow Code vX.Y.Z`;
- the release tag is `vX.Y.Z` and matches the `desktop/package.json` version;
- root `package.json` `999.0.0-local` is for local development, not a product release.

`desktop/package.json` is the desktop version and artifact-naming baseline. By default, `scripts/release.ts` prepares only the desktop version: without dry-run it creates `release/vX.Y.Z`, updates the desktop version, and commits the version files and existing release notes without creating a tag. Only an explicit `--mobile <patch|minor|major|x.y.z>` also increments the independent mobile version. Obtain separate authorization to create the branch and commit before executing it.

The dry run reports the files it would update and whether release notes exist; it does not check remote Git tags:

```bash
bun run scripts/release.ts X.Y.Z --dry
```

The following preparation command creates a branch and commit, so confirm authorization, a clean worktree, release notes, and the target version before running it:

```bash
bun run scripts/release.ts X.Y.Z
```

Preparation neither creates nor pushes a tag. The separate `bun run scripts/release.ts --tag X.Y.Z` fetches `origin/main`, validates the merged version and release notes, and creates only a local annotated tag; it neither pushes nor publishes and requires separate authorization. Manually pushing a tag only triggers the build and verification jobs of `Release Desktop`; it does not publish. `publish-release` runs only for the official `workflow_call` from Release Please (`official_release: true`) or a manual draft `workflow_dispatch`. Do not move existing tags or upload local build artifacts.

## Official release entry: Release Please

Official releases are driven by `.github/workflows/release-please.yml` on every push to `main`. It uses `release-please-config.json` and `.release-please-manifest.json` (which records the last published version) to open a desktop release PR and update `desktop/package.json`. The current configuration includes only `desktop`; it neither synchronizes nor publishes the mobile version automatically. Merging the release PR creates the tag and a draft Release; `resolve-release` verifies the commit the tag peels to, then calls `release-desktop.yml` with `official_release: true` and `draft: false`. After the gates and the six-platform build all pass, that workflow uploads the complete asset set and un-drafts the release.

`release-notes/vX.Y.Z.md` must already exist on `main` before the release PR is merged, otherwise `release-contract` fails.

## Release workflow gates

The actual gates in `.github/workflows/release-desktop.yml` are:

1. `release-contract` runs `check:release-surface`; on a tag push it checks the tag against the `desktop/package.json` version and checks the release-note file and title.
2. `signing-preflight` checks macOS signing/notarization and Windows SignPath configuration, and reports whether this build is signed.
3. `verify-governance` runs `check:policy`.
4. `verify-runtime` runs `check:server`, `check:agent-flow`, and `check:adapters`.
5. `verify-desktop` runs `check:desktop` and `check:persistence-upgrade`.
6. `release-verify-gate` succeeds only when all three `verify-*` jobs succeed; the build matrix also completes package smoke on six platforms before publishing.

Do not substitute a locally successful installer for the workflow result. GitHub Release is the source of truth for public release assets.

## Signing and notarization

macOS uses these GitHub Actions secrets:

```text
MACOS_CERTIFICATE
MACOS_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

`MACOS_CERTIFICATE` is the base64 content of a Developer ID Application `.p12`. The project does not ship a `.pkg`, so no Developer ID Installer certificate is needed. When macOS configuration is missing, the workflow marks artifacts unsigned and warns that Computer Use client attestation may be affected.

Windows uses SignPath rather than the obsolete `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` variables. The preflight reads:

```text
SIGNPATH_API_TOKEN                     # GitHub Actions secret
SIGNPATH_ORGANIZATION_ID               # repository variable
SIGNPATH_PROJECT_SLUG                  # repository variable
SIGNPATH_TEST_SIGNING_POLICY_SLUG      # draft/manual test policy
SIGNPATH_RELEASE_SIGNING_POLICY_SLUG   # tag/release policy
SIGNPATH_APPLICATION_ARTIFACT_CONFIGURATION_SLUG
SIGNPATH_INSTALLER_ARTIFACT_CONFIGURATION_SLUG
```

When all Windows signing settings are absent, the current workflow may produce unsigned artifacts according to its documented rule; a partial configuration is an error and a non-draft release refuses to continue. A manual workflow can explicitly select `skip_windows_signing`, but the release record must state that artifacts are unsigned. SmartScreen on an unsigned Windows artifact does not itself mean installation or updater failure.

## Package Windows x64

### Native Windows

Use the project script from Windows PowerShell. It prepares MSVC, builds the Windows sidecar, creates the NSIS installer, and runs package smoke:

```powershell
cd desktop
bun run build:windows-x64
```

It needs Bun/Bunx and Visual Studio 2022 Build Tools with the Desktop development with C++ workload.

### WSL / Linux cross-package

The PowerShell script requires native Windows; do not assume `powershell.exe` exists in WSL. Use the Windows sidecar target, Wine, and the installed electron-builder:

```bash
SIDECAR_TARGET_TRIPLE=x86_64-pc-windows-msvc bun run --cwd desktop prepare:ripgrep
SIDECAR_TARGET_TRIPLE=x86_64-pc-windows-msvc bun run --cwd desktop build:sidecars
bun run --cwd desktop build
bun run --cwd desktop build:electron
CSC_IDENTITY_AUTO_DISCOVERY=false WINELOADER=wine64 \
  desktop/node_modules/.bin/electron-builder \
  --project desktop --win nsis --x64 --publish never
```

`electron:build` only builds sidecars, the renderer, and Electron bundles; use `electron:package` or invoke electron-builder as above when an installer is required. The Windows x64 sidecar and `rg.exe` must exist; never substitute the Linux sidecar.

Typical output includes:

```text
desktop/build-artifacts/electron/EchoFlow-Code-X.Y.Z-win-x64.exe
desktop/build-artifacts/electron/EchoFlow-Code-X.Y.Z-win-x64.exe.blockmap
```

## Static package and real Windows verification

First verify static package contents:

```bash
bun run test:package-smoke --platform windows --package-kind release \
  --artifacts-dir desktop/build-artifacts/windows-x64-validation
sha256sum desktop/build-artifacts/windows-x64-validation/EchoFlow-Code-X.Y.Z-win-x64.exe
```

`package-smoke` proves package structure, not Windows installation or launch. A maintainer must install the NSIS `.exe` on real Windows and check:

- the About version matches this release;
- session creation, sidecar startup, and Provider Settings work;
- `latest.yml`, `.exe`, and `.exe.blockmap` in the release assets use the same version;
- manual-download guidance works after an update failure, and SmartScreen on an unsigned artifact is not mistaken for an updater failure.

Do not mix stale `linux-unpacked`, macOS, or historical artifacts into the Windows verification directory: static checks can mistake them for update assets.

## Auto-update and site sync

The app uses `electron-updater` with the complete GitHub Release asset set. Matrix jobs first generate their `latest*.yml` files, then `scripts/release-update-metadata.ts` merges them into the standard names electron-updater expects. Do not let each matrix job publish the same metadata directly or the files will overwrite one another.

Differential downloads are disabled by default. They are requested only on Windows or macOS when `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=1` is explicitly set and the download source is the GitHub Release direct feed with its pinned contract fingerprint verified; `ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` forces them off. Custom update feeds, proxy feeds, and Linux always use full downloads.

Rollout and enabling the default are currently blocked: offline tests confirm that `GenericDifferentialDownloader` accepts an incorrect `Content-Range` and a `206` without `Accept-Ranges: bytes` under `NodeHttpExecutor` when the final file SHA-512 matches. `electron-updater` enters its built-in full-package fallback only when the differential downloader throws; a malformed response accepted by the dependency does not trigger that fallback. An online canary cannot compensate for this response-contract gap. Do not run a differential canary using the explicit switch until a maintainable response-validation/fallback layer and its offline gates are in place. Response validation/fallback, integration verification, and the real canary are not complete; the current tests do not constitute Electron transport acceptance or rollout approval.

`updateRangeContract.test.ts` directly constructs `GenericDifferentialDownloader` and `NodeHttpExecutor`. Its redirect case asserts that the Node transport does not follow a 302; the multipart case only asserts rejection of an invalid `Content-Type`. It does not run the app's `downloadUpdate()` or use `ElectronHttpExecutor` with `electron.net.request` / the updater session, so it does not cover Electron net redirect behavior or a real multipart response. The installed implementation primarily branches on status, range-support headers, and multipart `Content-Type`; it does not validate that a `206` `Content-Range` matches the requested interval or require `Accept-Ranges: bytes`.

The session `webRequest` API is not a sufficient validation boundary: Electron exposes response headers to `onHeadersReceived` but not the multipart body, so it cannot validate each part's range and byte count. Registering another listener for the same WebRequest event replaces the existing listener; there is no subscription handle that allows a temporary listener to be safely composed and removed independently. The repository currently has no `onHeadersReceived` listener, but temporarily taking exclusive ownership of the updater session would still create a fragile global constraint and would not prove compatibility with future or external session consumers.

Task 4 has not completed release acceptance, but the application-level `DifferentialHttpExecutor` now provides a controlled boundary: before a verified-feed differential response reaches the downloader, it validates the single-Range status, `Accept-Ranges`, `Content-Range`, `Content-Length`, and body byte count; multiple ranges are rejected so the existing flow can fall back to the full package. The offline wrapper contract passes, and complete-package and blockmap downloads still delegate to the original Electron executor. The remaining blocker is proving with the real Electron transport and a loopback HTTP server that GET/Range, 302, valid multipart, and malformed responses trigger the full-package fallback, followed by real-device acceptance. A headers-only hook, Node transport test, or online canary cannot substitute for this evidence. The real Task 5 canary is NOT RUN; differential downloads remain disabled by default, and the explicit switch must not be used for a canary.

Differential eligibility and canary evidence must come from the app's actual `downloadUpdate()` request; do not infer success from `HEAD`, standalone `curl`, download size, or a generic “downloaded” log. Record the source separately with method, request URL, release tag, client version, platform, arch, `Range`, HTTP status, `Content-Range`, `Content-Length`, `Accept-Ranges`, `Content-Type`, redirect chain, fallback result, installer SHA-512, and UTC timestamp. Isolate evidence by `release/platform-arch/source/run-id`, for example `update-canary-evidence/<release>/<platform>-<arch>/<source>/<run-id>/range.jsonl` and `summary.json`. Use a CI run/build ID or a maintainer UTC timestamp plus a unique suffix; never overwrite evidence and do not commit it. Missing actual updater GET/Range/response headers, `206`, or correct range details means BLOCKED/FAIL. Keep direct GitHub and proxy evidence separate; a proxy without its own verified contract may only record the full-package path.

A full-package fallback exercise must record offline, interruption, failed-response evidence, and the subsequent full-package request/result. Verify that no false download-complete event is emitted, retry works, installation and restart succeed, and providers, sessions, Skills, Agents, memories, the custom data directory, and historical task state remain intact. Linux AppImage continues to use full-package updates in this first phase; no `.AppImage.blockmap` is required.

At the end of a release, `site-release-sync` triggers `deploy-docs.yml --release <tag>` after the GitHub Release completes. `scripts/site-release-manifest.ts` copies update yml files byte-for-byte into `site/dist/update/` and creates `site/dist/download/manifest.json` from the release asset list; the sync runs before site upload and failure blocks the workflow.

These invariants must not change:

1. GitHub Release keeps the complete electron-builder asset set;
2. mirrored yml files remain byte-for-byte identical to GitHub assets and are never re-serialized;
3. `artifactName` stays `EchoFlow-Code-${version}-${os}-${arch}.${ext}` because the download manifest and installer checks depend on it.

Every production release must be tested by upgrading from the previous stable version at least once: install the old version, push the tag and wait for the workflow, trigger the update from the old app, install and restart, then verify the version, providers, sessions, Skills, Agents, memories, custom data directory, and historical task state. On macOS focus on signing and launch policy; on Windows focus on `latest.yml`, the installer, and the blockmap; on Linux focus on AppImage auto-update.
