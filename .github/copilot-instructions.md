# AI 编程指导

编辑文件时，遵循根 `AGENTS.md` 和最近的嵌套 `AGENTS.md`。

沿用根规范的完成标准和授权边界；任务专属测试与失败诊断见 `docs/internals/contributing.md`。持续完成范围内的本地实现、确定性检查和修复，无需每一步询问。

- 生产改动须附同区域测试，区域定义见 `scripts/pr/change-policy.ts`。保持或提高覆盖率基线，并满足变更行覆盖率门槛；维护者批准例外仍须明确决定。
- 单元测试无法证明用户可见的跨边界流程时，使用 E2E 或桌面 UI 冒烟。临时浏览器自动化使用 `ego-browser`；已提交冒烟脚本保留自己的运行器。
- Provider/auth/runtime-env/model-window/proxy 改动在 `check:impact` 选中时，须运行离线 `bun run check:provider-contract`；桌面聊天/WebSocket/会话改动同样使用 `check:chat-contract`。
- 真实冒烟仅作为可信维护者证据，且需要明确授权。必需测试使用隔离 fixture，不使用已保存凭据。
- 对最终 diff 按根验证策略完成检查。交接须列出变更文件、新增测试、实际运行的命令及可获得的通过/失败数量、未运行检查、已生成的证据路径和剩余风险。
