# 贡献指南

## 按需入口

- [根 AGENTS.md](AGENTS.md)：统一仓库规则、授权边界与验证要求；[DESIGN.md](DESIGN.md)：桌面设计。
- [详细贡献指南](docs/internals/contributing.md) / [English](docs/en/internals/contributing.md)：安装、测试设计、质量报告、PR 与发布操作。
- [执行、数据与信任边界](docs/internals/execution-boundaries.md)、[PR 模板](.github/pull_request_template.md)、[Issue 路由](.agents/workflows/issue-router.md)。

## 本地验证

WSL 本地先做定向回归，再用 `bun run check:impact` 选择模块检查；全量留给 GitHub Actions，不要求本地重复。PR-ready/push-ready 须区分本地模块验证完成与候选 SHA 对应的 PR Actions 门禁通过，未提交工作区不能复用旧 CI 绿灯；nightly 全量不等于 release 验收。证据要求见[详细贡献指南](docs/internals/contributing.md#ai-coding-agent-修复循环)。

`git push` 不再自动运行本地质量门禁。`bun run verify` 保留显式本地 PR 验证入口及所选 coverage 的阻塞语义，不是 WSL 默认动作；`bun run quality:push` 是跳过 coverage 的可选快捷入口，不能代替完整验证。报告见 `artifacts/quality-runs/<timestamp>/`。

## 贡献的许可边界

贡献前请阅读 [LICENSE](LICENSE) 和[第三方许可声明](THIRD_PARTY_LICENSES.md)。根许可证只保留 EchoFlow 原创内容的权利，不授予第三方代码的许可。提交新贡献时，请在 PR 中明确新增内容的来源及你有权提供的授权，由维护者在合入前确认；此说明不变更既有授权，也不转移版权或授予维护者重新许可权。

引入或修改第三方代码时，保留原许可及版权通知并说明来源，不得改成项目当前许可；第三方原始许可证、NOTICE 和来源记录保留原文。适配范围、固定来源版本、回归证据与冲突处理遵循根规则的[实现与兼容边界](AGENTS.md#实现与兼容边界)，不默认通过 merge 同步外部仓库。第三方指导等义中文化须保留来源、归属、链接、标识符及许可义务；已有修改记录见 [PATCHES.md](native/agent-desktop/PATCHES.md)。
