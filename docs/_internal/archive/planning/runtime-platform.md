---
title: 运行时与执行平台（历史归档）
nav_title: 运行时与执行平台
description: 合并保存 2026 年的相关设计、计划与任务记录，不作为现行执行指令。
order: 1
---

# 运行时与执行平台（历史归档）

本页于 2026-11-14 按主题合并旧 Superpowers 资料，保留原设计、计划、任务摘要和进度；仅调整标题层级、旧路径、插件要求与本地绝对路径。原文中的版本、审批、完成状态和测试结果均为当时记录，不代表当前实现、当前授权或本次验证。不得按归档中的命令直接继续旧任务。

现行要求以仓库 AGENTS.md、[执行与信任边界](../../../internals/execution-boundaries.md) 和 [贡献流程](../../../internals/contributing.md) 为准；[返回归档索引](README.md)。

## 来源目录

- [sdd/2026-10-echoflow-runtime-management/progress.md](#sdd-2026-10-echoflow-runtime-management-progress)
- [sdd/2026-10-echoflow-runtime-management/task-1-brief.md](#sdd-2026-10-echoflow-runtime-management-task-1-brief)
- [sdd/2026-10-echoflow-runtime-management/task-2-brief.md](#sdd-2026-10-echoflow-runtime-management-task-2-brief)
- [sdd/2026-10-echoflow-runtime-management/task-3-brief.md](#sdd-2026-10-echoflow-runtime-management-task-3-brief)
- [sdd/2026-10-echoflow-runtime-management/task-4-brief.md](#sdd-2026-10-echoflow-runtime-management-task-4-brief)
- [sdd/2026-10-echoflow-runtime-management/task-6-brief.md](#sdd-2026-10-echoflow-runtime-management-task-6-brief)
- [sdd/2026-10-echoflow-runtime-management/todos.md](#sdd-2026-10-echoflow-runtime-management-todos)
- [plans/2026-10-26-dsh-refactor-migration.md](#plans-2026-10-26-dsh-refactor-migration)
- [plans/2026-10-echoflow-runtime-management.md](#plans-2026-10-echoflow-runtime-management)
- [plans/2026-10-echoflow-runtime-preparation.md](#plans-2026-10-echoflow-runtime-preparation)
- [specs/2026-10-echoflow-multi-runtime-agent-platform-design.md](#specs-2026-10-echoflow-multi-runtime-agent-platform-design)
- [specs/2026-10-echoflow-runtime-management-design.md](#specs-2026-10-echoflow-runtime-management-design)

---

<a id="sdd-2026-10-echoflow-runtime-management-progress"></a>

## SDD ledger — plan: docs/_internal/archive/planning/runtime-platform.md#plans-2026-10-echoflow-runtime-management

来源：`sdd/2026-10-echoflow-runtime-management/progress.md`。

Pre-flight: Task 1 produces the runtime discovery result and API consumed by Tasks 2–5; shared result types must live in Electron-safe code imported by host/UI. Task 2 WSL discovery extends Task 1 subprocess contract. Task 3 IPC consumes Task 1/2; Task 4 host API consumes Task 3; Task 5 UI consumes Task 4; Task 6 validates compatibility across all earlier tasks.

Ruling: Execute in place — user explicitly selected the current workspace; preserve all unrelated changes and edit only runtime-management paths.

Baseline: Initial `bun test` invocation used Bun's test runner by mistake; correct configured Vitest baseline passed: 6 files, 192 tests. It emitted pre-existing React `act(...)` and BrowserHost refresh warnings in `generalSettings.test.tsx`; no failures.

Task 1: Ruling: `probeRuntimePath` requires the selected product ID and fixed product-specific `--version` argument — otherwise arbitrary executable paths would be classified as known runtimes by guesswork; it still validates the executable and never accepts command arguments — cost if wrong: users may have to select product before selecting its executable.
Task 1: Ruling: Desktop focused tests use `bun run test --run`, Vitest — bare `bun test` invokes Bun's different runner and fails on `vi.hoisted`/jsdom, confirmed in baseline; cost if wrong: none beyond test command consistency.
Task 1: Ruling: Native known-product discovery uses fixed `claude` and `codex` binary names on PATH; WSL and custom path handling remain separate tasks — avoids shell search commands and bounds probing — cost if wrong: installations under nonstandard names are discoverable only through explicit path.
Task 1: complete (commits a2f1219..a2f1219, tests: bash -lc 'cd desktop && bun run test --run electron/services/runtimeDiscovery.test.ts' →    Duration  550ms (transform 42ms, setup 12ms, collect 26ms, tests 44ms, environment 208ms, prepare 79ms))

Task 2: Ruling: WSL distro labels are accepted only as `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` and each probe uses `wsl.exe -d <name> --exec sh -c <fixed script>` — the distribution remains one argv element and `--exec` ensures command execution occurs inside the selected distro; cost if wrong: uncommon valid distro labels with spaces are omitted from auto-probe and require user-selected route later.
Task 2: Ruling: WSL remains explicit (`includeWsl`) rather than part of initial discovery — avoids unexpectedly starting/consulting WSL at page load; cost if wrong: user must press the WSL probe action.
Task 2: complete (commits a2f1219..a2f1219, tests: bash -lc 'cd desktop && bun run test --run electron/services/runtimeDiscovery.test.ts' →    Duration  593ms (transform 49ms, setup 12ms, collect 32ms, tests 49ms, environment 213ms, prepare 82ms))
Task 3: complete (commits a2f1219..a2f1219, tests: bash -lc 'cd desktop && bun run test --run electron/ipc/capabilities.test.ts electron/services/runtimeDiscovery.test.ts' →    Duration  589ms (transform 94ms, setup 26ms, collect 97ms, tests 56ms, environment 435ms, prepare 199ms))
Task 4: complete (commits a2f1219..a2f1219, tests: bash -lc 'cd desktop && bun run test --run src/lib/desktopHost/electronHost.test.ts src/lib/desktopHost/contract.test.ts' →    Duration  576ms (transform 111ms, setup 23ms, collect 121ms, tests 25ms, environment 433ms, prepare 167ms))
Task 5: complete (commits a2f1219..a2f1219, tests: bash -lc 'cd desktop && bun run test --run src/__tests__/generalSettings.test.tsx' →    Duration  16.69s (transform 1.61s, setup 14ms, collect 2.44s, tests 13.74s, environment 214ms, prepare 79ms))

---

<a id="sdd-2026-10-echoflow-runtime-management-task-1-brief"></a>

## Task 1: Define the safe discovery result and subprocess contract

来源：`sdd/2026-10-echoflow-runtime-management/task-1-brief.md`。

**Files:**
- Create: `desktop/electron/services/runtimeDiscovery.ts`
- Test: `desktop/electron/services/runtimeDiscovery.test.ts`

**Interfaces:**
- `discoverRuntimes(options?: { includeWsl?: boolean }): Promise<RuntimeDiscoveryResult>`
- `probeRuntimePath(path: string): Promise<RuntimeInstallation>`
- Result records use stable `productId`, `source`, `status`, optional `version`, optional `path`, optional `distribution`, optional sanitized `error`; no credentials or arbitrary env.
- Initial supported product IDs are `echoflow-agent`, `claude-code`, and `codex`; DeepSeek is represented by the existing DeepSeek status service, not probed as a CLI. Do not claim these are executable backends for EchoFlow sessions.

- [ ] **Step 1: Add tests for empty and successful native discovery**

Inject PATH lookup and spawn behavior. Assert unknown/missing commands produce an empty/`not-found` result, and known Claude/Codex executable names produce product-specific entries with normalized version and source. Include EchoFlow bundled as a separately identified product entry, not a PATH binary.

- [ ] **Step 2: Add tests for subprocess failure containment**

Assert nonzero exit, malformed output, spawn error, timeout, and oversized stdout/stderr become per-installation error states and do not reject the entire discovery result. Assert timed-out children are killed and output is capped.

- [ ] **Step 3: Add path validation tests**

Cover relative path, control characters, nonexistent path, directory, non-executable file, platform-incompatible executable, and a valid executable. Validate with filesystem APIs before launching a fixed version probe.

- [ ] **Step 4: Run the new service test and verify red**

Run: `cd desktop && bun test electron/services/runtimeDiscovery.test.ts`
Expected: FAIL because the service and its contract do not exist yet.

- [ ] **Step 5: Implement the minimum native discovery service**

Use `where.exe`/PATH handling on Windows and `which`-free PATH directory lookup where possible; use filesystem checks against PATH entries rather than shelling out to discovery commands. Launch only known executable paths with fixed version arguments, no shell, minimized environment, timeout, bounded output, and explicit child cleanup. Keep probing one product failure independent from others.

- [ ] **Step 6: Run focused tests**

Run: `cd desktop && bun test electron/services/runtimeDiscovery.test.ts`
Expected: PASS for native discovery, path validation, sanitized failures, and process cleanup.

---

<a id="sdd-2026-10-echoflow-runtime-management-task-2-brief"></a>

## Task 2: Add read-only WSL discovery

来源：`sdd/2026-10-echoflow-runtime-management/task-2-brief.md`。

**Files:**
- Modify: `desktop/electron/services/runtimeDiscovery.ts`
- Test: `desktop/electron/services/runtimeDiscovery.test.ts`

**Interfaces:**
- `discoverRuntimes({ includeWsl: true })` returns WSL discoveries as installations tagged with `source: 'wsl'` and the exact distro name.
- On non-Windows, WSL returns `not-applicable` and does not spawn a process.

- [ ] **Step 1: Add WSL parsing and distro tests**

Test WSL absent, command failure, no distributions, valid distro output (including CRLF and UTF-16LE where `wsl.exe --list --quiet` emits it), duplicate names, empty names, and distro names containing shell metacharacters. Invalid names must never become shell fragments.

- [ ] **Step 2: Add per-distro probe tests**

Assert the service uses `wsl.exe` with fixed argv and a fixed shell script, no user-provided command text, and a bounded timeout per distro. Missing Claude/Codex in one distro must not hide another distro's successful result.

- [ ] **Step 3: Run focused tests and verify red**

Run: `cd desktop && bun test electron/services/runtimeDiscovery.test.ts`
Expected: WSL-specific tests fail before implementation.

- [ ] **Step 4: Implement WSL enumeration/probes**

Run WSL enumeration only on Windows. Parse distribution names, validate/normalize them, then invoke one fixed read-only script per distribution to check known executable locations and versions. Never run login shells or read user startup scripts; do not install, update, modify distro files, or claim a Linux path is a Windows executable.

- [ ] **Step 5: Run focused tests**

Run: `cd desktop && bun test electron/services/runtimeDiscovery.test.ts`
Expected: PASS for Windows WSL fixtures and non-Windows no-op behavior.

---

<a id="sdd-2026-10-echoflow-runtime-management-task-3-brief"></a>

## Task 3: Expose discovery through constrained Electron IPC

来源：`sdd/2026-10-echoflow-runtime-management/task-3-brief.md`。

**Files:**
- Modify: `desktop/electron/ipc/channels.ts`
- Modify: `desktop/electron/ipc/capabilities.ts`
- Modify: `desktop/electron/main.ts`
- Test: `desktop/electron/ipc/capabilities.test.ts`
- Modify: `desktop/electron/services/runtimeDiscovery.test.ts` only if IPC handler logic is extracted for testability

**Interfaces:**
- IPC `runtimeDiscoveryGet` accepts no payload and returns discovery result.
- IPC `runtimeDiscoveryProbePath` accepts exactly one bounded absolute file path and returns a validated installation result; no command, args, env, or product ID is accepted from renderer.

- [ ] **Step 1: Add IPC validator tests**

Reject strings, objects with extra fields, relative paths, empty paths, paths over the chosen bound, NUL/control characters, and non-string payloads; accept a well-formed absolute path. Keep no-payload discovery strict.

- [ ] **Step 2: Run the IPC tests and verify red**

Run: `cd desktop && bun test electron/ipc/capabilities.test.ts`
Expected: new channel and validator tests fail before registration.

- [ ] **Step 3: Register narrow channels and handlers**

Register handlers using the shared `registerHandler`/capability guard pattern. Use the native open-file dialog to choose a file only if it can return a path without accepting arbitrary renderer input; then call the same backend validation path. Do not add an IPC API that lets the renderer provide shell arguments or executable launch options.

- [ ] **Step 4: Run IPC tests**

Run: `cd desktop && bun test electron/ipc/capabilities.test.ts`
Expected: PASS including invalid input rejection.

---

<a id="sdd-2026-10-echoflow-runtime-management-task-4-brief"></a>

## Task 4: Wire existing Desktop Host and renderer types

来源：`sdd/2026-10-echoflow-runtime-management/task-4-brief.md`。

**Files:**
- Modify: `desktop/src/lib/desktopHost/types.ts`
- Modify: `desktop/src/lib/desktopHost/electronHost.ts`
- Modify: `desktop/src/lib/desktopHost/browserHost.ts`
- Test: `desktop/src/lib/desktopHost/electronHost.test.ts`
- Test: `desktop/src/lib/desktopHost/contract.test.ts`

**Interfaces:**
- Add `runtimeDiscovery.list(): Promise<RuntimeDiscoveryResult>` and `runtimeDiscovery.probePath(path: string): Promise<RuntimeInstallation>` under the existing host interface; use exported shared types, not duplicate UI-only shapes.
- Browser host rejects with its existing explicit unsupported-capability error.

- [ ] **Step 1: Add host contract tests**

Assert Electron host invokes only the new channels with exact payloads; assert Browser host reports unsupported and never returns fabricated discoveries.

- [ ] **Step 2: Run tests and verify red**

Run: `cd desktop && bun test src/lib/desktopHost/electronHost.test.ts src/lib/desktopHost/contract.test.ts`
Expected: fail until runtimeDiscovery methods are exposed.

- [ ] **Step 3: Wire typed host methods**

Add the methods to host types and both hosts. Reuse shared discovery result types and preserve the narrow IPC boundary.

- [ ] **Step 4: Run host tests**

Run: `cd desktop && bun test src/lib/desktopHost/electronHost.test.ts src/lib/desktopHost/contract.test.ts`
Expected: PASS.

---

<a id="sdd-2026-10-echoflow-runtime-management-task-6-brief"></a>

## Task 6: Documentation, compatibility and full verification

来源：`sdd/2026-10-echoflow-runtime-management/task-6-brief.md`。

**Files:**
- Modify: `docs/desktop/settings.md`
- Tests: `desktop/electron/services/claudeCodeRuntime.test.ts`, `desktop/electron/services/deepseekHarnessRuntime.test.ts`, relevant UI and host tests

**Interfaces:**
- Existing Claude Code config schema, IDs, environment key, session behavior, and DeepSeek sidecar data root remain unchanged.
- No data migration should be needed because user-selected paths are probed on demand and are not persisted in this release.

- [ ] **Step 1: Document management behavior and explicit limits**

Explain native/WSL/custom-path discovery, source-specific actions, and that detection is not EchoFlow execution support. State that SDK is internal, external CLI installation remains user/vendor-managed, WSL probes are read-only, and 0.5.7 does not switch sessions.

- [ ] **Step 2: Verify compatibility tests**

Run: `cd desktop && bun test electron/services/claudeCodeRuntime.test.ts electron/services/deepseekHarnessRuntime.test.ts electron/ipc/capabilities.test.ts src/lib/desktopHost/electronHost.test.ts src/lib/desktopHost/contract.test.ts src/__tests__/generalSettings.test.tsx`
Expected: PASS; old Bundled/Installed config and DeepSeek lifecycle contracts unchanged.

- [ ] **Step 3: Run desktop static checks**

Run: `cd desktop && bun run lint`
Expected: PASS with TypeScript and ESLint clean.

- [ ] **Step 4: Run repository checks**

Run: `bun run check:policy && bun run check:desktop`; if native packaging exact-path dependencies are touched and `change-policy` selects desktopNative, also run `bun run check:native`.
Expected: PASS. Then run `bun run verify` before claiming release-ready.

- [ ] **Step 5: Review diff and user work**

Run `git diff --check`, inspect only runtime-management paths, and confirm pre-existing plugin, session archive, Android, account/docs, and other uncommitted work remains untouched. Do not stage, commit, tag, or edit version/release notes.

### Explicit Exclusions

- No session or Team Runtime switching, no Runtime task dispatch, no Agent scheduling, and no claim that discovery equals execution support.
- No auto-install/update of user/system/WSL third-party CLIs; keep DeepSeek's existing app-managed lifecycle unchanged.
- No SDK install/management UI; SDK dependencies remain owned by EchoFlow's build.
- No arbitrary executable launch arguments, environment passthrough, disk-wide recursive scanning, or command-string interpolation.
- No migration or renaming of Claude runtime IDs/config/env keys, and no changes to Team plan persistence.
- If repository evidence shows an extra persisted inventory is required, stop before adding it and revise the design/plan to include migration, frozen old fixture, unknown-field preservation, backup behavior, and `bun run check:persistence-upgrade`.

---

<a id="sdd-2026-10-echoflow-runtime-management-todos"></a>

## todos

来源：`sdd/2026-10-echoflow-runtime-management/todos.md`。

- [ ] Task 1 — safe discovery service and subprocess contract
- [ ] Task 2 — read-only WSL discovery
- [ ] Task 3 — constrained Electron IPC
- [ ] Task 4 — Desktop Host discovery methods
- [ ] Task 5 — runtime management UI
- [ ] Task 6 — docs, compatibility, full verification

---

<a id="plans-2026-10-26-dsh-refactor-migration"></a>

## dsh 底座逐模块重构迁移计划 — Wave 0：基础层

来源：`plans/2026-10-26-dsh-refactor-migration.md`。

**Goal:** 把 DeepSeek Harness（MIT）vendored 成 EchoFlow 的执行底座，做出零外发的 `echoflow` profile 与 ACP 接缝，并立下「模块级重构迁移」的协议与路线图；`src/` 在本 wave 一行不动。

**Architecture:** 边跑边换（一条条替换旧零件，不是推倒重来）。现有产品路径（sidecar → `src/server`）保持原样运行、照常发布；同时在 `runtime/` 新增一棵独立的子树（vendored dsh + EchoFlow 自有插件），从下一阶段起一次替换一个模块，替换期间新旧两条路并存、随时可切回旧的。每个模块的替换做完了才删旧代码。会话数据格式不换成 dsh 的格式（见「本计划的裁定」）。

**Tech Stack:** vendored deepseek-harness（pnpm@11.28.5 workspace、Node ≥24.9.0、Cordis 插件架构）、EchoFlow 根 bun@1.3.14（工具链物理隔离）、Vitest/pnpm test（runtime 域）、bun test（根域）。

**Spec:** `docs/_internal/archive/planning/runtime-platform.md#specs-2026-10-echoflow-multi-runtime-agent-platform-design`（长期方向；§4.1 控制面/执行面、§4.3 适配级别、§7 阶段门继续有效；§5/§9/§10 的修订由本计划 Task 1 落地）。能力审计结论（2026-10-26，149 条对照，both-have 97 / dsh-partial 22 / dsh-lacks 15 / dsh-covers 13 / echoflow-lacks 2）是本计划「加强层」立项清单的证据来源。

### 本计划的裁定（执行者按此实现；维护者可在 review 时推翻）

1. **持久化合同：strangler，不换。** EF 产品数据（会话列表、Teams、IM 绑定、设置）继续用 EF 自己的格式与迁移规则；dsh 的 V4 事件日志是 runtime 内部细节，由接缝适配器翻译。不把单一 harness 的 session schema 提升为 EF 的持久化合同（10-08 设计 §4.2 + AGENTS.md 持久化兼容规则）。
2. **桌面壳：保留 EF 自有 Electron 桌面。** dsh 只作执行底座被驱动（ACP/Remote），不采用 dsh 的 `apps/desktop`。33.9 万行自有 UI（宠物、Mermaid、图片生成气泡等）是产品面，且「不照搬」。
3. **存量会话：早 wave 不迁移。** `~/.claude/projects/**/*.jsonl` 保持现有读路径；专门的迁移工具作为后续独立模块（带 old-fixture 测试）出现，永不静默改写。
4. **`subagent-claude-code`：源码保留、安装图排除。** vendored 树里保留该包（on-demand、MIT 主体），但 `runtime/dsh` 的 workspace 安装图不得拉取 `@anthropic-ai/claude-agent-sdk*` 的 ~215MB 平台载荷（optionalDependencies）。用户将来主动启用时走 dsh 自己的 on-demand 安装。
5. **商标纪律：** 用户可见文案与产品名不得出现 “DeepSeek Harness”（注册商标）；用 “dsh/DSH” 或自有品牌。MIT 版权声明随 vendored 源码保留，记入 `THIRD_PARTY_LICENSES.md`。

### Global Constraints

- **零外发默认值**：出厂 `echoflow` profile 对下列插件必须 `disabled: true`：`session-log-deepseek`、`session-telemetry-otel`、`plugin-package-inventory-deepseek`、`deepseek-account`、`deepseek-llm-api-extensions`、`web-search-deepseek`、`web-deepseek-api`、`llm-deepseek-account`；有效配置中不得出现 `api.deepseek.com`、`dsh-otel-collector.deepseeksvc.com`。桌面 product-analytics 同理（Wave 1 接桌面时生效，本 wave 记录在 blocklist）。
- **工具链隔离**：`runtime/` 只用 pnpm；根目录脚本只能通过显式的 `bun run check:runtime` 进入，禁止 `bun install`/`bun run verify` 递归触碰 `runtime/dsh` 的 workspace。`runtime/dsh` 树保持**未修改**（升级靠整体 re-vendor diff），EchoFlow 侧定制一律放 `runtime/echoflow/`。
- **独立性契约**：`AGENTS.md` `## Independence & Reference Policy` 的修订见 Task 1。修订前不得合入 vendor 代码；修订后允许 vendoring MIT 代码，条件是保留版权声明、记入 `THIRD_PARTY_LICENSES.md`、不声称 authorship/维护归属、EchoFlow 自有代码与 vendored 代码物理分离。
- **可回退**：每个任务完成后旧产品路径行为不变（`bun run check:desktop` / `check:server` 在本 wave 不得变红）。Wave 0 只做加法。
- **安全预检**：所有 boot 测试用临时 `DSH_HOME`（`scripts/quality-gate/sandbox.ts` 风格），测试结束断言未写入真实 `~/.claude`。
- AGENTS.md 保持 <24 KB（`scripts/pr/quality-contract.test.ts` 强制）；顶层目录、quality gate、package script、ChangeArea 的变动与 AGENTS.md 同变更。
- 根 `src/` 受 `cli-core` 门保护；本 wave 不触碰 `bin/` 与根 `src/`。
- Commit 用 Conventional Commit（`feat:`/`fix:`/`docs:`/`test:`/`chore:`），trailer 记 `Tested:` / `Not-tested:` 与 `Scope-risk:`。

### Review Focus

以下是这套东西最容易出事的五个地方，按危险程度从高到低排。每条后面写明：哪个任务的哪个测试负责看住它。

1. **dsh 升级后，往外发数据的插件改了名或新增了，我们的禁用名单没跟上 → 用户会话数据悄悄发给 DeepSeek。**（`cordis.patch.yml` 里写了不存在的插件名不会报错，只在日志里提一句，很难注意到。）→ 看住它的是：Task 3 逐项检查生效配置的测试 + Task 4 的保险插件（名单里任何一项还开着就拒绝启动）。
2. **安装依赖时把 Anthropic 的官方二进制拉下来（约 215MB，许可不明）→ 发布包带上不该带的东西。** → 看住它的是：Task 2 检查依赖清单里 `@anthropic-ai` 一个都不许出现。
3. **根目录的 bun 命令和 `runtime/` 里的 pnpm 命令互相干扰 → 一边装依赖弄坏另一边。** → 看住它的是：Task 7 的路由测试（`runtime/` 的改动只跑 `check:runtime`，不碰其它检查）。
4. **测试启动 dsh 时把文件写进你真实的 `~/.claude` 配置目录 → 污染用户数据。** → 看住它的是：Task 5 的测试用临时目录，跑完检查真实配置目录没多出任何文件。
5. **加新东西时顺手改了现有产品的行为（比如提前把 Node 最低版本从 22 抬到 24）→ 现有用户升级后用不了。** → 看住它的是：Task 6 只写一个「版本检查函数」放在一边，真正改产品口径留到下一阶段，本阶段一行现有代码不动。

---

### Task 1: 契约与设计文档落位

**Files:**
- Modify: `AGENTS.md`（`## Independence & Reference Policy` 与 Project Structure 节）
- Modify: `scripts/pr/change-policy.ts`（`ChangeArea` 加 `runtime`）
- Modify: `package.json`（script `check:runtime`）
- Modify: `docs/_internal/archive/planning/runtime-platform.md#specs-2026-10-echoflow-multi-runtime-agent-platform-design`（§5/§9/§10 修订）
- Modify: `THIRD_PARTY_LICENSES.md`（vendored 记录约定先立条目占位）
- Test: `scripts/pr/change-policy.test.ts`（或该包既有测试文件）

**Interfaces:**
- Produces: `ChangeArea` 联合新增 `'runtime'`；路由规则「`runtime/**` 的变更 → `bun run check:runtime`」；`package.json` script `check:runtime`（见 Task 7 定义其最终形态，本任务先占位为 `pnpm --dir runtime/echoflow test`）；AGENTS.md 中 `runtime/` 顶层目录说明（一句：vendored dsh 底座 + EchoFlow bundles，pnpm 工具链，修改前读 `runtime/README.md`）。
- Consumes: 无（首个任务）。

- [ ] **Step 1: 写失败测试 — `runtime/**` 路径路由到 `check:runtime`**

在 `scripts/pr/change-policy.test.ts`（若无则新建）中断言：输入变更路径 `['runtime/dsh/packages/session/index.ts', 'runtime/echoflow/bundles/egress-guard/src/index.ts']`，impact 选择包含 `check:runtime`，且不包含 `check:desktop`/`check:server`。

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test scripts/pr/change-policy.test.ts`
Expected: FAIL（`runtime` 不在 ChangeArea / 路由表中）

- [ ] **Step 3: 改 `scripts/pr/change-policy.ts` 与 `package.json`**

`ChangeArea` 联合类型加 `'runtime'`；路径路由加 `runtime/**` → `runtime`；`package.json` scripts 加 `"check:runtime": "pnpm --dir runtime/echoflow test"`（完整形态 Task 7 收口，允许本任务先这么写）。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test scripts/pr/change-policy.test.ts`
Expected: PASS

- [ ] **Step 5: 修订 `AGENTS.md`**

在 `## Independence & Reference Policy` 增补一段（英文，与该节语气一致）：MIT/Apache-2.0 许可的第三方代码可以 source-vendor 进本仓库，前提是（a）原版权声明与 LICENSE 随代码保留，（b）`THIRD_PARTY_LICENSES.md` 记录来源与版本，（c）不声称其 authorship/维护归属为 EchoFlow，（d）vendored 树与 EchoFlow 自有代码物理分离（`runtime/dsh` vs `runtime/echoflow`），（e）不得复制其他项目的代码进 EchoFlow 自有树（该禁令原样保留）。同时在 Project Structure 节加 `runtime/` 一行（10 词内）。控制在 24 KB 内。

- [ ] **Step 6: 修订 10-08 设计文档的 §5/§9/§10**

§5 删去「可继续按仓库既有上游同步流程维护」（同步已退役，`53bd2e296`），改为「执行底座采用 MIT 开源 harness 作 vendored 依赖 + 自有编排层」；§9 第一条「不从头开发通用 Harness」补注「（不自研 ≠ 不采用 MIT 底座；采用 dsh 并在其上做加强层不属于自研）」；§10 的 Team worker 试点入口标注「已被逐模块重构迁移取代，见 `docs/_internal/archive/planning/runtime-platform.md#plans-2026-10-26-dsh-refactor-migration`」。文首加一行修订记录（日期 + 「授权依据：维护者 2026-10-26 方向确认」）。

- [ ] **Step 7: 跑契约自检**

Run: `bun run audit:harness && bun test scripts/pr/quality-contract.test.ts`
Expected: PASS（AGENTS.md 仍 <24 KB）

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md scripts/pr/change-policy.ts scripts/pr/change-policy.test.ts package.json docs/_internal/archive/planning/runtime-platform.md#specs-2026-10-echoflow-multi-runtime-agent-platform-design THIRD_PARTY_LICENSES.md
git commit -m "docs(contract): allow MIT vendoring with notice rules and add runtime surface"
```

---

### Task 2: vendored dsh 树 + 工具链隔离

**Files:**
- Create: `runtime/dsh/**`（vendored 源码树，**不修改任何文件**）
- Create: `runtime/dsh-manifest.json`
- Create: `runtime/README.md`
- Create: `runtime/echoflow/package.json`、`runtime/echoflow/pnpm-workspace.yaml`、`runtime/echoflow/.gitignore`
- Test: `runtime/echoflow/test/vendor-manifest.test.ts`

**Interfaces:**
- Produces: `runtime/dsh-manifest.json` 形状 `{ upstream: string /* repo URL */, commit: string /* 完整 SHA */, vendoredAt: string /* YYYY-MM-DD */, exclusions: string[], nodeFloor: [number,number,number] }`；`runtime/dsh` 未修改树（`git diff` 语义上对上游 SHA 无本地改动）；`runtime/echoflow` workspace 可 `pnpm install && pnpm test`。
- Consumes: Task 1 的 `check:runtime` script。

- [ ] **Step 1: 写失败测试 — manifest 完整性与安装图纯净**

`runtime/echoflow/test/vendor-manifest.test.ts`，断言：
1. `runtime/dsh-manifest.json` 的 `commit` 是 40 位 hex，`nodeFloor` 等于 `[24, 9, 0]`，`exclusions` 包含 `.git`、`node_modules`、`website`、`benchmarks`、`snapshots`；
2. `runtime/dsh/package.json` 的 `packageManager` 以 `pnpm@` 开头；
3. `runtime/echoflow/pnpm-lock.yaml`（若存在）与 `runtime/echoflow/package.json` 依赖树中 `@anthropic-ai` 出现次数为 0；
4. `runtime/dsh/packages/subagent/subagent-claude-code/package.json` 仍存在（源码保留，裁定 4）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd runtime/echoflow && pnpm test`
Expected: FAIL（`runtime/dsh-manifest.json` 不存在）

- [ ] **Step 3: vendoring**

以 `https://github.com/deepseek-ai/deepseek-harness.git` 的 HEAD 为基线（执行时 `git clone --depth 1` 后 `git rev-parse HEAD` 取完整 SHA；2026-10-26 审计时为 `ed74ec82ce1fe3a36da6c0815a935473ef4bb0fb`），完整拷贝源码到 `runtime/dsh/`，排除 `exclusions` 所列目录与 `.git`。写 `runtime/dsh-manifest.json`（commit 取克隆的完整 SHA）。`runtime/dsh-manifest.json` 与 `runtime/README.md` 同时记录升级协议：「升级 = 整树替换 + 更新 manifest SHA + 重跑 `check:runtime`；对 `runtime/dsh` 的任何本地修改都禁止，定制放 `runtime/echoflow/`」。

- [ ] **Step 4: 建 `runtime/echoflow` workspace**

`package.json`：`"packageManager": "pnpm@11.28.5"`、`"engines": {"node": ">=24.9.0"}`、依赖里**不得**含任何 `@anthropic-ai/*`；devDependencies 只放 `vitest`、`typescript`。`pnpm-workspace.yaml` members: `bundles/*`（本 wave 空占位可省，Task 4 加入）。`.gitignore` 忽略 `node_modules`。`corepack enable` 后 `pnpm install` 生成 lockfile。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd runtime/echoflow && pnpm test`
Expected: PASS（4 组断言全绿）

- [ ] **Step 6: Commit**

```bash
git add runtime/
git commit -m "feat(runtime): vendor dsh at pinned commit with isolated pnpm workspace"
```

---

### Task 3: `echoflow` profile + 零外发禁用清单

**Files:**
- Create: `runtime/echoflow/egress-blocklist.json`
- Create: `runtime/echoflow/profile-template/package.json`、`runtime/echoflow/profile-template/cordis.patch.yml`
- Test: `runtime/echoflow/test/profile-egress.test.ts`

**Interfaces:**
- Produces: `egress-blocklist.json` 形状 `{ plugins: Array<{ id: string, reason: string }>, hosts: string[] }`（`plugins` 至少含 Global Constraints 列的 8 个 id + `product-analytics`、`command-feedback`；`hosts` 至少含 `api.deepseek.com`、`dsh-otel-collector.deepseeksvc.com`、`download.deepseek.com`）；`profile-template/` 是 `loadProfileDirectory` 可加载的目录（`package.json` 的 `dsh.profile.bundles` 声明 bundle 列表）。
- Consumes: Task 2 的 vendored 树与 workspace。

- [ ] **Step 1: 写失败测试 — 有效配置零外发**

`runtime/echoflow/test/profile-egress.test.ts`：把 `profile-template/` 拷到临时 `DSH_HOME/profiles/echoflow`，运行 `node runtime/dsh/... dsh --profile echoflow --dump-config`（命令形态以 `docs/cli-help.md` 的 config dump 为准），断言：
1. dump 的每一行针对 blocklist 的每个 `plugins[].id`：要么该 id 不出现，要么其条目带 `disabled: true`；
2. dump 全文对 `hosts[]` 每个字符串零匹配；
3. 退出码为 0。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd runtime/echoflow && pnpm test profile-egress`
Expected: FAIL（patch 尚不存在，dump 含 `session-log-deepseek` 启用行 / 含 DeepSeek hosts）

- [ ] **Step 3: 写 blocklist 与 profile patch**

`egress-blocklist.json` 按 Interfaces 的形状填全（reason 写外发内容一句，如「uploads incremental canonical session log to DeepSeek API」）。`profile-template/cordis.patch.yml` 对每个 id 写一层覆盖：

```yaml
- id: session-log-deepseek
  disabled: true
```

（patch 机制参考 `runtime/dsh/packages/bundle/sdk-app/cordis.patch.yml` 的既有写法：顶层 `- id: <x>` + `disabled: true` 为替换层。）`profile-template/package.json` 的 `dsh.profile.bundles` 选 `@deepseek-ai/dsh-base` + 执行面 bundle（ACP 接缝用 `@deepseek-ai/dsh-acp-app`；以 `runtime/dsh/packages/util/official-bundles/src/bundles.ts` 的 `PROFILE_TEMPLATES.acp` 为准）。`web-search-deepseek`/`web-deepseek-api` 若 dump 后确认在 acp 组合中不出现，从 patch 删去该两行并在测试中改为「不出现即通过」。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd runtime/echoflow && pnpm test profile-egress`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/echoflow/egress-blocklist.json runtime/echoflow/profile-template runtime/echoflow/test/profile-egress.test.ts
git commit -m "feat(runtime): ship zero-egress echoflow profile with blocklist-driven disables"
```

---

### Task 4: `egress-guard` 加强包（dsh 没有的能力，我们加上）

**Files:**
- Create: `runtime/echoflow/bundles/egress-guard/package.json`、`src/index.ts`、`README.md`
- Modify: `runtime/echoflow/profile-template/cordis.patch.yml`（insert guard 插件行）
- Test: `runtime/echoflow/test/egress-guard.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `egress-blocklist.json`。
- Produces: 纯函数 `verifyEffectiveConfig(dump: string, blocklist: Blocklist): string[]`（返回违规描述数组，空数组 = 通过），放在 `bundles/egress-guard/src/verify.ts` 供单测；插件入口 `default` 导出为 Cordis 插件（`name: '@echoflow/egress-guard'`），激活时对当前组合跑 `verifyEffectiveConfig`，违规则抛错使 boot 失败（required-entry 语义：宁可不启动，不可外发）。

- [ ] **Step 1: 写失败测试（单测 + boot 级）**

`test/egress-guard.test.ts`：
1. `verifyEffectiveConfig('…id: session-log-deepseek\n  disabled: false…', blocklist)` 返回 ≥1 条违规；`disabled: true` 版本返回空数组；缺失 id 返回空数组；`hosts` 命中（如 dump 含 `api.deepseek.com`）返回违规；
2. boot 级：把 `profile-template` 的 `session-log-deepseek` 行改回启用，启动该 profile，断言进程退出非零且 stderr 含该插件 id；恢复后启动成功。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd runtime/echoflow && pnpm test egress-guard`
Expected: FAIL（`verifyEffectiveConfig` 未定义）

- [ ] **Step 3: 实现 `verifyEffectiveConfig(dump: string, blocklist: Blocklist): string[]` 与插件入口**

校验逻辑：按行解析 dump（不必完整 YAML 解析——逐 id 找 `id: <x>` 条目块，判断块内是否有 `disabled: true`；hosts 做子串匹配）。插件入口在激活钩子里读同目录 blocklist（打包时随包带上），违规 `throw`。README 用英文写明它是 EchoFlow 自有 bundle（产品差异化，不声称 dsh 归属）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd runtime/echoflow && pnpm test egress-guard`
Expected: PASS（含 boot 级两条）

- [ ] **Step 5: Commit**

```bash
git add runtime/echoflow/bundles/egress-guard runtime/echoflow/profile-template/cordis.patch.yml runtime/echoflow/test/egress-guard.test.ts
git commit -m "feat(runtime): add egress-guard bundle that fails boot on data egress"
```

---

### Task 5: ACP 接缝冒烟（第一个模块级接缝）

**Files:**
- Create: `runtime/echoflow/test/acp-seam.test.ts`
- Create: `runtime/echoflow/src/acpProbe.ts`（测试驱动用的最小 JSON-RPC stdio 客户端，后续 Wave 1 的 runtime bridge 会复用其 transport 部分）
- Test: `runtime/echoflow/test/acp-seam.test.ts`

**Interfaces:**
- Consumes: Task 3 的 profile（ACP 组合）。
- Produces: `acpProbe.ts` 导出 `spawnAcpProfile(options: { dshHome: string, dshRoot: string }): AcpSession`，其中 `AcpSession` 有 `initialize(): Promise<{ serverInfo: { name: string, version: string } }>`、`shutdown(): Promise<void>`、`kill(): void`。Wave 1 的 `desktop/electron` runtime bridge 将消费同一 transport。

- [ ] **Step 1: 写失败测试**

`acp-seam.test.ts`：临时 `DSH_HOME` 拷入 profile → `spawnAcpProfile` → `initialize()` 返回 `serverInfo.name` 为 dsh 的 runtime 身份字符串（以 `runtime/dsh/packages/sdk/protocol/src/types.ts` 的 wire-stable 常量为准）→ `shutdown()` 后进程退出码 0 → 断言 `DSH_HOME` 之外（尤其真实 `~/.claude`）零新文件（对比调用前后目录清单快照）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd runtime/echoflow && pnpm test acp-seam`
Expected: FAIL（`spawnAcpProfile` 未定义）

- [ ] **Step 3: 实现 `spawnAcpProfile`**

stdio 行分隔 JSON-RPC（参照 `runtime/dsh/packages/sdk/protocol/src/transport.ts` 的帧格式）。启动命令以 `runtime/dsh/docs/cli-help.md` 的 `--profile` + acp 行为为准；stdout 交给 transport，stderr 保留为诊断。不实现 prompt/事件——本任务只证明「可启动、可握手、可干净退出」。

- [ ] **Step 4: 跑测试确认通过（含 sandbox 断言）**

Run: `cd runtime/echoflow && pnpm test acp-seam`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/echoflow/src/acpProbe.ts runtime/echoflow/test/acp-seam.test.ts
git commit -m "test(runtime): prove ACP seam boots and shuts down cleanly under sandbox home"
```

---

### Task 6: host Node 预检模块（下限 24.9.0，不提前改产品口径）

**Files:**
- Create: `runtime/echoflow/src/nodeFloor.ts`
- Test: `runtime/echoflow/test/node-floor.test.ts`

**Interfaces:**
- Consumes: Task 2 manifest 的 `nodeFloor`。
- Produces: `checkNodeFloor(current: string, floor: [number, number, number]): { ok: boolean, reason: string | null }` — 语义：主/次/补丁按数字比较，低于 floor 时 `reason` 为 `'Node.js 24.9.0 or later is required for the dsh runtime'`。Wave 1 的 `nodeRuntime.ts` 改造时调用它并把桌面口径从 22.19.0 抬到 24.9.0（**本任务不做那步**，避免提前改变现有用户路径）。

- [ ] **Step 1: 写失败测试**

断言：`checkNodeFloor('24.9.0', [24,9,0]).ok === true`；`'24.19.0'` → true；`'24.8.9'` → false 且 reason 非空；`'22.19.0'` → false；`'25.0.0'` → true；非法字符串（`'bun'`）→ false 且 reason 非空。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd runtime/echoflow && pnpm test node-floor`
Expected: FAIL

- [ ] **Step 3: 实现 `checkNodeFloor`**

只做语义版本数字三段比较，不引 semver 依赖（裁定：不加依赖）。非法/缺段 → `ok: false`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd runtime/echoflow && pnpm test node-floor`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/echoflow/src/nodeFloor.ts runtime/echoflow/test/node-floor.test.ts
git commit -m "feat(runtime): add host node floor check for the dsh runtime"
```

---

### Task 7: `check:runtime` 收口 + 路由验证 + handoff 记录

**Files:**
- Modify: `package.json`（`check:runtime` 最终形态）
- Modify: `runtime/README.md`（写清 wave 交接：升级协议、blocklist 维护、`runtime/dsh` 禁改）
- Test: `scripts/pr/change-policy.test.ts`（补一条：`runtime/**` 变更**不**拉起 `check:desktop`/`check:server`/`check:native`）

**Interfaces:**
- Produces: `check:runtime` = `pnpm --dir runtime/echoflow install --frozen-lockfile && pnpm --dir runtime/echoflow test`（确定性、离线、无真实凭据）。后续每个模块迁移 plan 的「验证」步骤复用它。
- Consumes: Task 1 的占位 script、Task 2–6 的测试。

- [ ] **Step 1: 写失败测试（路由不泄漏）**

断言：变更集 `['runtime/dsh/x.ts']` 的 impact 只含 `check:runtime`；变更集 `['desktop/electron/main.ts', 'runtime/echoflow/src/nodeFloor.ts']` 含 `check:native` 与 `check:runtime`（import-aware 双选）。

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test scripts/pr/change-policy.test.ts`
Expected: FAIL（当前 `check:runtime` 占位形态 / 路由未固化）

- [ ] **Step 3: 定稿 `check:runtime` 与 README 交接段**

`package.json` 按 Interfaces 改写 script。`runtime/README.md` 增加「Wave 0 → Wave 1 交接」小节，点名 Wave 1 的三件事：`nodeRuntime.ts` 下限抬到 24.9.0 并改用 `checkNodeFloor`、`deepseekHarnessRuntime.ts` 的 npx 启动换成 vendored profile 启动（ACP 消费 `acpProbe` 的 transport）、桌面 product-analytics 进 blocklist 强制。

- [ ] **Step 4: 全量验证**

Run: `bun run check:runtime && bun test scripts/pr/change-policy.test.ts && bun run check:impact`
Expected: 全 PASS；`check:impact` 输出显示 `runtime/**` → `check:runtime`

- [ ] **Step 5: Commit + handoff 记录**

```bash
git add package.json runtime/README.md scripts/pr/change-policy.test.ts
git commit -m "chore(runtime): finalize check:runtime gate and wave-1 handoff notes"
```

Handoff（随提交 trailer 或 PR 描述）：changed files 清单、focused checks（`check:runtime`、`bun test scripts/pr/…`）、checks not run（`bun run verify` 全量——本 wave 纯加法，按需补跑）、remaining risk（blocklist 随 dsh 升级需人手复核——egress-guard 只能拦清单内项）。

---

### 每个模块怎么迁（六步，一步一个检查点，任何一步不过就停）

以后每个模块（比如「会话存取」「权限弹窗」）单独开一个计划文件，把下面六步展开成任务。每步做完都能单独检查、单独拒绝：

1. **先给旧行为拍照**：给这个模块现在的行为补上测试（只加测试，不改实现），跑出全绿。这张「照片」以后用来证明换完之后行为没变。
2. **定好两边的接口**：写清楚「这个模块对外提供什么、用什么格式」。接口用 EchoFlow 自己的定义，dsh 内部的格式不能直接变成产品对外的承诺。
3. **新旧同时跑**：dsh 版实现做好后先藏在开关后面，默认还是走旧路。用同一份输入喂新旧两套，对比输出是否一致。
4. **切换**：默认改走 dsh 版。旧路保留一个版本周期，出问题一键切回。
5. **升级功能**：确认新路稳定后，把这个模块该有的新能力加上（dsh 已有的好东西直接用；dsh 没有的我们补）。升级单独提交，不行单独回退。
6. **删旧代码**：证明新旧行为一致的证据齐了（该跑的检查都跑了），才删旧实现。只删这次替换产生的废代码；用户旧数据一律只读保留。

### 模块迁移路线图（每一行 = 将来一个独立的计划文件）

| Wave | 模块 | 现在在哪 → 换到哪 | 换的时候顺便升级什么 | 怎么证明换完没变坏 |
|---|---|---|---|---|
| 0 | 基础层 | — → `runtime/` | egress-guard（dsh 无此物） | 本计划 Task 2–6 |
| 1 | 运行时桥 | `deepseekHarnessRuntime` npx → vendored profile 启动 | Node 下限 24.9.0 统一口径；更新检查走 EF 渠道 | `check:native` + acp-seam 回归 |
| 2 | 会话存取 | `sessionService` 读路径 → dsh event log + EF 投影 | fork-at-boundary、事件溯源回放（dsh 强项） | 会话历史 fixture 对比 + `check:chat-contract` |
| 3 | agent loop / 工具执行 | `src/services`+`src/tools` → `agent-loop`/`tool-executor` | **PTC `run_code` 程序式工具**（dsh 有 EF 无，echoflow-lacks 项） | `check:agent-flow` + `check:desktop-ui-smoke` |
| 4 | 权限管线 | EF 权限栈 → `authorization`/`guard` + EF 规则存储 | EF saved-permissions + 断线重放补 dsh 短板（dsh-partial 项） | `check:agent-flow` 权限段 + ui-smoke 点真按钮 |
| 5 | provider 路由 | 保留 `src/server/proxy`/presets（EF 强项）喂给 dsh llm 路由 | OpenCode Go/OAuth 订阅集成 + 成本核算（dsh-lacks 项） | `check:provider-contract` + live smoke |
| 6 | MCP + Skills | EF MCP/Skills 处理 → `mcp-client`/`skill` | 跨客户端 `.agents/skills` 约定保留 | 既有 MCP/Skills 测试 |
| 7 | 多运行时协同 | —（新能力） | opencode 经 `subagent-acp` 挂第二后端；路由规则 EF 定 | 10-08 设计 §7 Phase 3 门（实测增益） |
| 8 | 加强层逐项 | 各 EF 独有模块 | 15 项 dsh-lacks 清单：IM 舰队/配对码/扫码、会话回卷+文件检查点、USD 成本、Anthropic Messages 反代、网络策略、工具输入改写、宠物窄权限、H5 策略、远程凭据规则、图片生成、Mermaid 气泡、轮次预算、会话删除 | 每项独立测试 + 桌面冒烟 |
| 9 | 协作/公开访问 | `sessionCollaboration*`/`publicAccess` → dsh remote-access/liveshare + EF 配对 | 设备配对/哈希令牌/撤销（EF 强项）叠到 dsh RBAC 上 | 协作集成测试 |
| 10 | 退役 | `src/server` 残余、sidecar 模式 | sidecar 改为启动 `echoflow` profile | `bun run verify` 全绿 + `src/` 行数报告 |

（Wave 2+ 的「目标」若审计结论与实施时的 dsh 版本不符，以实施时的语义审计为准并回写本表。）

### 明确不做（本 program）

- 不改写/迁移存量会话数据（裁定 3）。
- 不把 dsh 的 session/工具 schema 提升为 EF 持久化合同（裁定 1）。
- 不采用 dsh 的 `apps/desktop`（裁定 2）。
- 不在 `runtime/dsh` 树内做任何本地修改（定制进 `runtime/echoflow/`）。
- 不把 on-demand 的 `subagent-claude-code`/`subagent-codex` 拉进默认安装图（裁定 4）。
- 不承诺 transcript 跨 harness 无损迁移（10-08 §2 原则保留）。

---

<a id="plans-2026-10-echoflow-runtime-management"></a>

## EchoFlow Runtime Management Implementation Plan

来源：`plans/2026-10-echoflow-runtime-management.md`。

**Goal:** Give users one truthful place to discover and manage EchoFlow's bundled Agent, supported runtimes installed on the current OS or WSL, and user-selected executable locations—without switching EchoFlow session or Team execution.

**Architecture:** Add an Electron-owned discovery service that reports product entries separately from installation instances. It performs bounded, read-only probes for known executable names, supports Windows WSL distribution probes and a validated user-selected path, and keeps the existing Claude `bundled | installed` session setting and DeepSeek sidecar lifecycle intact. The renderer only displays results and calls narrow IPC operations; finding a runtime never implies it can execute EchoFlow tasks.

**Tech Stack:** TypeScript, Electron IPC, React, Bun/Vitest, Node `child_process`/filesystem APIs, current desktop host capability pattern.

**Spec:** `docs/_internal/archive/planning/runtime-platform.md#specs-2026-10-echoflow-runtime-management-design`

### Global Constraints

- This release does not switch EchoFlow main sessions or Team workers to discovered runtimes.
- Preserve the current Claude Code `bundled | installed` IDs, config path, environment key, resolver behavior, and persisted session metadata.
- Keep EchoFlow's bundled runtime product identity distinct from current Claude Code-derived implementation lineage.
- Keep DeepSeek Harness's isolated data directory and existing start/stop/restart/update/open lifecycle.
- SDKs are EchoFlow implementation dependencies, not user-installable runtime entries.
- Current-system, WSL, and user-selected probes are read-only; never auto-install or update third-party tools.
- Probe only fixed known executable names/arguments; never interpolate arbitrary user input into shell commands.
- Preserve unrelated working-tree changes; do not stage, commit, tag, or change release versions.
- Desktop runtime management changes map to existing `desktop`/`desktopNative` checks; do not invent a ChangeArea.

### Review Focus

- Same runtime installed in PATH, standard locations, and a user-selected path is deduplicated or clearly shown as distinct locations without misleading product duplicates.
- Missing WSL, zero distributions, stopped distributions, invalid UTF-16/list output, timeout, and nonzero exit all produce partial results and do not break native runtime discovery.
- A selected file that is a directory, non-executable, wrong-platform binary, or changes between selection and probe is rejected as unavailable.
- Malicious-looking WSL distribution names or file paths cannot inject shell syntax; shell commands/arguments are constants and values are passed as argv where possible.
- Probe output/environment never reveals API keys, OAuth tokens, full process environment, or sensitive output; child processes are killed on timeout/disconnect.
- Discovering Codex/Claude/WSL only changes management display; it must not alter the existing session runtime or Team worker runtime.

---

### File Structure

- `desktop/electron/services/runtimeDiscovery.ts` (new): product definitions, native executable discovery, explicit-path validation, version probe normalization, WSL enumeration/probe, and bounded subprocess helper.
- `desktop/electron/services/runtimeDiscovery.test.ts` (new): injected PATH/filesystem/process dependencies; deterministic tests for supported products, errors, timeout, WSL parsing, and path validation.
- `desktop/electron/ipc/channels.ts`: add narrow `runtimeDiscoveryGet` and `runtimeDiscoveryProbePath` channels.
- `desktop/electron/ipc/capabilities.ts` and tests: validate no-payload discovery and path-only probe payload; reject invalid/oversized/control-character input.
- `desktop/electron/main.ts`: register handlers and call the discovery service; use the existing Electron open-file dialog for user path selection if the existing dialog API can enforce file-only selection.
- `desktop/src/lib/desktopHost/types.ts`, `electronHost.ts`, `browserHost.ts`, and their tests: expose the discovery result and explicit-path probe through existing host capabilities; browser host returns unsupported, not fake success.
- `desktop/src/pages/settings/RuntimeSettings.tsx`: render product cards and installation instances, probe/refresh, WSL selection, and user-path discovery; keep existing Claude selector and DeepSeek management actions clearly separate and behavior-compatible.
- `desktop/src/i18n/locales/{en,zh,zh-TW,jp,kr}.ts`: runtime list, source, version, path, status, WSL, probe failure, selection, and unsupported labels.
- `desktop/src/__tests__/generalSettings.test.tsx` or focused runtime settings test: verify product/instance rendering, probe interaction, current setting compatibility, and no runtime switching from discovery.
- `desktop/electron/services/claudeCodeRuntime.test.ts`, `desktop/electron/services/deepseekHarnessRuntime.test.ts`, `desktop/electron/ipc/capabilities.test.ts`, `desktop/src/lib/desktopHost/electronHost.test.ts`, `desktop/src/lib/desktopHost/contract.test.ts`: compatibility and boundary checks; modify only for real coverage gaps.
- `docs/desktop/settings.md`: explain what management detects and explicitly distinguish detection from EchoFlow task-execution support.

### Task 1: Define the safe discovery result and subprocess contract

**Files:**
- Create: `desktop/electron/services/runtimeDiscovery.ts`
- Test: `desktop/electron/services/runtimeDiscovery.test.ts`

**Interfaces:**
- `discoverRuntimes(options?: { includeWsl?: boolean }): Promise<RuntimeDiscoveryResult>`
- `probeRuntimePath(path: string): Promise<RuntimeInstallation>`
- Result records use stable `productId`, `source`, `status`, optional `version`, optional `path`, optional `distribution`, optional sanitized `error`; no credentials or arbitrary env.
- Initial supported product IDs are `echoflow-agent`, `claude-code`, and `codex`; DeepSeek is represented by the existing DeepSeek status service, not probed as a CLI. Do not claim these are executable backends for EchoFlow sessions.

- [x] **Step 1: Add tests for empty and successful native discovery**

Inject PATH lookup and spawn behavior. Assert unknown/missing commands produce an empty/`not-found` result, and known Claude/Codex executable names produce product-specific entries with normalized version and source. Include EchoFlow bundled as a separately identified product entry, not a PATH binary.

- [x] **Step 2: Add tests for subprocess failure containment**

Assert nonzero exit, malformed output, spawn error, timeout, and oversized stdout/stderr become per-installation error states and do not reject the entire discovery result. Assert timed-out children are killed and output is capped.

- [x] **Step 3: Add path validation tests**

Cover relative path, control characters, nonexistent path, directory, non-executable file, platform-incompatible executable, and a valid executable. Validate with filesystem APIs before launching a fixed version probe.

- [x] **Step 4: Run the new service test and verify red**

Run: `cd desktop && bun test electron/services/runtimeDiscovery.test.ts`
Expected: FAIL because the service and its contract do not exist yet.

- [x] **Step 5: Implement the minimum native discovery service**

Use `where.exe`/PATH handling on Windows and `which`-free PATH directory lookup where possible; use filesystem checks against PATH entries rather than shelling out to discovery commands. Launch only known executable paths with fixed version arguments, no shell, minimized environment, timeout, bounded output, and explicit child cleanup. Keep probing one product failure independent from others.

- [x] **Step 6: Run focused tests**

Run: `cd desktop && bun test electron/services/runtimeDiscovery.test.ts`
Expected: PASS for native discovery, path validation, sanitized failures, and process cleanup.

### Task 2: Add read-only WSL discovery

**Files:**
- Modify: `desktop/electron/services/runtimeDiscovery.ts`
- Test: `desktop/electron/services/runtimeDiscovery.test.ts`

**Interfaces:**
- `discoverRuntimes({ includeWsl: true })` returns WSL discoveries as installations tagged with `source: 'wsl'` and the exact distro name.
- On non-Windows, WSL returns `not-applicable` and does not spawn a process.

- [x] **Step 1: Add WSL parsing and distro tests**

Test WSL absent, command failure, no distributions, valid distro output (including CRLF and UTF-16LE where `wsl.exe --list --quiet` emits it), duplicate names, empty names, and distro names containing shell metacharacters. Invalid names must never become shell fragments.

- [x] **Step 2: Add per-distro probe tests**

Assert the service uses `wsl.exe` with fixed argv and a fixed shell script, no user-provided command text, and a bounded timeout per distro. Missing Claude/Codex in one distro must not hide another distro's successful result.

- [x] **Step 3: Run focused tests and verify red**

Run: `cd desktop && bun test electron/services/runtimeDiscovery.test.ts`
Expected: WSL-specific tests fail before implementation.

- [x] **Step 4: Implement WSL enumeration/probes**

Run WSL enumeration only on Windows. Parse distribution names, validate/normalize them, then invoke one fixed read-only script per distribution to check known executable locations and versions. Never run login shells or read user startup scripts; do not install, update, modify distro files, or claim a Linux path is a Windows executable.

- [x] **Step 5: Run focused tests**

Run: `cd desktop && bun test electron/services/runtimeDiscovery.test.ts`
Expected: PASS for Windows WSL fixtures and non-Windows no-op behavior.

### Task 3: Expose discovery through constrained Electron IPC

**Files:**
- Modify: `desktop/electron/ipc/channels.ts`
- Modify: `desktop/electron/ipc/capabilities.ts`
- Modify: `desktop/electron/main.ts`
- Test: `desktop/electron/ipc/capabilities.test.ts`
- Modify: `desktop/electron/services/runtimeDiscovery.test.ts` only if IPC handler logic is extracted for testability

**Interfaces:**
- IPC `runtimeDiscoveryGet` accepts no payload and returns discovery result.
- IPC `runtimeDiscoveryProbePath` accepts exactly one bounded absolute file path and returns a validated installation result; no command, args, env, or product ID is accepted from renderer.

- [x] **Step 1: Add IPC validator tests**

Reject strings, objects with extra fields, relative paths, empty paths, paths over the chosen bound, NUL/control characters, and non-string payloads; accept a well-formed absolute path. Keep no-payload discovery strict.

- [x] **Step 2: Run the IPC tests and verify red**

Run: `cd desktop && bun test electron/ipc/capabilities.test.ts`
Expected: new channel and validator tests fail before registration.

- [x] **Step 3: Register narrow channels and handlers**

Register handlers using the shared `registerHandler`/capability guard pattern. Use the native open-file dialog to choose a file only if it can return a path without accepting arbitrary renderer input; then call the same backend validation path. Do not add an IPC API that lets the renderer provide shell arguments or executable launch options.

- [x] **Step 4: Run IPC tests**

Run: `cd desktop && bun test electron/ipc/capabilities.test.ts`
Expected: PASS including invalid input rejection.

### Task 4: Wire existing Desktop Host and renderer types

**Files:**
- Modify: `desktop/src/lib/desktopHost/types.ts`
- Modify: `desktop/src/lib/desktopHost/electronHost.ts`
- Modify: `desktop/src/lib/desktopHost/browserHost.ts`
- Test: `desktop/src/lib/desktopHost/electronHost.test.ts`
- Test: `desktop/src/lib/desktopHost/contract.test.ts`

**Interfaces:**
- Add `runtimeDiscovery.list(): Promise<RuntimeDiscoveryResult>` and `runtimeDiscovery.probePath(path: string): Promise<RuntimeInstallation>` under the existing host interface; use exported shared types, not duplicate UI-only shapes.
- Browser host rejects with its existing explicit unsupported-capability error.

- [x] **Step 1: Add host contract tests**

Assert Electron host invokes only the new channels with exact payloads; assert Browser host reports unsupported and never returns fabricated discoveries.

- [x] **Step 2: Run tests and verify red**

Run: `cd desktop && bun test src/lib/desktopHost/electronHost.test.ts src/lib/desktopHost/contract.test.ts`
Expected: fail until runtimeDiscovery methods are exposed.

- [x] **Step 3: Wire typed host methods**

Add the methods to host types and both hosts. Reuse shared discovery result types and preserve the narrow IPC boundary.

- [x] **Step 4: Run host tests**

Run: `cd desktop && bun test src/lib/desktopHost/electronHost.test.ts src/lib/desktopHost/contract.test.ts`
Expected: PASS.

### Task 5: Build Runtime Management UI around products and installation instances

**Files:**
- Modify: `desktop/src/pages/settings/RuntimeSettings.tsx`
- Modify: `desktop/src/i18n/locales/{en,zh,zh-TW,jp,kr}.ts`
- Test: `desktop/src/__tests__/generalSettings.test.tsx`

**Interfaces:**
- The UI calls `host.runtimeDiscovery.list()` and `probePath()`; existing Claude `getClaudeCode/setClaudeCode/chooseClaudeCode` and DeepSeek lifecycle APIs remain in place and retain their current behavior.
- “Detected” and “Supported for EchoFlow task execution” are distinct states; this phase only reports discovery and the current Claude/DeepSeek existing lifecycle.

- [x] **Step 1: Add UI tests for catalog and installation rendering**

Mock EchoFlow bundled, native Claude, Codex, WSL Claude, and DeepSeek status results. Assert product, source, version, path/distro, and status are displayed accurately; assert Codex/WSL discoveries are labeled detected only, not selectable for sessions.

- [x] **Step 2: Add UI tests for refresh, per-source errors, and path selection**

Assert refresh reloads entries, one failed probe leaves other cards visible, user path selection calls backend validation, invalid paths show errors, and no discovery action calls `setClaudeCode` or changes the current session runtime.

- [x] **Step 3: Run focused UI test and verify red**

Run: `cd desktop && bun test src/__tests__/generalSettings.test.tsx`
Expected: new runtime-manager assertions fail before UI work.

- [x] **Step 4: Implement runtime catalog presentation**

Add the discovery section to the existing Runtime settings page. Keep current Claude Code executable selection under a clearly labeled compatibility section; keep DeepSeek's existing controls in its own card. Add explicit user-triggered “check WSL” so potentially slow distro probing does not block initial page rendering. Do not add runtime selection or task dispatch controls.

- [x] **Step 5: Localize and run UI tests**

Update all five locales for source, version, detected/unsupported, WSL, select path, refresh, and failure states. Run: `cd desktop && bun test src/__tests__/generalSettings.test.tsx`
Expected: PASS.

### Task 6: Documentation, compatibility and full verification

**Files:**
- Modify: `docs/desktop/settings.md`
- Tests: `desktop/electron/services/claudeCodeRuntime.test.ts`, `desktop/electron/services/deepseekHarnessRuntime.test.ts`, relevant UI and host tests

**Interfaces:**
- Existing Claude Code config schema, IDs, environment key, session behavior, and DeepSeek sidecar data root remain unchanged.
- No data migration should be needed because user-selected paths are probed on demand and are not persisted in this release.

- [x] **Step 1: Document management behavior and explicit limits**

Explain native/WSL/custom-path discovery, source-specific actions, and that detection is not EchoFlow execution support. State that SDK is internal, external CLI installation remains user/vendor-managed, WSL probes are read-only, and 0.5.7 does not switch sessions.

- [x] **Step 2: Verify compatibility tests**

Run: `cd desktop && bun test electron/services/claudeCodeRuntime.test.ts electron/services/deepseekHarnessRuntime.test.ts electron/ipc/capabilities.test.ts src/lib/desktopHost/electronHost.test.ts src/lib/desktopHost/contract.test.ts src/__tests__/generalSettings.test.tsx`
Expected: PASS; old Bundled/Installed config and DeepSeek lifecycle contracts unchanged.

- [x] **Step 3: Run desktop static checks**

Run: `cd desktop && bun run lint`
Expected: PASS with TypeScript and ESLint clean.

- [x] **Step 4: Run repository checks**

Run: `bun run check:policy && bun run check:desktop`; if native packaging exact-path dependencies are touched and `change-policy` selects desktopNative, also run `bun run check:native`.
Expected: PASS. Then run `bun run verify` before claiming release-ready.

- [x] **Step 5: Review diff and user work**

Run `git diff --check`, inspect only runtime-management paths, and confirm pre-existing plugin, session archive, Android, account/docs, and other uncommitted work remains untouched. Do not stage, commit, tag, or edit version/release notes.

### Explicit Exclusions

- No session or Team Runtime switching, no Runtime task dispatch, no Agent scheduling, and no claim that discovery equals execution support.
- No auto-install/update of user/system/WSL third-party CLIs; keep DeepSeek's existing app-managed lifecycle unchanged.
- No SDK install/management UI; SDK dependencies remain owned by EchoFlow's build.
- No arbitrary executable launch arguments, environment passthrough, disk-wide recursive scanning, or command-string interpolation.
- No migration or renaming of Claude runtime IDs/config/env keys, and no changes to Team plan persistence.
- If repository evidence shows an extra persisted inventory is required, stop before adding it and revise the design/plan to include migration, frozen old fixture, unknown-field preservation, backup behavior, and `bun run check:persistence-upgrade`.

---

<a id="plans-2026-10-echoflow-runtime-preparation"></a>

## EchoFlow Agent Runtime Identity and Management Plan

来源：`plans/2026-10-echoflow-runtime-preparation.md`。

**Goal:** Make 0.5.7 runtime management accurately present EchoFlow’s bundled Agent as its own shipped runtime product, while distinguishing the installed Claude Code executable and preserving current execution behavior.

**Architecture:** The product may call its shipped execution product EchoFlow Agent Runtime, but the code/flow evidence must remain explicit: this is independent as EchoFlow’s shipped product/executable, not an independently authored Harness implementation. `Bundled` launches EchoFlow’s packaged CLI entry into the Claude Code-derived runtime; `Installed` selects an external Claude Code executable. These are two executable sources in the current Claude-derived execution family, not two Harnesses and not a Codex-style runtime registry. DeepSeek Harness is a separately managed sidecar and is not session/Team dispatch today. This release corrects the management model/copy and tests selection semantics; it does not claim independent Harness implementation or multi-Harness task execution.

**Tech Stack:** TypeScript, React, Electron IPC, Bun/Vitest, existing runtime services and test fixtures.

**Spec:** `docs/_internal/archive/planning/runtime-platform.md#specs-2026-10-echoflow-multi-runtime-agent-platform-design`

### Global Constraints

- Product name: **EchoFlow Agent Runtime** for the bundled EchoFlow-shipped execution product; expose code lineage accurately in explanatory/help text.
- Installed means an external Claude Code executable. Bundled and Installed are source choices for the existing Claude-derived path, not distinct Harness families.
- DeepSeek Harness remains a separately managed sidecar; do not imply it can run EchoFlow sessions or Team workers.
- Preserve runtime IDs (`bundled`, `installed`), config path `claude-code-runtime.json`, environment key `ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG`, and compatibility behavior.
- Keep provider/model selection separate from runtime executable selection.
- Do not claim Codex or DeepSeek Harness is a Team/session backend unless a real task integration exists and is tested.
- Do not alter release version/tag, stage, or commit; unrelated user changes are present.
- Do not change root upstream-derived `src/` except a proven minimal propagation bug with matching regression coverage.

### Review Focus

- Bundled option is presented as EchoFlow Agent Runtime; installed option is clearly identified as Claude Code executable.
- The UI does not imply Bundled is a clean-room, Claude-independent Harness or that Installed means Codex/any CLI.
- Selecting `installed` remains disabled until a valid executable is configured and preserves absolute-path/executable validation.
- Old config and sessions using `bundled | installed` continue to load without migration or data loss.
- Provider/model choice does not silently change when runtime source changes.
- Team workers use the intended executable source and retain isolated provider credentials/model routing.

---

### File Structure

- `desktop/src/pages/settings/RuntimeSettings.tsx`: present the bundled EchoFlow Agent Runtime identity, clarify installed Claude Code as an executable source, and distinguish DeepSeek sidecar lifecycle from session execution without changing backend behavior.
- `desktop/src/i18n/locales/{zh,en,zh-TW,jp,kr}.ts`: clarify first-party bundled runtime vs installed Claude Code wording.
- `desktop/src/__tests__/generalSettings.test.tsx`: extend the existing Runtime settings UI test to pin product naming and preserve Bundled/Installed selection behavior.
- `desktop/electron/services/claudeCodeRuntime.ts` and tests: leave config schema/IDs intact; only modify if the first-party identity needs a non-breaking display metadata surface.
- `src/server/services/teamPlanRuntime.ts`: only if the focused worker regression proves the parent-selected Claude CLI executable is dropped.
- `src/server/services/conversationService.teamWorkers.test.ts`: verify executable selection propagation and provider/model isolation with existing fixture CLI processes.
- `docs/desktop/settings.md`, `docs/start/models.md`, `docs/internals/agent.md`: accurately document product identity, implementation lineage, and what is/isn't a dispatchable backend.

### Task 1: Confirm runtime identity and management scope

**Files:**
- Read: `desktop/src/pages/settings/RuntimeSettings.tsx`
- Read: `desktop/electron/services/claudeCodeRuntime.ts`, `desktop/electron/services/deepseekHarnessRuntime.ts`
- Read: `src/server/services/conversationService.ts`, `src/server/services/teamPlanRuntime.ts`
- Read: corresponding Electron and Team-worker tests

**Interfaces:**
- Existing `ClaudeCodeRuntimeId = 'bundled' | 'installed'` and config contract remain unchanged.
- Existing DeepSeek Harness lifecycle stays separate from Team/session dispatch.

- [x] **Step 1: Record what each existing runtime entry actually does**

Confirm `bundled` resolves to EchoFlow’s packaged CLI entry but runs the Claude Code-derived QueryEngine/session path; `installed` resolves to a user-selected Claude Code executable; DeepSeek is separately started as an isolated sidecar and is not passed to `ConversationService.startSession` or Team worker launch. Record these as distinct product/runtime concepts.

- [x] **Step 2: Confirm technical lineage and external naming obligations**

Use repository instructions and available official package/product documentation. Record separately: product owner/name, implementation lineage, executable identity, licensing review status. Do not call the bundled runtime clean-room or independent-source code.

- [x] **Step 3: Fix the exact 0.5.7 product language**

Use the distinction: “EchoFlow Agent Runtime (Bundled)” = EchoFlow-shipped product runtime, with Claude Code-derived implementation lineage; “Claude Code (Installed)” = externally installed executable. Explain that Bundled/Installed changes executable source within the current execution family; it does not select Codex/DeepSeek or switch model provider. Identify DeepSeek as separately managed and not currently dispatchable by EchoFlow sessions.

### Task 2: Add UI regression tests before changing runtime labels

**Files:**
- Test: `desktop/src/__tests__/generalSettings.test.tsx` (already renders RuntimeSettings and tests the installed selection flow)
- Modify: `desktop/src/pages/settings/RuntimeSettings.tsx` only after tests fail for desired labels
- Modify translations: `desktop/src/i18n/locales/{zh,en,zh-TW,jp,kr}.ts`

**Interfaces:**
- UI continues calling existing `runtime.getClaudeCode()`, `runtime.setClaudeCode('bundled' | 'installed')`, and `runtime.chooseClaudeCode()` host APIs.
- No IPC channel, persisted ID, config filename, or executable resolver changes.

- [x] **Step 1: Add visible product-identity tests**

Test that the bundled option is labeled EchoFlow Agent Runtime, the alternative names Claude Code (Installed), and the DeepSeek card is clearly a separate managed Harness rather than a session selector. Assert existing IPC still receives `bundled` or `installed` when each source is selected.

- [x] **Step 2: Run the focused UI test and verify red**

Run: `cd desktop && bun test src/__tests__/generalSettings.test.tsx`.
Expected: identity assertions fail against current labels while IPC behavior assertions reflect current behavior.

- [x] **Step 3: Change only user-facing labels and descriptions**

Update RuntimeSettings and all required locale values. Identify the bundled product as EchoFlow Agent Runtime, name the external choice Claude Code (Installed), and include a concise lineage clarification without presenting these source choices as two different vendor Harnesses.

- [x] **Step 4: Verify UI and locale tests**

Run: `cd desktop && bun test src/__tests__/generalSettings.test.tsx`
Expected: PASS; no runtime config or IPC behavior changes.

### Task 3: Preserve configuration and executable compatibility

**Files:**
- Test: `desktop/electron/services/claudeCodeRuntime.test.ts`
- Test: `desktop/src/lib/desktopHost/electronHost.test.ts`
- Modify production config only if a regression is found

**Interfaces:**
- Keep `ClaudeCodeRuntimeId` values, `ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG`, and existing schema version 1.

- [x] **Step 1: Add or confirm compatibility assertions**

Confirm existing tests pin the missing-config default to bundled, installed path validation, invalid config handling, and the IPC contract that accepts only the runtime ID (never a renderer-supplied executable path). Add a regression assertion only for any uncovered behavior.

- [x] **Step 2: Run config and IPC tests**

Run from repo root: `bun test desktop/electron/services/claudeCodeRuntime.test.ts desktop/electron/ipc/capabilities.test.ts desktop/src/lib/desktopHost/electronHost.test.ts`
Expected: PASS without persistence migration.

### Task 4: Test and correct Team worker executable inheritance

**Files:**
- Test: `src/server/services/conversationService.teamWorkers.test.ts`
- Modify only if required: `src/server/services/teamPlanRuntime.ts`

**Interfaces:**
- Reuse `ConversationService.getSessionCliRuntimeId(parentSessionId)` and `SessionStartOptions.cliRuntimeId`.
- Team plan `runtime.providerId/modelId/effortLevel` remains model routing, not Harness selection.

- [x] **Step 1: Add a fixture regression for an installed parent runtime**

In the existing independent fixture CLI process test, set the parent session's `cliRuntimeId` to `installed`; assert each Team worker's `startSession` receives the same CLI runtime ID, while provider/model/effort and per-worker credentials remain as individually approved.

- [x] **Step 2: Run the test and confirm current behavior**

Run: `bun test src/server/services/conversationService.teamWorkers.test.ts`
Expected: the new assertion reveals whether the parent's runtime selection is currently lost. Do not edit production code before observing the result.

- [x] **Step 3: Fix only a confirmed omission**

If the assertion fails, pass `conversationService.getSessionCliRuntimeId(plan.sessionId)` as `cliRuntimeId` when starting each worker. Do not persist a duplicate runtime field in Team plan records. If it passes, make no production change.

- [x] **Step 4: Verify worker routing and isolation**

Run: `bun test src/server/services/conversationService.teamWorkers.test.ts src/server/services/teamPlanRuntime.test.ts src/server/services/teamPlanService.test.ts`
Expected: PASS for provider/model routing, worker environment isolation, barrier rollback, and stop behavior.

### Task 5: Document the runtime boundary and run release checks

**Files:**
- Modify: `docs/desktop/settings.md`
- Modify: `docs/start/models.md`
- Modify: `docs/internals/agent.md`
- Test lane: `bun run check:agent-flow`

**Interfaces:**
- Docs describe the product-facing name without renaming internal compatibility IDs.
- Existing Agent flow and Team worker contracts remain unchanged except confirmed `cliRuntimeId` propagation.

- [x] **Step 1: Update user and developer documentation**

Explain that EchoFlow Agent Runtime is the EchoFlow-shipped bundled product, whose current execution path is Claude Code-derived; Installed selects an external Claude Code executable; DeepSeek Harness is independently managed and is not currently dispatched by EchoFlow sessions/Team workers; provider/model selection is separate.

- [x] **Step 2: Run the affected quality checks**

Run: `bun run check:server && bun run check:agent-flow && bun run check:policy`
Expected: PASS. Then run `bun run verify` before claiming release-ready.

- [x] **Step 3: Inspect release-scope cleanliness**

Run `git diff --check`, inspect only task-related paths, and confirm unrelated session archive, plugin marketplace, Android protocol, docs/account, and strategy changes remain untouched. Do not stage, commit, tag, or edit version/release notes.

### Explicit Exclusions

- No claim that the current bundled CLI is a Claude-independent Harness; it is EchoFlow-shipped but Claude Code-derived.
- No Codex task adapter, DeepSeek task API bridge, generic Harness registry, runtime marketplace, unified transcript, or cross-runtime session migration in this release-preparation plan.
- No rewrite or re-license of the bundled Claude Code-derived runtime.
- No renaming of internal config IDs, env keys, persisted session fields, or compatibility paths.
- No open-core boundary decision; licensing/provenance audit remains a separate commercial-release gate.
- If user intent is to ship Codex/DeepSeek as actual EchoFlow Agent task executors in 0.5.7, stop and expand scope only after official API, permission, lifecycle, packaging and licensing evidence is reviewed.

---

<a id="specs-2026-10-echoflow-multi-runtime-agent-platform-design"></a>

## EchoFlow 多运行时 Agent 平台：长期方向设计

来源：`specs/2026-10-echoflow-multi-runtime-agent-platform-design.md`。

> 状态：设计稿，待用户评审。本文确定产品与架构方向，不授权实现或改变现有许可。
> 日期：2026-10-08

### 1. 目标与边界

EchoFlow 的长期目标是成为一个由 EchoFlow 自己定义 Agent 产品、并可调用不同底层 Harness 的平台，服务多个用户群体，而非仅限开发者。它需要让用户从目标出发，获得可检查、可交接、可恢复的任务结果；运行时是执行底座，不是产品身份。

这不是“第一版同时服务所有人”。平台方向可以横向，产品投入必须纵向分阶段：先验证可复用的共性，再按证据选择群体和任务做深。不同群体的入口、专业流程和交付物可以不同；权限、任务生命周期、执行器适配、结果检查等基础能力尽量复用。

本计划不预设科研、教育、编程、办公任一群体先胜出，不假设多运行时天然产生商业优势，也不把开源/闭源边界当作商业模式本身。

### 2. 产品论点

**EchoFlow 提供自己的任务型 Agent；Agent 负责组织工作和交付，官方 Harness 负责其擅长的执行。**

EchoFlow Agent 不只是 persona、提示词或工具列表。每个可发布的 Agent 应有：

- 目标用户与可描述的工作任务；
- 必要输入、上下文来源和数据边界；
- 可执行步骤、人工介入条件与失败处理；
- 可交付产物及可检查的完成标准；
- 运行时能力要求及不满足时的降级/拒绝规则；
- 代表性任务及评测记录。

EchoFlow 的产品责任止于明确的任务合同：它解释做什么、分配执行、维护任务状态、收集证据并呈现结果。底层 Harness 保留自己的模型循环、原生工具、完整会话和内部上下文管理。EchoFlow 不承诺跨运行时无损迁移 transcript 或完全相同的工具、权限与恢复语义。

### 3. 用户与市场策略

#### 3.1 多群体作为长期覆盖，而非同时交付

候选群体开放，包括开发者/软件团队、研究人员与课题组、办公/运营人员、教育工作者及其他有重复任务的人群。每个候选场景以同一张机会卡评估：

1. 使用者、预算持有人和采购/决策路径分别是谁；
2. 当前流程、发生频率、耗时和失败成本；
3. 输入是否可得、输出是否可验证；
4. 数据敏感性、合规要求和部署约束；
5. 原生模型/Harness/垂直软件为何未解决；
6. 谁会重复使用，谁愿意付费，获客成本和服务负担如何；
7. EchoFlow 的多运行时或本地执行是否带来可量化增益。

不以兴趣表达、下载量、Agent 数或连接器数量作为需求证明。优先观察真实工作、试用真实输入，并争取付费试点/预算承诺。不得把单一群体的验证外推成其他群体也成立。

#### 3.2 平台共性与垂直差异

共性平台层负责任务生命周期、项目/工作区引用、执行器路由、审批记录、事件来源、产物、验证证据与恢复入口。垂直 Agent 层负责专业术语、输入采集、步骤、领域规则、模板、输出格式和特定验证器。

如多个场景的流程、权限和数据模型实质不同，应允许独立的 Agent 产品体验，不强求所有场景压入一个通用工作流或同一 UI。共享核心以实际重复出现的机制为边界，而非以“未来可能统一”为理由提前抽象。

### 4. 多运行时架构原则

#### 4.1 控制面与执行面

- **EchoFlow 控制面**：Agent 与任务定义、路由决策、工作区边界、用户可见权限状态、运行记录、事件来源、产物和验收。
- **Runtime Adapter**：负责具体 Runtime 的发现/预检、启动、事件转换、原生 ID 关联，以及该 Runtime 实际支持的操作。
- **Harness 执行面**：模型循环、原生工具和权限语义、完整会话、内部恢复机制。

不得将 provider/model 与 runtime 选择混为一谈：前者回答“调用哪种模型/供应商”，后者回答“由哪个执行环境运行 Agent”。一个 Runtime 可使用多个 provider/model；产品持久化需分别表示或引用两者。

#### 4.2 最小任务契约

第一版只在真实垂直切片需要的范围内定义任务合同：任务标识、Agent/任务版本、输入和工作区引用、验收条件、执行器选择、生命周期状态、来源可追踪的事件、结果/错误、产物引用和原生运行时引用。运行时专属字段作为 adapter 私有数据或带来源的事件保留，避免把单一 Harness 的 session/tool schema 变成 EchoFlow 的持久化合同。

能力以显式声明处理：可发现、可启动、事件流、工作区控制、人工审批、取消、恢复、用量/成本、产物导出等。缺省为不支持；不支持的能力不得在 UI 中暗示可用。任务要求高于 adapter 能力时，拒绝路由或请求用户改变任务边界，不静默降级。

#### 4.3 适配级别

- **实验接入**：开发者手动配置，能启动并记录退出/错误；不宣传为生产支持。
- **受支持执行器**：版本/平台预检、输入边界、事件/状态、停止行为和产物路径有确定测试；任务可以安全失败。
- **深度集成**：只有 Runtime 有可靠接口且用户需求证明有价值时，才提供会话继续、细粒度审批、恢复、成本计量等深度能力。

此分级是内部发布/支持标准，不一定需要立即向终端用户增加复杂的兼容性界面。

#### 4.4 隔离、权限与并行

宿主不得仅凭 prompt 声称安全。每个写任务需明确工作区；多个写 Agent 不得在同一工作树无协调地并发修改。优先采取隔离 worktree/副本、由一个集成步骤审阅合并。只读任务可先并行。

EchoFlow 按任务声明权限边界，并检查 adapter 是否能落实。无法控制工作区、网络、工具权限或人工审批的 Runtime，只能承接相应风险允许的任务。宿主凭据不得无必要地暴露给子进程；各 Runtime 的凭据与授权方式遵循供应商接口和产品安全审查。

取消含义必须准确：优雅取消、会话级取消、进程终止、无法取消需等待，分别呈现；不可把杀进程伪装成成功取消。恢复与跨 Runtime 继续任务以 EchoFlow 保存的任务状态/产物重新执行为主，不承诺迁移原生会话。

### 5. 上游与代码所有权

在现有产品路径仍依赖 Claude Code 时，可继续按仓库既有上游同步流程维护该路径。新产品层和多 Runtime 工作应尽可能落在 EchoFlow 拥有的服务/适配边界，不向上游派生 runtime 深度写入产品逻辑。只有替代路径覆盖实际使用且通过可靠性门槛后，才决定冻结、隔离或退役原路径；不把“换 Harness”当作自动停止上游维护的依据。

商业发布或重新许可前，逐项审查代码来源、贡献者授权、第三方依赖/资源和各 Runtime 的 SDK/CLI 许可及再分发条款。根目录许可证声明不能自动证明所有上游派生代码均可按同一许可再分发。此项需法律专业意见；本文不作法律结论。

### 6. 开源与商业化边界

许可策略后置于权利审查和用户验证。可评估的原则是：对外开放有助于信任、可扩展或本地部署的基础能力；收入围绕经验证的持续价值，例如专业 Agent/工作流维护、组织策略与管理、部署支持、更新服务或托管能力。不得仅以隐藏 prompt 或限制基础运行功能作为默认收费逻辑。

开源与商业可并存，但须回答：用户为何持续付费、开放代码是否影响该收入、闭源组件是否能被有效运营/交付、用户是否可在本地自助复现全部价值、许可义务是否允许计划中的分发方式。未回答前，不切割现有产品，也不改变已发布版本的许可承诺。

### 7. 分阶段路线图与阶段门

阶段按证据推进，不以日历承诺代替结果。每阶段可以继续、缩小、转向或停止。

#### Phase 0 — 事实与风险基线

**产出**：现有 EchoFlow Agent/Team/Workflow/Session 路径图；候选 Runtime 的官方集成接口、限制、条款、安装与升级评估；代码来源与许可审计清单；跨群体机会卡与访谈提纲。

**通过门**：清楚区分当前已有能力、上游依赖、EchoFlow 自有能力和未知权利/接口事项；没有把未经核实的能力写入商业承诺。权利问题未明时，商业分发相关决策暂停。

#### Phase 1 — 跨群体问题发现

**产出**：从至少数个不同群体采集真实工作流程和失败案例，形成可比较的任务候选集、买家/使用者地图和初步成本价值模型。具体样本量及时间预算在实施计划中按可接触用户数确定。

**通过门**：至少一个任务有真实发生证据、明确用户和预算影响、可获得输入及可验收输出；至少另一类群体保留为对照，避免早期偏见。没有明显候选时继续发现，不先铺 Agent。

#### Phase 2 — 单 Agent 任务闭环

**产出**：挑选一个代表性任务，使用现有稳定执行路径实现 EchoFlow 自有 Agent 的端到端闭环：输入、执行、人工介入、产物、验证和复盘。暂不大规模多 Runtime，也不需要专用新 UI 系统。

**通过门**：相对用户直接使用底层 Harness/当前手工流程，在预先定义的用户指标上有明确改善；失败能够解释，权限边界可验证，用户愿意再次用。若 Agent 只是输出更顺眼或 prompt 能复制出同等结果，不认定通过。

#### Phase 3 — 第二个异构 Runtime 试点

**产出**：选择在真实任务中能带来增益的第二 Runtime，先作为受限 worker 或独立执行器接入；完成启动、事件、停止/终止、工作区隔离、错误和产物闭环。必要时仅在 EchoFlow 自有 server/service 边界做最小契约，不重做主会话。

**通过门**：第二 Runtime 相较第一个带来实测任务质量、可用性、策略符合度或商业成交增益；适配、测试、支持的边际成本可控。若只是增加兼容列表，暂停扩展。

#### Phase 4 — Agent 编排与可复用产品核心

**产出**：当单 Agent 与异构执行器试点均证明收益后，抽取共同任务编排机制：依赖、任务交接、隔离并行、整合、验收、人工接管。开发第二个不同群体/任务的 Agent，以检验哪些核心真正通用。

**通过门**：共享核心降低了交付第二个 Agent 的成本而未迫使垂直工作流失去效果；跨 Runtime 任务可追踪、可恢复、权限语义诚实；至少两个独立任务/用户群存在真实复用需求。

#### Phase 5 — 产品化与商业模式

**产出**：根据实际付费方选择个人、高级 Agent、团队订阅、组织管理、私有部署/支持或托管服务中的一项/少数几项验证；准备支持策略、更新兼容、数据流说明、渠道和单位经济模型。商业版本可先小规模付费试点，不预先铺全套计费系统。

**通过门**：有重复使用和实际付费/采购承诺；成功任务的收入覆盖模型/运行时/支持/维护成本并留有合理空间；供应商变动和用户迁移有应对方案。

#### Phase 6 — 开源边界与平台扩展

**产出**：依据权利审查、采用数据和商业证据确定开源/商业边界；公开稳定的扩展契约（如确有第三方需求）；增加运行时和 Agent 分发渠道。

**通过门**：新的公开 API/市场/治理能力有真实使用者和可持续维护人力；新 Runtime 的增量价值大于适配与支持成本。否则保持小型集成集合，不做通用市场。

### 8. 衡量体系

不以 Agent 数、Runtime 数、模型数或功能提交数作为北极星。按阶段衡量：

- **发现**：任务发生频率、当前耗时/返工、预算负责人确认的问题；
- **结果**：首次成功率、验收通过率、人工接管/返工时间、失败恢复率、总耗时；
- **产品**：重复任务使用、跨任务复用、用户保留/带走产物的比例；
- **多 Runtime 增量**：第二 Runtime 带来的可完成任务/质量/成交变化，扣除安装、维护和支持成本；
- **商业**：付费试点转化、重复付费、每个成功交付的收入和变动成本、支持成本；
- **安全/信任**：越权或隔离失败、错误显示取消/恢复、数据流认知偏差，目标为零容忍事件并进行人工复盘。

具体基线和数值阈值在 Phase 0/1 之后按用户任务定义，不能先编造通用目标数字。

### 9. 明确不做

- 不从头开发通用 Harness，除非官方底座都无法满足已验证的关键产品需求。
- 不预先统一所有 transcript、原生会话、工具事件或权限模型。
- 不同时发布多个未验证的垂直 Agent 套件。
- 不以支持 Runtime 数量、市场上架数量或 prompt 数量代表产品进展。
- 不在权利与许可未审查前重许可现有上游衍生代码或做商业分发承诺。
- 不先建设大型 Agent 市场、计费平台、云端调度系统或企业治理套件。
- 不为了“所有群体”牺牲每个任务的边界、验收和真实用户体验。

### 10. 当前代码库落点（规划依据，不是实现承诺）

- Team 计划当前的 runtime 字段是 provider/model/effort，成员启动仍通过 `conversationService.startSession()`；它不是多 Harness 执行抽象。
- `TeamPlanRuntimeAdapter` 是 Team Plan 服务的可注入执行边界，可作为现有模式参考，但当前默认实现仍指向同一条 Team runtime 路径。
- `src/` 在仓库约定中属于上游衍生 Claude Code runtime；产品级 Runtime 工作应优先在 EchoFlow 自有边界实现。
- `adapters/` 已有消息平台适配器语义；不能因名字相同就把新 Harness 实现放入该模块。
- 计划先以 Team worker 做第二 Runtime 试点，是因为它比替换主会话影响面小；若 Phase 1/2 指向别的垂直切片，应调整实现入口。

这些是对现状的定向检查结果，不替代对所有调用链、持久化兼容、权限和测试面的实施前审查。

---

<a id="specs-2026-10-echoflow-runtime-management-design"></a>

## EchoFlow Runtime Management Design

来源：`specs/2026-10-echoflow-runtime-management-design.md`。

> 状态：设计稿，待评审。聚焦运行时发现与管理，不授权运行时切换或任务执行接入。
> 日期：2026-10-08

### 1. 目标

为 EchoFlow 建立一个统一的运行时管理页，让用户了解机器上有哪些可管理的 Agent 执行环境、它们来自哪里、版本和状态如何，并执行该环境确实支持的管理操作。

0.5.7 的范围是**发现、状态、安装来源管理和已有生命周期操作**。它不提供在不同 Runtime 间切换 EchoFlow 会话、不把任务派给新 Runtime，也不承诺各种 Runtime 能力相同。

长期目标可以包含 EchoFlow 自己的 Agent、当前系统安装的 CLI、WSL 中的 CLI、用户自选位置的可执行文件和 DeepSeek Harness。它们可以出现在同一个管理产品中，但来源和管理方式不同，不能压成一个“选择一个可执行文件”的模型。SDK 是产品内部实现集成的技术方式，不是普通用户要安装或管理的运行时。

### 2. 术语与当前事实

- **EchoFlow Agent**：EchoFlow 发行和管理的第一方 Agent 产品运行时。当前 bundled 入口运行的执行代码仍来源于 Claude Code 衍生实现；产品归属不等于代码从零独立创作。
- **Claude Code（系统安装）**：由用户或其他安装器放在当前操作系统中的 Claude Code CLI。
- **Claude Code（WSL 安装）**：安装在 Windows 用户指定的 WSL 发行版中的 Claude Code CLI。它属于 Linux 环境，不能当成 Windows 路径。
- **自选可执行文件**：用户明确指定的 CLI 文件路径，经验证后作为一个被发现/管理的安装实例记录。
- **DeepSeek Harness**：仓库已有的独立 Electron sidecar，有单独启动、停止、更新和数据目录；当前不接入 EchoFlow 会话或 Team worker 执行。
- **SDK**：由 EchoFlow 开发者集成的代码依赖和调用接口，不是用户安装的 Agent 程序，不作为本期运行时列表中的一类安装实例。若 EchoFlow 内部使用 SDK，版本随 EchoFlow 应用发布；除非用户需要配置的服务或凭据，否则无需给普通用户单列 SDK 管理卡。

现有设置中的 `Bundled / Installed` 只选择 Claude Code 衍生执行路径的可执行文件来源：Bundled 使用 EchoFlow 打包入口，Installed 使用用户选择的 Claude Code 可执行文件。内部 ID、配置路径和会话兼容字段是历史兼容合同；本设计不重命名或改变其执行含义。

### 3. 用户体验

管理页展示**运行时产品**及其发现到的**安装实例**，不是只展示一个全局选择器。每个实例至少包含：

- 产品名与类型（EchoFlow Agent、Claude Code、Codex、DeepSeek Harness 等）；
- 来源（EchoFlow 随包、当前系统、具体 WSL 发行版、自选路径）；
- 状态（可用、未发现、版本未知、检查失败、运行中、已停止、需要配置等）；
- 版本和位置/发行版（若能可靠取得）；
- 上次探测时间与可解释的错误提示；
- 对该来源确实支持的操作，例如重新探测、选择路径、启动、停止、重启、更新或打开。

页面不得暗示“发现即支持执行”。提示状态应区分：**已安装/可管理** 与 **已接入 EchoFlow 任务执行**。0.5.7 可管理某 Runtime，但不会因此自动使其成为 EchoFlow session/Team backend。

### 4. 安装来源与探测策略

#### 4.1 EchoFlow 随包运行时

使用已有运行时状态服务报告 bundled 版本、可用性和必要的组件状态。不得通过扫描 PATH 来判断它是否存在。显示 EchoFlow Agent 产品名，并在详情/说明中保持当前实现血缘准确。

#### 4.2 当前操作系统安装

按操作系统使用有限、已知的探测方式：PATH 搜索及该产品官方支持的标准位置。记录绝对路径、版本和探测来源。不要递归扫描整个磁盘，不要对未知候选运行任意命令。

#### 4.3 WSL 安装

只在 Windows 可用。先枚举 WSL 发行版，再在用户发起探测时，对每个已选发行版用固定、只读的命令检查产品命令是否存在及版本。结果必须带发行版名、发行版内路径和探测时间。不得自动安装、更新、修改 shell 配置或改写 WSL 文件。

WSL 没安装、WSL 命令不可用、发行版关闭或探测超时时，应作为独立状态返回；不能把 WSL 内的 Linux 路径交给 Windows 原生进程当作普通可执行路径。

#### 4.4 用户自选路径

用户通过系统文件选择器选择目标 CLI；服务端重新验证文件存在、类型、可执行权限/平台后缀，并使用产品定义的安全版本探测命令读取身份和版本。记录该实例的路径与探测结果。无效路径不得保存为可用实例。不能接受渲染进程直接传入任意 shell 命令或参数。

#### 4.5 SDK 不是用户安装项目

SDK 由 EchoFlow 应用依赖和发布流程管理，用户不需要自己发现、下载或选择“SDK 运行时”。如果某个 Agent 产品在内部通过 SDK 执行，管理页可以将它作为 EchoFlow Agent 产品的一部分显示运行状态；无需暴露 SDK 包名和开发者概念。用户需要提供凭据时，用相应产品的账户/连接设置管理，不把秘密放进运行时探测结果。

如未来希望用户自行安装某个 Runtime，优先寻找该供应商支持的 CLI/桌面应用/本地服务作为面向用户的实体；只有供应商明确把 SDK 当作可由第三方应用嵌入并负责分发、生命周期和认证的产品接口时，才在 EchoFlow 内部采用。引入仍需单独审查官方接口、条款、凭据、权限、事件、停止/恢复和维护成本。

### 5. 管理操作边界

管理操作按来源实现，不要求每种 Runtime 都支持同一组操作：

- EchoFlow bundled：报告版本/状态；更新随 EchoFlow 应用发布。
- 当前系统或自选 CLI：重新探测、打开其位置；安装/更新由原厂包管理器或用户负责，除非后续明确设计安全、官方支持的安装流程。
- WSL CLI：报告状态、发行版和路径；不自动安装/升级。打开 WSL shell 或其帮助文档可作为只读辅助操作，须明确目标发行版。
- DeepSeek Harness：复用已有独立 sidecar 的启动、停止、重启、更新操作和独立数据目录，不改变其身份或数据位置。
- SDK：由 EchoFlow 自身依赖管理，不显示“安装/启动 SDK”；如被某个内置 Agent 使用，只显示 Agent/产品运行状态。

0.5.7 **不做 Runtime 切换**：不改变主会话和 Team worker 使用哪个执行器；不添加调度器；不将可探测实例直接作为可选执行后端。现有 Claude Code Bundled/Installed 设置为兼容旧执行选择暂时保留，UI 与管理页要说明这是旧执行路径的可执行来源选择，而非新管理页的通用切换器。

### 6. 实现边界

建立由产品类型、实例来源、平台位置、版本/状态和可用管理操作组成的**管理数据模型**，而不是共用一个 `runtimeId` 选择值。采用按产品的探测/管理服务：

- 复用现有 Claude Code runtime config/resolver 及其校验，不重命名兼容 ID；
- 复用现有 DeepSeek Harness lifecycle，不把它接进 ConversationService；
- WSL 探测和原生 CLI 探测分别实现，因为进程、路径、超时、环境和权限边界不同；
- SDK 属于 EchoFlow 内部实现，不进入用户安装和探测列表；
- UI 对探测失败进行逐项展示，某一来源故障不能导致整个管理页失效。

优先以只读探测实现核心，再接入已有生命周期操作。没有真实测试覆盖的动作不展示。探测命令必须固定、限时、输出截断并清理子进程；用户指定路径属于输入边界，必须验证且不能把它拼成 shell 命令。

不在本设计中规定对所有厂商通用的执行器 API、会话格式、权限协议或任务状态模型；本期没有 Runtime 任务执行切换。

### 7. 持久化与隐私

优先从系统/配置即时探测，不保存密钥和完整环境。若需要保存用户自选路径或 WSL 发行版选择，只保存最少的稳定引用，并按 `AGENTS.md` 执行持久化兼容要求：保留未知字段、旧配置可读、需要时提供前向迁移和旧夹具测试。若不需要跨重启记住选择，则不新增持久化 schema。

探测不得上传路径、发行版名称、环境变量或凭据。日志记录产品、操作结果和可诊断错误时必须脱敏用户目录与秘密。

### 8. 分阶段实施路线

#### Phase A — 0.5.7 管理基础

- 确认现有 EchoFlow bundled/installed 以及 DeepSeek Harness 状态/操作接口。
- 明确产品名、来源类型和状态文案，保留旧设置的执行语义。
- 加入当前系统 CLI 与用户自选路径的安全探测；探测结果能区分未安装、无效路径、版本未知和探测错误。
- 对 Windows 实现 WSL 发行版枚举与只读版本探测；非 Windows 明确标记不适用。
- 用户不需要安装或管理 SDK；是否使用 SDK 由 EchoFlow 产品实现决定。
- 测试探测、错误处理、取消/超时和秘密/路径不泄露。

**通过门：**在支持平台上，EchoFlow bundled、当前系统安装、自选路径和 Windows WSL 的探测结果可区分且可解释；已有 DeepSeek 管理动作仍正常；不发生任务执行器切换、不改变旧配置、不把探测误报为执行支持。

#### Phase B — 扩充探测目录

根据用户真实需要和官方支持方式增加新 CLI/Harness 的系统、WSL 与自选位置探测。每个条目单独验证版本命令、参数和平台支持；未知产品不因文件名相似被误认。外部 Runtime 的首选体验是让用户按官方方式安装，再由 EchoFlow 探测和展示；不要自行下载/打包，除非供应商支持该分发方式且产品团队明确承担签名、更新、回滚与安全响应。

#### Phase C — SDK 作为内部实现，不作为用户安装流程

如 EchoFlow 决定通过某供应商 SDK 实现自己的 Agent，SDK 依赖和更新由应用构建管理。用户界面呈现 EchoFlow Agent 的状态与所需账户/凭据，而不是让用户安装 SDK。若 SDK 实际扩展出用户需要的外部服务配置，再在对应账户/连接设置里呈现。SDK 执行接入仍需独立设计和验证，不属于运行时安装探测。

#### Phase D — 单独决策任务执行接入

根据用户需求、官方接口与许可、安全、取消/恢复和任务测试结果，另行决定是否允许某 Runtime 执行 EchoFlow 会话/Team 任务。此决策不由 Phase A 的“探测成功”自动触发。

### 9. 验证矩阵

- 平台：Windows 原生、Windows+WSL、macOS/Linux；不支持的来源返回明确“不适用”。
- 来源：EchoFlow bundled、PATH/标准安装位置、自选路径、WSL 发行版；SDK 不作为用户安装来源。
- 状态：发现、未发现、无效、版本未知、权限拒绝、超时、进程失败、停止/运行中。
- 安全：恶意路径/参数不会被 shell 注入；超时结束子进程；日志和响应不包含 token、完整环境或未脱敏用户隐私路径。
- 兼容：旧 `bundled | installed` 配置和会话选择保持原样；没有执行选择副作用。
- 生命周期：DeepSeek 现有隔离目录、进程和启动/停止/更新语义不受影响。

### 10. 明确不做

- 不做跨 Runtime 会话切换、任务路由、Team worker 接入或多 Agent 协作改造。
- 不把 Claude Code 的 `bundled | installed` 解释成所有 Runtime 的选择器。
- 不自动安装或更新用户系统/WSL 中的 CLI；除非另有经过审查的安装设计。
- 不递归扫描磁盘或执行未知程序来“猜”它是不是 Agent。
- 不把 SDK 冒充可下载、可启动的 CLI，也不要求用户安装开发依赖。
- 不为没有实际执行集成的厂商显示“已支持 EchoFlow Agent”。
- 不迁移/改名旧运行时 ID、配置文件、环境变量或历史路径。
- 不在本项目中决定 EchoFlow 商业开源边界或重新许可现有上游衍生代码。
