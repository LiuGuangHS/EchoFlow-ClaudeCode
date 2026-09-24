---
title: Release and Windows packaging
nav_title: Release and Windows packaging
description: Maintainer workflow for version alignment, fork tags, and Windows NSIS installers.
order: 11
---

# Release and Windows packaging

This is a maintainer workflow. Finish merges on `main` and start from a clean worktree. Never commit `artifacts/`, `build-artifacts/`, `dist/`, `electron-dist/`, or `node_modules/`.

## Align the release version

A product release version must match across:

- `desktop/package.json` `version`
- `mobile/package.json` `version`
- `mobile/app.json` `expo.version`
- `release-notes/vX.Y.Z.md`
- the fork's `vX.Y.Z` tag

Root `package.json` `999.0.0-local` is a local development version, not a product release version.

Preview release metadata before creating a tag:

```bash
bun run scripts/release.ts X.Y.Z --dry
```

Create `release-notes/vX.Y.Z.md` first if it is missing. Run the release script without `--dry` only after the version, notes, and verification evidence are ready; it creates the release commit and annotated tag.

## Manage fork tags

Audit local, `origin`, and `upstream` independently:

```bash
git tag --list 'v*' --sort=v:refname
git ls-remote --tags origin 'v*'
git ls-remote --tags upstream 'v*'
```

Upstream tags can share names with fork tags. Do not modify upstream by default. Before deleting a tag, define the scope:

- **Local only**: `git tag -d vX.Y.Z`
- **origin remote**: after explicit confirmation, `git push origin :refs/tags/vX.Y.Z`
- **upstream**: do not touch by default

Deleting a tag does not roll back commits or version files. Decide on version files, release notes, and tags together.

## Package Windows x64

### Native Windows

Use the project script from Windows PowerShell. It initializes MSVC, builds the Windows sidecar, packages NSIS, and runs package-smoke:

```powershell
cd desktop
bun run build:windows-x64
```

It needs Bun/Bunx and Visual Studio 2022 Build Tools with the Desktop development with C++ workload.

### WSL / Linux cross-package

The PowerShell script requires native Windows; do not assume `powershell.exe` exists in WSL. Use Wine and the installed Electron-builder:

```bash
SIDECAR_TARGET_TRIPLE=x86_64-pc-windows-msvc bun run --cwd desktop prepare:ripgrep
SIDECAR_TARGET_TRIPLE=x86_64-pc-windows-msvc bun run --cwd desktop build:sidecars
bun run --cwd desktop build
bun run --cwd desktop build:electron
CSC_IDENTITY_AUTO_DISCOVERY=false WINELOADER=wine64 \
  desktop/node_modules/.bin/electron-builder \
  --project desktop --win nsis --x64 --publish never
```

Run packaging in the foreground and retain its full output. The Windows x64 sidecar and `rg.exe` must exist; run `prepare:ripgrep` when they do not. Never substitute the Linux sidecar.

The usual output is:

```text
desktop/build-artifacts/electron/EchoFlow-Code-X.Y.Z-win-x64.exe
desktop/build-artifacts/electron/EchoFlow-Code-X.Y.Z-win-x64.exe.blockmap
```

## Verify

First verify static package contents:

```bash
bun run test:package-smoke --platform windows --package-kind release \
  --artifacts-dir desktop/build-artifacts/windows-x64-validation
sha256sum desktop/build-artifacts/windows-x64-validation/EchoFlow-Code-X.Y.Z-win-x64.exe
```

`package-smoke` proves package structure, not Windows installation or launch. A maintainer must install the NSIS `.exe` on real Windows and check the version, session creation, sidecar startup, Provider Settings, and that `latest.yml`, `.exe`, and `.exe.blockmap` use the same version. SmartScreen on an unsigned installer does not itself mean installation or updater failure.

Do not mix stale `linux-unpacked`, macOS, or historical artifacts into the Windows verification directory: static checks can mistake them for update assets.
