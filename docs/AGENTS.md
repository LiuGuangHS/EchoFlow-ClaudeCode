# 文档说明

这些规则适用于 `docs/` 下的改动，并叠加根目录规则。

## 文档面向的读者

文档只有两类读者。如果页面不服务于其中任何一类，就不应放在这里。

- **使用应用的人**：`start/`、`cases/`、`desktop/`、`mobile/`、`im/`。不要求读者具备代码背景。
- **阅读源码的人**：`internals/`、`cli/`。内容包括架构、实现和贡献流程。

内部流程产物（迁移任务列表、验证清单、设计提案、发布 runbook）不是文档。不要把它们放入公开 section：仅限维护者的材料放在 `_internal/`，完成后移动到 `_internal/archive/`。将长期有效的事实折叠进相关 `internals/` 页面。

## 结构

顶层共有七个 section：`start/`、`cases/`、`desktop/`、`mobile/`、`im/`、`cli/`、`internals/`。此列表必须与 `site/scripts/generate-docs-manifest.mjs` 的 `sections` 数组一致；新增 section 时必须在那里登记。

`docs/en/` 按文件镜像中文目录。中文页面与 `docs/en/` 对应页面必须保持同步。

## 文档应放在哪里

- **产品文档**：上述七个 section 及其 `docs/en/` 镜像。站点生成器只发布这些内容。
- **站点资源**：放在 `docs/images/` 和 `docs/public/`；`site/src/generated/` 是构建产物，保持 gitignore。
- **发布历史**：放在 `release-notes/`。治理和入口文档，例如 `README.md`、`CONTRIBUTING.md` 和 `SECURITY.md`，保留在仓库根目录。
- **仅限维护者的 runbook、设计说明和交接记录**：放在 `docs/_internal/`。完成后移动到 `docs/_internal/archive/`。这些文件不发布到站点，也不得从产品页面链接。
- **Agent 说明**：是根目录和嵌套的 `AGENTS.md` 文件。它们指导贡献者和 Agent，不是产品文档。
- **`docs/superpowers/`**：是本地计划目录，被 gitignore 且永不跟踪。已跟踪页面不得链接到它；先把长期有效的结论折叠进 `internals/`。
- 活跃的架构计划可以暂时放在仓库根目录。完成后，将长期有效的结论移入 `internals/`，并归档或删除过程草稿。

## Frontmatter（每个页面必需）

```yaml
---
title: 连接模型服务
nav_title: 连接模型      # 侧栏标签，≤12 个汉字
description: 一句话说明这篇讲什么。       # 用于搜索和 SEO meta
order: 2                # section 内顺序；index.md 使用 0
---
```

站点会把 H1 后的第一段渲染为导语；请写成普通段落，不要使用引用块。

## 中文排版

中文字符与相邻的拉丁字母或数字之间加空格，例如：「一枚 6 位码」「回填 App ID」。渲染管线不会自动插入空格，必须在源文件中写出。标点符号不需要空格。

## 截图

产品截图放在 `docs/images/app/`，格式为宽度 2000px 的 WebP，并从真实构建中截取。绝不提交旧 UI 版本的截图；应重新截取。提交前脱敏 token、二维码、API key 和已配对账号名称。单个功能页原则上最多约三张截图。

分步设置教程是例外：`docs/im/` 会嵌入 `docs/images/im/<platform>/` 中的控制台截图，每个步骤需要一张。判断标准是读者没有截图能否完成操作。

## 路由就是文件路径

`docs/start/install.md` 发布为 `/start/install`。重命名文件会改变公开 URL，因此要把旧路径加入 `site/src/content/docs.js` 的 `LEGACY_ROUTES`，并加入 `site/scripts/prepare-static-output.mjs` 的 `legacyRoutes`。

`/im/` 由桌面应用内的 `desktop/src/pages/AdapterSettings.tsx` 链接，不能移动。

## 检查

- 影响报告选中 `bun run check:docs` 时运行它。该命令会安装隔离的 `site/` 依赖树、构建 React 站点，并校验所有本地链接和图片。
- 发布说明必须与 `scripts/release.ts`、`.github/workflows/release-desktop.yml` 和带版本号的 release-notes 约定保持一致。
