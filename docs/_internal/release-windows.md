---
title: 发布与 Windows 打包
nav_title: 发布与 Windows 打包
description: 维护者统一版本、构建、签名和验证桌面发布产物的流程。
order: 11
---

# 发布与 Windows 打包

这是维护者流程。发版前先在 `main` 完成合并并让工作区干净。不要提交 `artifacts/`、`build-artifacts/`、`dist/`、`electron-dist/` 或 `node_modules/`。

## 版本、release notes 和 tag

EchoFlow Code 使用自己的版本线。发布版本必须满足：

- `desktop/package.json`、`mobile/package.json` 和 `mobile/app.json` 的版本相同；
- `release-notes/vX.Y.Z.md` 存在，并以 `# EchoFlow Code vX.Y.Z` 开头；
- 正式 tag 是 `vX.Y.Z`，与 `desktop/package.json` 的版本一致；
- 根 `package.json` 的 `999.0.0-local` 只用于本地开发，不是产品发布版本。

`desktop/package.json` 是当前版本读取和发布产物命名的基准；`scripts/release.ts` 会从它读取当前版本，并在非 dry-run 发布时更新三个版本文件、提交 release commit，再创建 annotated tag。先确认 release notes 已存在，再执行真正的发布命令。

预览命令只报告将更新的文件和 release notes 是否存在，不检查远端 Git tag：

```bash
bun run scripts/release.ts X.Y.Z --dry
```

发布脚本会执行提交和创建 tag，属于对本地 Git 的写操作；执行前确认分支、工作区和版本目标都正确：

```bash
bun run scripts/release.ts X.Y.Z
```

手动运行 `scripts/release.ts` 并推送 tag 只会触发 `Release Desktop` 的构建与验证 job，不会发布：`publish-release` 仅在 Release Please 的官方 `workflow_call`（`official_release: true`）或手动 draft 的 `workflow_dispatch` 下运行。不要移动已有 tag 或上传本地构建产物。

## 正式发布入口：Release Please

正式发布由 `.github/workflows/release-please.yml` 在 `main` 收到推送后驱动：它按 `release-please-config.json` 和 `.release-please-manifest.json`（记录上一个已发布版本）生成 release PR，并同步 `desktop/package.json`、`mobile/package.json` 和 `mobile/app.json` 的版本。合并 release PR 后会创建 tag 和 draft Release；`resolve-release` 校验 tag 指向的提交后，以 `official_release: true`、`draft: false` 调用 `release-desktop.yml`。门禁和六平台构建全部通过后，该 workflow 上传完整资产并取消 draft。

`release-notes/vX.Y.Z.md` 必须在合并 release PR 之前已存在于 `main`，否则 `release-contract` 会失败。

## Release workflow 门禁

`.github/workflows/release-desktop.yml` 的实际门禁如下：

1. `release-contract` 运行 `check:release-surface`；push tag 时检查 tag 与 `desktop/package.json` 版本相同，并检查 release notes 文件和标题。
2. `signing-preflight` 检查 macOS 签名/公证配置和 Windows SignPath 配置，输出本次构建是否签名。
3. `verify-governance` 运行 `check:policy`。
4. `verify-runtime` 运行 `check:server`、`check:agent-flow` 和 `check:adapters`。
5. `verify-desktop` 运行 `check:desktop` 和 `check:persistence-upgrade`。
6. `release-verify-gate` 只有在三个 `verify-*` job 都成功时才成功；构建矩阵还要在六个平台完成 package smoke，所有依赖通过后才发布。

不要用本地“看起来成功”的安装包替代 workflow 结果。公开发布资产以 GitHub Release 为准。

## 签名与公证

macOS 使用以下 GitHub Actions secrets：

```text
MACOS_CERTIFICATE
MACOS_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

`MACOS_CERTIFICATE` 是 Developer ID Application `.p12` 的 base64 内容。项目不发布 `.pkg`，不需要 Developer ID Installer 证书。缺少 macOS 配置时 workflow 会明确标记产物为 unsigned，并报告 Computer Use client attestation 可能受影响。

Windows 使用 SignPath，而不是旧的 `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` 变量。preflight 读取：

```text
SIGNPATH_API_TOKEN                 # GitHub Actions secret
SIGNPATH_ORGANIZATION_ID           # repository variable
SIGNPATH_PROJECT_SLUG              # repository variable
SIGNPATH_TEST_SIGNING_POLICY_SLUG  # draft/manual test policy
SIGNPATH_RELEASE_SIGNING_POLICY_SLUG # tag/release policy
SIGNPATH_APPLICATION_ARTIFACT_CONFIGURATION_SLUG
SIGNPATH_INSTALLER_ARTIFACT_CONFIGURATION_SLUG
```

Windows 签名配置全部缺失时，当前 workflow 可以按其规则生成 unsigned 产物；部分配置则视为错误，非 draft 发布会拒绝继续。手动 workflow 还可以显式选择 `skip_windows_signing`，但 release 记录必须说明产物未签名。unsigned Windows 产物仍可能触发 SmartScreen，SmartScreen 提示本身不等于安装或 updater 失败。

## Windows x64 打包

### 原生 Windows

在 Windows PowerShell 使用项目脚本。它准备 MSVC、构建 Windows sidecar、生成 NSIS 并运行 package smoke：

```powershell
cd desktop
bun run build:windows-x64
```

需要 Bun/Bunx 和 Visual Studio 2022 Build Tools 的 Desktop development with C++ workload。

### WSL / Linux 交叉打包

PowerShell 脚本要求原生 Windows；WSL 中不要假设 `powershell.exe` 可用。使用 Windows sidecar target、Wine 和已安装的 electron-builder：

```bash
SIDECAR_TARGET_TRIPLE=x86_64-pc-windows-msvc bun run --cwd desktop prepare:ripgrep
SIDECAR_TARGET_TRIPLE=x86_64-pc-windows-msvc bun run --cwd desktop build:sidecars
bun run --cwd desktop build
bun run --cwd desktop build:electron
CSC_IDENTITY_AUTO_DISCOVERY=false WINELOADER=wine64 \
  desktop/node_modules/.bin/electron-builder \
  --project desktop --win nsis --x64 --publish never
```

`electron:build` 只构建 sidecar、renderer 和 Electron bundle；需要安装包时使用 `electron:package`，或像上面一样直接调用 electron-builder。Windows x64 sidecar 与 `rg.exe` 必须存在，不能用 Linux sidecar 代替。

通常的输出包括：

```text
desktop/build-artifacts/electron/EchoFlow-Code-X.Y.Z-win-x64.exe
desktop/build-artifacts/electron/EchoFlow-Code-X.Y.Z-win-x64.exe.blockmap
```

## 静态包与真实 Windows 验收

先验证静态包内容：

```bash
bun run test:package-smoke --platform windows --package-kind release \
  --artifacts-dir desktop/build-artifacts/windows-x64-validation
sha256sum desktop/build-artifacts/windows-x64-validation/EchoFlow-Code-X.Y.Z-win-x64.exe
```

`package-smoke` 只能证明包结构，不能证明 Windows 安装或启动。维护者仍需在真实 Windows 上安装 NSIS `.exe`，检查：

- About 中的版本与本次 release 一致；
- 会话创建、sidecar 启动和 Provider Settings 可用；
- Release 资产中的 `latest.yml`、`.exe` 和 `.exe.blockmap` 版本一致；
- 更新失败时的手动下载引导可用，unsigned 产物的 SmartScreen 提示不被误判为 updater 失败。

不要把 `linux-unpacked`、macOS 或历史 artifacts 混入 Windows 验证目录；静态检查可能把它们误判为更新资产。

## 自动更新与站点同步

应用由 `electron-updater` 从 GitHub Release 获取完整资产。matrix job 先生成各自的 `latest*.yml`，再由 `scripts/release-update-metadata.ts` 合并为 electron-updater 期望的标准文件名；不要让每个 matrix job 直接发布同名 metadata，否则会互相覆盖。

差分下载默认关闭。只有在 Windows 或 macOS 上显式设置 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=1`，且下载源是通过固定合同指纹校验的 GitHub Release 直连源时才会请求启用；`ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` 可强制关闭。自定义更新源、代理源和 Linux 始终使用完整下载。

当前不能放量或把默认值改为开启：离线测试已确认 `GenericDifferentialDownloader` 在 `NodeHttpExecutor` 下接受错误的 `Content-Range`，也接受缺少 `Accept-Ranges: bytes` 的 `206`，只要最终文件 SHA-512 匹配。`electron-updater` 只有在差分 downloader 抛错时才会进入其内置完整包回退；被依赖接受的异常响应不会触发这条回退。这个响应合同缺口不能由线上 canary 抵消；修复并通过新的离线门禁前，不得以显式开关做差分 canary。响应校验/fallback 层、集成验证和真实 canary 尚未完成，不能将现有测试当作 Electron transport 验收，也不能把放量记为完成。

当前 `updateRangeContract.test.ts` 直接构造 `GenericDifferentialDownloader` 和 `NodeHttpExecutor`。其中 redirect 用例断言 Node transport 不跟随 302；multipart 用例只断言错误的 `Content-Type` 会被拒绝。它没有执行应用的 `downloadUpdate()`，也没有经过 `ElectronHttpExecutor` 的 `electron.net.request` / updater session，因此不覆盖 Electron net 的重定向行为或真实 multipart 响应。依赖实现显示差分下载器主要按状态码、范围支持标头和 multipart Content-Type 分流；它不校验 `206` 的 `Content-Range` 与请求区间相符，也不强制 `Accept-Ranges: bytes`。

当前不能把 session `webRequest` 钩子当作上述校验层：Electron 只向 `onHeadersReceived` 暴露响应头，不暴露 multipart body，因而无法验证每个 part 的区间和字节数；WebRequest 同一事件再次注册会替换已有 listener，也没有可安全叠加后再单独移除的订阅句柄。现有代码尚无 `onHeadersReceived` listener，但临时占用 updater session 仍会建立脆弱的全局独占约束，不能证明不影响未来或外部 session 使用者。

Task 4 仍未完成发布验收，但应用级 `DifferentialHttpExecutor` 已建立受控边界：在 verified feed 的差分请求交给 downloader 前校验单 Range 的状态码、`Accept-Ranges`、`Content-Range`、`Content-Length` 和 body 字节数；multiple Range 直接拒绝并让现有流程回落完整包。离线 wrapper contract 已通过，完整包和 blockmap 下载仍委托原始 Electron executor。剩余阻塞是用真实 Electron transport 和 loopback HTTP server 证明 GET/Range、302、合法 multipart、坏响应会触发完整包 fallback，并完成真实设备验收。不能用只看 headers 的钩子、Node transport 测试或线上 canary 代替该证据。真实 Task 5 canary 为 NOT RUN，差分保持默认关闭且不允许用显式开关做 canary。

差分资格或 canary 证据必须来自应用实际的 `downloadUpdate()` 请求，不能用 `HEAD`、独立 `curl`、下载大小或普通“downloaded”日志推断。按 source 分开保存 method、请求 URL、release tag、客户端版本、platform、arch、`Range`、HTTP status、`Content-Range`、`Content-Length`、`Accept-Ranges`、`Content-Type`、重定向链、fallback 结果、installer SHA-512 和 UTC 时间戳。证据目录按 `release/platform-arch/source/run-id` 隔离，例如 `update-canary-evidence/<release>/<platform>-<arch>/<source>/<run-id>/range.jsonl` 与 `summary.json`；使用 CI run/build id 或维护者 UTC 时间戳加唯一后缀，禁止覆盖且不入库。缺少实际 updater GET/Range/响应头、206 或正确区间信息时标记 BLOCKED/FAIL。direct GitHub 与 proxy 的证据分开；未经单独 contract 验证的 proxy 只能记录完整包路径。

完整包回退演练须记录断网、中断、失败响应及后续完整包请求/结果，并验证不会错误发出下载完成、可以重试、安装与重启成功且 provider、会话、Skills、Agents、记忆、自定义数据目录及历史任务状态保留。Linux AppImage 第一阶段继续按完整包更新验收；不要求 `.AppImage.blockmap`。

发布收尾的 `site-release-sync` 在 GitHub Release 完成后触发 `deploy-docs.yml --release <tag>`。`scripts/site-release-manifest.ts` 将更新 yml 逐字节同步到 `site/dist/update/`，并按 release 资产生成 `site/dist/download/manifest.json`；同步在站点上传前执行，失败会阻断 workflow。

以下不变量不能破坏：

1. GitHub Release 继续包含完整 electron-builder 资产集；
2. 镜像的 yml 与 GitHub 资产逐字节一致，不能重新序列化；
3. `artifactName` 保持 `EchoFlow-Code-${version}-${os}-${arch}.${ext}`，因为下载 manifest 和安装包校验依赖它。

每次正式发布至少从上一个稳定版本做一次真实升级：安装旧版、推 tag 并等待 workflow、在旧版触发更新、安装并重启，然后确认版本、provider、会话、Skills、Agents、记忆、自定义数据目录和历史任务状态仍可用。macOS 重点检查签名/启动策略，Windows 重点检查 `latest.yml`、安装包和 blockmap，Linux 重点检查 AppImage 自动更新。
