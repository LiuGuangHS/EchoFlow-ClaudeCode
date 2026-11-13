---
title: 真实模型质量 Baseline
nav_title: 真实模型 Baseline
description: 维护者运行 provider smoke、Coding Agent baseline 和 release quality gate 的内部流程。
order: 12
---

# 真实模型质量 Baseline

这是维护者 runbook，不是普通 PR 的必跑项。只有确定性检查通过、provider 使用范围明确且维护者授权额度后，才运行真实 provider 或模型。不要把真实 token、响应体、transcript 或用户配置写入 PR、文档或共享 artifact；共享报告只保留有界、脱敏的证据。

## 运行前条件

先确认当前 diff 的确定性检查已通过：

```bash
bun run check:impact
bun run verify
```

`bun run verify` 不调用真实模型，按 impact 选择检查，选中的 coverage 失败会阻塞本地验证。它必须先通过，才能把 live 失败归因于 provider、模型或真实跨进程路径，而不是把确定性回归混在一起。托管 PR 的 `coverage-checks` 是独立提示性检查，不在 `pr-quality-gate` 的依赖中；不要把托管门禁绿灯当作本地 coverage 已通过。

本地 policy 缺少可核验的 PR author / base branch CODEOWNERS、无法判定维护者例外时仍为 `blocked`，不是已证实缺少审批。不能用 `git user`、工作区 CODEOWNERS、伪造 label 或 `ALLOW_*` 补身份。先保留已取得的技术证据，不为重复确认已知阻塞重跑完整门禁。

`nightly-quality.yml` 不作路径选择，执行其中配置的确定性检查、独立 macOS Swift 检查和模块图健康度；手动 `skip_coverage` 默认关闭，UI smoke 缺依赖会明确跳过。nightly、impact 选择的 `verify`、显式 live release gate 与真实平台包验收各有边界，不能互相冒充。

## Baseline 与 smoke

默认 baseline 只做离线检查，不调用模型：

```bash
bun run quality:baseline
```

列出本机桌面端保存的 provider 和可复制的 selector：

```bash
bun run quality:providers
```

维护者明确授权后，选择 `quality:providers` 输出的值运行真实 baseline：

```bash
bun run quality:gate --mode baseline --allow-live --provider-model <provider>:<model-or-role>:<label>
```

如果只需要 provider smoke 和桌面 agent-browser smoke：

```bash
bun run quality:smoke --provider-model <provider>:<model-or-role>:<label>
```

可以重复 `--provider-model` 运行多个模型：

```bash
bun run quality:gate --mode baseline --allow-live \
  --provider-model <provider-a>:<model-or-role>:<label-a> \
  --provider-model <provider-b>:<model-or-role>:<label-b>
```

没有保存的 provider 时，维护者可以使用一次性环境变量 smoke；不要把真实 key 写进 shell history、日志或文档：

```bash
QUALITY_GATE_PROVIDER_BASE_URL=<redacted> \
QUALITY_GATE_PROVIDER_API_KEY=<redacted> \
QUALITY_GATE_PROVIDER_MODEL=<model-id> \
QUALITY_GATE_PROVIDER_API_FORMAT=openai_chat \
bun run quality:gate --mode baseline --allow-live
```

`provider-model` 的实际格式和可用 selector 以 `bun run quality:providers` 的输出为准。模型 ID 含冒号时优先使用 role selector，不要手工拆 UUID 或猜 provider 配置。

## Baseline 证明什么

Baseline 会启动隔离的本地服务、创建 fixture、通过聊天让模型完成 Coding Agent 任务、运行验证命令并保存 transcript、diff、verification log 和报告。provider smoke 另外验证上游连通性、proxy 转换和流式结果。不同 provider 的请求头、分组字段和错误响应必须从脱敏的真实 request/response 建模；离线替身绿灯不能替代 live 证据。

以下改动在确定性 contract/E2E 通过后应由维护者补跑：

- 桌面聊天、会话恢复、WebSocket 和 CLI bridge；
- provider、model 和 runtime 选择；
- 权限、工具调用、文件编辑和任务执行；
- agent-browser、Computer Use、Skills 和 MCP；
- release 前或高风险跨模块重构。

来自 fork 的 PR 不获得 repository secrets，也不要求贡献者自费调用模型。外部 PR 记录 `live model: not run (untrusted fork / no provider)`；维护者在合并或发布前补跑适用的 live evidence。

## 证据与失败处理

报告目录通常是：

```text
artifacts/quality-runs/<timestamp>/report.md
artifacts/quality-runs/<timestamp>/report.json
artifacts/quality-runs/<timestamp>/junit.xml
artifacts/quality-runs/<timestamp>/logs/*.log
```

先按报告和日志定位，不从 lane 计数或摘要单独下结论：

| 观察 | 诊断入口与边界 |
| --- | --- |
| Lane 全绿但总体失败 | 查看 `report.json` 的 `status`、`candidate.before` / `candidate.after`、`candidate.status` 与 `candidate.failures`。runner 比较完整 HEAD、index/worktree diff SHA-256 及未跟踪文件内容/类型指纹；端点未知不是 clean，变化或未知均使验收失败。JUnit 的 `candidate-provenance` 是独立 testcase，不改写 lane 计数 |
| 候选看似未变 | `stable` 只证明端点相等，不检测中途改动再恢复；采集非原子。schema version `1` 旧报告可缺少新字段，不把缺字段当稳定证据。`runtime` 只描述 runner 自身，不推断子工具版本 |
| executor / spawn 异常 | 看失败 lane 的 `error`、`exitCode`、`signalCode` 和 `logs/<lane>.log`；executor rejection 会追加错误并保留部分输出、继续后续 lane。runner 被强制终止或 artifact 写入失败时不保证最终报告 |
| Coverage 长时间无输出 | 控制台 `[coverage]` JSON 的 `phase: start` 提供 command、cwd、startedAt、logPath、capturePath；执行中读隔离 `capturePath`。结束后读持久化 `logPath` 和 `${logPath}.process.json`，临时 capture 通常已清理 |
| Coverage 进程异常 | process JSON 保存实际 `exitCode`（未知为 `null`）、`signalCode`、可选 `error`、起止时间、durationMs 和 `runnerRuntime`；spawn/wait 异常先保存部分输出及诊断再清理并抛回原异常。signal、error 或未知退出不进入 root 的 assertion-exit 例外 |
| Root instrumentation 非零 | 仅普通非零退出且发现/完成文件、最终 summary 和单进程 LCOV 完整可用时，现有策略接受覆盖率并记录 instrumentation note；原始断言失败仍真实存在，correctness 由独立 `check:server` 保证。`lcovAvailable: true` 不单独证明 suite 成功，signal 即使有 LCOV 或 exit 0 也失败；adapters/desktop 未评估该字段，不等于 false |
| Changed-line 数字过小或为零 | 查看 coverage report 的 `changedLines.scope`：strategy、baseRef、diffArgs、includes 和可选 error。explicit-base / branch-fallback 仅含已提交差异；dirty-worktree 比较 HEAD，仅含暂存和未暂存差异，不含分支提交与未跟踪文件。dirty 选择仍只由未暂存 tracked 改动触发，staged-only 可落到 branch-fallback 或 none。diff 失败明确为 unknown，但保留现有 empty-fallback 评分，零行不能据此证明没有变更 |
| Coverage 失败或目标差距 | 查看 `artifacts/coverage/<timestamp>/coverage-report.md` / `.json` 的 suites、`failures` 和 `changedLines.failures`；`targetGaps` 是技术债提示。缺 summary/LCOV 是采集失败，不能推断产品缺陷或自行降低阈值 |
| Policy 缺上下文 | 保留 `blocked` 和已有技术结果；等待可信 author/base 证据，不推断身份、不伪造批准 |

交接中写清：完整候选 SHA 与内容指纹、环境和工具路径/版本、使用的 provider selector、运行的命令、退出状态、实际 pass/fail 数量、模型/live 是否执行、报告路径和剩余风险。发布产物另记 SHA-256，重建或签名后重新关联。没有自动跨运行缓存或统一强制 preflight；不要把操作要求写成已经实现的门禁。不要共享凭据、任意消息正文、完整堆栈、用户路径或未脱敏的上游响应体。

SiHub 的历史教训必须保留：695 条离线令牌测试通过时，真实调用仍因未写进文档的 `New-Api-User` header 和 group field 全部失败。实机路径未验证前只能写「离线测试通过、实机未验证」，不能写「修好了」。

## Release gate

发版前由维护者显式授权 live 检查：

```bash
bun run quality:gate --mode release --allow-live --provider-model <provider>:<model-or-role>:<label>
```

`quality:release` 是 release mode 别名，仍需上述显式 live 参数与额度授权。release mode 组合 PR checks、baseline catalog、live baseline、provider smoke、native checks 和当前平台的 release `package-smoke`，不自动包含 nightly 全部检查。live lane 不允许静默跳过；缺 provider、额度或外部账号时，必须把 blocker 写入发版记录并停止发布。

`release-desktop.yml` 不直接运行 `verify`，但 `verify-governance`（含 identity/upstream 审计）、`verify-runtime`、`verify-desktop` 汇入 `release-verify-gate`，`publish-release` 依赖它及构建矩阵。该门禁和当前平台 package smoke 不替代每个目标 OS/架构上的真实包启动、安装、旧版升级/数据保留及签名/公证证据。发布前验证待发布的同一产物并记录哈希；正式发布后再从旧版验证实际 metadata/下载/安装/重启更新链路，不把尚未发布的线上候选当作发布前置条件。
