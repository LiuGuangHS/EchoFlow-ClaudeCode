## 变更摘要


## 功能质量契约

填写要求见[贡献指南](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/docs/internals/contributing.md#pr-提交流程)；证据各填一次，未运行标记 `not run` / pending，不计通过。

- 变更范围：<!-- desktop / server / adapter / native / docs / provider-runtime / agent-loop / release -->
- 新增或更新的测试：
  - <!-- 同区域回归与跨边界确定性 E2E/契约检查；无对应测试时说明维护者例外 -->
- 本地验证证据：
  - <!-- check:impact、定向回归和受影响模块的实际命令、结果/退出状态、通过/失败/跳过数量、报告/JUnit/日志路径；全量留给 GitHub Actions，不要求在 WSL 重复 -->
- Actions 证据：
  - <!-- 候选 SHA、checkout/merge SHA、PR head/base、run URL；声明 PR-ready 时附候选 SHA 对应的 `pr-quality-gate` 结果。完整验证另注明范围，不复用其他版本绿灯 -->
- 覆盖率证据：
  - <!-- 报告路径、相关套件摘要、changed-line coverage 门槛结果；未满足时记录阻塞或维护者批准的例外 -->
- E2E / 真实模型证据：
  - <!-- 实际入口/跨进程证据或未运行原因；live 仅可信维护者明确授权额度后执行，已有测试/报告在此引用即可 -->
- 已知风险 / 回退：
  - <!-- 剩余风险和安全回退方式 -->

## 确认

- [ ] 已为每项生产行为变更新增或更新同区域测试，或记录维护者批准的例外。
- [ ] 本 PR 未触及 CLI 核心路径，或作者为 CODEOWNER，或维护者已批准 `allow-cli-core-change`。
- [ ] 覆盖率基线/门槛变更已获维护者批准 `allow-coverage-baseline-change`。
- [ ] 任何 quarantine 策略变更均获维护者批准；未隔离确定性的 provider/chat 契约测试。
- [ ] Provider/runtime 变更有离线 mock/fixture 契约覆盖；缺测试的维护者例外记录为 `allow-missing-tests`。
