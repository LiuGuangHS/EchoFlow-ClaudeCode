# 贡献指南

## 从改动到交付

1. 阅读[根 AGENTS.md](AGENTS.md)及领域链接，按根 `package.json#packageManager` 准备 Bun 和所需依赖。
2. 补最小行为回归并完成改动；WSL 本地运行定向测试，再用 `bun run check:impact` 选择模块检查，全量留给 GitHub Actions。
3. 按[详细贡献指南](docs/internals/contributing.md#ai-coding-agent-修复循环) / [English](docs/en/internals/contributing.md#ai-coding-agent-fix-loop)记录证据、缺口和风险，再用 [PR 模板](.github/pull_request_template.md)交付；本地通过不等于候选 Actions 门禁通过。

安装、测试设计、显式本地 gate、报告诊断及发布步骤只在详细指南维护；[Issue 路由](.agents/workflows/issue-router.md)处理问题分流。

## 安全底线

保留已有用户改动；测试隔离真实用户配置、凭据和数据；分支/提交/推送/PR、发布、设置变更及在线额度须有覆盖该操作的明确授权。完整约束见[根规则](AGENTS.md)，运行时与持久化契约见[执行、数据与信任边界](docs/internals/execution-boundaries.md)。

## 贡献的许可边界

贡献前请阅读 [LICENSE](LICENSE) 和[第三方许可声明](THIRD_PARTY_LICENSES.md)。根许可证只保留 EchoFlow 原创内容的权利，不授予第三方代码的许可。提交新贡献时，请在 PR 中明确新增内容的来源及你有权提供的授权，由维护者在合入前确认；此说明不变更既有授权，也不转移版权或授予维护者重新许可权。

引入或修改第三方代码时，保留原许可及版权通知并说明来源，不得改成项目当前许可；第三方原始许可证、NOTICE 和来源记录保留原文。适配范围、固定来源版本、回归证据与冲突处理遵循根规则的[实现与兼容边界](AGENTS.md#实现与兼容边界)，不默认通过 merge 同步外部仓库。第三方指导等义中文化须保留来源、归属、链接、标识符及许可义务；已有修改记录见 [PATCHES.md](native/agent-desktop/PATCHES.md)。
