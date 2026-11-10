## 变更摘要


## 功能质量契约

- 变更范围：<!-- desktop / server / adapter / native / docs / provider-runtime / agent-loop / release -->
- 新增或更新的测试：
  - <!-- 例如：单元/组件/API/请求形状/工作流/E2E -->
- 覆盖率证据：
  - <!-- 覆盖率报告路径、相关套件摘要、变更行覆盖率（changed-line coverage） -->
- E2E / 真实模型证据：
  - <!-- 命令和报告路径，或没有 provider/额度等明确阻塞项 -->
- 已知风险 / 回退：
  - <!-- 剩余风险和安全回退方式 -->

## 验证

- [ ] 已运行相关本地检查，或说明不适用的原因。
- [ ] 已为每项生产行为变更新增或更新同区域测试。
- [ ] 已运行 `bun run check:impact` 选中的检查；声明 PR-ready/完整验证时，还已运行 `bun run verify`。
- [ ] 新增或变更的可执行生产代码行满足变更行覆盖率门槛，或已记录阻塞项/维护者批准的例外。
- [ ] 已附上或概述质量报告路径、JUnit/日志产物路径，以及通过/失败/跳过数量。
- [ ] 已对跨边界变更运行确定性 E2E/契约检查。可信维护者运行真实模型检查时附上证据，否则明确标记未运行。

## 风险

- [ ] 本 PR 未触及 CLI 核心路径，或作者为 CODEOWNER，或维护者已批准 `allow-cli-core-change`。
- [ ] 生产代码变更包含对应测试，或维护者已批准 `allow-missing-tests`。
- [ ] 覆盖率基线/门槛变更已获维护者批准 `allow-coverage-baseline-change`。
- [ ] 任何 quarantine 策略变更均获维护者批准；未隔离确定性的 provider/chat 契约测试。
- [ ] Provider/runtime 变更由离线 mock/fixture 契约测试覆盖；真实冒烟由可信维护者执行，或已明确记录暂未运行。
