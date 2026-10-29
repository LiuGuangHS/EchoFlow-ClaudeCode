# 内部文档索引

`docs/_internal/` 只放维护者需要的运行手册、设计/评审记录和交接材料，不属于产品文档，也不会被文档站生成器发布。公开文档在 `docs/{start,cases,desktop,mobile,im,cli,internals}/`，英文镜像在 `docs/en/`。

## 现行

| 文档 | 用途 |
| --- | --- |
| `decoupling-plan.md` | 脱钩与重写的现行重构计划（原根目录 `DECOUPLING_PLAN.md`） |
| `release-windows.md` | 桌面端发布与自动更新 runbook |
| `computer-use-native-manual-qa.md` | macOS/Windows Computer Use 真机验收步骤 |
| `computer-use-codex-impl-blueprint.md` | Codex 原生 Computer Use 兼容契约与实现边界 |

## 归档

| 路径 | 归档原因 |
| --- | --- |
| `archive/ui-clone/` | 早期桌面端 PRD、UI 规格和服务端架构；已被当前实现取代 |
| `archive/computer-use-*.md` | 已完成的 Computer Use 重设计、评审、CEF 分析、Swift 方案和交接材料 |
| `archive/upstream-sync-agent-handoff.md` | 上游同步流程已整体退役 |

## 生命周期

规则见 `docs/AGENTS.md` 的 “Where documentation lives”：有效事实进 `docs/internals/**` 或对应 surface 的 `AGENTS.md`，完成的材料进 `archive/`，本目录不从公开页链接。
