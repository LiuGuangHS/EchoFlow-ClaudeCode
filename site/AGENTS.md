# React 站点规范

这些规则适用于 `site/` 下的公开落地页与文档体验。

## 不得破坏的契约

- 保持站点可通过 `npm ci` 独立安装，并可通过 `npm run build` 构建。
- 保持 `npm run check` 确定性、离线，并负责编译之外的站点专用校验。
- 保留 GitHub Pages 自定义域名契约；生产资源和路由必须从 `code.echoflow.cn` 根路径工作。`scripts/prepare-static-output.mjs` 会在 CNAME 漂移时硬失败。
- `docs/` 下文件是长篇中文和英文文档的事实来源。两种语言都有时，保持对应公开路由一致。
- 不要把私有用户状态、凭据、本地文件系统路径或未脱敏产品截图复制进站点。
- 站点或文档改动后运行 `bun run check:docs`；用户可见布局改动还要提供桌面和窄移动端浏览器证据。

## 内容如何进入站点

`scripts/generate-docs-manifest.mjs` 扫描 `docs/`，然后向被 Git 忽略的 `src/generated/` 输出三项：

- `docs-index.js`：立即加载的索引，包含 route、section、title、`nav_title`、description、`order`。保持小巧，它会随每个页面发送。
- `content/<id>.js`：每篇文档一个模块，保存去掉 frontmatter 后的 Markdown **正文**。`docsContent` 将 route 映射为动态 import，打开一页不会下载其余文档。
- `search-index.js`：仅由搜索对话框延迟导入。

路由来自文件路径（`docs/start/install.md` → `/start/install`）。重命名文件会重命名 URL，因此要同时把旧路径加入 `src/content/docs.js` 的 `LEGACY_ROUTES` 和 `scripts/prepare-static-output.mjs` 的 `legacyRoutes`。

侧边栏分组来自 generator 的 `sections` 数组；新增公开的顶层 `docs/` 目录必须在此注册。generator 在替换生成内容前会拒绝未注册的 section。组内顺序来自每篇文档 frontmatter 的 `order`。

## 设计系统

`src/styles/base.css` 保存共享 token。落地页全程采用用户提供的 Wandor 方向：暖纸张插画、白色渐隐环境视频、Geist 字体、Special Elite 字标、液态玻璃表面和黑色胶囊控件。整个落地路径（功能、引导、FAQ、下载）保持一致。文档使用同一纸张、插画、字体和陶土色调，通过 `src/docs/doc-wandor.css` 作用域化，确保两种主题下阅读表面都清晰。公开显示名为 `EchoFlow`；需要与实际产物一致时保留旧可执行路径和发布文件名。

首次访问 `/` 时，浏览器首选语言为中文则显示中文，其他语言显示英文。`/en` 和 `/en/start` 是英文入口；`/` 和 `/start` 保持中文路由。打开 `/` 时，已保存的手动语言选择优先。

- 使用 token（`--surface-*`、`--text-*`、`--border*`、`--brand*`、`--sp-*`、`--fs-*`、`--r-*`），不要使用字面量值。组件中的原始 hex 即为缺陷。
- 保持截图平整清晰。不要把产品 UI 叠放、倾斜、模糊或自动旋转后作为主要证据。
- 动画应解释任务阶段或阅读转场；在减少动效或暂停动效时页面仍必须完整。
- 两种主题都必须可用。`<html>` 上的 `data-theme` 由 `index.html` 的 bootstrap script 在首次绘制前设置。
- 所有样式表的断点为 1180 / 900 / 620。不要引入第四个。

## Mermaid

````mermaid 围栏会渲染为图表。`docs/` 当前没有使用它——使用过的两页已在 2026 年 7 月重构时删除——因此依赖和 `.doc-mermaid` 样式暂未使用、按需加载且不增加读者成本。保留它们：`internals/` 正是图表有价值的地方，Mermaid 主题已经接入站点 token。

## 字体

字体自托管在 `public/fonts/`，从 `desktop/public/fonts/` 复制。落地页参考明确要求 Geist 和 Special Elite Google Fonts 链接。保留本地字体回退，使字体 CDN 不可达时布局仍可用。当前只托管 latin 子集；中文字形按预期回退到平台字体，与桌面应用一致。
