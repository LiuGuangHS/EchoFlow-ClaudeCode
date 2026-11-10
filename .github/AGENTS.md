# CI 与仓库策略

这些规则适用于 `.github/` 改动，并叠加根目录规则。

- 将工作流改动视为产品改动。运行 `bun run check:policy`；有 `actionlint` 时运行它。
- `scripts/pr/change-policy.ts` 是路径到检查路由的唯一事实来源。不要在提示性自动化中复制路由图。
- 路由由路径前缀和 `scripts/pr/module-graph.ts` 的导入图组成。前缀决定区域和所有阻塞规则；导入图只扩大需要运行的界面检查。无法构建导入图时应选择所有界面，而不是静默退回前缀。
- `nightly-quality.yml` 无条件运行每个确定性 lane 并重新证明模块图健康度。它存在是因为按 PR 选择只能覆盖 diff 触达的范围；不要把这些 job 移入必需的 PR 门禁。它每天 19:00 UTC 和 `workflow_dispatch` 运行；维护者已选定该频率，`pr-quality-workflow.test.ts` 固定了它，改频率须由维护者决定。每个运行 runtime 套件的 job 都必须先安装 ripgrep（该测试也固定此要求）：Agent 发现通过它列出文件。
- 保持 `pr-quality-gate` 为稳定的必需状态。选中的 job 必须成功，未选中的必须明确跳过；绝不能把失败转换成成功。
- 提示性 lane（`coverage-checks`）不得放进门禁的 `needs`，以免必需状态等待它们。分片（`--shard=<i>/<n>`）只缩短墙钟时间：所有分片合计必须运行完整检查，`pr-quality-workflow.test.ts` 会固定这一点。不要为了加快 CI 而缩小选中 lane 的范围。
- 必需 PR job 必须保持离线，不得接收 provider 凭据或依赖付费 / 在线服务。
- `pull_request_target` 工作流可以使用可信 base code 检查 PR 元数据，但绝不能执行 PR head、安装 PR 控制的依赖或向贡献者代码暴露 secrets。
- Bun 必须与 `package.json#packageManager` 对齐，必需 job 使用 frozen lockfile 安装。
- 不得削弱覆盖率、测试路由、CODEOWNERS 或分支保护来让其他改动通过。维护者 override label 必须有明确且留档的决定。
- 个人 CODEOWNER 创建的 PR 不需要 `allow-cli-core-change` label（维护者决定，2026-10）。`scope-plan` 和 `pr-triage.yml` 都从 base branch 读取 CODEOWNERS，绝不读取 PR head；其他 override label 不变。
- 绝不把失败测试重试成通过。`check:server` 会对每个失败文件重跑一次并标记 `FLAKY` 或 `FAILED`，但两者仍让门禁失败；应修复竞态，或仅在最后手段下带原因和 owner 隔离。
- 仓库设置、ruleset、secrets 和必需检查变更需要用户明确授权；仅编辑工作流文件不等于获得授权。
