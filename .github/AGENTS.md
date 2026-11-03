# CI 与仓库策略

这些规则适用于 `.github/` 下的改动，并叠加根目录规则。

- 将工作流改动视为产品改动。运行 `bun run check:policy`；如果环境提供 `actionlint`，也运行它。
- `scripts/pr/change-policy.ts` 是路径到检查路由的唯一事实来源。不要在提示性自动化中复制路由图。
- 路由由路径前缀和 `scripts/pr/module-graph.ts` 的导入图共同决定。前缀决定 area 及所有阻断规则；导入图只扩大要运行的 surface check。无法构建导入图时，应选择所有 surface，而不是静默退回仅按前缀判断。
- `nightly-quality.yml` 无条件运行每条确定性 lane，并重新证明模块图健康度。它存在的原因是按改动选择检查只能覆盖 diff 能触达的范围；不要把这些 job 移入必需的 PR gate。它只允许 `workflow_dispatch` 触发——是否花费约 90 分钟 CI 由维护者决定；如果重新加入 `schedule:`，`pr-quality-workflow.test.ts` 必须失败。
- 保留 `pr-quality-gate` 作为稳定的必需状态。已选择的 job 必须成功，未选择的 job 必须明确标记为跳过；绝不能把失败转换成成功。
- 必需检查必须保持离线，不得接收 provider 凭据，也不得依赖付费或实机服务。
- `pull_request_target` 工作流可以使用可信的 base 代码检查 PR 元数据，但绝不能执行 PR head、安装由 PR 控制的依赖，或向贡献者代码暴露 secrets。
- 保持 Bun 与 `package.json#packageManager` 一致；必需 job 使用冻结 lockfile 安装。
- 不要为了让另一项改动通过而削弱 coverage、测试路由、CODEOWNERS 或分支保护。维护者覆盖标签必须有明确且记录在案的决定。
- 仓库设置、ruleset、secrets 和必需检查的变更需要用户明确授权；仅编辑工作流文件不等于获得这项授权。
