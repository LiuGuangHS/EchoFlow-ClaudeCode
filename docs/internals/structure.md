---
title: 项目结构
nav_title: 项目结构
description: 仓库的目录职责边界：CLI、Server、桌面端、Adapter 与文档站。
order: 3
---

# 项目结构

本项目包含 CLI/TUI、本地 Server、Electron 桌面端、IM Adapter 和文档站。下面只列稳定的职责边界；具体文件以当前源码为准。

```text
.
├── bin/
│   └── echoflow-code                 # CLI 启动脚本
├── preload.ts                      # Bun preload 与构建期兼容入口
├── package.json                    # 根项目脚本和依赖
├── src/
│   ├── entrypoints/
│   │   └── cli.tsx                 # CLI 主入口
│   ├── main.tsx                    # TUI 主流程
│   ├── setup.ts                    # 启动初始化
│   ├── screens/                    # REPL 等终端界面
│   ├── components/                 # Ink UI 组件
│   ├── tools/                      # Bash、Edit、Grep 等 Agent 工具
│   ├── commands/                   # 斜杠命令
│   ├── services/                   # Provider、MCP、OAuth 等共享服务
│   ├── utils/                      # 运行时工具与 Computer Use 集成
│   ├── vendor/                     # 受控的 vendored 实现
│   └── server/
│       ├── index.ts                # Bun.serve HTTP/WebSocket 入口
│       ├── router.ts               # REST 资源路由
│       ├── api/                    # API 边界
│       ├── services/               # 会话、Provider、索引、诊断等服务
│       ├── ws/                     # WebSocket 协议和生命周期
│       ├── proxy/                  # Provider 协议转换
│       ├── middleware/             # Auth 与 CORS
│       └── config/                 # Provider 预设
├── desktop/
│   ├── src/                        # React Renderer
│   │   ├── api/                    # Server API / WebSocket 客户端
│   │   ├── components/             # Chat、Workspace、Browser、布局组件
│   │   ├── features/               # Pets 等独立功能
│   │   ├── pages/                  # 会话、设置、任务、诊断等页面
│   │   ├── stores/                 # Zustand 状态
│   │   ├── i18n/                   # 桌面多语言
│   │   └── lib/                    # Renderer 运行时工具
│   ├── electron/
│   │   ├── main.ts                 # Electron main 入口
│   │   ├── preload.ts              # 主窗口 Host bridge
│   │   ├── preview-preload.ts      # 原生预览 bridge
│   │   ├── pet-preload.ts          # 宠物窗口 bridge
│   │   ├── ipc/                    # IPC channel 与校验
│   │   └── services/               # Sidecar、终端、更新、预览等服务
│   ├── sidecars/
│   │   └── claude-sidecar.ts       # server / cli / adapters 统一入口
│   ├── scripts/                    # 构建、打包和资源准备
│   └── src-tauri/                  # 历史代码及现用打包资源；非当前 Host
├── adapters/
│   ├── common/                     # 配置、配对、消息与 WS 共享层
│   ├── dingtalk/
│   ├── feishu/
│   ├── qq/
│   ├── slack/
│   ├── telegram/
│   ├── wechat/
│   ├── wecom/
│   └── whatsapp/
├── mobile/                         # Kotlin Android 壳
├── native/
│   └── cu-helper/                  # macOS Computer Use 原生 Swift helper
├── runtime/
│   ├── win_helper.py               # Windows Computer Use helper
│   └── requirements-win.txt
├── scripts/                        # 根项目质量门禁、发布与维护脚本
├── tests/                          # 跨模块测试与测试资源
├── site/                           # React 文档站、内容索引与静态构建
└── docs/                           # 中英文 Markdown 文档内容
```

## 文档分布

| 位置 | 作用 | 是否发布 |
| --- | --- | --- |
| `docs/{start,cases,desktop,mobile,im,cli,internals}/` | 中文产品文档 | 是 |
| `docs/en/` | 英文镜像，逐文件对齐 | 是 |
| `docs/images/`、`docs/public/` | 站点图片与静态资源 | 是 |
| `release-notes/` | GitHub Release 历史 | 否，独立发布产物 |
| `docs/_internal/` | 维护者 runbook、设计/评审与 `archive/` | 否 |
| 根目录与各 surface 的 `AGENTS.md` | Agent 与贡献者指导 | 否 |
| `docs/superpowers/` | 本地计划，gitignore | 否，禁止从公开页链接 |
| `site/src/generated/` | 文档站生成的索引与内容 | 否，gitignore |

公开页改名要同时更新 `LEGACY_ROUTES` 和 `scripts/prepare-static-output.mjs` 的 `legacyRoutes`。过程稿完成后，先把仍然有效的事实提炼到 `docs/internals/`，再归档到 `docs/_internal/archive/`；不要从公开页链接 `_internal/`、`archive/` 或 `docs/superpowers/`。

## 运行边界

| 入口 | 运行时 | 说明 |
|---|---|---|
| `src/entrypoints/cli.tsx` | Bun | CLI/TUI 与 Agent 工具 |
| `src/server/index.ts` | Bun / `Bun.serve` | 本地 HTTP、WebSocket 与 H5 |
| `desktop/electron/main.ts` | Electron main | 原生桌面 Host |
| `desktop/src/` | Chromium Renderer | React 桌面 UI |
| `desktop/sidecars/claude-sidecar.ts` | Bun 编译 Sidecar | 打包后的 Server、CLI 与 Adapter 入口 |
| `adapters/<platform>/` | Bun Sidecar | 平台消息接入 |

新增代码时应放在拥有该职责的边界内：桌面原生能力进入 `desktop/electron/`，共享业务 API 进入 `src/server/`，IM 平台差异进入 `adapters/<platform>/`，不要在 Renderer 中绕过这些边界。
