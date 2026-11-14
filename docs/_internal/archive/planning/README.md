# 历史设计与计划归档

2026-11-14 将 `docs/superpowers/` 与 `.superpowers/sdd/` 的 49 份 Markdown 合并为以下 6 个主题，不再按工具、specs、plans 或任务编号分散维护。Superpowers 执行要求已移除；本目录仅用于查阅历史，不是待执行任务清单，也不证明功能已经完成。

## 按主题查阅

| 主题 | 来源文档数 |
| --- | --- |
| [运行时与执行平台](runtime-platform.md) | 12 |
| [账号与内容市场](accounts-and-market.md) | 4 |
| [桌面、设置与 H5](desktop-and-mobile.md) | 10 |
| [发布、下载与更新](release-and-updates.md) | 9 |
| [质量门禁、Hook 与诊断](quality-and-diagnostics.md) | 12 |
| [历史上游同步与集成](upstream-integration.md) | 2 |

## 保留与调整

- 原设计、任务步骤、进度与失败/阻塞记录均保留；没有把旧测试结果改写成本次通过，也没有将未完成计划标为完成。
- 同主题的设计、计划和执行记录合在一页；以下来源表可定位原文段落。`plans/`、`specs/` 来自旧文档目录，`sdd/` 来自旧任务状态目录。
- 删除旧插件的强制调用提示；修正跨文档引用、标题层级和空白，并将本机绝对路径改为占位符。历史工具名、版本和架构取舍仅作为当时语境保留。
- 新计划进入 `docs/_internal/` 的现行索引，长期有效的规则进入 `docs/internals/`；不再建立 Superpowers 专用文档目录。
- 这批资料仅在维护者归档中保存，不进入公开站点、搜索或 sitemap。

## 原始证据

迁移前两个目录共有 65 个文件：49 份 Markdown、4 个 `plan-path` 指针、11 份测试日志和 1 个局部 `.gitignore`。完整原始文件经逐文件字节核对后备份到本机被 Git 忽略的 `artifacts/docs-consolidation-2026-11-14/originals.tar.gz`；日志和工具状态不作为文档提交。备份不是跨机器可用的仓库资料，历史测试结论已保留在各主题的进度记录中。

### 原计划指针

| 来源任务 | 合并后的计划位置 |
| --- | --- |
| `2026-10-31-diagnostic-remediation` | [计划](quality-and-diagnostics.md#plans-2026-10-31-diagnostic-remediation) |
| `2026-10-echoflow-runtime-management` | [计划](runtime-platform.md#plans-2026-10-echoflow-runtime-management) |
| `2026-11-02-incremental-update-rollout` | [计划](release-and-updates.md#plans-2026-11-02-incremental-update-rollout) |
| `2026-11-02-settings-reorg` | [计划](desktop-and-mobile.md#plans-2026-11-02-settings-reorg) |

## 来源定位

| 原来源 | 合并位置 |
| --- | --- |
| `sdd/2026-10-31-diagnostic-remediation/progress.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#sdd-2026-10-31-diagnostic-remediation-progress) |
| `sdd/2026-10-31-diagnostic-remediation/task-1-brief.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#sdd-2026-10-31-diagnostic-remediation-task-1-brief) |
| `sdd/2026-10-31-diagnostic-remediation/task-2-brief.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#sdd-2026-10-31-diagnostic-remediation-task-2-brief) |
| `sdd/2026-10-31-diagnostic-remediation/task-3-brief.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#sdd-2026-10-31-diagnostic-remediation-task-3-brief) |
| `sdd/2026-10-31-diagnostic-remediation/task-4-brief.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#sdd-2026-10-31-diagnostic-remediation-task-4-brief) |
| `sdd/2026-10-31-diagnostic-remediation/task-5-brief.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#sdd-2026-10-31-diagnostic-remediation-task-5-brief) |
| `sdd/2026-10-31-diagnostic-remediation/task-6-brief.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#sdd-2026-10-31-diagnostic-remediation-task-6-brief) |
| `sdd/2026-10-echoflow-runtime-management/progress.md` | [运行时与执行平台](runtime-platform.md#sdd-2026-10-echoflow-runtime-management-progress) |
| `sdd/2026-10-echoflow-runtime-management/task-1-brief.md` | [运行时与执行平台](runtime-platform.md#sdd-2026-10-echoflow-runtime-management-task-1-brief) |
| `sdd/2026-10-echoflow-runtime-management/task-2-brief.md` | [运行时与执行平台](runtime-platform.md#sdd-2026-10-echoflow-runtime-management-task-2-brief) |
| `sdd/2026-10-echoflow-runtime-management/task-3-brief.md` | [运行时与执行平台](runtime-platform.md#sdd-2026-10-echoflow-runtime-management-task-3-brief) |
| `sdd/2026-10-echoflow-runtime-management/task-4-brief.md` | [运行时与执行平台](runtime-platform.md#sdd-2026-10-echoflow-runtime-management-task-4-brief) |
| `sdd/2026-10-echoflow-runtime-management/task-6-brief.md` | [运行时与执行平台](runtime-platform.md#sdd-2026-10-echoflow-runtime-management-task-6-brief) |
| `sdd/2026-10-echoflow-runtime-management/todos.md` | [运行时与执行平台](runtime-platform.md#sdd-2026-10-echoflow-runtime-management-todos) |
| `sdd/2026-10-echoflow-site-account-market/progress.md` | [账号与内容市场](accounts-and-market.md#sdd-2026-10-echoflow-site-account-market-progress) |
| `sdd/2026-11-02-incremental-update-rollout/progress.md` | [发布、下载与更新](release-and-updates.md#sdd-2026-11-02-incremental-update-rollout-progress) |
| `sdd/2026-11-02-incremental-update-rollout/task-1-brief.md` | [发布、下载与更新](release-and-updates.md#sdd-2026-11-02-incremental-update-rollout-task-1-brief) |
| `sdd/2026-11-02-incremental-update-rollout/task-2-brief.md` | [发布、下载与更新](release-and-updates.md#sdd-2026-11-02-incremental-update-rollout-task-2-brief) |
| `sdd/2026-11-02-settings-reorg/progress.md` | [桌面、设置与 H5](desktop-and-mobile.md#sdd-2026-11-02-settings-reorg-progress) |
| `sdd/2026-11-02-settings-reorg/task-1-brief.md` | [桌面、设置与 H5](desktop-and-mobile.md#sdd-2026-11-02-settings-reorg-task-1-brief) |
| `plans/2026-05-09-h5-access.md` | [桌面、设置与 H5](desktop-and-mobile.md#plans-2026-05-09-h5-access) |
| `plans/2026-10-18-claude-hook-policy.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#plans-2026-10-18-claude-hook-policy) |
| `plans/2026-10-19-upstream-v074-merge.md` | [历史上游同步与集成](upstream-integration.md#plans-2026-10-19-upstream-v074-merge) |
| `plans/2026-10-25-upstream-sync-automation.md` | [历史上游同步与集成](upstream-integration.md#plans-2026-10-25-upstream-sync-automation) |
| `plans/2026-10-26-dsh-refactor-migration.md` | [运行时与执行平台](runtime-platform.md#plans-2026-10-26-dsh-refactor-migration) |
| `plans/2026-10-26-frontend-visual-polish-and-flutter-verdict.md` | [桌面、设置与 H5](desktop-and-mobile.md#plans-2026-10-26-frontend-visual-polish-and-flutter-verdict) |
| `plans/2026-10-26-ui-layer-hardening.md` | [桌面、设置与 H5](desktop-and-mobile.md#plans-2026-10-26-ui-layer-hardening) |
| `plans/2026-10-26-update-channel.md` | [发布、下载与更新](release-and-updates.md#plans-2026-10-26-update-channel) |
| `plans/2026-10-27-download-theme-and-release-verification.md` | [发布、下载与更新](release-and-updates.md#plans-2026-10-27-download-theme-and-release-verification) |
| `plans/2026-10-29-quality-gate-integrity.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#plans-2026-10-29-quality-gate-integrity) |
| `plans/2026-10-30-agent-quality-gate.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#plans-2026-10-30-agent-quality-gate) |
| `plans/2026-10-30-echoflow-sihub-account-merge.md` | [账号与内容市场](accounts-and-market.md#plans-2026-10-30-echoflow-sihub-account-merge) |
| `plans/2026-10-31-diagnostic-remediation.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#plans-2026-10-31-diagnostic-remediation) |
| `plans/2026-10-echoflow-runtime-management.md` | [运行时与执行平台](runtime-platform.md#plans-2026-10-echoflow-runtime-management) |
| `plans/2026-10-echoflow-runtime-preparation.md` | [运行时与执行平台](runtime-platform.md#plans-2026-10-echoflow-runtime-preparation) |
| `plans/2026-10-echoflow-site-account-market.md` | [账号与内容市场](accounts-and-market.md#plans-2026-10-echoflow-site-account-market) |
| `plans/2026-11-02-desktop-design-system-boundaries.md` | [桌面、设置与 H5](desktop-and-mobile.md#plans-2026-11-02-desktop-design-system-boundaries) |
| `plans/2026-11-02-incremental-update-rollout.md` | [发布、下载与更新](release-and-updates.md#plans-2026-11-02-incremental-update-rollout) |
| `plans/2026-11-02-release-please-migration.md` | [发布、下载与更新](release-and-updates.md#plans-2026-11-02-release-please-migration) |
| `plans/2026-11-02-settings-reorg.md` | [桌面、设置与 H5](desktop-and-mobile.md#plans-2026-11-02-settings-reorg) |
| `specs/2026-05-09-h5-access-design.md` | [桌面、设置与 H5](desktop-and-mobile.md#specs-2026-05-09-h5-access-design) |
| `specs/2026-05-13-desktop-open-project-targets-design.md` | [桌面、设置与 H5](desktop-and-mobile.md#specs-2026-05-13-desktop-open-project-targets-design) |
| `specs/2026-10-26-ui-layer-hardening-design.md` | [桌面、设置与 H5](desktop-and-mobile.md#specs-2026-10-26-ui-layer-hardening-design) |
| `specs/2026-10-26-update-channel-design.md` | [发布、下载与更新](release-and-updates.md#specs-2026-10-26-update-channel-design) |
| `specs/2026-10-31-diagnostic-remediation-design.md` | [质量门禁、Hook 与诊断](quality-and-diagnostics.md#specs-2026-10-31-diagnostic-remediation-design) |
| `specs/2026-10-echoflow-multi-runtime-agent-platform-design.md` | [运行时与执行平台](runtime-platform.md#specs-2026-10-echoflow-multi-runtime-agent-platform-design) |
| `specs/2026-10-echoflow-runtime-management-design.md` | [运行时与执行平台](runtime-platform.md#specs-2026-10-echoflow-runtime-management-design) |
| `specs/2026-10-echoflow-site-account-market-design.md` | [账号与内容市场](accounts-and-market.md#specs-2026-10-echoflow-site-account-market-design) |
| `specs/2026-11-02-release-please-design.md` | [发布、下载与更新](release-and-updates.md#specs-2026-11-02-release-please-design) |
