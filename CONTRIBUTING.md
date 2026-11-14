# 贡献指南

贡献流程以 [详细指南](docs/internals/contributing.md) 为准；跨目录的产品所有权、持久化和信任边界见 [执行、数据与信任边界](docs/internals/execution-boundaries.md)。本页只保留入口，不重复维护各模块检查清单。

## 本地验证

先查看当前改动需要哪些检查：

```bash
bun run check:impact
```

运行选中的检查；需要完整验证或声明 PR-ready 时使用统一入口，不必先逐个重复执行全部 lane：

```bash
bun run verify
```

`git push` 不再自动运行本地质量门禁。`bun run quality:push` 是不含 coverage 的快捷入口；完整验证仍使用 `bun run verify`。报告和日志位于 `artifacts/quality-runs/<timestamp>/`。

- [回归测试设计](docs/internals/contributing.md#回归测试设计)：测试范围、状态转换和失败证据。
- [无模型的 Agent / UI 检查](docs/internals/contributing.md#无模型的端到端-agent-门禁)：mock、隔离沙箱和桌面 smoke；不能用 mock 或 build 代替真机证据。
- [PR 模板](.github/pull_request_template.md)：填写影响面、测试/覆盖率证据、未运行项和剩余风险。

确定性检查不使用真实用户配置、凭据或模型额度。真实模型验证需维护者明确授权；fork 贡献者可注明 `live model: not run (untrusted fork / no provider)`，不因此阻塞确定性 PR gate。

## 贡献的许可边界

贡献前请阅读 [LICENSE](LICENSE) 和[第三方许可声明](THIRD_PARTY_LICENSES.md)。根许可证只保留 EchoFlow 原创内容的权利，不授予第三方代码的许可。提交新贡献时，请在 PR 中明确新增内容的来源及你有权提供的授权，由维护者在合入前确认；此说明不变更既有授权，也不转移版权或授予维护者重新许可权。

引入或修改第三方代码时，保留原许可及版权通知，并说明来源。不要把已有第三方许可改成项目当前许可。外部代码的适配范围、回归证据及冲突处理见[外部代码学习与变更边界](AGENTS.md#外部代码学习与变更边界)，不默认通过 merge 同步外部仓库。

`native/agent-desktop/AGENTS.md` 可在保留来源、归属、链接、标识符及许可证义务的前提下等义中文化；修改记录见 [PATCHES.md](native/agent-desktop/PATCHES.md)。第三方原始许可证、NOTICE 和来源记录保留原文。

## 按需入口

- [AGENTS.md](AGENTS.md)：目录规则路由；[Issue 路由](.agents/workflows/issue-router.md)。
- [桌面组件](desktop/src/components/AGENTS.md)、[桌面设计](DESIGN.md)、[移动端发布](mobile/RELEASING.md)。
- [Harness 开发与升级](harness/README.md)、[运行时契约](src/server/runtime/README.md)。

历史设计与审计不是现行规范；英文产品镜像、历史发布资料和第三方许可证不属于规范中文化范围。
