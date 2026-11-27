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

Merging the desktop release PR from Release Please creates the tag and a GitHub Release draft. After the gates and six-platform builds pass, `Release Desktop` uploads the complete draft assets and links to the checksum receipt in its run summary. Verify those Windows installers, then dispatch `Release Please` from `main` with the `release_tag`, `release_sha`, and approved `staged_artifact_id` to publish the same assets. See the [Release steps](../internals/contributing.md#release-steps) for rebuilding a draft, resolving an uncertain publication result, and recovering site or mobile delivery.

`release-notes/vX.Y.Z.md` must already exist on `main` before the release PR is merged, otherwise `release-contract` fails.

## Release workflow gates

Quality jobs, publication dependencies, the shared release SHA, and platform evidence requirements are maintained in [Release Gate](../internals/contributing.md#release-gate). This runbook adds Windows operations rather than a second gate table. Do not substitute a locally successful installer for the workflow result. GitHub Release is the source of truth for public release assets.

## Signing and notarization

Modes, credentials, and platform limitations are defined in [Signing Secrets](../internals/contributing.md#signing-secrets). macOS `macos_signing` defaults to `unsigned`; selecting `signed` fails on missing configuration instead of silently downgrading. Disclose unsigned mode's Computer Use and auto-update limitations. The certificate is the base64 content of a Developer ID Application `.p12`; no Developer ID Installer certificate is needed because the project does not ship a `.pkg`.

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

Windows `windows_signing` and `WINDOWS_SIGNING_ENABLED` rules are also maintained in that shared section; the SignPath list here supports packaging preparation. State the signing mode in release records. SmartScreen on an unsigned Windows artifact does not itself mean installation or updater failure.

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

`package-smoke` proves package structure, not Windows installation or launch. The workflow also runs compiled-sidecar and installer smoke on Windows x64; that does not establish Windows ARM64 or every real upgrade path. See [Release Gate](../internals/contributing.md#release-gate) for pre-publication acceptance of the same artifact on each target and its evidence requirements.

A maintainer must install the NSIS `.exe` on real Windows and check:

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

After desktop publication, `site-release-sync` runs `deploy-docs.yml` against the stable release that GitHub marks Latest. When an older release is published, the site continues to use the current Latest release. Before site upload, `scripts/site-release-manifest.ts` copies update yml files byte-for-byte into `site/dist/update/` and creates `site/dist/download/manifest.json` from the same release's assets. A sync failure stops that site deployment.

These invariants must not change:

1. GitHub Release keeps the complete electron-builder asset set;
2. mirrored yml files remain byte-for-byte identical to GitHub assets and are never re-serialized;
3. `artifactName` stays `EchoFlow-Code-${version}-${os}-${arch}.${ext}` because the download manifest and installer checks depend on it.

Follow [Verify One Real Update Path](../internals/contributing.md#verify-one-real-update-path) after official publication; this does not replace pre-publication package acceptance. On Windows, check `latest.yml`, the installer, and the blockmap, then data preservation after updating from the previous version. That section also defines other platforms' requirements and unsigned macOS manual-upgrade boundaries.
