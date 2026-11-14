# 内部文档索引

`docs/_internal/` 只放维护者需要的运行手册、设计/评审记录和交接材料，不属于产品文档，也不会被文档站生成器发布。公开文档在 `docs/{start,cases,desktop,mobile,im,cli,internals}/`，英文镜像在 `docs/en/`。

## 现行

| 文档 | 用途 |
| --- | --- |
| `decoupling-plan.md` | 脱钩与重写的现行重构计划（原根目录 `DECOUPLING_PLAN.md`） |
| [工作区集成账本](workspace-integration.md) | 原根目录账本；保留阶段状态和未关闭项，历史验证不代表当前候选通过 |
| `release-windows.md` | 桌面端发布与自动更新 runbook |
| `quality-baseline.md` | 真实 provider、模型 baseline 与 release quality gate |
| `computer-use-native-manual-qa.md` | macOS/Windows Computer Use 真机验收步骤 |
| `computer-use-codex-impl-blueprint.md` | Codex 原生 Computer Use 兼容契约与实现边界 |
| [原生桌面模块开发说明](agent-desktop-development.zh.md) | `native/agent-desktop/` 的上游开发指导中文参考；保留来源与版本边界 |
| [移动端维护资料](mobile-maintenance.md) | 实现、发布、推送和本地 fixture；原模块路径保留兼容入口 |
| [cu-helper 兼容证据与历史集成方案](cu-helper-evidence.md) | 限定版本兼容证据与未实施提案，不作为新授权或完成证明 |
| [连接器实现与接入证据](connectors-evidence.md) | 连接器说明、固定来源与供应商研究；保留历史数量差异和未联调状态 |

## 归档

| 路径 | 归档原因 |
| --- | --- |
| `archive/ui-clone/` | 早期桌面端 PRD、UI 规格、原型与服务端架构的唯一归档；原 `docs/ui-clone/` 的相同副本已删除 |
| [桌面设计与组件迁移历史](archive/desktop-design.md) | 合并已完成的组件库审计/迁移与被替代的「纸·墨·印」交接，不再作为现行规范 |
| [Windows UI 验证历史](archive/windows-ui-2026-07.md) | 合并 `v0.4.10..91829e91` 人工清单和缺陷记录；保留 partial、blocked 和未执行项 |
| `archive/computer-use-*.md` | 已完成的 Computer Use 重设计、评审、CEF 分析、Swift 方案和交接材料 |
| [历史设计与计划](archive/planning/README.md) | 原 Superpowers 的 49 份设计、计划与任务记录合并为 6 个主题；保留历史状态，不再作为插件执行入口 |

分类与归档规则见 [文档放置](../AGENTS.md#文档放置)。
