---
title: 发布、下载与更新（历史归档）
nav_title: 发布、下载与更新
description: 合并保存 2026 年的相关设计、计划与任务记录，不作为现行执行指令。
order: 4
---

# 发布、下载与更新（历史归档）

本页于 2026-11-14 按主题合并旧 Superpowers 资料，保留原设计、计划、任务摘要和进度；仅调整标题层级、旧路径、插件要求与本地绝对路径。原文中的版本、审批、完成状态和测试结果均为当时记录，不代表当前实现、当前授权或本次验证。不得按归档中的命令直接继续旧任务。

现行要求以仓库 AGENTS.md、[执行与信任边界](../../../internals/execution-boundaries.md) 和 [贡献流程](../../../internals/contributing.md) 为准；[返回归档索引](README.md)。

## 来源目录

- [sdd/2026-11-02-incremental-update-rollout/progress.md](#sdd-2026-11-02-incremental-update-rollout-progress)
- [sdd/2026-11-02-incremental-update-rollout/task-1-brief.md](#sdd-2026-11-02-incremental-update-rollout-task-1-brief)
- [sdd/2026-11-02-incremental-update-rollout/task-2-brief.md](#sdd-2026-11-02-incremental-update-rollout-task-2-brief)
- [plans/2026-10-26-update-channel.md](#plans-2026-10-26-update-channel)
- [plans/2026-10-27-download-theme-and-release-verification.md](#plans-2026-10-27-download-theme-and-release-verification)
- [plans/2026-11-02-incremental-update-rollout.md](#plans-2026-11-02-incremental-update-rollout)
- [plans/2026-11-02-release-please-migration.md](#plans-2026-11-02-release-please-migration)
- [specs/2026-10-26-update-channel-design.md](#specs-2026-10-26-update-channel-design)
- [specs/2026-11-02-release-please-design.md](#specs-2026-11-02-release-please-design)

---

<a id="sdd-2026-11-02-incremental-update-rollout-progress"></a>

## SDD ledger — plan: docs/_internal/archive/planning/release-and-updates.md#plans-2026-11-02-incremental-update-rollout

来源：`sdd/2026-11-02-incremental-update-rollout/progress.md`。

Pre-flight: no reachable spec file was named; the plan's Spec section is the binding repository-state description.
Pre-flight shared interfaces: Task 1 produces verified-feed/runtime gating consumed by Tasks 2–5; Task 3 consumes release workflow and metadata APIs; Task 4 consumes Task 1 feed gating and Task 2 download-state behavior; Task 5 consumes Tasks 1–4 and must not change the default in this plan.
Ruling: execute in the existing non-main worktree — the branch is `fix/computer-use-identity-residue`, and the repository already contains extensive user changes that must not be isolated by reset or overwritten; only allowlisted update-chain files will be edited.
Task 1: complete (working tree changes, tests: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateFeed.test.ts` → PASS; `bun run check:electron` → PASS, 717 pass / 1 skip / 0 fail; Electron bundle completed)
Task 2: complete (working tree changes, tests: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateSmoke.test.ts` → PASS, 30 pass / 0 fail; failure, retry, feed fallback, metadata mismatch, duplicate download, cancellation, and install ordering are covered; no production change was required)
Task 3: complete (working tree changes, tests: `bun test scripts/refresh-windows-update-metadata.test.ts scripts/pr/release-workflow.test.ts scripts/quality-gate/package-smoke/index.test.ts` → PASS, 71 pass / 1 skip / 0 fail; final installer/blockmap/metadata validation and workflow ordering are covered)
Task 4: BLOCKED — offline real-dependency contract at `desktop/electron/services/updateRangeContract.test.ts` confirms valid single Range and rejects 416, inconsistent 200, interrupted response, redirect and invalid multipart Content-Type in the Node harness; it also confirms the dependency accepts a wrong `Content-Range` and missing `Accept-Ranges: bytes` when final SHA-512 matches. NodeHttpExecutor does not model Electron redirect transport, and a true multipart body cannot be proven through this harness. Electron `webRequest.onHeadersReceived` exposes headers but not multipart body bytes, so it cannot validate each part's range/length; registering a same-event listener replaces the existing listener and cannot be composed as a temporary independent subscription. Required Task 4 command previously had 120 pass / 1 skip / 0 fail, but the contract gate is not satisfied; tests expose dependency behavior and do not establish safe eligibility or fallback. Ruling: do not add a session-level header hook; keep default off and block canary until a controlled boundary can inspect full response bodies before differential consumption and real Electron transport tests prove invalid responses reach full-package fallback — a false pass could enable unsafe differential downloads.
Task 5: runbook/evidence instructions updated in Chinese and English; maintainer canary NOT RUN because no authorized release/device/signing environment is available. No canary evidence was fabricated, and no release/default-setting change was made.

---

<a id="sdd-2026-11-02-incremental-update-rollout-task-1-brief"></a>

## Task 1: 增加默认关闭的差分下载开关

来源：`sdd/2026-11-02-incremental-update-rollout/task-1-brief.md`。

**Files:**
- Modify: `desktop/electron/services/updater.ts:63-70,211-230`
- Modify: `desktop/electron/main.ts:643-661`
- Modify: `desktop/electron/services/updater.test.ts`
- Modify: `desktop/electron/services/updateFeed.ts`
- Modify: `desktop/electron/services/updateFeed.test.ts`

**Interfaces:**
- Consumes: 现有 `ElectronUpdaterRuntimeOptions`、`resolveUpdateFeedConfig()` 和 `getUpdaterService()`。
- Produces: `ElectronUpdaterRuntimeOptions.differentialDownload?: boolean`，默认版本策略当前为 `false`；`UpdateFeedConfig` 显式产出 `differentialDownloadFeedUrls: string[]` 和 `differentialDownloadContracts: Record<string, { version: string, fingerprint: string }>`，其中 key 必须是完整规范化 download feed URL，`version` 是仓库 contract 版本常量，`fingerprint` 是该 feed 通过离线 contract 后记录的静态 SHA-256 指纹；默认 allowlist 只含 canonical direct GitHub feed，其他 feed 不得隐式加入。差分资格必须同时满足“平台允许、显式请求/版本默认值允许、download feed URL 按完整规范化 URL 精确命中 `differentialDownloadFeedUrls`、该 URL 的 contract version/fingerprint 与内置记录完全相等”；每次 metadata/download feed resolve 或 fallback 后重新计算资格，不能沿用旧 updater 状态。未验证或未知 feed（包括未通过独立 contract 的 `gh-proxy.org`、`ECHOFLOW_UPDATE_FEED_URL` 和 look-alike URL）一律 fail-closed，不能仅因环境变量为 `1` 开启。

- [ ] **Step 1: 写失败测试，固定默认关闭、环境变量优先级和 feed 资格**
  - 无 runtime option 时断言 `disableDifferentialDownload === true`。
  - `differentialDownload: true` 时只有在当前 feed 命中 verified allowlist 且 contract 指纹匹配时断言 `disableDifferentialDownload === false`；否则仍为 `true`。
  - 环境变量采用明确优先级：`ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` 与 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=0` 都强制关闭，前者优先级最高；`ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=1` 只请求启用并继续经过平台、allowlist 和 contract 门禁；未设置使用版本默认值（当前为关闭，canary 通过后独立变更才可改为开启）；其他值（`true`、`yes`、空白等）fail-closed，不得启用或继承 on 的 release default，并记录可诊断告警。
  - 增加 `disable=1`、`disable=1 + enable=1`、`enable=0`、`enable=1`、缺失、`true`、`yes` 和其他非法值的回归断言，固定紧急关闭优先级与 release default 语义。
  - Linux 即使显式请求也不得启用；Windows/macOS 的请求仍需通过 feed 资格门禁。
  - 分别断言 canonical direct GitHub 精确 URL、默认 `gh-proxy.org`、任意 `ECHOFLOW_UPDATE_FEED_URL` 自定义 feed、未知 host 和 look-alike URL 的结果；metadata/download fallback 后每个候选源都必须重新计算资格，未验证源只能保留完整包路径。

- [ ] **Step 2: 运行 updater 相关测试，确认新增断言先失败**

  Run: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateFeed.test.ts`

  Expected: 新增开关断言 FAIL，既有测试失败必须先判断是否为本任务基线问题，不得改写既有行为断言。

- [ ] **Step 3: 实现最小开关与 fail-closed 资格门禁**
  - 在 `ElectronUpdaterRuntimeOptions` 增加 `differentialDownload?: boolean`，并让 `updateFeed.ts` 暴露 `differentialDownloadFeedUrls: string[]` 与 `differentialDownloadContracts: Record<string, { version: string, fingerprint: string }>`；使用完整规范化 URL 精确匹配，并要求 URL 对应的 contract version/fingerprint 与内置记录完全相等，未列入记录的 feed 一律不具备差分资格。
  - 构造器只在 runtime request 或版本默认值允许、平台允许、当前 download feed 精确命中 verified allowlist 且 contract 指纹匹配时设置 `updater.disableDifferentialDownload = false`，否则保持 `true`。
  - 在 `main.ts` 实现明确优先级：`ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` 最高优先级强制关闭；否则 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=0` 强制关闭、为 `1` 只请求开启但仍受全部资格门禁、未设置使用版本默认值；其他值 fail-closed，不得继承 on 的 release default，并记录告警。Linux 始终关闭；差分模式下 `downloadFeedUrls` 仅取 `differentialDownloadFeedUrls`，未验证 proxy 只走完整包路径。
  - 每次 metadata/download feed resolve 或 fallback 后重新计算资格，清理或隔离旧 provider、blockmap 和下载状态，不能沿用上一源的差分资格。
  - 保留现有 `autoDownload = false`、feed fallback 和下载完成后安装语义。

- [ ] **Step 4: 运行测试确认开关通过**

  Run: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateFeed.test.ts`

  Expected: PASS；默认关闭、显式开启、非精确值和 Linux 保护均有证据。

- [ ] **Step 5: 运行 Electron 类型检查**

  Run: `bun run check:electron`

  Expected: PASS；该命令必须由自身返回成功，不以管道末端退出码代替。

---

---

<a id="sdd-2026-11-02-incremental-update-rollout-task-2-brief"></a>

## Task 2: 锁定下载失败、fallback 和安装顺序

来源：`sdd/2026-11-02-incremental-update-rollout/task-2-brief.md`。

**Files:**
- Modify: `desktop/electron/services/updater.test.ts`
- Modify: `desktop/electron/services/updateSmoke.test.ts`
- Modify: `desktop/electron/services/updater.ts`（仅在复现状态残留后修改）

**Interfaces:**
- Consumes: `ElectronUpdaterService.checkForUpdates()`、`downloadUpdate()`、`cancelInstall()`、`stageDownloadedUpdate()`、`quitAndInstallDownloadedUpdate()`。
- Produces: 回归测试证明差分失败或下载源失败不会伪造完成状态；metadata fingerprint 不一致不会下载；成功后才可安装。

- [ ] **Step 1: 写失败测试覆盖五条状态不变量**
  - `downloadUpdate()` 第一次失败时不发 `Finished`，`hasDownloadedUpdate()` 为 `false`，安装抛出 `has not finished downloading`。
  - 失败后第二次调用可以重新尝试；成功后只发一次实际下载，重复调用只发 `Finished` 而不重复调用底层下载。
  - 主下载源失败时继续尝试下一个 `downloadFeedUrls`；所有源失败时错误包含每个 feed 的诊断。
  - candidate fingerprint 不一致时跳过该源，不能调用 `updater.downloadUpdate()`。
  - `cancelInstall()` 清除 pending/downloaded 状态，之后必须重新检查更新。

- [ ] **Step 2: 运行定向测试确认缺口**

  Run: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateSmoke.test.ts`

  Expected: 新增的状态断言至少有一条先失败；若当前实现已经满足，则记录为现有行为已覆盖，不为增加测试而改生产代码。

- [ ] **Step 3: 只修复被测试证明的状态问题**
  - 不新增 updater cache 清理接口，除非测试复现了底层状态残留。
  - 保持 `Finished` 事件只在底层下载成功后发出。
  - 保持 `quitAndInstall(false, true)` 只由已完成下载路径调用。

- [ ] **Step 4: 运行定向测试确认通过**

  Run: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateSmoke.test.ts`

  Expected: PASS；失败、重试、重复下载、取消和安装顺序均被覆盖。

---

---

<a id="plans-2026-10-26-update-channel"></a>

## 更新/下载通道独立化（自有域名 + 加速）实施计划

来源：`plans/2026-10-26-update-channel.md`。

**Goal:** 落地页按钮直接下载对应平台安装包（不跳 GitHub），应用检查更新请求 `code.echoflow.cn/update/` 元数据（失败兜底 GitHub），更新失败时 UI 引导用户去官网手动下载新版。

**Architecture:** GitHub Releases 发布链路完全不动（老用户兼容硬前提），新增两条旁路：发版时把四个 `latest*.yml` 逐字节镜像 + `downloads.json` 生成进站点静态产物，落到 `code.echoflow.cn/update/`（机器消费的更新元数据）与 `code.echoflow.cn/download/manifest.json`（下载页数据源）；`/download` 是独立 React 页面（App 路由 + 静态骨架），应用侧默认元数据源切到 `/update/`、失败回退 GitHub；下载页用 Range 探测 + `window.location.assign` 实现加速优先/直连回退的流式下载。字节传输的加速前缀复用 updater 现有常量（单一来源）。路径分工：`/download` 给人，`/update` 给机器，`/download/manifest.json` 只服务下载页。

**Tech Stack:** Bun 脚本 + `bun:test`（脚本与 electron 服务测试）、Vitest（desktop UI）、`node --test`（站点 lib）、React + Vite（落地页）、GitHub Actions（release-desktop.yml / deploy-docs.yml）。

**Spec:** [docs/_internal/archive/planning/release-and-updates.md#specs-2026-10-26-update-channel-design](release-and-updates.md#specs-2026-10-26-update-channel-design)

### Global Constraints

- 老用户零影响是硬前提：GitHub Releases 继续收到完整 electron-builder 资产集（`artifactName` 保持 `EchoFlow-Code-${version}-${os}-${arch}.${ext}`，签名身份不变，四个 yml 逐字节镜像、禁止手改 `path`/`sha512` 字段）。旧二进制只认编译在内的 GitHub feed，无法感知本变更。
- 元数据镜像必须「GitHub 完整发布之后」执行（顺序保证不出现 yml 先于安装包上线）。
- 站点同步失败必须让工作流红，不允许静默。
- 加速前缀为 `gh-proxy.org`（复用 updater 现有 `DEFAULT_PROXY_FEED_URL` 常量），换镜像只改一处。
- 站点测试跑 `node --test "src/**/*.test.js"`；electron 测试跑 `bun test ./electron`（`check:electron`）；脚本测试挂 `package.json:17` 的 `check:policy` 显式清单。
- 每个新翻译 key 必须加进全部五个 `desktop/src/i18n/locales/*.ts`。
- 站点 `prepare-static-output.mjs` 的 `dist/CNAME === code.echoflow.cn` 契约不可破坏（新文件放 `/update/` 与 `/download/`）。
- **`/download` 与 `/update/` 必须在应用侧 feed 切换（Task 2）之前上线**：应用内「更新失败请去官网手动下载」的引导目标就是 `/download`；feed 先切而页面未上线会把用户送去 404。

### Review Focus

以下输入/条件没有任务的测试能覆盖，是本设计最可能咬人的地方（按严重度排序）：

1. **官网 yml 缺失/404**：新应用必须表现为「回退 GitHub 元数据后正常更新」，绝不能静默显示"最新版"→ Task 2 覆盖（元数据回退链）。
2. **`ECHOFLOW_UPDATE_FEED_URL` 被显式设置的运维/高级用户**：覆盖必须是纯单源、无回退（用户显式选择），且 `ECHOFLOW_UPDATE_GITHUB_PROXY_BASE` 行为不变 → Task 2 覆盖。
3. **yml 被 CDN 缓存成旧版**（EdgeOne 长缓存 `/update/*.yml`）：表现为"用户漏过一次更新"，下次成功同步后自愈；不做双源对照（复杂度换不来收益，对抗审查判定）→ Task 5 文档记录该降级模式。
4. **draft release / 手动 `workflow_dispatch` 且 draft 关闭**：站点同步只在**非 draft** 发布时跑，draft 发布绝不触发 → Task 4 的 `release-workflow.test.ts` 覆盖。
5. **普通 docs 推送（无 release）触发 deploy-docs**：`/update/*.yml` 与 `downloads.json` 不得消失（`latest` 兜底再生成）→ Task 4 的 `pr-quality-workflow.test.ts` 覆盖。
6. **浏览器无 JS / manifest fetch 失败**：下载按钮必须回退到 `releases/latest` 页面（href 兜底）→ Task 3 覆盖。

---

#### Task 1: `/download` 独立下载页 + 下载模块 `releaseDownload`

**Files:**
- Create: `site/src/pages/download/DownloadPage.tsx`
- Create: `site/src/lib/releaseDownload.js`
- Test: `site/src/lib/releaseDownload.test.js`
- Modify: `site/src/App.jsx:82-83`（路由分发加 `/download` 与 `/en/download`）
- Modify: `site/scripts/prepare-static-output.mjs:238-254`（`/download`、`/en/download` route entry + sitemap）
- Modify: `site/src/components/SiteHeader.jsx:8-9,119-121`（下载按钮改为跳 `/download`）
- Modify: `site/src/pages/home/HomePage.tsx:72,210-212`（页脚与弹窗 CTA 改跳 `/download`）

**Interfaces:**
- Consumes: `GITHUB_URL`；manifest schema（Task 4 生成，此处按契约写死消费）：`{ version, tag, assets: { "win-x64": "...", ... }, extras: { "linux-x86_64.deb": "...", ... } }`
- Produces: `resolveDownloadTarget(platform, arch, manifest) -> { url, fileName } | null`；`buildDownloadCandidates(manifest, platform, arch) -> string[]`（加速前缀在前、GitHub 直链在后）；`pickPlatformArch(userAgent) -> { platform, arch }`；`startDirectDownload(candidates, opts?) -> Promise<'started' | 'fallback'>`（Range 探测 + `window.location.assign`，全失败 resolve `'fallback'`）；`DOWNLOAD_PAGE_PATH = '/download'`（Task 2 的应用内引导链接此常量）。

- [ ] **Step 1: 写失败测试 `site/src/lib/releaseDownload.test.js`**

覆盖（`node --test`）：
- `pickPlatformArch`：Win32 UA → `{platform:'win', arch:'x64'}`；UA 含 `Windows` 且 `ARM64` → `arm64`；MacIntel UA → `{platform:'mac', arch:'arm64'}`（默认主流架构，UA 不可靠）；Linux x86_64 → `{platform:'linux', arch:'x86_64'}`；空 UA → win/x64 默认。
- `buildDownloadCandidates`：manifest 有 `win-x64` 资产时返回**两条**候选，第一条以 `https://gh-proxy.org/https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/download/<tag>/` 开头，第二条为 GitHub 直链；manifest 缺该 platform-arch 键 → `[]`；tag 缺失 → `[]`。
- `resolveDownloadTarget`：命中键返回 `{url: <直链>, fileName: <资产名>}`；未命中返回 `null`。
- `startDirectDownload`：注入假 `fetch`（Range 0-0 第一条 200 → `location.assign` 记下首条 URL，resolve `'started'`）；第一条 404、第二条 200 → assign 第二条；两条都抛/非 2xx → resolve `'fallback'` 且 assign 从未调用。

- [ ] **Step 2: 运行确认失败**

Run: `cd site && node --test src/lib/releaseDownload.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `site/src/lib/releaseDownload.js`**

纯函数 + 注入式副作用（`fetch`/`location` 从参数或全局取）。平台映射：Windows→win、MacIntel→mac、Linux→linux。加速前缀用导出常量 `GITHUB_ACCELERATOR_PREFIX = 'https://gh-proxy.org/'`（Task 5 与桌面侧常量注释互指）。Range 探测 `fetch(url, { headers: { Range: 'bytes=0-0' } })`，`res.ok || res.status === 416` 视为可达。模块顶部注释说明 UA 无法可靠区分 Apple Silicon/Intel 故默认 arm64。

- [ ] **Step 4: 运行确认通过**

Run: `cd site && node --test src/lib/releaseDownload.test.js`
Expected: PASS

- [ ] **Step 5: 写 `DownloadPage.tsx`（无测试步骤——见下）**

页面结构（紧凑、产品风，不搞营销 hero）：版本徽章（manifest.version）、平台/架构选择（默认 `pickPlatformArch` 探测结果，可手改）、主下载按钮（`startDirectDownload`，探测期间禁用 + `aria-busy`）、「其他格式」区（manifest.extras 的 deb/rpm 旁链，直链 GitHub）、manifest 加载失败时整页回退为「前往 GitHub Releases」按钮、页面底部一行小字：自动更新说明（「已安装用户：设置 → 关于 → 检查更新」）。文案走 `landingContent`/既有 i18n 模式（站点用 locale prop，不引 i18n 库）。`toSiteHref` 保持 `/en/download` 双语路径。

- [ ] **Step 6: 接线 App 路由与静态骨架**

`App.jsx`：`path === '/download' || path === '/en/download'` 渲染 `DownloadPage`（传 locale）。`prepare-static-output.mjs`：`createRouteEntry('/download', shell, {...meta})` 与 `/en/download`（meta 用中/英标题与 description），并加入 `writeSitemap` 的 urls 列表。**不要**把它做成 docs 记录（不进 `docs/` 目录、无 frontmatter、不进侧边栏）。

- [ ] **Step 7: 站点检查**

Run: `cd site && npm run check`
Expected: PASS（typecheck + check:docs + node 测试全过）

- [ ] **Step 8: Commit**

```bash
git add site/src/lib/releaseDownload.js site/src/lib/releaseDownload.test.js site/src/pages/download/DownloadPage.tsx site/src/App.jsx site/scripts/prepare-static-output.mjs site/src/components/SiteHeader.jsx site/src/pages/home/HomePage.tsx
git commit -m "feat(site): add a standalone /download page resolving installers with accelerator-first fallback"
```

**Files:**
- Create: `site/src/lib/releaseDownload.js`
- Test: `site/src/lib/releaseDownload.test.js`

**Interfaces:**
- Consumes: `site/src/components/SiteHeader.jsx` 的 `GITHUB_URL`；`downloads.json` schema（Task 4 生成，此处按契约写死消费）：`{ version, tag, assets: { "win-x64": "EchoFlow-Code-0.7.1-win-x64.exe", ... } }`
- Produces: `resolveDownloadTarget(platform, arch, manifest) -> { url, fileName } | null`；`buildDownloadCandidates(manifest, platform, arch) -> string[]`（加速前缀在前、GitHub 直链在后）；`pickPlatformArch(userAgent) -> { platform, arch }`；`startDirectDownload(candidates, opts?) -> Promise<'started' | 'fallback'>`（Range 探测 + `window.location.assign`，全失败 resolve `'fallback'` 由调用方回退 GitHub 页）

- [ ] **Step 1: 写失败测试 `site/src/lib/releaseDownload.test.js`**

覆盖（`node --test`）：
- `pickPlatformArch`：Win32 UA → `{platform:'win', arch:'x64'}`；UA 含 `Windows` 且 `ARM64` → `arm64`；MacIntel UA → `{platform:'mac', arch:'arm64'}`（默认主流架构，UA 不可靠）；Linux x86_64 → `{platform:'linux', arch:'x86_64'}`；空 UA → win/x64 默认。
- `buildDownloadCandidates`：manifest 有 `win-x64` 资产时返回**两条**候选，第一条以 `https://gh-proxy.org/https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/download/<tag>/` 开头，第二条为 GitHub 直链；manifest 缺该 platform-arch 键 → 返回 `[]`；tag 缺失 → `[]`。
- `resolveDownloadTarget`：命中键返回 `{url: <直链>, fileName: <资产名>}`；未命中返回 `null`。
- `startDirectDownload`：注入假 `fetch`（Range 0-0 第一条 200 → `location.assign` 记下首条 URL，resolve `'started'`）；第一条 404、第二条 200 → assign 第二条；两条都抛/非 2xx → resolve `'fallback'` 且 assign 从未调用。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd site && node --test src/lib/releaseDownload.test.js`
Expected: FAIL（模块不存在/导出未定义）

- [ ] **Step 3: 实现 `site/src/lib/releaseDownload.js`**

纯函数 + 注入式副作用（`fetch`/`location` 从参数或全局取，便于测试注入）。平台映射：Windows→win、MacIntel→mac、Linux→linux。加速前缀从**导出常量** `GITHUB_ACCELERATOR_PREFIX = 'https://gh-proxy.org/'` 拼接（桌面侧常量在 Task 2 收口为同一字符串）。Range 探测用 `fetch(url, { headers: { Range: 'bytes=0-0' } })`，`res.ok || res.status === 416` 视为可达。模块顶部加一行注释说明 UA 无法可靠区分 Apple Silicon/Intel，故默认 arm64。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd site && node --test src/lib/releaseDownload.test.js && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/releaseDownload.js site/src/lib/releaseDownload.test.js
git commit -m "feat(site): resolve direct installer downloads with accelerator-first fallback"
```

---

#### Task 2: 应用侧元数据源切官网 + 兜底 + 失败引导

**前置检查：** `/download` 页面（Task 1）必须已上线可达（`curl -sI https://code.echoflow.cn/download` 返回 200）再合本任务——引导链接指向它。

**Files:**
- Modify: `desktop/electron/services/updateFeed.ts:1-2,26-44`（常量与 `resolveUpdateFeedConfig`）
- Modify: `desktop/electron/services/updater.ts:259-287`（`checkForUpdates` 回退链）
- Modify: `desktop/electron/main.ts:507-511`（传 `metadataFallbackUrls`）
- Modify: `desktop/electron/services/updater.ts:53-57` 与 `desktop/src/lib/desktopHost/types.ts:112-114`（`'mismatched-metadata'` 类型缺口，顺带补）
- Test: `desktop/electron/services/updateFeed.test.ts`
- Test: `desktop/electron/services/updater.test.ts`
- Modify: `desktop/src/pages/settings/AboutSettings.tsx:150-170`（错误区）
- Modify: `desktop/src/i18n/locales/{zh,zh-TW,en,jp,kr}.ts`

**Interfaces:**
- Consumes: Task 1 无依赖；`normalizeUpdateFeedBaseUrl`、`MissingUpdateMetadataError`（既有）。
- Produces: `UpdateFeedConfig` 增字段 `metadataFallbackUrls: string[]`；`resolveUpdateFeedConfig` 默认产出 `metadataUrl = 'https://code.echoflow.cn/update/'`、`metadataFallbackUrls = [DIRECT_GITHUB_RELEASE_FEED_URL]`、`downloadFeedUrls = [proxy, direct]`（不变）；`ECHOFLOW_UPDATE_FEED_URL` 显式设置时仍为纯单源（`metadataFallbackUrls: []`）。

- [ ] **Step 1: 写失败测试（updateFeed）**

`desktop/electron/services/updateFeed.test.ts` 改默认期望并新增：
- 无 env：`metadataUrl === 'https://code.echoflow.cn/update/'`、`metadataFallbackUrls === [DIRECT_GITHUB_RELEASE_FEED_URL]`、`downloadFeedUrls === [proxyFeedUrl, directFeedUrl]`。
- `ECHOFLOW_UPDATE_FEED_URL` 显式：`metadataFallbackUrls === []`（纯单源）。
- `ECHOFLOW_UPDATE_GITHUB_PROXY_BASE` 仍只影响 `downloadFeedUrls[0]`。
- `resolveUpdateFeedUrls` 仍返回去重全量（元数据主源 + 兜底 + 下载源）。

- [ ] **Step 2: 运行确认失败**

Run: `cd desktop && bun test ./electron/services/updateFeed.test.ts`
Expected: FAIL（默认值断言）

- [ ] **Step 3: 实现 updateFeed.ts**

新增 `const SELF_UPDATE_METADATA_URL = 'https://code.echoflow.cn/update/'`；`UpdateFeedConfig` 加 `metadataFallbackUrls: string[]`；显式 env 分支返回 `metadataFallbackUrls: []`；默认分支返回主源 + `[DIRECT_GITHUB_RELEASE_FEED_URL]`。`resolveUpdateFeedUrls` 并入兜底 URL。

- [ ] **Step 4: 写失败测试（updater 回退链）**

`desktop/electron/services/updater.test.ts` 新增（沿用既有 fake updater 注入风格）：
- 主元数据源抛 `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`（或 404 cannot find latest*.yml）→ `checkForUpdates` 自动切兜底源并返回兜底源解析到的 update（pendingUpdate 来自兜底）。
- 主源抛**普通网络错误**（非 missing metadata）→ 同样回退（设计决策：网络错误也回退，别让单点抖动吞掉检查）。
- 主源与兜底源都 missing metadata → 返回 `null`（静默无更新，与老行为一致）。
- 都抛普通错误 → 抛出且 `getLastFeedAttempts()` 记录两条尝试。
- `downloadUpdate` 现有顺序循环不变：补一条「两个下载源指纹都 mismatch → 抛错且尝试列表含 mismatched-metadata」用例（当前无覆盖）。

- [ ] **Step 5: 运行确认失败**

Run: `cd desktop && bun test ./electron/services/updater.test.ts`
Expected: FAIL

- [ ] **Step 6: 实现 updater.ts 回退链**

`checkForUpdates`：把 `metadataFeedUrl` 单源改为 `[metadataFeedUrl, ...metadataFallbackUrls]` 顺序尝试；对每个源 `setFeedUrl` → `checkForUpdatesOnCurrentFeed()`；`MissingUpdateMetadataError` 记 `missing-metadata` 后试下一源；其他错误记 `error` 后试下一源；全源 missing → 返回 `null`；至少一个源成功 → `withFeedDiagnostics` 记 `selected` 并返回。全源失败 → 抛 `withFeedAttemptErrorMessage`（消息含全部尝试，供 UI 展示）。同时把 `ElectronUpdateFeedAttempt.result` 联合与 `types.ts` 对齐补 `'mismatched-metadata'`。

- [ ] **Step 7: 接线 main.ts**

`getUpdaterService` 构造参数把 `feedConfig.metadataFallbackUrls` 传入（`ElectronUpdaterService` 构造器增同名字段，默认 `[]`）。

- [ ] **Step 8: 运行 electron 测试确认通过**

Run: `cd desktop && bun test ./electron`
Expected: PASS

- [ ] **Step 9: 写失败测试（失败引导 UI）**

`desktop/src/pages/settings/AboutSettings.tsx` 对应测试文件（新建或并入现有 AboutSettings 测试）：
- `errorCode` 非空且状态为 `error` 时，错误区渲染「请至 https://code.echoflow.cn/download 手动下载新版」文案与按钮；点击按钮调用 `getDesktopHost().shell.open('https://code.echoflow.cn/download')`（沿用该文件既有 open 模式，line 94）。
- `errorCode === null` 时不渲染引导区。
- 文案经 i18n key（不硬编码中文）。

- [ ] **Step 10: 运行确认失败**

Run: `cd desktop && bun run test -- --run src/pages/settings/AboutSettings`
Expected: FAIL

- [ ] **Step 11: 实现引导区 + 五个 locale key**

在错误展示处（`UPDATE_ERROR_KEYS` 映射渲染附近）追加引导块。新增 key：`update.manualDownloadHint`（例：「更新检查失败。请至官网下载页手动获取新版：」）与 `update.manualDownloadAction`（「前往下载页」），五语言（zh/zh-TW/en/jp/kr）同步。同步更新 `update.idle` 文案中「对比 GitHub Releases 的最新版本」→「对比官网更新服务的最新版本」。

- [ ] **Step 12: 运行 desktop 测试确认通过**

Run: `cd desktop && bun run test -- --run src/pages/settings/AboutSettings`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add desktop/electron/services/updateFeed.ts desktop/electron/services/updater.ts desktop/electron/main.ts desktop/src/lib/desktopHost/types.ts desktop/electron/services/updateFeed.test.ts desktop/electron/services/updater.test.ts desktop/src/pages/settings/AboutSettings.tsx desktop/src/pages/settings/AboutSettings.test.tsx desktop/src/i18n/locales
git commit -m "feat(desktop): check updates from code.echoflow.cn with GitHub fallback and manual-download guidance"
```

---

#### Task 3: 文档与站点文案指向新下载页

**Files:**
- Modify: `docs/start/install.md:16-29`（下载表改指 `/download`）
- Modify: `docs/start/install.md:134`（更新说明改为官网更新服务）
- Modify: `docs/start/troubleshooting.md`（版本确认措辞）
- Modify: `docs/start/code-signing.md`（Release 来源措辞保留 GitHub 事实，不改）
- Modify: `docs/en/start/install.md`（同上，双语对齐）
- Modify: `docs/en/start/troubleshooting.md`
- Modify: `docs/public/llms.txt:11`（Latest desktop download）
- Test: `site/scripts/check-docs.mjs` 隐式覆盖（链接解析）

**Interfaces:**
- Consumes: Task 1 的 `/download` 路由。
- Produces: 无。

- [ ] **Step 1: 改 docs 下载指向**

`install.md`：下载表从「GitHub Releases 选一个」改为「打开 [下载页](https://code.echoflow.cn/download) 按系统与架构下载」；表格保留为「其他架构/直链见 GitHub Releases」的兜底说明（外链保留）。`troubleshooting.md` 的「最新正式版」措辞改为下载页（外链仍可保留 GitHub）。`code-signing.md` 讲的是签名与来源验证，**GitHub Releases 仍是事实来源，不改**。`llms.txt` 的 `Latest desktop download` 改 `https://code.echoflow.cn/download`。

- [ ] **Step 2: 检查文档链接契约**

Run: `bun run check:docs`
Expected: PASS（`/download` 已在 Task 1 进 sitemap/routes；docs 内指向外网不校验）

- [ ] **Step 3: Commit**

```bash
git add docs/start/install.md docs/start/troubleshooting.md docs/en/start/install.md docs/en/start/troubleshooting.md docs/public/llms.txt
git commit -m "docs: point install and troubleshooting at the standalone download page"
```

---

#### Task 4: 发版同步（CI + 生成器 + 契约测试）

**Files:**
- Create: `scripts/site-release-manifest.ts`
- Test: `scripts/site-release-manifest.test.ts`
- Modify: `package.json:17`（`check:policy` 追加新测试文件）
- Modify: `.github/workflows/release-desktop.yml`（`publish-release` outputs + 新 job `site-release-sync`）
- Modify: `.github/workflows/deploy-docs.yml`（`workflow_call` inputs + build 步骤嵌入）
- Modify: `scripts/pr/release-workflow.test.ts`
- Modify: `scripts/pr/pr-quality-workflow.test.ts`
- Modify: `AGENTS.md`（Release Workflow 一节一句话）
- Modify: `site/AGENTS.md`（生成文件契约）

**Files:**
- Create: `scripts/site-release-manifest.ts`
- Test: `scripts/site-release-manifest.test.ts`
- Modify: `package.json:17`（`check:policy` 追加新测试文件）
- Modify: `.github/workflows/release-desktop.yml`（`publish-release` outputs + 新 job `site-release-sync`）
- Modify: `.github/workflows/deploy-docs.yml`（`workflow_call` inputs + build 步骤嵌入）
- Modify: `scripts/pr/release-workflow.test.ts`
- Modify: `scripts/pr/pr-quality-workflow.test.ts`
- Modify: `AGENTS.md`（Release Workflow 一节一句话）
- Modify: `site/AGENTS.md`（生成文件契约）

**Interfaces:**
- Consumes: Task 2 的 `SELF_UPDATE_METADATA_URL` 常量语义（`/update/` 路径）；`scripts/release-update-metadata.ts` 的风格（bun、yaml parse/stringify）。
- Produces: `generateSiteReleaseManifest({ release, outDir, githubToken, repo }) -> { downloadsPath, updateFiles }`；`site/dist/downloads.json`（`{ version, tag, assets }`）；`site/dist/update/{latest.yml,latest-mac.yml,latest-linux.yml,latest-linux-arm64.yml}`。

- [ ] **Step 1: 写失败测试 `scripts/site-release-manifest.test.ts`**

注入假 GitHub API（fetch stub 或 `gh` CLI stub——选仓库已有惯例；`release-update-metadata.test.ts` 用真实 fixture 文件，此处同样优先 fixture 风格）：
- 给定 release tag 与资产清单 fixture → 写出四个 yml 到 `<out>/update/`（内容逐字节等于 fixture 源）且 `<out>/download/manifest.json` 含 `version`/`tag`/`assets`（六个主推键：`win-x64`、`win-arm64`、`mac-arm64`、`mac-x64`、`linux-x86_64`、`linux-arm64`）与 `extras`。
- 资产名严格来自资产清单（fixture 中放入非模板名如 `linux-x86_64.AppImage`），**不得**由 `artifactName` 模板推导。
- `latest.yml` 缺失于资产清单 → 抛错（管线必须红）。
- 幂等：重复运行输出一致。

- [ ] **Step 2: 运行确认失败**

Run: `bun test ./scripts/site-release-manifest.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `scripts/site-release-manifest.ts`**

CLI：`--release <tag|latest> --out <dir> --repo <owner/repo>`。用 `gh api repos/{repo}/releases/{tag}` 取资产表（沿用仓库既有 gh 用法；无 token 时清晰报错）。下载四个 yml 资产内容写入 `<out>/update/<原名>`；从资产清单挑出 `.exe/.dmg/.AppImage/.deb/.rpm`（排除 `.zip`/`.blockmap`/`.yml`）按命名规则映射 platform-arch 键（正则提取 `-win-x64`/`-mac-arm64`/`-linux-x86_64` 等记号；无法识别的资产名抛错——宁可红也不静默漏）。`<out>/download/manifest.json` 写 `{ version, tag, assets: {win-x64, win-arm64, mac-arm64, mac-x64, linux-x86_64, linux-arm64}, extras: {deb/rpm 文件名} }`——注意 manifest 落 `download/` 子目录（不是 dist 根），与下载页同路径；`--out` 传入的是 `site/dist`。

- [ ] **Step 4: 运行确认通过 + 挂 policy**

Run: `bun test ./scripts/site-release-manifest.test.ts && bun run check:policy`
Expected: PASS（先按报错把新测试追加进 `package.json` 的 `check:policy` 清单）

- [ ] **Step 5: 改 release-desktop.yml（先写测试）**

`scripts/pr/release-workflow.test.ts` 新增断言（在既有 publish-release describe 内）：
- `publish-release` job 有 `outputs: version`；
- 存在 `site-release-sync` job，`needs: publish-release`，其 `if` 与既有 undraft 条件一致（draft 关闭才跑）；
- 该 job 调用 `deploy-docs`（`workflow_call` 传 `release_tag`）且排在 GitHub 完整发布之后。

Run: `bun test ./scripts/pr/release-workflow.test.ts` → FAIL（断言不存在）

- [ ] **Step 6: 实现 release-desktop.yml**

`publish-release` 增 `outputs: version: ${{ steps.version.outputs.value }}`（version step 已存在，line 997-1002）；新增 job `site-release-sync`（`needs: publish-release`，`if` 复刻 undraft 条件）：`uses: ./.github/workflows/deploy-docs.yml` + `with: release_tag: ${{ needs.publish-release.outputs.version }}` + `secrets: inherit`。

- [ ] **Step 7: 改 deploy-docs.yml（先写测试）**

`scripts/pr/pr-quality-workflow.test.ts` 的 `docs deployment workflow` describe 新增断言：workflow 有 `workflow_call.inputs.release_tag`；build 中 `run: npm --prefix site run build` 之后、`path: site/dist` 之前存在 manifest 生成步骤；普通 docs 部署（无 `release_tag`）同样生成（`--release latest`），保证 `/update/` 不消失；`DOCS_BASE: /` 与 CNAME 断言相关步骤不变。

Run: `bun test ./scripts/pr/pr-quality-workflow.test.ts` → FAIL

- [ ] **Step 8: 实现 deploy-docs.yml**

`on:` 增 `workflow_call: inputs: release_tag: {type: string, required: false}`；build job 加 `oven-sh/setup-bun`（版本对齐仓库其他 workflow 的用法）与 `GH_TOKEN: ${{ github.token }}`；在 build 与 upload 之间加步骤：`bun run scripts/site-release-manifest.ts --release ${{ inputs.release_tag || 'latest' }} --out site/dist --repo ${{ github.repository }}`。**放在 upload 之前 = 同步失败即 workflow 红**（满足「失败必须可见」）。

- [ ] **Step 9: 运行契约测试确认通过**

Run: `bun test ./scripts/pr/release-workflow.test.ts ./scripts/pr/pr-quality-workflow.test.ts`
Expected: PASS

- [ ] **Step 10: 文档同步**

`AGENTS.md` Release Workflow 一节加一句：发版 additionally 把更新元数据与下载页 manifest 同步到 code.echoflow.cn（GitHub Releases 仍是完整发布源）。`site/AGENTS.md` 加契约：`/download/manifest.json` 与 `/update/*.yml` 由 deploy 生成、不入库、本地 build 不触网。跑 `bun run audit:harness`（AGENTS.md 变更必须）。

- [ ] **Step 11: Commit**

```bash
git add scripts/site-release-manifest.ts scripts/site-release-manifest.test.ts package.json .github/workflows/release-desktop.yml .github/workflows/deploy-docs.yml scripts/pr/release-workflow.test.ts scripts/pr/pr-quality-workflow.test.ts AGENTS.md site/AGENTS.md
git commit -m "feat(release): mirror update metadata and downloads manifest to the site on publish"
```

---

#### Task 5: 收尾——加速常量收口、文档与降级模式记录

**Files:**
- Modify: `desktop/electron/services/updateFeed.ts`（`DEFAULT_PROXY_FEED_URL` 加注释指向站点侧同一常量）
- Modify: `docs/internals/contributing.md`（发布/更新链路一节）
- Modify: `docs/_internal/archive/planning/release-and-updates.md#specs-2026-10-26-update-channel-design`（按对抗审查结论更正：删「双 yml 对照」，记录 stale 自愈为降级模式）

**Interfaces:**
- Consumes: Task 1-4 全部。
- Produces: 无。

- [ ] **Step 1: 常量收口**

在 `updateFeed.ts` 的 `DEFAULT_PROXY_FEED_URL` 与 `site/src/lib/releaseDownload.js` 的 `GITHUB_ACCELERATOR_PREFIX` 各加一行注释：两处字符串必须一致，换镜像需同改。

- [ ] **Step 2: 文档**

`docs/internals/contributing.md` 记：更新链路（元数据官网优先/GitHub 兜底、下载加速优先/直连兜底、失败引导手动下载）、发版同步步骤、以及三条不可破坏项（GitHub 完整发布、yml 逐字节、artifactName 不变）。设计文档删掉「双元数据对照」决策，改写为：EdgeOne 缓存陈旧属可接受降级模式（下次同步自愈）。

- [ ] **Step 3: 本地全量验证**

Run: `bun run check:impact`
Expected: 报告列出 desktop/native/docs/scripts 相关面（按实际导入图）

- [ ] **Step 4: Commit**

```bash
git add docs/internals/contributing.md docs/_internal/archive/planning/release-and-updates.md#specs-2026-10-26-update-channel-design desktop/electron/services/updateFeed.ts
git commit -m "docs: record the self-hosted update channel and its compatibility preconditions"
```

---

### 执行顺序与发版注意

- Task 1→2→3→4→5 顺序执行。**Task 1 的 `/download` 页面上线是 Task 2 应用切 feed 的前置**（引导链接指向它）；Task 4 的 `--out site/dist` 产出 `/download/manifest.json` 与 Task 1 的消费端是隐式契约（下载页在 manifest 缺失时回退 GitHub 页，不会白屏）。
- **本次发版验证清单**（release 工作流跑完后人工确认）：
  1. GitHub Release 资产完整（18 个安装包/blockmap + 4 个 yml）；
  2. `https://code.echoflow.cn/download/manifest.json` 可达且含正确 tag；
  3. 四个 `https://code.echoflow.cn/update/*.yml` 可达、内容与 GitHub 版逐字节一致（`diff <(curl -s ...) <(gh api ... --jq .content | base64 -d)`）；
  4. 新装一版应用，检查更新命中官网元数据；临时把 `ECHOFLOW_UPDATE_FEED_URL` 指向一个 404 地址验证兜底；断网验证引导区出现且按钮跳 `/download`。

---

<a id="plans-2026-10-27-download-theme-and-release-verification"></a>

## Download Theme and Release Verification Implementation Plan

来源：`plans/2026-10-27-download-theme-and-release-verification.md`。

**Goal:** Bring the public download page into the existing Wandor/documentation visual system and identify/fix the actual runtime or desktop release-verification failure without disturbing unrelated user changes.

**Architecture:** Keep the download data flow in `releaseDownload.js` unchanged. Rework only `DownloadPage.tsx` markup classes and `download.css`, using the existing warm-paper tokens and local assets already used by the public site; add a page-scoped theme shell so the shared `SiteHeader` receives the same visual treatment as documentation. For CI, run each command from the release workflow independently, trace any failure to its source, and add only the smallest regression test or source fix required.

**Tech Stack:** React 19, TypeScript/TSX, plain CSS, Vite, Node test runner, Bun test runner, GitHub Actions workflow scripts.

**Spec:** Existing repository contract in `site/AGENTS.md` and `AGENTS.md`; no separate product spec is needed because the requested behavior is to unify the download page with the existing Wandor/documentation theme while preserving download functionality.

### Global Constraints

- Preserve the download manifest, platform/architecture selection, accelerator-first fallback, GitHub fallback, locale routes, and metadata behavior.
- Reuse existing site tokens and local assets; do not add a dependency, CDN font, or a fourth responsive breakpoint.
- Do not modify the user's in-progress login/auth files unless a confirmed release failure directly requires it.
- Keep CI checks deterministic, offline where required, and use the repository's existing verification routing.
- Run `bun run check:docs` after site changes and record desktop plus narrow-mobile browser evidence when available.
- Never claim the release problem is fixed until the exact failing command passes independently.

### Review Focus

- Missing manifest/loading state: the page must remain useful and visually composed before `/download/manifest.json` resolves.
- Manifest unavailable or unsupported selection: the GitHub Releases fallback must remain reachable without broken layout.
- Both light and dark themes: the page and shared header must use the correct warm-paper/ink palette in either `data-theme`.
- Narrow mobile viewport: platform and architecture controls, CTA, header, and footer text must not overflow or shift unpredictably at the existing 620px breakpoint.
- CI command composition: a passing aggregate job must not hide which server/desktop lane failed; run and report each workflow command separately.

---

#### Task 1: Make the download page use the existing public-site theme

**Files:**
- Modify: `site/src/pages/download/DownloadPage.tsx`
- Modify: `site/src/pages/download/download.css`
- Test/verify: `site/package.json` scripts and browser render of `/download` and `/en/download`

**Interfaces:**
- Consumes: existing `SiteHeader`, `releaseDownload.js` functions, `setPageMeta`, `site/src/styles/base.css` tokens, and existing home/documentation visual language.
- Produces: a page-scoped download shell whose markup preserves all existing selection and fallback behavior and whose CSS uses the warm-paper layout, editorial typography, black capsule CTA, restrained glass surfaces, and responsive breakpoints already used by the site.

- [ ] **Step 1: Add the page shell and semantic visual regions without changing behavior**

  Keep the existing state/effects and event handlers. Add only stable classes/semantic wrappers for: page shell, intro/eyebrow, version metadata, selection panel, platform/architecture groups, primary CTA, fallback panel, extra formats, update note, and a compact footer/back-to-docs affordance if the existing page has no equivalent. Keep locale copy and links intact.

- [ ] **Step 2: Replace the standalone white-card CSS with token-backed Wandor/documentation styling**

  Scope all rules under the download shell. Use existing `--bg`, `--surface`, `--surface-muted`, `--brand`, `--brand-soft`, `--ink`, `--on-ink`, `--border`, `--shadow-*`, `--font-sans`, and `--font-serif` tokens rather than raw colors. Use a wide editorial two-column desktop composition with the action panel as the visual anchor, a paper/landscape ambient surface from an existing local asset if appropriate, capsule controls matching the home CTA, and the existing 1180/900/620 media breakpoints. Add hover, pressed, focus-visible, loading, empty, and dark-theme states.

- [ ] **Step 3: Run site checks and inspect both routes at desktop and mobile widths**

  Run `cd site && npm run typecheck`, `cd site && npm run check:docs`, and `cd site && npm test`. Build with `cd site && npm run build`. Use the existing browser/screenshot path if available to inspect `/download` and `/en/download` at 1280x900 and 375x760, checking both theme attributes; fix only regressions found in this page.

#### Task 2: Reproduce release verification failures by lane

**Files:**
- Inspect: `.github/workflows/release-desktop.yml`
- Inspect: `package.json`, `desktop/package.json`, `adapters/package.json`, and relevant check scripts/tests
- Inspect: `src/utils/auth.ts`, `src/utils/authFileDescriptor.ts`, and related tests only as evidence

**Interfaces:**
- Consumes: the exact commands from `verify-runtime` and `verify-desktop` in the release workflow.
- Produces: a confirmed failure matrix identifying the failing command, error, and root cause; no source change is allowed until the failure is reproduced or a CI-only cause is proven.

- [ ] **Step 1: Run each runtime lane independently**

  From the repository root, run `bun run check:server`, `bun run check:agent-flow`, and `bun run check:adapters` separately, capturing the first failing test and complete error. Do not infer from the aggregate job status.

- [ ] **Step 2: Run each desktop lane independently**

  Run `bun run check:desktop` and `bun run check:persistence-upgrade` separately, capturing the first failing test and complete error. Compare with the workflow's clean-checkout dependency installation and platform environment.

- [ ] **Step 3: Trace the first failure to source and test isolation**

  For an auth-related failure, inspect environment variables, FD descriptors, well-known token paths, and global cache setup/teardown; for a desktop failure, trace the failing assertion to its source. Record a single falsifiable hypothesis before editing.

#### Task 3: Apply the smallest verified release fix, if reproduction confirms one

**Files:**
- Modify: only the source/test/workflow file directly responsible for the confirmed failure
- Test: matching same-area regression test beside the changed production code

**Interfaces:**
- Consumes: Task 2's confirmed failure matrix and hypothesis.
- Produces: a focused regression test that fails before the fix and passes after it, with no changes to unrelated user-owned work.

- [ ] **Step 1: Add the minimal failing regression test**

  Pin the invariant at the affected seam; for auth, restore process environment and global credential caches and isolate any well-known file path; for desktop, assert the actual user-visible contract rather than retuning an existing expectation.

- [ ] **Step 2: Implement one root-cause fix**

  Change only the responsible code path. Do not add broad retries, weaken assertions, skip tests, or alter release gating to hide the failure.

- [ ] **Step 3: Run the focused test and the selected surface checks**

  Run the new test first, then `bun run check:impact`, and the selected gate (`bun run check:server`, `bun run check:desktop`, or `bun run check:persistence-upgrade`). Re-run every exact release workflow command that failed.

- [ ] **Step 4: Run final verification and report remaining risk**

  Run `bun run check:docs` for the site work and `bun run verify` only after the focused lanes pass. Report changed files, tests, visual evidence, skipped checks, and any unresolved CI/network limitation.

---

<a id="plans-2026-11-02-incremental-update-rollout"></a>

## Electron 增量更新分阶段落地计划

来源：`plans/2026-11-02-incremental-update-rollout.md`。

**Goal:** 先证明现有完整安装包升级闭环，再在不更换 Electron、不引入第三方 delta-builder 的前提下，对 EchoFlow Windows/macOS 的 blockmap 差分下载做可验证、可回退的 canary；Linux AppImage 第一阶段保持完整包更新。

**Architecture:** 保留现有 `electron-updater` 与 `electron-builder`。更新服务默认继续关闭差分下载，通过 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=1` 提供仅供维护者 canary 的显式开关；差分路径只接受 `resolveUpdateFeedConfig()` 产生的、与内置 canonical direct GitHub download URL 完整规范化后精确匹配的 verified feed，`gh-proxy.org`、`ECHOFLOW_UPDATE_FEED_URL` 和其他自定义源默认只能走完整包。先补齐产物、Range、签名后 blockmap、feed fallback 和安装顺序的离线/真实验收，再把 Windows/macOS 的默认值改为开启。默认开启后由 `ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` 提供优先级最高的紧急关闭；`ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=0` 也强制关闭，`=1` 只请求开启，未设置使用当前 release default，其他值一律 fail-closed（不得继承 on 的 release default），两个变量同时存在时关闭优先。Linux 不因本计划强制要求 `.AppImage.blockmap`。

**Tech Stack:** Electron 42、`electron-updater` 6.8、`electron-builder` 26.8、Bun、TypeScript、Vitest/Bun test、GitHub Actions、现有 `package-smoke`。

**Spec:** 用户请求“怎么先做增量升级，规划一下”；仓库现状以 `desktop/electron/services/updater.ts`、`updateFeed.ts`、`scripts/refresh-windows-update-metadata.ts`、`scripts/release-update-metadata.ts`、`.github/workflows/release-desktop.yml` 和现有测试为准。

### Global Constraints

- 第一阶段只验证 Windows NSIS 和 macOS zip；Linux AppImage 保持现有完整包更新路径。
- `ElectronUpdaterService` 的默认行为在 canary 通过前必须保持 `disableDifferentialDownload = true`；默认值改为 on 前必须先通过 verified-feed 与离线 Range contract 门禁。
- 差分下载只允许平台支持、显式启用且 download feed URL 属于静态 verified allowlist；feed 必须按完整规范化 URL 精确匹配，不得只按 hostname、前缀或环境变量名称判断。
- `UpdateFeedConfig` 必须显式提供 `differentialDownloadFeedUrls: string[]`；默认仅允许 canonical direct GitHub feed，默认 `gh-proxy.org`、`ECHOFLOW_UPDATE_FEED_URL` 和其他自定义 feed 不得进入该列表。
- 差分模式下 `main.ts` 只能把 `downloadFeedUrls` 限制为 `differentialDownloadFeedUrls`；未验证 proxy 只能走完整包路径，不能作为差分路径中的 fallback。
- 环境变量契约固定为：`ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` 优先级最高并强制关闭；否则 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=0` 也强制关闭；`=1` 仅请求开启并仍受平台和 verified feed 限制；未设置使用当前 release default；`true`、`yes`、空白及其他非法值按 fail-closed 处理并不得启用。两个强制关闭条件同时存在时仍关闭。
- 不引入 `@jake-gao/delta-builder`、HDiffPatch 或新的网络/更新依赖。
- GitHub Release 继续保留完整 electron-builder 资产；站点镜像的 `latest*.yml` 必须与 GitHub 资产逐字节一致。
- Windows 签名完成后，必须基于最终签名 installer 重建 `.blockmap`，并更新最终 `latest.yml` 的 checksum/size。
- 任何差分失败都必须落到完整包或现有 feed fallback；不能把失败表现成“已下载完成”。
- 只有 `downloadUpdate()` 成功发出 `Finished` 后，才允许 `quitAndInstall(false, true)`。
- 不修改桌面架构、`DesktopHost`、Tauri 兼容代码、renderer 性能代码或用户数据持久化格式。
- 不把本地构建目录、coverage、安装包或真实用户配置提交进仓库。

### Review Focus

- **默认关闭、已验证 feed 与紧急关闭**：没有环境变量时仍走完整包；差分请求必须同时满足 Windows/macOS、精确 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=1`（或默认开启阶段的内部默认值）和已验证 feed；内置 canonical direct GitHub feed 才是首个已验证 feed，`gh-proxy.org`、任意 `ECHOFLOW_UPDATE_FEED_URL` 和任意自定义 proxy 必须保持完整包，除非另有独立验证并显式加入 allowlist；`ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` 永远优先并强制关闭。对应 `updater.test.ts`、`main.ts`/feed 配置测试。
- **Range 响应异常**：源返回 `200`、`416`、重定向、错误 `Content-Range`、不支持 `Accept-Ranges`、中断或 multipart/byteranges 时，真实下载路径必须有离线 contract 断言其成功、失败或完整包 fallback；GitHub 直连按单 Range 验证，`gh-proxy.org` 另测其可能返回的 multipart/byteranges，不能把两者视为同一种源；对应 loopback HTTP contract 测试和真实源验收记录。若依赖没有可离线调用的稳定入口，Task 4 必须标记 BLOCKED 并禁止进入默认启用。
- **签名后资产不一致**：最终 installer、`.blockmap`、`latest.yml` 的文件名、size、sha512 必须相互匹配；导出的 metadata API 自身必须在写回前验证 installer、blockmap 和唯一 `files[]` 配对；对应 `refresh-windows-update-metadata.test.ts`、workflow contract 和 package smoke。
- **Canary 证据不可复核**：每个启用差分的 platform/arch/source 必须保存不入库的结构化 evidence artifact，包含实际 updater `GET`、`Range`、`206`、正确 `Content-Range`、`Content-Length`、`Accept-Ranges`、重定向链、fallback 结果、release/client/installer 摘要；direct GitHub 与未验证 `gh-proxy.org` 的完整包记录不得混为差分成功证据。
- **多源 fingerprint 不一致**：metadata feed 与 download feed 不一致时不得下载；一致但主下载源失败时才尝试下一个源；切换 feed 后必须证明不会复用旧 provider、旧 blockmap、旧下载缓存或已下载文件；对应现有 `updater.test.ts` 的回归扩展。
- **差分模式回退范围**：只有代码中的 verified-feed allowlist 可进入差分路径；未知或未验证 Range 能力的 proxy（包括当前 `gh-proxy.org`）不得进入默认差分路径。失败必须回退同源完整包或明确切到 direct 源，不得只切 metadata 而沿用旧 download state；切换到未验证源时必须显式将差分关闭。
- **中断和重复安装**：下载失败/中断不发 `Finished`，不能安装；成功后重复下载不重复拉取，取消后必须重新检查；对应 `updater.test.ts` 和真实旧版升级验收。

---

#### 前置阶段：冻结可追溯候选基线（不改代码）

**Files:**
- 不修改仓库文件；当前工作区只读检查。

**目的:** 当前工作区包含大量与更新链无关的既有修改，不能直接把它当作候选发布版本。先从明确的 `main`、release 分支或独立干净 checkout 建立候选基线；保留当前工作区，不执行 `reset`、`clean`、覆盖式恢复、移动 tag 或覆盖既有 Release。

- [ ] **Step 1: 固定候选版本与改动边界**
  - 在干净 checkout 中运行 `git status --short --branch`。
  - 核对 `desktop/package.json`、`mobile/package.json`、`mobile/app.json`、release notes 和 tag 的版本一致性。
  - 确认没有复用历史 `artifacts/`、`build-artifacts/`、`dist/`、`electron-dist/` 或旧 blockmap。
  - 记录本轮允许修改的文件清单；当前工作区的其他修改不得混入候选发布。

- [ ] **Step 2: 先验证现有完整包闭环**
  - 不改变 `disableDifferentialDownload`，先运行现有 updater、metadata、workflow 和 package-smoke 定向测试。
  - 生成草稿资产时确认 installer、`.blockmap`、`latest*.yml` 的版本、路径、size、sha512 和站点逐字节镜像关系。
  - 在获得正式发布授权后，用上一稳定版到下一 patch 版做一次受控完整包升级，检查安装、重启和 provider、session、Skills、Agents、记忆、自定义数据目录及历史任务状态。
  - 这一步只能证明完整包升级链路，不能把“安装成功”当作差分下载证据。

- [ ] **Step 3: 设定停止条件**
  - 若候选版本不干净、版本/tag 不一致、完整包升级失败或站点 metadata 过期，停止在此阶段，先修复基线，不进入差分开关和 canary。

---

#### Task 1: 增加默认关闭的差分下载开关

**Files:**
- Modify: `desktop/electron/services/updater.ts:63-70,211-230`
- Modify: `desktop/electron/main.ts:643-661`
- Modify: `desktop/electron/services/updater.test.ts`
- Modify: `desktop/electron/services/updateFeed.ts`
- Modify: `desktop/electron/services/updateFeed.test.ts`

**Interfaces:**
- Consumes: 现有 `ElectronUpdaterRuntimeOptions`、`resolveUpdateFeedConfig()` 和 `getUpdaterService()`。
- Produces: `ElectronUpdaterRuntimeOptions.differentialDownload?: boolean`，默认版本策略当前为 `false`；`UpdateFeedConfig` 显式产出 `differentialDownloadFeedUrls: string[]` 和 `differentialDownloadContracts: Record<string, { version: string, fingerprint: string }>`，其中 key 必须是完整规范化 download feed URL，`version` 是仓库 contract 版本常量，`fingerprint` 是该 feed 通过离线 contract 后记录的静态 SHA-256 指纹；默认 allowlist 只含 canonical direct GitHub feed，其他 feed 不得隐式加入。差分资格必须同时满足“平台允许、显式请求/版本默认值允许、download feed URL 按完整规范化 URL 精确命中 `differentialDownloadFeedUrls`、该 URL 的 contract version/fingerprint 与内置记录完全相等”；每次 metadata/download feed resolve 或 fallback 后重新计算资格，不能沿用旧 updater 状态。未验证或未知 feed（包括未通过独立 contract 的 `gh-proxy.org`、`ECHOFLOW_UPDATE_FEED_URL` 和 look-alike URL）一律 fail-closed，不能仅因环境变量为 `1` 开启。

- [ ] **Step 1: 写失败测试，固定默认关闭、环境变量优先级和 feed 资格**
  - 无 runtime option 时断言 `disableDifferentialDownload === true`。
  - `differentialDownload: true` 时只有在当前 feed 命中 verified allowlist 且 contract 指纹匹配时断言 `disableDifferentialDownload === false`；否则仍为 `true`。
  - 环境变量采用明确优先级：`ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` 与 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=0` 都强制关闭，前者优先级最高；`ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=1` 只请求启用并继续经过平台、allowlist 和 contract 门禁；未设置使用版本默认值（当前为关闭，canary 通过后独立变更才可改为开启）；其他值（`true`、`yes`、空白等）fail-closed，不得启用或继承 on 的 release default，并记录可诊断告警。
  - 增加 `disable=1`、`disable=1 + enable=1`、`enable=0`、`enable=1`、缺失、`true`、`yes` 和其他非法值的回归断言，固定紧急关闭优先级与 release default 语义。
  - Linux 即使显式请求也不得启用；Windows/macOS 的请求仍需通过 feed 资格门禁。
  - 分别断言 canonical direct GitHub 精确 URL、默认 `gh-proxy.org`、任意 `ECHOFLOW_UPDATE_FEED_URL` 自定义 feed、未知 host 和 look-alike URL 的结果；metadata/download fallback 后每个候选源都必须重新计算资格，未验证源只能保留完整包路径。

- [ ] **Step 2: 运行 updater 相关测试，确认新增断言先失败**

  Run: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateFeed.test.ts`

  Expected: 新增开关断言 FAIL，既有测试失败必须先判断是否为本任务基线问题，不得改写既有行为断言。

- [ ] **Step 3: 实现最小开关与 fail-closed 资格门禁**
  - 在 `ElectronUpdaterRuntimeOptions` 增加 `differentialDownload?: boolean`，并让 `updateFeed.ts` 暴露 `differentialDownloadFeedUrls: string[]` 与 `differentialDownloadContracts: Record<string, { version: string, fingerprint: string }>`；使用完整规范化 URL 精确匹配，并要求 URL 对应的 contract version/fingerprint 与内置记录完全相等，未列入记录的 feed 一律不具备差分资格。
  - 构造器只在 runtime request 或版本默认值允许、平台允许、当前 download feed 精确命中 verified allowlist 且 contract 指纹匹配时设置 `updater.disableDifferentialDownload = false`，否则保持 `true`。
  - 在 `main.ts` 实现明确优先级：`ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` 最高优先级强制关闭；否则 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=0` 强制关闭、为 `1` 只请求开启但仍受全部资格门禁、未设置使用版本默认值；其他值 fail-closed，不得继承 on 的 release default，并记录告警。Linux 始终关闭；差分模式下 `downloadFeedUrls` 仅取 `differentialDownloadFeedUrls`，未验证 proxy 只走完整包路径。
  - 每次 metadata/download feed resolve 或 fallback 后重新计算资格，清理或隔离旧 provider、blockmap 和下载状态，不能沿用上一源的差分资格。
  - 保留现有 `autoDownload = false`、feed fallback 和下载完成后安装语义。

- [ ] **Step 4: 运行测试确认开关通过**

  Run: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateFeed.test.ts`

  Expected: PASS；默认关闭、显式开启、非精确值和 Linux 保护均有证据。

- [ ] **Step 5: 运行 Electron 类型检查**

  Run: `bun run check:electron`

  Expected: PASS；该命令必须由自身返回成功，不以管道末端退出码代替。

---

#### Task 2: 锁定下载失败、fallback 和安装顺序

**Files:**
- Modify: `desktop/electron/services/updater.test.ts`
- Modify: `desktop/electron/services/updateSmoke.test.ts`
- Modify: `desktop/electron/services/updater.ts`（仅在复现状态残留后修改）

**Interfaces:**
- Consumes: `ElectronUpdaterService.checkForUpdates()`、`downloadUpdate()`、`cancelInstall()`、`stageDownloadedUpdate()`、`quitAndInstallDownloadedUpdate()`。
- Produces: 回归测试证明差分失败或下载源失败不会伪造完成状态；metadata fingerprint 不一致不会下载；成功后才可安装。

- [ ] **Step 1: 写失败测试覆盖五条状态不变量**
  - `downloadUpdate()` 第一次失败时不发 `Finished`，`hasDownloadedUpdate()` 为 `false`，安装抛出 `has not finished downloading`。
  - 失败后第二次调用可以重新尝试；成功后只发一次实际下载，重复调用只发 `Finished` 而不重复调用底层下载。
  - 主下载源失败时继续尝试下一个 `downloadFeedUrls`；所有源失败时错误包含每个 feed 的诊断。
  - candidate fingerprint 不一致时跳过该源，不能调用 `updater.downloadUpdate()`。
  - `cancelInstall()` 清除 pending/downloaded 状态，之后必须重新检查更新。

- [ ] **Step 2: 运行定向测试确认缺口**

  Run: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateSmoke.test.ts`

  Expected: 新增的状态断言至少有一条先失败；若当前实现已经满足，则记录为现有行为已覆盖，不为增加测试而改生产代码。

- [ ] **Step 3: 只修复被测试证明的状态问题**
  - 不新增 updater cache 清理接口，除非测试复现了底层状态残留。
  - 保持 `Finished` 事件只在底层下载成功后发出。
  - 保持 `quitAndInstall(false, true)` 只由已完成下载路径调用。

- [ ] **Step 4: 运行定向测试确认通过**

  Run: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateSmoke.test.ts`

  Expected: PASS；失败、重试、重复下载、取消和安装顺序均被覆盖。

---

#### Task 3: 加固 Windows 签名后 blockmap 与 metadata 契约

**Files:**
- Modify: `scripts/refresh-windows-update-metadata.ts:91-151`
- Modify: `scripts/refresh-windows-update-metadata.test.ts`
- Modify: `scripts/pr/release-workflow.test.ts:409-465`
- Modify: `scripts/quality-gate/package-smoke/index.ts`（仅补最终资产配对检查）
- Modify: `scripts/quality-gate/package-smoke/index.test.ts`
- Modify: `.github/workflows/release-desktop.yml`（仅补验证步骤，不改签名顺序）

**Interfaces:**
- Consumes: `rebuildWindowsInstallerBlockmap()`、`refreshWindowsUpdateMetadata({ installerPath, metadataPath })` 和 workflow 的“签名 installer → refresh metadata → package smoke”顺序。
- Produces: `refreshWindowsUpdateMetadata()` 是完整校验边界：写回前必须确认 installer 存在、`${installerPath}.blockmap` 存在且可解析、metadata 恰好一个 `files[]` 项且 `path` 指向该 installer，并确认 sha512/size 配对；签名后输出必须同时存在最终 installer、`<installer>.blockmap` 和指向该 installer 的 `latest.yml`；静态门禁能发现缺失或错误配对。

- [ ] **Step 1: 写失败测试固定最终 blockmap 必须存在且以最终 installer 为输入**
  - 直接调用导出的 `refreshWindowsUpdateMetadata({ installerPath, metadataPath })` 时，在任何 yml 写入前校验 installer 存在、`${installerPath}.blockmap` 存在且可解析，并校验 blockmap 的 `files[]`/`file` 元数据与最终 installer 的 basename、size 和 sha512 配对；同时校验 metadata 恰好一个 `files[]` 项且 `path` 指向最终签名 installer；缺失、不可解析或配对不一致时失败。
  - 直接 API 调用缺少 blockmap、blockmap 不是对象、blockmap 的 `files[]`/`file` 元数据与最终 installer 的 basename/size/sha512 不匹配时必须失败，且 metadata 文件内容保持原样；CLI 仍按“重建 blockmap → refresh metadata”执行，但不能依赖 CLI 顺序提供安全保证。
  - `rebuildWindowsInstallerBlockmap()` 可以保留完成后的自检，但不能作为唯一边界；补充导出 API 直接调用的回归测试。
  - metadata 的 sha512/size 与最终 installer 一致，旧 `sha2` 不残留。
  - workflow 测试固定 refresh 必须发生在签名 installer restore 之后、installer execution/package smoke 之前。

- [ ] **Step 2: 运行相关测试确认缺口**

  Run: `bun test scripts/refresh-windows-update-metadata.test.ts scripts/pr/release-workflow.test.ts scripts/quality-gate/package-smoke/index.test.ts`

  Expected: 新增的缺失 blockmap 断言先失败，或若现有实现已满足则记录覆盖情况。

- [ ] **Step 3: 实现最小验证**
  - `rebuildWindowsInstallerBlockmap()` 完成后显式确认 `${resolvedInstallerPath}.blockmap` 存在且可解析；`refreshWindowsUpdateMetadata()` 在自身边界再次校验 blockmap 的 `files[]`/`file` 元数据与最终 installer 的 basename、size、sha512 配对。
  - package smoke 在 Windows release artifact 中检查 installer、installer blockmap、`latest.yml` 的 basename 配对；不改变 Linux 无 blockmap 的规则。
  - workflow 只增加缺失资产即失败的检查，不重新序列化站点 yml。

- [ ] **Step 4: 运行测试确认通过**

  Run: `bun test scripts/refresh-windows-update-metadata.test.ts scripts/pr/release-workflow.test.ts scripts/quality-gate/package-smoke/index.test.ts`

  Expected: PASS；最终签名资产契约和 Linux 例外均有测试证据。

---

#### Task 4: 强制锁定真实下载边界与 fallback contract

**Files:**
- Modify: `desktop/electron/services/updater.test.ts`
- Modify: `desktop/electron/services/updateFeed.ts`
- Modify: `desktop/electron/services/updateFeed.test.ts`
- Modify: `desktop/electron/services/updateSmoke.test.ts`
- Create: `desktop/electron/services/updateRangeContract.test.ts`（强制离线 Range contract；使用现有测试 harness 或最小 loopback fixture 驱动已安装依赖的真实下载入口）

**Interfaces:**
- Consumes: 已安装的 `electron-updater`/`app-builder-lib`、现有 `ElectronUpdaterService` 测试 harness；不新增依赖。
- Produces: 必须存在的离线 feed 资格、响应校验和 fallback contract，明确区分单 Range 与 multipart/byteranges 响应；`desktop/electron/services/updateRangeContract.test.ts` 必须通过现有测试 harness 或最小 loopback fixture 调用已安装依赖的真实下载入口，不能因为依赖内部入口不可注入而跳过异常场景。Range contract 不得留作可选 canary 证据；若真实依赖没有可离线调用的稳定入口，任务状态必须为 BLOCKED，且默认启用保持禁止。

- [ ] **Step 1: 先从当前依赖确认可测试的下载入口**
  - 检查已安装 `electron-updater` 6.8.3 和 `app-builder-lib` 的实际 differential downloader 入口、可注入 transport、blockmap 格式和 fallback 语义。
  - 确认是否能在现有测试 harness 中调用真实下载实现而不 mock 下载器；记录能够断言的 HTTP 与校验行为。
  - 入口是否稳定不影响门禁：若不能直接注入真实 downloader，则用最小 `127.0.0.1` loopback fixture 驱动公开下载入口；不得把 Range 异常 contract 降级为“可选”或只留给线上 canary。

- [ ] **Step 2: 强制写离线 Range contract，不以入口不稳定为跳过理由**
  - fixture 只监听 `127.0.0.1`，使用临时旧/新文件与真实格式 blockmap，不访问公网；不得自制 downloader 冒充真实依赖。
  - `desktop/electron/services/updateRangeContract.test.ts` 必须调用已安装依赖的真实下载实现或公开入口，驱动仅监听 `127.0.0.1` 的 loopback fixture（如需），覆盖正确单区间 `GET` 的 `206`、`Content-Range`、`Content-Length`、`Accept-Ranges: bytes`，并对每个场景断言真实下载路径的成功、失败或完整包 fallback，而不是只断言自制 downloader 或 service 抛错。
  - 必须覆盖 `200`、`416`、错误 `Content-Range`、重定向、缺少 `Accept-Ranges`、中断和 multipart/byteranges；每项都断言真实下载路径的拒绝、失败或完整包 fallback。
  - 将 direct 单 Range 与 proxy multipart 作为不同服务端行为验证；未能通过真实入口覆盖的场景必须标为 BLOCKED，并阻止默认启用，不能留给 canary 补足，也不能免除本仓库资格门禁、响应校验和 fallback contract。

- [ ] **Step 3: 验证切 feed 的实际状态边界**
  - 对当前 `ElectronUpdaterService` 检查 metadata fingerprint、provider、blockmap 和下载目录的生命周期；测试失败后重试以及换源是否留下旧下载状态。
  - 只有能复现旧 provider/blockmap/下载文件串用时才改生产代码；不能仅凭猜测新增清缓存或多 updater 实例机制。

- [ ] **Step 4: 运行全部离线 contract 测试**

  Run: `bun test desktop/electron/services/updater.test.ts desktop/electron/services/updateFeed.test.ts desktop/electron/services/updateSmoke.test.ts desktop/electron/services/updateRangeContract.test.ts`

  Expected: PASS；以上每个异常场景均有离线断言。若某一项只能在真实源验证，必须标记 BLOCKED/NOT RUN，写明原因和 canary evidence 采集办法，不得以“适用”跳过；Task 5 只能在本 task PASS 后执行。

---

#### Task 5: 完成 canary 发布验收和默认启用决策

**Files:**
- Modify: `docs/_internal/release-windows.md:133-146`
- Modify: `docs/en/_internal/release-windows.md` 对应章节
- Modify: `.github/workflows/release-desktop.yml`（仅补 artifact/metadata 验证或 canary 说明）
- Modify: `scripts/pr/release-workflow.test.ts`（锁定验证顺序）
- Modify: `desktop/electron/main.ts`（用于后续独立默认值变更，切换 release default、紧急关闭和 feed 门禁）
- Modify: `desktop/electron/services/updater.test.ts`（用于同步默认值、`0` 紧急关闭、`1` 显式覆盖、verified feed 和 Linux 保护的测试契约）
- Modify: `desktop/electron/services/updateFeed.ts`（仅在后续独立默认值变更需要调整版本默认值时修改）
- Modify: `desktop/electron/services/updateFeed.test.ts`（仅同步上述独立默认值变更的测试）

**Interfaces:**
- Consumes: Tasks 1–4 的开关、资产契约、离线 contract 和现有 release workflow。
- Produces: 维护者可执行的真实升级验收表，以及把默认值从 off 改为 on 的明确门槛；默认启用不是本任务自动发生的副作用。

- [ ] **Step 1: 更新中英文维护者 runbook**
  - 明确 Release N 保持默认 off，只生成并验证 blockmap；Task 1–4 任一 FAIL/BLOCKED/NOT RUN 都不得进入默认启用。
  - 明确维护者在 Windows/macOS canary 机上设置 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=1`，从上一个稳定版本升级到新版本；未验证 `gh-proxy.org` 或其他自定义 feed 只能按完整包验收，不能作为差分证据。
  - 在实际 `downloadUpdate()` 期间，通过 `autoUpdater.netSession.webRequest` 的 request/response 事件或现有 updater session 的受控记录代理采集真实 `GET`；若当前 Electron/updater 版本不能从现有 session 暴露这些事件，Task 5 必须先在 `main.ts` 增加仅用于 canary evidence 的最小诊断入口，并在 `updater.test.ts` 增加离线断言，不能用独立 curl 或手工推测替代。按 source 分开记录 method、source、release、platform、arch、Range、HTTP status、Content-Range、Content-Length、Accept-Ranges、Content-Type、重定向链和 fallback 结果，并记录 release tag、客户端版本、installer SHA-512、时间戳。
  - 每个启用差分的 platform/arch/source 必须生成不入库、按 run-id 隔离且不可覆盖的 CI/维护者 evidence artifact，例如 `update-canary-evidence/<release>/<platform>-<arch>/<source>/<run-id>/range.jsonl` 和 `summary.json`；`run-id` 必须来自 CI run/build id 或维护者提供的 UTC 时间戳加随机/单调后缀。缺少实际 updater GET、Range、`206`、正确 `Content-Range`、`Content-Length` 或 `Accept-Ranges: bytes` 时判定 BLOCKED/FAIL，不能以 HEAD、下载大小或普通日志替代。
  - 记录成功、完整包 fallback、失败响应证据、断网、中断、重启恢复、签名、版本、配置、会话、Skills、Agents、记忆和自定义数据目录检查；direct GitHub 与 `gh-proxy.org` 证据分开保存，proxy 的完整包记录不得证明差分成功。
  - 明确 Linux AppImage 继续按完整包更新验收，deb/rpm 不作为 updater 主路径。

- [ ] **Step 2: 运行 docs 相关检查**

  Run: `bun run check:docs`

  Expected: PASS；中英文 runbook、workflow 和版本规则一致。

- [ ] **Step 3: 做真实 canary，不在本地伪造成功**
  - 选连续两个正式 release 资产，安装旧版后从旧版触发更新。
  - Windows x64、Windows ARM64（若有真实设备）、macOS x64/ARM64 分别记录完整包大小、实际下载量、耗时和是否发生 fallback；direct GitHub 与 `gh-proxy.org` 分开记录，不能用一个源的结果代表另一个源。
  - 对每个启用差分的 platform/arch/source，在实际 `downloadUpdate()` 期间通过 `autoUpdater.netSession.webRequest` 的 request/response 事件或 Task 5 新增的最小诊断入口保存不可变 JSONL/结构化记录：实际 GET URL、method、release、platform、arch、Range、HTTP status、Content-Range、Content-Length、Accept-Ranges、Content-Type、重定向链、fallback 结果、release tag、客户端版本、installer SHA-512 和时间戳。若无法从真实 updater 请求捕获这些字段，则结果为 BLOCKED；direct 源必须证明单 Range `206`；未通过 verified feed 门禁的 proxy 只能记录完整包请求，不能作为差分成功来源。
  - 每个 release × platform × source 必须保存独立、不可覆盖的 evidence artifact，例如 `update-canary-evidence/<release>/<platform>-<arch>/<source>/<run-id>/range.jsonl` 和 `summary.json`；`run-id` 必须由 CI run/build id 或维护者提供的 UTC 时间戳加随机/单调后缀组成，重跑不得复用旧目录，作为 CI/maintainer artifact，不入库。差分成功样本必须包含 `206`、正确 `Content-Range`、`Content-Length`、`Accept-Ranges: bytes`，差分失败后 fallback 样本必须同时保存失败响应（如 `200`、`416`、错误区间或中断）与完整包请求/结果。禁止仅用 HEAD、独立 curl、下载大小或“downloaded”日志替代实际 updater 请求；无法捕获真实请求和响应头时判定 BLOCKED，不能宣称通过或据此开启默认值。
  - 断网或损坏 Range 响应时确认最终仍可用完整包，且未出现“Finished 但安装失败”；下载源切换后确认没有沿用旧 blockmap 或临时下载文件。
  - 真实线上验证属于 maintainer evidence，不替代离线门禁。

- [ ] **Step 4: 只有 canary 通过后再另开独立变更改默认值**
  - 本计划不直接把默认策略改为开启；后续独立变更必须让 `ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD=1` 最高优先级强制关闭；否则 `ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD=0` 强制关闭、`=1` 只请求启用且仍受平台 + verified-feed 门禁，未设置使用版本默认值（当前 off，决策版 Windows/macOS on、Linux off），其他值 fail-closed 并记录告警。
  - 后续独立变更同步更新 `main.ts`、`updater.test.ts`、必要时 `updateFeed.ts`/测试和 runbook，不引入第三方 delta-builder。
  - 若 canary 未达到收益或 fallback 不可靠，保持默认 off；不以社区“90%/几十 MB”数字作为启用依据。

- [ ] **Step 5: 运行最终最小验证集**

  Run: `bun run check:impact`

  Expected: 读完 `## Cross-surface impact` 后执行所有被选中的检查，至少包括 `bun run check:native`、`bun run check:docs` 和 `bun run check:policy`；若检查依赖原生平台或签名机而无法执行，报告为 BLOCKED 并记录补跑命令，不称为 PASS。

---

### Execution Order and Stop Conditions

1. Task 1 必须先落地 fail-closed 的 verified-feed 资格门禁，未验证源保持差分关闭；Task 1 PASS 后才能进入下一阶段。
2. Task 2 在 Task 1 PASS 后锁定失败、重试、fallback、缓存状态和安装顺序；Task 2 PASS 后才能进入下一阶段。
3. Task 3 在 Task 2 PASS 后确保最终签名资产、blockmap 和 metadata 配对；Task 3 PASS 后才能进入下一阶段。
4. Task 4 在 Task 1–3 全部 PASS 后强制完成离线 Range/响应校验/fallback contract，不得因依赖入口不稳定而跳过；Task 4 PASS 后才能进入 Task 5。
5. Task 5 先更新 runbook 和 evidence bundle 规则，再做维护者 canary；任何 FAIL/BLOCKED/NOT RUN 都停止，不进入默认开启。
6. 默认值变更必须另开独立变更，重跑环境变量、平台和 verified-feed 开关测试；本计划不自动把默认值改为开启。
7. 任一阶段发现 feed fallback 会复用错误的 updater cache、签名后 blockmap 与 installer 不匹配、或中断安装无法恢复，先修复并重新跑该阶段，不扩大到第三方 delta 或框架迁移。

### Explicit Non-Goals

- 不迁移到 Electrobun、Tauri 或其他桌面框架。
- 不引入 `@jake-gao/delta-builder` 或自定义 HDiffPatch 更新格式。
- 不把 Linux AppImage blockmap 变成 release 必需品。
- 不修改站点 manifest 的资产命名规则或 yml 逐字节镜像规则。
- 不把“下载体积减少”写成产品承诺；必须以真实连续版本的 GET Range 和下载记录为依据。

---

<a id="plans-2026-11-02-release-please-migration"></a>

## Release-Please Migration Implementation Plan

来源：`plans/2026-11-02-release-please-migration.md`。

**Goal:** Replace the local release-tagging script with a reviewed Release PR flow while preserving hand-authored notes and the existing desktop publisher.

**Architecture:** Release Please manifest mode maintains exactly one package, `desktop/`, so there is one product version and one `vX.Y.Z` tag. Its documented JSON extra-file updaters synchronize `mobile/package.json` and `mobile/app.json`; mobile is not a second Release Please package. Configure `draft: true` and keep GitHub Release creation enabled: the action creates a draft and exposes the tag, then explicitly dispatches the existing desktop workflow with `GITHUB_TOKEN`. The desktop workflow replaces the draft body with the hand-authored notes and remains the sole publisher of complete assets and website update metadata. Do not use `skip-github-release` as a tag-only mechanism.

**Tech Stack:** GitHub Actions YAML, `googleapis/release-please-action` manifest mode, Bun tests, existing `gh` CLI release workflow.

**Spec:** `docs/_internal/archive/planning/release-and-updates.md#specs-2026-11-02-release-please-design` (local-only and gitignored by repository policy).

### Global Constraints

- Keep `desktop/package.json` as the product version source; keep root `package.json` at `999.0.0-local`.
- Keep `mobile/package.json` and `mobile/app.json` equal to the desktop version.
- Keep hand-authored `release-notes/vX.Y.Z.md` as the public release body; disable generated changelog edits.
- First Release PR must resolve the missing tag and publish prepared version `0.7.3`; normal future 0.x feature/fix bumps remain patch increments.
- Preserve existing desktop build, signing, validation, release upload, website sync, and manual draft behavior.
- Do not push, create tags, dispatch workflows, or publish releases during implementation.
- Preserve pre-existing unrelated worktree changes, including the current edits in both contributing guides.

### Review Focus

- First Release PR computes a version other than `0.7.3` from the `v0.7.2` manifest baseline — prove the pinned Release Please dry-run/config output proposes exactly `0.7.3` without an unsafe persistent `release-as` override.
- Android package version or `app.json` version fails to follow the desktop bump — test all three version values after the configured JSON updaters run.
- A commit marked `BREAKING CHANGE` unexpectedly raises minor/major during 0.x — test the pinned releaser and require a patch bump while calling out the breaking behavior in the human-authored note.
- Release Please creates a public/incomplete GitHub Release before desktop artifacts finish — test and configure draft/skip behavior so only the existing publisher makes the release public after full asset validation.
- `GITHUB_TOKEN` tag creation fails to start packaging — assert the workflow explicitly dispatches `release-desktop.yml` with the release tag and does not rely on `push: tags`.
- A manually dispatched draft run starts publishing or overwrites a published release — retain and test the existing draft guard and separate automated official dispatch semantics.

---

### File Map

- Create `.github/workflows/release-please.yml`: Release Please manifest workflow, least-privilege permissions, Release PR creation, and tag-based desktop workflow dispatch.
- Create `release-please-config.json`: Node releaser configuration for one desktop package, patch-only versioning, disabled changelog-file edits, draft release creation, and structured Android extra-file updates.
- Create `.release-please-manifest.json`: last published baseline for the desktop package (`0.7.2` at the observed rollout baseline).
- Modify `.github/workflows/release-desktop.yml`: accept release-please dispatch by release tag, validate the checked-out package version, and preserve the separate manual draft path.
- Modify `scripts/pr/release-surface-audit.ts` and `.test.ts`: allow validation against the Release PR target version while preserving current checks for existing callers.
- Modify `scripts/pr/release-workflow.test.ts`: cover action workflow contract and desktop tag-dispatch/publish safety.
- Remove `scripts/release.ts` and `scripts/release.test.ts`; no longer needed after Release Please owns version PRs and tags.
- Modify `AGENTS.md`, `docs/AGENTS.md`, `docs/_internal/release-windows.md`, `docs/en/_internal/release-windows.md`, and Chinese/English contributing guides: make the maintainer runbook canonical and remove stale local-script instructions. Preserve the existing unrelated edits in both contributing guides.
- Do not change `scripts/release-mobile.ts` or `desktop/src-tauri/tauri.release-ci.json`; their deletion is outside this migration and their lack of repository-local references is insufficient evidence for removal.

### Task 1: Verify Release Please Configuration and First 0.7.3 Proposal

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Test: `scripts/release-please-config.test.ts`

**Interfaces:**
- Consumes: current versions in `desktop/package.json`, `mobile/package.json`, and `mobile/app.json`; last published tag `v0.7.2`.
- Produces: exactly one manifest package `desktop` with `release-type: node`; `mobile/package.json` and `mobile/app.json` updated through documented JSON `extra-files` owned by that package; `skip-changelog: true`; `bump-patch-for-minor-pre-major: true`; explicit, tested policy for breaking changes below 1.0.

- [ ] **Step 1: Add a failing config-contract test**

Assert the manifest baseline is `0.7.2`; exactly one package (`desktop`) uses the node release type; changelog generation is disabled; that package's extra-file fields point at `mobile/package.json` `$.version` and `mobile/app.json` `$.version`; a `feat:` commit and a `BREAKING CHANGE` commit each resolve to the next patch in 0.x; and the patch-only bump policy is configured.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `bun test scripts/release-please-config.test.ts`
Expected: FAIL because the config and manifest do not yet exist.

- [ ] **Step 3: Validate the exact config against the pinned action/releaser**

Use the official action/release-please schema and implementation at the chosen pinned version. Prove, with a local fixture/dry-run that does not contact GitHub, that the three version files converge to `0.7.3` from the `0.7.2` baseline using commits reachable after `v0.7.2`. Do not add a persistent `release-as` override unless the dry-run proves conventional-commit configuration cannot yield `0.7.3`; if a one-time override is required, make its removal part of the same first Release PR and test that the next run returns to ordinary patch calculation.

- [ ] **Step 4: Implement only the config proven by the dry-run**

Use `release-please-config.json` and `.release-please-manifest.json`; configure the exact JSON updater format supported at the pinned version. Keep generated changelog disabled. Preserve `desktop/package.json` as the canonical manifest package.

- [ ] **Step 5: Run the focused test and dry-run again**

Run: `bun test scripts/release-please-config.test.ts`
Expected: PASS; all three version fields resolve to `0.7.3`, and no autogenerated changelog file is produced or replaces `release-notes/v0.7.3.md`.

### Task 2: Make the Desktop Publisher Tag-Dispatchable

**Files:**
- Modify: `.github/workflows/release-desktop.yml`
- Modify: `scripts/pr/release-workflow.test.ts`

**Interfaces:**
- Consumes: release-please action's verified output tag and existing `workflow_dispatch` input contract.
- Produces: official release dispatch checks out and packages the requested release tag; ordinary maintainer draft dispatch behavior remains unchanged.

- [ ] **Step 1: Write failing workflow contract tests**

Cover: a tag push continues to work; official dispatch requires an explicit valid `vX.Y.Z` tag and builds from that tag; package version must match tag; the official dispatch publishes only after build/verification and syncs the site; ordinary `draft=true` remains draft; no dispatch path can overwrite a published release as a draft.

- [ ] **Step 2: Run focused tests and confirm the new cases fail**

Run: `bun test scripts/pr/release-workflow.test.ts`
Expected: FAIL on missing official tag-dispatch contract.

- [ ] **Step 3: Implement the smallest workflow input and validation changes**

Retain the current tag trigger. Add a distinct input for the release tag when `workflow_dispatch` is invoked by Release Please. Checkout that tag, derive version from the checked-out `desktop/package.json`, and require exact equality with the requested tag. Make automated release dispatch explicitly select the current official publish path (`draft=false`) while leaving maintainer draft behavior intact. Continue loading the public release body from `release-notes/vX.Y.Z.md` and let the existing publisher undraft only after all assets validate.

- [ ] **Step 4: Run focused workflow tests**

Run: `bun test scripts/pr/release-workflow.test.ts`
Expected: PASS, including all existing release workflow contracts.

### Task 3: Add Release Please Workflow and Safe Trigger Bridge

**Files:**
- Create: `.github/workflows/release-please.yml`
- Modify: `scripts/pr/release-workflow.test.ts`

**Interfaces:**
- Consumes: Task 1 manifest/config and Task 2 tag-dispatch contract.
- Produces: on pushes to `main`, maintain/update the Release PR; on merge creating the desktop release, explicitly dispatch `release-desktop.yml` by tag using `GITHUB_TOKEN`.

- [ ] **Step 1: Write failing Release Please workflow tests**

Assert trigger is restricted to `main` plus controlled manual recovery; action is pinned to a reviewed immutable version; permissions are exactly `contents: write`, `pull-requests: write`, and `actions: write` for manual workflow dispatch; manifest/config file paths are explicit; no PAT/App secret is used; desktop release is dispatched only for a newly released desktop package; dispatch carries the exact release tag and requests official publishing.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `bun test scripts/pr/release-workflow.test.ts`
Expected: FAIL because the workflow does not exist.

- [ ] **Step 3: Implement Release Please manifest workflow**

Use the verified release-created/tag output from the pinned action. Configure `draft: true` so Release Please creates a draft GitHub Release and exposes the tag; do not set `skip-github-release`. The existing desktop publisher must attach assets and hand-authored notes to the same draft and publish it only after validation. Never allow a public empty release before desktop assets are ready.

- [ ] **Step 4: Run focused tests**

Run: `bun test scripts/pr/release-workflow.test.ts`
Expected: PASS; no trigger relies on the tag push emitted with `GITHUB_TOKEN`.

### Task 4: Validate Release Surface Against the Target Release Version

**Files:**
- Modify: `scripts/pr/release-surface-audit.ts`
- Modify: `scripts/pr/release-surface-audit.test.ts`
- Modify: `.github/workflows/release-please.yml`
- Modify: `scripts/pr/release-workflow.test.ts`

**Interfaces:**
- Consumes: release target tag/version from the Release Please event; current no-argument `bun run check:release-surface` call remains compatible.
- Produces: a manually dispatched audit runs against the Release PR head ref and validates the target note path/title and public identity before merge without trusting an unvalidated version string; the canonical runbook requires this green result.

- [ ] **Step 1: Add failing audit tests**

Cover a valid target version differing from the base package version, a missing note, wrong title, malformed version input, and unchanged default behavior when no target is supplied. The workflow contract test must also prove the manual audit accepts the Release PR head ref and target version and checks out that ref.

- [ ] **Step 2: Run the focused audit tests and confirm new cases fail**

Run: `bun test scripts/pr/release-surface-audit.test.ts`
Expected: FAIL on the target-version and malformed-input cases.

- [ ] **Step 3: Add a validated optional target-version input**

Keep the existing no-argument invocation reading `desktop/package.json`. Add one explicit CLI/env value for Release PR CI, validate it against `^\d+\.\d+\.\d+$` before constructing paths, then run the same note/brand/conflict audit.

- [ ] **Step 4: Run audit tests and the existing gate**

Run: `bun test scripts/pr/release-surface-audit.test.ts`
Expected: PASS.

Run: `bun run check:release-surface`
Expected: PASS against the current checkout.

Add a manual audit mode to `.github/workflows/release-please.yml` that accepts a Release PR head ref and target version, checks out the ref, runs `bun run check:release-surface --version <target>`, and does not run Release Please or dispatch the publisher. Update both canonical runbooks to require this audit to pass after the hand-authored note is added and before the Release PR is merged. Test that the Release Please update workflow does not rely on `pull_request` events emitted by `GITHUB_TOKEN`.

### Task 5: Remove the Local Release Script and Update Contributor Guidance

**Files:**
- Remove: `scripts/release.ts`
- Remove: `scripts/release.test.ts`
- Modify: `AGENTS.md`
- Modify: `docs/AGENTS.md`
- Modify: `docs/_internal/release-windows.md`
- Modify: `docs/en/_internal/release-windows.md`
- Modify: `docs/internals/contributing.md`
- Modify: `docs/en/internals/contributing.md`

**Interfaces:**
- Consumes: verified Release Please workflow and tag-dispatch behavior from Tasks 1–4.
- Produces: one canonical maintainer runbook; agent/contributor docs point to it and retain only key invariants and checks.

- [ ] **Step 1: Update the Chinese and English runbooks**

Replace local script steps with: prepare/version the hand-authored release note in the Release PR; manually dispatch the release-surface audit against the PR head ref and target version and wait for green; verify the three package version fields; review required CI; merge to create the release tag; and verify the existing desktop publisher/site sync. Document the first 0.7.3 migration behavior and manual recovery paths without claiming this implementation has been externally enabled.

- [ ] **Step 2: Update instruction and contributing references**

Remove stale `scripts/release.ts` workflow references. Point to the runbook and keep the desktop version source, note/tag equality, quality-gate policy, and no-manual-tag-move safety rules. Preserve the current unrelated added bullets in both contributing guides verbatim.

- [ ] **Step 3: Delete the obsolete local release script and its tests**

Remove `scripts/release.ts` and `scripts/release.test.ts` only after the new workflow/config tests pass. Keep `scripts/release-mobile.ts` and all Tauri files.

- [ ] **Step 4: Run documentation and script checks**

Run: `bun test scripts/release.test.ts scripts/pr/release-workflow.test.ts scripts/pr/release-surface-audit.test.ts scripts/release-please-config.test.ts`
Expected: PASS (omit the removed release test file after deletion and retain all new replacement coverage).

Run: `bun run check:docs`
Expected: PASS; English and Chinese runbooks are aligned and local links validate.

### Task 6: End-to-End Local Verification and Handoff

**Files:** all Task 1–5 files only.

- [ ] **Step 1: Run the narrow checks**

Run: `bun test scripts/pr/release-workflow.test.ts scripts/pr/release-surface-audit.test.ts scripts/release-please-config.test.ts`
Expected: PASS.

Run: `bun run check:release-surface`
Expected: PASS.

Run: `bun run check:docs`
Expected: PASS.

Run: `bun run check:impact`
Expected: reports docs, release, and any import-aware affected areas; run the selected narrow lanes it names.

- [ ] **Step 2: Review the final diff and external-action boundary**

Confirm only intended release files changed, no user changes were staged or overwritten, no release tag was created, no workflow was dispatched, and no GitHub Release was published.

- [ ] **Step 3: Report evidence and gaps**

List changed files, focused tests/checks and exact results, any lane not run with its reason, the first-release behavior for `0.7.3`, and the fact that workflow behavior in GitHub Actions remains unverified until the workflow is merged and run.

---

<a id="specs-2026-10-26-update-channel-design"></a>

## 更新/下载通道独立化（自有域名 + 加速）设计

来源：`specs/2026-10-26-update-channel-design.md`。

日期：2026-10-26
状态：已与维护者对齐，本次发版落地

### 意图

国内用户下载桌面安装包和获取更新慢（GitHub 直连慢、第三方加速前缀不可控）。
目标：下载与更新检查落在自有域名 `code.echoflow.cn`，字节传输用「加速前缀优先、GitHub 直连回退」的多源顺序兜住，零新增成本。本次发版全部落地；后续转私有仓库时，本设计的失败引导机制负责接住存量用户。

### 目标

1. 独立下载页 `/download`：按平台/架构直接下载安装包（不跳 GitHub 二次点选），加速优先、直连回退；首页按钮改为跳该页（一次跳转，落在自己域名）。
2. 应用「检查更新」请求 `code.echoflow.cn/update/` 上的更新元数据，失败兜底 GitHub。
3. 更新检查/下载全部失败时，UI 明确引导「请至 code.echoflow.cn/download 手动下载新版」（可点按钮）。
4. GitHub Releases 发布链路完全不动（老用户兼容的硬前提）。

### 非目标

- 不迁走安装包字节的存储源（GitHub Releases 仍是产物源，免费）。
- 不做仓库闭源/双仓库迁移（另行处理；本设计是它的前置船票）。
- 不依赖 EdgeOne 控制台配置（缓存 TTL 等仅作优化，代码侧必须自洽）。
- 不做差分更新改动、不做下载管理器。

### 约束

- 纯免费：不新增对象存储/CDN 支出（调研结论：EdgeOne Blob 单对象 25MB 上限、Gitee 附件 100MB 上限、npmmirror 仅固定名单，均不可用；COS/R2 均非零成本或国内不稳，放弃）。
- 老用户零影响：旧二进制的 feed 配置编译在内（`desktop/electron/services/updateFeed.ts` 默认值），只认 GitHub Releases；只要 GitHub 发布不减配（同名产物、完整资产集、electron-builder 生成的 yml 不改写），旧版本行为一字不变。
- 站点契约：`code.echoflow.cn` 根路径部署（`site/scripts/prepare-static-output.mjs` 的 CNAME 断言）；新文件放根与 `/update/` 子路径。
- 仓库规范：生产改动同 PR 带同区域测试；`scripts/pr/*`、`release-desktop.yml`、`deploy-docs.yml` 变更须更新对应契约测试；AGENTS.md 24KB 内。

### 既有机制（复用，不重造）

- `desktop/electron/services/updateFeed.ts`：feed 解析与 env 覆盖（`ECHOFLOW_UPDATE_FEED_URL`、`ECHOFLOW_UPDATE_GITHUB_PROXY_BASE`）。
- `desktop/electron/services/updater.ts`：单元数据源检查 + 多下载源顺序回退 + `updateMetadataFingerprint` 防串包。
- `release-desktop.yml` `publish-release`：`scripts/release-update-metadata.ts` 已合并出四个标准元数据文件（`latest.yml`、`latest-mac.yml`、`latest-linux.yml`、`latest-linux-arm64.yml`——注意 Linux arm64 独立一份）。
- 站点：`deploy-docs.yml` → GitHub Pages；`HomePage.tsx` 已有平台切换 state；`SiteHeader.jsx` 的下载常量（导出名以源码为准）。

### 决策（维护者已定 / 标注默认由我定）

1. 【已定】下载与更新检查挂自有域名；字节传输走加速前缀 → GitHub 直连顺序回退；纯免费、不靠 CDN 配置。
2. 【已定】「获取不到更新 → 引导去新网址手动下载一次」机制必做（未来转私有的接驳桥）。
3. 【已定，2026-10-26 追加】单开 `/download` 独立页面（不进 docs 路由、不进侧边栏）；首页按钮改为跳该页，不再在首页直接触发下载。
4. 【默认】架构按钮：主按钮给主流默认架构（macOS→arm64、Windows→x64、Linux→x86_64；Windows UA 明确 ARM 时主推 arm64），「其他架构」保留 GitHub Releases 链接；不做双架构按钮（浏览器 UA 无法可靠区分 Apple Silicon/Intel）。
5. 【默认】Linux 主推 AppImage，deb/rpm 小字旁链。
6. 【默认】加速前缀复用 updater 现有 gh-proxy 常量，单一来源；换镜像只改一处。
7. 【默认】路径分工：`/download` 给人，`/update` 给机器，manifest 落 `/download/manifest.json`（下载页私有数据，不占根路径）。

### 架构

#### 站点侧

- 新脚本 `scripts/site-release-manifest.ts`（bun，风格对齐 `scripts/release-update-metadata.ts`）：`--release <tag|latest> --out <dir>`，从 GitHub Release 资产表生成 `downloads.json`（platform+arch → 精确资产文件名 + 版本号），并把四个 `latest*.yml` 逐字节拷进 `<out>/update/`。禁止从 `artifactName` 模板推导文件名——以 release 资产清单为准（Linux 各格式 arch 记号不同）。
- 新模块 `site/src/lib/releaseDownload.js`：fetch `/downloads.json` → 平台/架构选择 → 候选 URL（加速前缀、GitHub 直链）→ Range 探测 → 命中后 `window.location.assign` 流式下载；manifest 失败回退 GitHub `releases/latest` 页。探测期间禁用按钮防连点。
- 接线：`SiteHeader.jsx` 头部下载按钮（href 保留原常量作无 JS 回退）、`HomePage.tsx` 页脚下载区（用所选平台）与弹窗 CTA；hint 文案改「其他架构/直链见 GitHub Releases」。
- `deploy-docs.yml`：`on:` 增 `release: types: [published]`（或经 release 工作流 `workflow_call` 传 `release_tag`）；build 步骤在站点 build 后、upload 前跑 manifest 生成。普通 docs 部署用 `--release latest`，保证 `/update/` 在重新部署后仍在。
- URL 落点：`https://code.echoflow.cn/downloads.json`（根）、`https://code.echoflow.cn/update/{latest.yml,latest-mac.yml,latest-linux.yml,latest-linux-arm64.yml}`。

#### 应用侧

- `updateFeed.ts` 新默认：`metadataUrl = https://code.echoflow.cn/update/`，`metadataFallbackUrls = [DIRECT_GITHUB_RELEASE_FEED_URL]`（必备）；`downloadFeedUrls` 保持 `[加速前缀, GitHub 直连]`。`ECHOFLOW_UPDATE_FEED_URL` 覆盖语义不变（显式单源、无回退）。
- `updater.ts`：`checkForUpdates` 主源失败或无更新时依次试元数据兜底源；不做双元数据源版本对照（CDN 缓存陈旧按降级模式接受，见「余下风险」）。下载顺序回退逻辑不动。
- 失败引导：更新检查/下载全源失败的错误展示面附「请至 https://code.echoflow.cn/#download 手动下载新版」文案 + 可点按钮（走既有 external-open 机制）。

#### 发版 CI 侧

- `release-desktop.yml`：`publish-release` 输出 version；新增 `site-release-sync` job（`needs: publish-release`，仅非 draft 时跑），带 `release_tag` 触发站点部署。GitHub Release 完整发布保持第一步、永不减配。
- 失败语义：站点同步失败必须让工作流红，不能静默（否则新用户在官网元数据缺失下裸奔——虽有 GitHub 兜底，但属于管线破损必须可见）。

### 兼容性结论（已对抗核实）

- 老用户：零影响、无过渡窗口。旧二进制只读 GitHub 元数据，新 yml 仍由 CI 逐字节镜像生成，语义不变。
- 新用户：官网主源 + GitHub 元数据兜底 + 下载多源顺序回退。
- 硬前提（长期有效）：GitHub Releases 继续收到完整 electron-builder 资产集（同 `artifactName` 模式、同签名身份、yml 不手改）。
- `ECHOFLOW_UPDATE_*` env 用户：语义不动。

### 余下风险

- gh-proxy.org 是公益第三方，可用性不受控；回退保证不劣于现状，换镜像改一处常量。
- EdgeOne 若长缓存 `/update/*.yml`，用户会漏过一次更新（下次同步自愈）——**接受为降级模式，不做双源对照**（对抗审查判定：复杂度换不来收益，兜底链已覆盖断源）。控制台设短缓存是纯优化项。
- 仓库内无 EdgeOne 部署痕迹，`code.echoflow.cn` 实为 GitHub Pages + 外部 CDN/反代（推断）；`/update/` 与 `/download/manifest.json` 的 CDN 行为需控制台确认（不阻塞）。

### 交给实施者的余项

- `SiteHeader.jsx` 下载常量真实导出名：`GITHUB_URL` / `DOWNLOAD_URL`（已核实）。
- desktop 更新错误展示面：`desktop/src/pages/settings/AboutSettings.tsx` 的 `UPDATE_ERROR_KEYS` 渲染区（line 19-26、154）。
- 生成器落点：`scripts/site-release-manifest.ts`（bun，测试挂 `check:policy` 清单）。
- `/download` 路由骨架：`prepare-static-output.mjs` 的 `createRouteEntry` + `writeSitemap`（该脚本只为文档与 legacy 路由生成骨架，需显式加两条）。

---

<a id="specs-2026-11-02-release-please-design"></a>

## Release-Please Migration Design

来源：`specs/2026-11-02-release-please-design.md`。

### Intent

Make product releases visible and reviewable before publication, while keeping a single release-version source and the repository's hand-authored release notes. A release should not depend on a maintainer remembering to run a local script that mutates several files and creates a tag as separate manual steps.

### Current State

- `desktop/package.json` is the authoritative product version.
- `mobile/package.json` and `mobile/app.json` must match it for Android builds.
- `scripts/release.ts` currently changes all three versions, commits the release note, and creates an annotated tag.
- Desktop publication is already implemented in `.github/workflows/release-desktop.yml`: it validates the tag/version, builds and verifies platform packages, publishes the GitHub Release, then syncs update metadata and the download manifest.
- `scripts/pr/release-surface-audit.ts` validates the release-note path/title and public release identity.
- GitHub suppresses most follow-up workflows caused by `GITHUB_TOKEN`, but allows `workflow_dispatch` and `repository_dispatch`.
- The workspace may contain unrelated user changes; this migration must not rewrite or stage them.

### Goals

- A Release PR is automatically opened/updated on `main` and reviewed before release.
- `desktop/package.json` remains the version source. Release Please updates `mobile/package.json` and `mobile/app.json` in the same release PR.
- `release-notes/vX.Y.Z.md` remains human-authored and is validated before merging.
- Merging an approved Release PR produces the version tag and starts the existing desktop release workflow without a PAT or GitHub App credential.
- Preserve existing build, signing, verification, GitHub Release publication, and website/update-channel sync behavior.
- Consolidate repeated contributor instructions around one canonical release runbook.

### Rollout Boundary

- This local implementation changes configuration and CI only; it must not push commits, create tags, dispatch workflows, or publish a release.
- Once the migration is reviewed, enabled, and merged, its first Release PR is intended to reconcile and publish the already-prepared 0.7.3 release. This preserves `release-notes/v0.7.3.md` and avoids jumping to 0.8.0 from the missing tag.

### Non-goals

- Do not change product release cadence.
- Do not make root `package.json` track the product version; it remains `999.0.0-local`.
- Do not remove the legacy Tauri configuration or unrelated release metadata generators.
- Do not change mobile APK publication policy beyond keeping its version files synchronized by the shared release PR.

### Design

#### Release Please configuration

Use Release Please manifest mode with exactly one manifest package, `desktop/`, using `release-type: node` and the existing `desktop/package.json` version as the canonical release version. Keep a single product tag and use documented structured JSON `extra-files` on that package to update `mobile/package.json` `$.version` and `mobile/app.json` `$.version` to the same release version. Do not configure `mobile/` as a second Release Please package. Disable generated changelog output because the project continues to author its release notes itself. Apply the documented pre-1.0 bump settings so every release remains a patch increment, including commits marked as breaking changes, as required by the repository's release policy. The hand-authored release note must clearly call out breaking changes; add a config-contract test proving the pinned releaser's behavior rather than relying on defaults.

The initial manifest baseline must match the last published product tag available when this workflow is enabled. At design time, remote `v0.7.2` was the last observed tag while local files and current HEAD were already at 0.7.3. Therefore the initial rollout must not assume the release PR will naturally be 0.7.3: the implementation must explicitly reconcile the missing `v0.7.3` tag and the current package version without publishing an unintended version. The chosen rollout is to make the first Release PR target 0.7.3, preserve the existing `release-notes/v0.7.3.md`, and only then resume ordinary patch bumps. This requires verifying Release Please's supported explicit-version mechanism and removing any one-time override immediately after the first release PR is generated/merged.

#### Release workflow orchestration

Add a dedicated release-please workflow on pushes to `main` and a manual dispatch for controlled recovery. Use the official `googleapis/release-please-action` pinned to a reviewed immutable version and grant only the permissions it needs to maintain the Release PR (`contents: write`, `pull-requests: write`) and explicitly dispatch the publisher workflow (`actions: write`).

When Release Please reports that a release was created for `desktop`, use `gh workflow run release-desktop.yml --ref <release-tag> -f draft=false` with `GITHUB_TOKEN`. The desktop workflow's `workflow_dispatch` path must accept and validate an explicit tag/version, check out that tag, and run the same release-contract/build/publish/sync jobs as the tag-push path. This avoids relying on the suppressed tag-push event and avoids an App/PAT credential.

The desktop workflow must keep its existing tag-push trigger for recovery/manual tag releases. Both entry paths must derive the same release tag and package version, reject mismatches, and publish only once. `workflow_dispatch` currently treats runs as draft/manual artifacts; release-please dispatch must be distinguishable from an ordinary manual draft run so it can publish the official release and site sync. Keep existing maintainer draft behavior intact.

#### Hand-authored release notes

Keep `release-notes/vX.Y.Z.md` as the source of the public GitHub Release body. The Release PR must include the note before it can merge. `check:release-surface` must validate the target release version and note in the Release PR before merge. Since Release Please uses `GITHUB_TOKEN` to create/update its PR, ordinary `pull_request` workflows are not reliably triggered; expose a manual `workflow_dispatch` audit for the Release PR head ref and target version, and require a green audit before merging. The packaging workflow continues to load the note from the checked-out release tag.

#### Documentation and cleanup

Make `docs/_internal/release-windows.md` the canonical operational runbook, with the English counterpart kept in sync. Reduce repeated release steps in `AGENTS.md`, `docs/AGENTS.md`, and the Chinese/English contributing guides to concise references to that runbook and the pre-merge release-note gate.

Do not delete `scripts/release-mobile.ts` or `desktop/src-tauri/tauri.release-ci.json` solely because repository-local references are absent. Their deletion is not required for Release Please migration and may remove manually used or future recovery paths; retain them unless a separate, proven cleanup establishes they are obsolete.

### Verification

- Unit tests for release surface auditing with a target version differing from the base package version.
- Workflow contract tests for Release PR creation, tag-derived workflow dispatch, tag/version equality, published-release behavior, and preservation of manual draft behavior.
- Configuration validation against the pinned Release Please action's current schema and a local dry-run or equivalent fixture proving all three version files update to one version and no generated changelog replaces hand-written notes.
- Run `bun run check:release-surface`, `bun run check:docs`, relevant release/workflow tests, and `bun run check:impact`.
- Do not push, create tags, dispatch workflows, or publish releases during implementation. External rollout requires a separate explicit user authorization.

### Implementation Calls

- Keep the release publisher and packaging logic in `release-desktop.yml`; Release Please only manages the release PR, version changes, and tag.
- Use `workflow_dispatch` with the repository token to bridge the tag event suppression; do not add an App/PAT secret.
- Keep manual draft packaging as a supported path and add a separate explicit input identifying the automated official release dispatch.
- Keep unrelated/uncertain artifacts and scripts until their lack of use is established independently.
