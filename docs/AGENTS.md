# 文档规范

这些规则适用于 `docs/` 改动，并叠加根目录规则。

## 文档放置

公开页面解释产品或源码，不是任务日志。可复用的架构和边界规则放在 `internals/`，贡献流程放在 `internals/contributing.md`，代码入口规则放在适用的 `AGENTS.md`。分别记录要求与已验证实现；审计发现、计划或单元测试通过都不能证明整项功能可用。

仅维护者使用的迁移清单、验证记录、设计提案和发布运行手册放在 `docs/_internal/`，不放入公开区。站点生成器必须在所有发布产物中排除 `_internal`。不要从公开页面链接这里，也不要把它作为秘密存储。活动记录放入索引；完成或被替代的记录在提取长期规则后归档到 `_internal/archive/`。不要把移动或删除既有记录当作顺手清理。

## 结构

公开区固定七个区段：`start/`、`cases/`、`desktop/`、`mobile/`、`im/` 面向应用用户，`cli/`、`internals/` 面向源码读者。新增区段必须在 `site/scripts/generate-docs-manifest.mjs` 的 `sections` 数组中登记。

`docs/en/` 与中文目录逐文件对应。存在英文页面时，保持中文页和 `docs/en/` 对应页内容结构一致；业务英文产品镜像不因本规范中文化任务翻译。

## Frontmatter（每页必需）

```yaml
---
title: 连接模型服务
nav_title: 连接模型      # 侧栏标签，≤12 个中文字符
description: 一句话说明这篇讲什么。       # 用于搜索和 SEO meta
order: 2                # 区段内位置；index.md 使用 0
---
```

站点会把 H1 后的第一段作为导语；请写普通段落，不要写成引用块。

## 截图

产品截图放在 `docs/images/app/`，使用宽度 2000px 的 WebP，并从真实构建版本截取。不要提交旧 UI 版本截图，应重新截取。提交前遮盖 token、二维码、API key 和配对账号名。功能页通常不超过约三张截图。

分步配置教程是例外：`docs/im/` 可从 `docs/images/im/<platform>/` 引用控制台截图，每一步一张；判断标准是读者是否没有截图就无法跟做。

## 路由就是文件路径

`docs/start/install.md` 发布为 `/start/install`。重命名文件会改变公开 URL，因此必须把旧路径加入 `site/src/content/docs.js` 的 `LEGACY_ROUTES`，并加入 `site/scripts/prepare-static-output.mjs` 的 `legacyRoutes`。

桌面应用内部会链接 `/im/`（`desktop/src/pages/AdapterSettings.tsx`）；该路由不可移动。

## 检查

- 如果 `bun run check:impact` 选中文档检查，运行 `bun run check:docs`。它会安装隔离的 `site/` 依赖树、构建 React 站点，并校验所有本地链接和图片。
- 发布说明必须与 `scripts/release.ts`、`.github/workflows/release-desktop.yml` 以及版本化 `release-notes` 约定保持一致。
