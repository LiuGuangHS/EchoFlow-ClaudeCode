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

这里显式通过 `verify` 是维护者 live 流程的前置条件，不是普通 PR 或 WSL 的默认动作：先排除确定性回归，再分析 live 失败。检查选择、本地 coverage 阻塞与托管 advisory 的区别见[四层门禁分工](../internals/contributing.md#四层门禁分工)。policy 缺可信审批上下文时保留 `blocked` 和已有技术结果，不伪造身份或批准，也不为已知阻塞重复运行完整门禁；诊断见[证据与失败诊断](../internals/contributing.md#证据与失败诊断)。

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

报告位置、候选身份与采集局限、lane/coverage/process 异常及交接字段统一见[证据与失败诊断](../internals/contributing.md#证据与失败诊断)，不要从 lane 计数或摘要单独下结论。live 记录另附实际 provider selector 和授权范围；不要共享凭据、任意消息正文、完整堆栈、用户路径或未脱敏的上游响应体。

SiHub 的历史教训必须保留：695 条离线令牌测试通过时，真实调用仍因未写进文档的 `New-Api-User` header 和 group field 全部失败。实机路径未验证前只能写「离线测试通过、实机未验证」，不能写「修好了」。

## Release gate

发版前由维护者显式授权 live 检查：

```bash
bun run quality:gate --mode release --allow-live --provider-model <provider>:<model-or-role>:<label>
```

`quality:release` 是 release mode 别名，仍需上述显式 live 参数与额度授权。release mode 组合 PR checks、baseline catalog、live baseline、provider smoke、native checks 和当前平台的 release `package-smoke`，不自动包含 nightly 全部检查。live lane 不允许静默跳过；缺 provider、额度或外部账号时，必须把 blocker 写入发版记录并停止发布。

workflow 门禁、目标平台包验收及发布前/后证据边界统一见[Release 门禁](../internals/contributing.md#release-门禁)；本流程的 live 结果不能替代其中任何未执行的层级。
