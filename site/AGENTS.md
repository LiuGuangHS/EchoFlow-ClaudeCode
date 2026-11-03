# React 站点说明

这些规则适用于 `site/` 下的公开落地页和文档体验。

## 不得破坏的契约

- 保持站点可以通过 `npm ci` 独立安装，并通过 `npm run build` 构建。
- 保持 `npm run check` 确定、离线，并负责编译之外的站点专属校验。
- 保留 GitHub Pages 自定义域名契约；生产资源和路由必须在 `code.echoflow.cn` 根路径下工作。`scripts/prepare-static-output.mjs` 会在 CNAME 漂移时硬失败。
- 将 `docs/` 文件视为长篇中文和英文文档的事实来源。当两种语言都存在时，保持对应公开路由一致。
- 不要把私有用户状态、凭据、本地文件系统路径或未脱敏的产品截图复制到站点。
- 站点或文档改动后运行 `bun run check:docs`；用户可见布局变化还要提供桌面端和窄移动端浏览器证据。

## 内容如何进入站点

`scripts/generate-docs-manifest.mjs` 扫描 `docs/`，然后向 `src/generated/`（已被 gitignore）生成三类内容：

- `docs-index.js`：即时索引，包含路由、section、title、`nav_title`、description、`order`。保持精简，因为它会随每个页面发送。
- `content/<id>.js`：每篇文档一个模块，保存去掉 frontmatter 后的 Markdown body。`docsContent` 将路由映射到动态 import，打开一个页面时不会下载其余内容。
- `search-index.js`：只由搜索对话框延迟导入。

路由来自文件路径；重命名页面时的 legacy 路由步骤见 `docs/AGENTS.md`。

侧栏分组来自生成器中的 `sections` 数组——新增顶层 `docs/` 目录时必须在那里登记，否则它会按裸目录名排到最后。分组内的顺序来自各文档的 `order` frontmatter。

`/download/manifest.json` 和 `/update/latest*.yml` 不是内容：`deploy-docs.yml` 在构建后通过 `scripts/site-release-manifest.ts` 写入 `dist/`，它们永远不提交；本地 `npm run build` 既不获取也不需要这些文件。下载页先读取同源 manifest；如果自定义域名构建时没有这些文件，再读取官方 GitHub Pages 副本；两者都缺失时，最终退回 GitHub Releases 链接。

## 设计系统

`src/styles/base.css` 保存共享 token。落地页始终使用用户提供的 Wandor 方向：温暖纸张插画、白色渐隐环境视频、Geist 字体、Special Elite 字标、液态玻璃表面和黑色胶囊控件。整个落地流程，包括功能、引导、FAQ 和下载，都要保持一致。文档使用同样的纸张、插画、字体和陶土色调，并通过 `src/docs/doc-wandor.css` 作用域化，以保证两种主题下阅读表面都清晰。品牌命名遵循根目录 `AGENTS.md`；只有必须匹配已发布产物时才保留旧的 `cc-haha` / `claude-haha` 名称。

首次访问 `/` 时，浏览器偏好语言为中文就显示中文，其他语言均显示英文。`/en` 和 `/en/start` 是英文入口；`/` 和 `/start` 仍是中文路由。打开 `/` 时，已保存的手动语言选择优先。

- 使用 token（`--surface-*`、`--text-*`、`--border*`、`--brand*`、`--sp-*`、`--fs-*`、`--r-*`），不要使用字面量值。组件中的裸 hex 就是 bug。
- 截图要平整、清晰。绝不把产品 UI 叠放、倾斜、模糊或自动旋转后作为主要证据。
- 动画应解释任务阶段或阅读过渡；减少动效或暂停动效时页面仍必须完整。
- 两种主题都必须可用。`<html>` 上的 `data-theme` 在首次绘制前由 `index.html` 的 bootstrap 脚本设置。
- 样式表统一使用 1180 / 900 / 620 断点，不要引入第四个断点。

## Mermaid

````mermaid 围栏会渲染成图表。目前 `docs/` 下没有页面使用它，依赖和 `.doc-mermaid` 样式以延迟加载方式保留，不增加读者成本；`internals/` 需要图表时可直接使用，主题已接入站点 token。

## 字体

字体自托管在 `public/fonts/`，从 `desktop/public/fonts/` 复制。落地页要求 Geist 和 Special Elite；二者通过 `src/pages/home/home.css` 声明的本地 fallback（`Inter`、monospace）解析，绝不能从 CDN 获取。**绝不添加 Google Fonts 的 `@import` 或 `<link>`**——中国大陆无法访问它，会让所有标题退回 serif。这里只托管拉丁子集；中文字形有意回退到平台字体，与桌面应用一致。
