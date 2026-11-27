## 变更摘要


## 功能质量契约

填写要求见[贡献指南](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/docs/internals/contributing.md#pr-提交流程)；证据各填一次，未运行标记 `not run` / pending，不计通过。

- 变更范围：<!-- desktop / server / adapter / native / docs / provider-runtime / agent-loop / release -->
- 测试及结果：<!-- 哪个测试覆盖了本次改动，运行结果如何？ -->
- 补充验证（如适用）：<!-- 相关跨模块或平台检查。需要变更行覆盖率报告时添加 run-coverage 标签。 -->
- 已知风险 / 回退：
  - <!-- 剩余风险和安全回退方式 -->

## 确认

- [ ] 已为每项生产行为变更新增或更新同区域测试，或记录维护者批准的例外。
- [ ] 本 PR 未触及 CLI 核心路径，或作者为 CODEOWNER，或维护者已批准 `allow-cli-core-change`。
- [ ] 覆盖率基线/门槛变更已获维护者批准 `allow-coverage-baseline-change`。
- [ ] 任何 quarantine 策略变更均获维护者批准；未隔离确定性的 provider/chat 契约测试。
- [ ] Provider/runtime 变更有离线 mock/fixture 契约覆盖；缺测试的维护者例外记录为 `allow-missing-tests`。
