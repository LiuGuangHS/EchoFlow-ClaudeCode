---
title: agent-desktop 中文开发指导
nav_title: 原生开发指导
description: 独立保存第三方原文之外的中文开发说明与适用边界。
order: 0
---

# agent-desktop 开发规范

本文是 EchoFlow 第一方维护者中文参考，不替代 `native/agent-desktop/AGENTS.md` 的上游原文和仓库根规范。下文完整保留分离前的中文指导；文中的相对路径、命令和“本文件”均指上游 `native/agent-desktop/` 目录语境，不是本页所在目录。新增命令时，上游英文命令计数与本页中文说明应分别核对。

## 原始字节与并行测试变更

`native/agent-desktop/UPSTREAM.json` 固定来源为 `vercel-labs/agent-desktop` 的提交 `9eb9b296192fcb70bda25e918cd6dd66abfa3d0d`。第三方原文不因中文参考改动；不可修改来源摘要或扩大 vendor 测试的补丁允许清单来容纳翻译。

本次分离前，两份完整文件已逐字节备份至仓库内忽略的 `artifacts/agent-desktop-zh-split-20261110/`：

- `AGENTS.md`：SHA-256 `7ce502ccb115bba6ed545e6af8943c23b421859ff53b3649edc27df084c9a5fe`。
- `doc_literal_drift_tests.rs`：SHA-256 `c912c320be0d397f1f91427cb15da9ce152ab59018d14ce103c44518e47d96e5`。

并行中文化曾在 Rust 文件添加中文修改说明，并将 `documented_command_counts_match_the_cli` 对 `AGENTS.md` 的两处断言字面量改为 `共 {total} 条命令，涵盖` 和 `macOS 可执行其中 {operational} 条`。这份完整改动保存在上述备份中；恢复来源英文文档时同步恢复对应英文断言，不删除该测试或其他测试，也不把第一方中文页注入上游测试。信封版本、ABI 和命令数量的校验继续保留。

已核对 `git show HEAD:<path>` 得到的原始字节摘要与来源记录完全一致，恢复目标为：

- `AGENTS.md`：SHA-256 `db9aef05e55896ea910d77531fb32145b94c4847a93c043868ecdd6e913c0b93`。
- `src/cli/doc_literal_drift_tests.rs`：SHA-256 `83c3f768eb04e1926499cdf6d3361f6fff0c9aa2da53331039a7a80d9ec57cca`。

以下为完整中文指导。

供在本目录工作的 AI 编程 Agent 使用。

来源：[vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop/tree/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d)，版本 1.0.2，Apache-2.0；原始文件摘要保存在 `UPSTREAM.json`，许可与归属见 `LICENSE`、`NOTICE` 和 `THIRD-PARTY-NOTICES`。
修改说明（2026-11-10）：EchoFlow 将上游指导等义翻译为中文，并明确本地适用边界；未修改原始许可证及来源记录。以下路径与命令相对于本目录。上游分支、发布、技能和未随本仓引入的站点或脚本说明仅描述上游流程，不授权在 EchoFlow 执行；本仓操作仍遵循根规范。文档、代码、测试冲突时，结合用户明确要求、已发布行为、版本历史与验证证据查明原因，不能只以当前代码和测试为准。

agent-desktop 是 AI Agent 调用的工具，不是 Agent。它是 Rust CLI 和 C 库，读取原生无障碍树，返回含引用式元素 ID 的结构化 JSON。观察—操作循环由调用方 Agent 承担。它不嵌入 LLM，没有 GUI 或交互提示，不自动操作网页（网页使用 agent-browser），也无法观察不提供无障碍树的 UI。

## 命令

每个平台适配器只能在对应 OS 编译，而工作区同时列出三个平台。因此，不限定包范围的 `cargo build`、`cargo test --workspace` 或 `cargo clippy --all-targets` 在任何主机上都会失败。应按主机选择包集合，与上游 `.githooks/pre-commit` 使用的集合一致：

```bash
HOST_PKGS=(-p agent-desktop-core -p agent-desktop-macos -p agent-desktop -p agent-desktop-ffi)
# Windows：把 agent-desktop-macos 换成 agent-desktop-windows；Linux 换成 agent-desktop-linux。
# 数组在 bash 和 zsh 中都会展开为独立参数；普通字符串在 zsh 中不会。

cargo build "${HOST_PKGS[@]}"                                  # 调试构建
cargo build --release -p agent-desktop                         # 发布 CLI；上游 CI 拒绝超过 15 MB 的产物
cargo test "${HOST_PKGS[@]}"                                   # 全部测试目标
cargo test "${HOST_PKGS[@]}" --lib                             # 仅库测试，跳过二进制 crate
cargo test -p agent-desktop                                    # 二进制 crate：CLI 契约、分发、批处理、策略
cargo test "${HOST_PKGS[@]}" <test_name>                       # 按名称运行单个测试
cargo clippy "${HOST_PKGS[@]}" --all-targets -- -D warnings    # 不允许警告
cargo fmt --all -- --check
cargo check -p agent-desktop-core --all-targets --target x86_64-pc-windows-msvc   # core 交叉编译
cargo check -p agent-desktop-core --all-targets --target x86_64-unknown-linux-gnu
cargo tree -p agent-desktop-core                               # 不得出现平台 crate
AGENT_DESKTOP_E2E_EXCLUSIVE=1 bash tests/e2e/run.sh            # macOS 端到端测试，自行构建产物
bash scripts/perf-baseline-compare.sh                          # macOS 相对合并基点的性能对比
```

`scripts/cargo-test-isolated-home.sh test "${HOST_PKGS[@]}" --lib` 使用一次性 `HOME` 运行测试，避免接触真实 `~/.agent-desktop`。上游 pre-commit hook 使用该脚本。

上游每次克隆后通过 `git config core.hooksPath .githooks` 启用 hook。暂存 Rust 或 TOML 改动时，它运行源码规则脚本（`check-rust-file-size.sh`、`check-no-phase-references.sh`、`check-stale-ref-constructor-misuse.sh`），并对主机包集合运行格式检查、clippy 和库测试。FFI 改动还运行 C ABI 透传测试与 cbindgen 头文件检查。上游文档的紧急跳过 hook 说明不构成本仓绕过检查的授权；EchoFlow 不得擅自跳过 hook。

## 事实与规范入口

- **已发布行为**由发布版本的代码和测试提供证据。文档与实现冲突是需要调查并在同一改动修正的问题；还须核对用户要求、版本历史和发布证据，不把当前代码与测试共同回退后的行为当作正确事实。
- **Agent 使用方法**在 `skills/`，会编译进二进制：`agent-desktop skills get desktop` 和 `agent-desktop skills get platform`。
- **术语**见 `CONCEPTS.md`；**JSON 契约**见 `docs/json-output.md`；**历史经验**见带 YAML 元数据（`module`、`tags`、`problem_type`）的 `docs/solutions/`。处理已有记录的领域前先搜索。
- **上游用户文档**位于 `apps/docs`，发布在 agent-browser.dev/desktop。上游要求编写或编辑页面、README、技能、变更日志、提交信息、PR 描述与 issue 时使用 `technical-writer` 技能（`.agents/skills/technical-writer/SKILL.md`）。文档同时面向开发者和调用 agent-desktop 的 Agent，应完整、简短，并核对实现；本仓未引入的入口不视为已安装能力。
- **上游计划文档**（阶段路线图 `phases.md`、子阶段计划、头脑风暴）放在上游根目录的 `.compound-engineering/`。该目录有意不跟踪，规划时按需读取；不得在已提交文件中链接或引用，因为其他检出副本没有它。
- 计划与实现冲突时，应依据发布代码查明已交付内容，直接修正计划，不附“此前写过”的说明，并引用反证：`probes/**/FINDINGS.md` 的行 ID 或源码行；在本仓仍须遵守上述冲突调查规则。

### 完成实现，不无故推迟

- 实现者负责把工作落地。“比预期困难”“PR 已经很大”“后续阶段会碰到这里”都不是推迟理由。
- 只有确实受阻才能推迟：平台不可能实现、依赖尚不存在的基础设施，或只能通过破坏已声明的不变量或安全属性实现。说明具体是哪一项。
- 推迟前先测量，用探针解决未知；基于假设的推迟只是猜测。
- 缩小范围由负责人决定。不能落地时说明并停止，不能悄悄缩减。
- 在上游开启 PR 前，将每个推迟项与迫使推迟的证据写入本地路线图的接收阶段，并在 PR 描述中列出。若改变当前阶段交付内容，也修正该阶段。

## 分支与提交

以下为上游流程，不替代 EchoFlow 根规范的操作授权和发布流程：

- 上游 `main` 同时承载 macOS、Windows、Linux。修复与功能从 `main` 分支，以 squash merge 合回；`main` 要求线性历史。
- 不添加 `Co-Authored-By`、AI 署名或“Generated with”页脚。
- 使用 Conventional Commits：`feat:`、`fix:`、`feat!:` 或 `BREAKING CHANGE:` 页脚、`docs:`、`style:`、`refactor:`、`perf:`、`chore:`、`ci:`、`test:`。格式为 `type: imperative summary`，冒号后使用小写祈使摘要，并说明原因。
- 上游版本从 1.0.0 起遵循 semver。发布 PR 同时更新 `Cargo.toml`、`Cargo.lock`、`npm/package.json` 和 `CHANGELOG.md`。合并会触发上游 `.github/workflows/release.yml` 发布 npm 与 GitHub Release；步骤见上游 `docs/releasing.md`。

## 架构

```text
crates/core/     agent-desktop-core：adapter/ 中的 PlatformAdapter trait、按领域组织的共享类型，
                 commands/ 下每条命令一个文件
crates/macos/    agent-desktop-macos：AX API
crates/windows/  agent-desktop-windows：UI Automation
crates/linux/    agent-desktop-linux：AT-SPI
crates/ffi/      agent-desktop-ffi：cdylib 及已提交的 C 头文件 include/agent_desktop.h
src/             agent-desktop 二进制：cli/、cli_args/、dispatch/、batch/、command_policy/、command_host/、
                 diagnostic/、visual_debug/
skills/          编译进二进制的 Agent 技能
 tests/          黄金 fixture、各 OS 端到端测试框架、FFI 冒烟测试
probes/          原始平台测量；FINDINGS.md 行可作为证据引用
apps/docs/       上游 Geistdocs 站点，以 Vercel Microfrontends 子应用发布于 agent-browser.dev/desktop
```

**依赖反转不可妥协。**
- Core 定义 `PlatformAdapter` 和所有共享类型；平台 crate 实现该 trait。
- Core 不导入平台 crate，平台 crate 不互相导入。`cargo tree -p agent-desktop-core` 出现平台 crate 时，上游 CI 失败。
- 只有二进制（`src/`）和 FFI crate 负责把平台接到 core。
- 平台在 `build_adapter()`（`src/main.rs`、`crates/ffi/src/adapter.rs`）中通过 `#[cfg(target_os)]` 编译期选择；`src/Cargo.toml` 使用目标条件依赖（`[target.'cfg(target_os = "macos")'.dependencies]`），不能用无条件依赖再靠源码 `cfg` 遮挡。
- `PlatformAdapter` 拆分在 `crates/core/src/adapter/`（`mod.rs` 及 `actions`、`input`、`observation`、`system` 分片）。每个方法默认返回 `AdapterError::not_supported`，适配器只实现支持的能力。严格解析（`resolve_element_strict*`）在无匹配时返回 `STALE_REF`，两个或更多匹配时返回 `AMBIGUOUS_TARGET`。
- Core 必须在所有 OS 运行。Core 中没有 CI lane 执行的 `#[cfg]` 分支只是设想，不是已交付代码：补充 lane 或移到 `PlatformAdapter` 后面。

**分发。** `src/dispatch/mod.rs` 的 `dispatch()` 直接用 `match` 调用 `crates/core/src/commands/` 中各命令的 `execute()`，没有命令 trait 或注册表。批处理不是第二套分发器：JSON 条目反序列化为同一个 `Commands` 枚举，经过相同 `CommandPolicy` 预检并调用同一个 `dispatch()`。

**新增命令。**
1. 新建 `crates/core/src/commands/<name>.rs`，包含 `execute()`，测试放在 `<name>_tests.rs`，并在 `commands/mod.rs` 注册。
2. 在 `src/cli/mod.rs` 添加 CLI 变体，在 `src/cli_args/` 添加参数。
3. 为 `dispatch()` 和 `src/command_policy/mod.rs` 的 `policy_for()` 添加分支；两个 match 都是穷尽匹配。
4. 在 `src/batch/mod.rs` 的 `parse_command()` 添加名称，否则 `every_cli_subcommand_is_known_to_batch_parser` 失败；同时更新 `src/cli/contract_command_surface_tests.rs` 的接口列表。
5. 更新 `README.md` 和本文件的命令计数；`src/cli/doc_literal_drift_tests.rs` 检查这些数字。
6. 新 `Action` 变体放在 `crates/core/src/actions/action.rs`；新适配器方法放在对应的 `PlatformAdapter` 分片，默认 `not_supported`。
7. 在同一改动中更新对应技能：跨平台行为用 `skills/agent-desktop/`，差异用平台技能，C ABI 用 `skills/agent-desktop-ffi/`。技能会编译进二进制，供 Agent 阅读。

**Crate 布局。** Core 根目录仅包含 `lib.rs` 及按 `CONCEPTS.md` 术语命名的领域目录：`actionability`、`actions`、`adapter`、`commands`、`context`、`cursor_overlay`、`input`、`locator`、`notifications`、`ref_action`、`refs`、`response`、`session`、`snapshot`、`storage`、`system`、`trace`、`tree`、`wait`。
- 平台 crate 根目录包含 `lib.rs`、`adapter.rs`（trait 实现）及五个分层目录；有辅助二进制时另有 `bin/`。`tree/` 读取、遍历和解析 UI；`actions/` 操作元素；`input/` 合成底层键盘、鼠标和剪贴板输入；`system/` 处理应用生命周期、窗口、权限和截图；`notifications/` 处理 OS 通知接口。
- 同层中一个概念达到四个或更多源码文件时，建立以共享术语命名的子目录（`resolve`、`walk`、`properties`、`select`、`scroll`、`clipboard`、`keyboard`、`mouse`、`window`、`capture` 等）。文件名保留前缀（`system/window/window_ops.rs`）；与目录同名的文件改为 `mod.rs`。
- 测试与代码相邻，命名为 `foo_tests.rs`，由 `foo.rs` 通过 `#[cfg(test)] #[path = "foo_tests.rs"] mod tests;` 声明。
- 能力实现放在 `adapter.rs` 或对应层的 `adapter.rs`。

**架构守卫。** 上游 pre-commit 与 CI 在源码规则旁运行 `scripts/check-architecture.sh`（规则在 `scripts/check_architecture.py`）。扫描前它会注入每条规则的违规样例，规则失去检测能力也会导致门禁失败。以下情况失败：core 依赖平台或 OS crate、平台 crate 相互访问、core 在允许清单外增加 OS 条件代码、crate 顶层布局漂移、能力实现错层、core 领域访问 `commands/`，或测试没有在相邻代码声明。core 依赖、core 领域、二进制目录、OS 允许清单只在评审中修改。CI 的 `cargo tree` 隔离步骤仍负责传递依赖检查。

## 编码标准

- **每个手写 `.rs` 文件最多 400 行**（`scripts/check-rust-file-size.sh`），按职责拆分。前五行含 `@generated` 的生成文件豁免，应修生成器而非输出。探针 `.ps1` 脚本豁免。C 头文件由 cbindgen 生成，CI 检查漂移：修改 Rust ABI 或 `crates/ffi/cbindgen.toml` 后用 `scripts/update-ffi-header.sh` 重建，不手改。
- **不写普通行内注释。** 通过命名表达含义。独立 `//` 行、行尾 `//` 和非文档 `/* */` 均被拒绝。只允许在名称不足以表达时给公开项写 `///`，以及 `//!` 模块文档。`scripts/check-rust-file-size.sh` 通过 `scripts/check_rust_comments.py` 一并执行注释与行数限制。
- **`crates/**` 和 `src/**` 不引用交付计划**：不写阶段、子阶段、计划决策 ID（`KTD<n>`）或计划单元 ID（`U<n>`）。写代码事实和原因；允许且鼓励引用 `A15-7` 等探针记录行 ID。由 `scripts/check-no-phase-references.sh` 检查。
- **一个文件只放一个领域 struct 或 enum**（如 `node.rs` 放 `AccessibilityNode`）；**每个命令一个文件**，按命令命名。
- **每个 struct 最多 7 个字段，每个函数最多 5 个参数。** 使用配置 struct 或 builder。
- **显式 `pub` 边界。** 只有 `lib.rs` 可重新导出；内部模块用 `pub(crate)`，禁止通配重新导出。
- **命名。** Crate 为 `agent-desktop-<name>`；模块文件为单数 `snake_case`；类型为 `PascalCase`；函数为动词开头的 `snake_case`；常量为 `SCREAMING_SNAKE_CASE`；CLI 标志为 kebab-case。

**错误。**
- 测试外不用 `unwrap()`、`expect()` 或 `panic!`；panic 仅用于测试。通过 `?` 或 match 传播错误。
- 适配器函数返回 `Result<T, AdapterError>`，命令处理器返回 `Result<serde_json::Value, AppError>`；`main()` 将 `AppError` 转为 JSON 信封及退出码。
- 错误包含 `code`（`ErrorCode`）、`message`，可选的 `suggestion`、`platform_detail`、`details`，以及交付处置状态。
- 错误码：`PERM_DENIED`、`ELEMENT_NOT_FOUND`、`APP_NOT_FOUND`、`ACTION_FAILED`、`ACTION_NOT_SUPPORTED`、`STALE_REF`、`AMBIGUOUS_TARGET`、`WINDOW_NOT_FOUND`、`PLATFORM_NOT_SUPPORTED`、`TIMEOUT`、`INVALID_ARGS`、`NOTIFICATION_NOT_FOUND`、`SNAPSHOT_NOT_FOUND`、`POLICY_DENIED`、`APP_UNRESPONSIVE`、`INTERNAL`。
- 退出码：`0` 成功，`1` 结构化错误，`2` 参数或解析错误。

## 输出契约

每条命令输出一个信封。完整契约见 `docs/json-output.md`。

```json
{ "version": "2.5", "ok": true, "command": "snapshot",
  "data": { "app": "Finder", "snapshot_id": "s8f3k2p9", "ref_count": 14, "complete": true, "tree": { } } }
```

```json
{ "version": "2.5", "ok": false, "command": "click",
  "error": { "code": "STALE_REF", "message": "...", "suggestion": "...",
             "recovery": { "strategy": "refresh_snapshot_then_retry_original", "retryable": true,
                           "requires_fresh_snapshot": true },
             "disposition": { "delivery": "not_delivered", "retry": "safe" } } }
```

- 省略 `None` 字段和空数组；紧凑模式省略边界框。`ref_count` 和 `tree` 位于 `data` 内。
- 每个快照都包含 `data.complete`。观察预算耗尽时仍成功，带有 `"complete": false`、`"truncated": true`、`"nodes_observed"` 和已观察到的树；每个截断节点带 `"subtree_truncated": true`。`--root` 下钻返回 `TIMEOUT` 而非部分树。
- 指针、拖拽、剪贴板、关闭应用和窗口命令以适配器的 `OperationReport` 作为 `data`。`delivered_verified` 需要读取后置条件；`delivered_unverified` 表示分发已完成但没有后置读取；`not_delivered` 仅用于已观察到目标条件满足的操作。Core 不添加 `clicked` 等无条件成功标志。
- 只有 `disposition.retry` 为 `safe` 时才使用 `recovery.strategy`。

## 引用与状态

`CONCEPTS.md` 定义引用、快照、会话、光标和追踪。实现最常违反的规则如下：

- 引用由快照限定（`@s8f3k2p9:e1`），按深度优先分配。输入只接受限定形式；裸 `@e1` 返回 `INVALID_ARGS`。`@eN` 仅是内部 RefMap 键。
- 元素角色可交互（见 `crates/core/src/tree/roles.rs` 的 `INTERACTIVE_ROLES`）或声明主要动作时才分配引用。单有 `SetFocus`、`RightClick`、`ScrollTo` 不够，因为网页运行时几乎给每个节点都声明它们。
- 操作严格按 `RefEntry` 证据重新识别元素：pid、角色、路径、来源界面、稳定文本身份和边界框哈希。控件值易变，不能作为身份。身份不符返回 `STALE_REF`；多个活跃候选返回 `AMBIGUOUS_TARGET`。
- 全部状态位于单一根目录，默认 `~/.agent-desktop`，通过 `AGENT_DESKTOP_HOME` 重定位（`crates/core/src/storage/state_root.rs`）。Refmap 位于 `snapshots/<snapshot_id>/refmap.json`，每个最多 1 MB；每个命名空间保留最新 128 个快照，清理时减至 96 个。命令通过 `RefStore` 访问，只为迁移读取旧 `last_refmap.json`。
- 会话选择顺序为 `--session`、`AGENT_DESKTOP_SESSION`、不选会话。`session start` 不为后续进程激活会话，必须传 ID。快照查询不搜索其他会话的命名空间。

## macOS 适配器注意事项

- macOS 会在兄弟分支间复用 `AXUIElementRef` 指针。遍历应使用祖先路径集合防护，不能用全局已访问集合，否则真实子树会消失。
- `AXElement` 的指针保持 `pub(crate)`，防止重复释放。`Clone` 必须 `CFRetain`，`Drop` 必须 `CFRelease`。
- 用 `AXUIElementCopyMultipleAttributeValues` 批量读取属性，不逐个调用。

## 测试与 CI

- 单元测试用小型专用适配器桩（见 `crates/core/src/adapter/test_support.rs`），`tests/fixtures/` 的黄金 JSON 保护序列化。
- 端到端框架（`tests/e2e/`、`tests/e2e-windows/`、`tests/e2e-linux/`）驱动构建后二进制操作真实应用。每个效果用独立观察验证，不能以命令自己的 `ok: true` 为依据。macOS 框架覆盖无头及 `--headed` 模式下每个引用操作。
- 上游 CI 运行格式、MSRV 构建、core 交叉编译、各 OS 的 clippy 与测试、core 隔离、15 MB 二进制体积检查，以及 FFI 头文件与 panic 守卫；这不代表本仓已执行这些检查。

## 命令接口

共 60 条命令，涵盖应用/窗口、观察、交互、滚动、键盘、鼠标、通知、剪贴板、等待、系统（包括 `session`、`trace`、`skills`）和批处理。macOS 可执行其中 56 条；四个按住输入的命令名（`key-down`、`key-up`、`mouse-down`、`mouse-up`）默认拒绝执行。Windows 和 Linux 暴露相同命令名。平台限制分别见 `skills/agent-desktop-macos/`、`skills/agent-desktop-windows/`、`skills/agent-desktop-linux/`。

## 完成标准

**性能。** 每项实质改动在合并前相对合并基点检查延迟。延迟变化必须有意为之并说明，不能留给用户发现。
- macOS：`bash scripts/perf-baseline-compare.sh` 生成 `report.html`；添加 `--apps "Slack,Google Chrome"` 覆盖密集 Electron 和 Chromium 界面。
- Windows：该脚本不能运行，改用探针成本方法：七次运行中丢弃预热，报告最小值，并附中位数与最大值（`probes/windows/FINDINGS.md` 的 A15-13、A18-7）。
- Linux：没有基线对比。守住预算：发布 CLI 不超过 15 MiB；显示服务无响应、总线无响应或应用停止时，每条命令在其超时加 1 秒内返回文档规定的错误码；真实应用快照为 `complete: true` 或干净截断；重复 FFI 调用时线程、描述符和内存不持续增长；glibc 最低要求保持 2.35 或更低（`scripts/check-elf-glibc-floor.sh`）。

**自用验收。** 上游每个平台子阶段都要用真实软件验证自己的接口并保留经评判的报告。
- 以陌生使用者身份运行：操作者只拿到已发布技能与构建后二进制，不看源码或计划；若由子 Agent 操作，明确此限制且不向其提供仓库。
- 在平台默认 shell 中逐字运行已发布文档的每个示例。不能按原文运行的示例与失效命令同等属于缺陷。
- 一旦需要技能未说明的标志、变量或顺序，即结束该次运行并记为发现。
- 没有任何发现的报告不算自用验收通过，而是验收失败。
- 读取每一步的 `ok`。等待使用工具自身的等待原语；固定 sleep 后检查存在竞态。报告失败前确认两次，描述行为前验证正反两个方向。
- 每个发现必须且只能有一种处置：本次修复，附具名测试并反证（破坏修复、观察测试失败、恢复）；由其他工作负责，写入本地路线图接收阶段；或给出理由明确接受。“已记录”不算处置。
- 报告与证据不纳入版本控制。
- 计划中的每项要求至少对应一个在违反该要求时会失败的测试。
