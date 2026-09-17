---
title: 发布与 Windows 打包
nav_title: 发布与 Windows 打包
description: 维护者统一版本、管理 fork 标签、构建和验证 Windows NSIS 安装包的流程。
order: 11
---

# 发布与 Windows 打包

这是维护者流程。发版前先在 `main` 完成合并并让工作区干净。不要提交 `artifacts/`、`build-artifacts/`、`dist/`、`electron-dist/` 或 `node_modules/`。

## 统一版本

产品发布版本必须同时一致：

- `desktop/package.json` 的 `version`
- `mobile/package.json` 的 `version`
- `mobile/app.json` 的 `expo.version`
- `release-notes/vX.Y.Z.md`
- fork 的 `vX.Y.Z` tag

根 `package.json` 的 `999.0.0-local` 仅用于本地开发，不是产品发布版本。

先预览发布元数据：

```bash
bun run scripts/release.ts X.Y.Z --dry
```

对应的 `release-notes/vX.Y.Z.md` 不存在时先创建。只有版本、说明和验证证据都准备完成后，才运行不带 `--dry` 的发布脚本；它会创建 release commit 和 annotated tag。

## 管理 fork 标签

本地、`origin` 与 `upstream` 必须分别审计：

```bash
git tag --list 'v*' --sort=v:refname
git ls-remote --tags origin 'v*'
git ls-remote --tags upstream 'v*'
```

上游 tag 可以与 fork tag 同名，默认不修改 upstream。删除前明确范围：

- **仅本地**：`git tag -d vX.Y.Z`
- **origin 远端**：明确确认后 `git push origin :refs/tags/vX.Y.Z`
- **upstream**：默认不操作

删除 tag 不会回退提交或版本文件；版本、release notes 和 tag 必须作为一个决策处理。

## Windows x64 打包

### 原生 Windows

在 Windows PowerShell 使用项目脚本。它初始化 MSVC、构建 Windows sidecar、打包 NSIS 并运行 package-smoke：

```powershell
cd desktop
bun run build:windows-x64
```

需要 Bun/Bunx 和 Visual Studio 2022 Build Tools 的 Desktop development with C++ workload。

### WSL / Linux 交叉打包

PowerShell 脚本要求原生 Windows；WSL 中不能假设 `powershell.exe` 存在。使用 Wine 和已安装的 Electron-builder：

```bash
SIDECAR_TARGET_TRIPLE=x86_64-pc-windows-msvc bun run --cwd desktop prepare:ripgrep
SIDECAR_TARGET_TRIPLE=x86_64-pc-windows-msvc bun run --cwd desktop build:sidecars
bun run --cwd desktop build
bun run --cwd desktop build:electron
CSC_IDENTITY_AUTO_DISCOVERY=false WINELOADER=wine64 \
  desktop/node_modules/.bin/electron-builder \
  --project desktop --win nsis --x64 --publish never
```

打包应前台执行并保留完整输出。Windows x64 sidecar 与 `rg.exe` 必须存在；缺少时先运行 `prepare:ripgrep`，不要用 Linux sidecar 代替。

输出通常位于：

```text
desktop/build-artifacts/electron/EchoFlow-Code-X.Y.Z-win-x64.exe
desktop/build-artifacts/electron/EchoFlow-Code-X.Y.Z-win-x64.exe.blockmap
```

## 验证

先验证静态包内容：

```bash
bun run test:package-smoke --platform windows --package-kind release \
  --artifacts-dir desktop/build-artifacts/windows-x64-validation
sha256sum desktop/build-artifacts/windows-x64-validation/EchoFlow-Code-X.Y.Z-win-x64.exe
```

`package-smoke` 只能证明包结构，不能证明 Windows 安装或启动。维护者仍需在真实 Windows 上安装 NSIS `.exe`，检查版本、会话创建、sidecar 启动、Provider 设置及 `latest.yml`、`.exe`、`.blockmap` 的版本一致性。未签名时的 SmartScreen 提示不等于安装或 updater 失败。

不要把 `linux-unpacked`、macOS 或历史 artifacts 混入 Windows 验证目录；静态检查可能把它们误判为更新资产。
