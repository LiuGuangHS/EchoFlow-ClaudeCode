---
title: 文档与站点维护规范
nav_title: 站点维护
description: 文档发布边界、内容格式、站点视觉与离线验证契约。
order: 0
---

# 文档与站点维护规范

修改 `docs/` 或 `site/` 前阅读本文；全仓授权、安全和验证流程以[根规范](../../AGENTS.md)为准。本文是按需维护规范，不随产品文档发布。

## 文档放置与路由

- `docs/` 是中英文产品/源码文档事实来源，不存任务日志；存在英文镜像时保持结构与公开路由对应。公开区为 `start/`、`cases/`、`desktop/`、`mobile/`、`im/`、`cli/`、`internals/`，新增区段须登记 `site/scripts/generate-docs-manifest.mjs` 的 `sections`。
- 维护者计划、迁移清单、验证记录与运行手册放 `docs/_internal/`，所有发布产物必须排除；公开页不链接它，不当作秘密存储。活动记录列入[内部索引](README.md)，完成后提取长期规则再归档；不顺手移动或删除历史记录。
- 文档每页 frontmatter 包含 `title`、`nav_title`（≤12 个中文字符）、`description`、`order`（索引为 0）；H1 后首段为普通导语。
- 文件路径就是公开 URL；重命名须更新 `site/src/content/docs.js` 的 `LEGACY_ROUTES` 和 `site/scripts/prepare-static-output.mjs` 的 `legacyRoutes`，不得移动桌面引用的 `/im/`。公开页引用未发布的根规范、设计文件或 PR 模板时使用仓库 URL，不把仓库相对链接当作有效站点路由。
- 产品截图取自当前真实构建、脱敏后存 `docs/images/app/`，2000px 宽 WebP，功能页通常不超过三张；IM 分步教程可在 `docs/images/im/<platform>/` 每步一张。界面证据保持平整清晰，不倾斜、模糊或自动旋转；站点不得包含私有状态、凭据或本地路径。
- 发布说明与 `scripts/release.ts`、release workflow 和版本化 release notes 一致；具体发布步骤只在[贡献指南](../internals/contributing.md)维护。

## 站点实现与视觉

- `site/` 保持可独立 `npm ci`、`npm run build` 和离线 `npm run check`；生产域名为 `code.echoflow.cn`，资源和路由从根路径工作，保留 CNAME 校验。
- generator 输出的索引保持轻量，正文按篇动态加载，搜索索引仅由搜索弹窗延迟加载；不把全文塞进首屏。保留按需 Mermaid 支持与主题 token，即使暂无文档使用。
- 站点沿用 Wandor：暖纸张插画、白色渐隐环境视频、Geist、Special Elite 字标、液态玻璃和黑色胶囊控件；公开名 `EchoFlow`，产物相关路径/文件名保持实际契约。文档样式用 `doc-wandor.css` 隔离，复用 `base.css` token，不在组件写原始 hex；断点仅 1180 / 900 / 620。
- 两种主题均可读，`index.html` 首次绘制前设置 `data-theme`；减少/暂停动效时内容完整。保留要求的 Google Fonts 链接及自托管 latin 字体回退，中文用平台字体。
- 首页首次按浏览器语言选中/英文，保存的手动选择优先；`/en`、`/en/start` 为英文，`/`、`/start` 保持中文路由。

## 验证边界

依赖准备与离线构建、检查分开执行；命令和完整门禁见[贡献指南](../internals/contributing.md)。链接需通过站点检查，不能只验证仓库文件存在。布局改动补桌面与窄移动端渲染证据；构建通过不替代视觉检查。
