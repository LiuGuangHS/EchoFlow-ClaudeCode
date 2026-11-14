# Harness：dsh 执行接缝

本目录保存 EchoFlow 与 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的接缝。dsh 负责执行运行时；EchoFlow 保留自己的产品外壳、UI、会话存储和服务商路由。

本目录没有复制的 dsh 源码。dsh 通过固定版本的 npm 包使用，本目录每一行都是 EchoFlow 自有代码。

## 目录内容

| 路径 | 职责 |
| --- | --- |
| `profile/` | `echoflow` dsh 配置：bundle、补丁和禁止外发的覆盖配置 |
| `bundles/` | dsh 未自带、由 EchoFlow 维护的插件（目前为 `egress-guard`） |
| `src/` | 启动顺序（`boot.js`）和驱动 dsh 的 ACP 接缝客户端 |
| `egress-blocklist.json` | 此配置绝不能使用的插件和主机 |
| `test/` | `check:harness` 检查通道 |

## 工具链

本目录使用 npm 和 Node，不使用 Bun。仓库根目录使用 Bun；两棵目录树不共享依赖安装，根目录 `bun install` 不会进入 `harness/`。

dsh 要求 Node `>= 24.9.0`，其包也假定现代 Node 环境。根仓库自身的 Node 最低要求较低，两者有意不同。

```bash
npm --prefix harness ci      # 严格安装锁定依赖树
npm --prefix harness test    # check:harness 检查通道
npm --prefix harness run preview
```

`preview` 使用临时 `HOME`/`DSH_HOME` 启动真实启动器，并将模型服务指向 `127.0.0.1` 回环网关。不需要凭据或网络，可快速观察一个完整回合：握手、`session/new`、一次流式提示及有界退出。

## 为什么精确锁定版本

本页记录的 dsh 开发预览状态中，npm `latest` 标签指向 `0.1.0-rc.6`，比最新已发布版本更旧。使用脱字符或波浪号范围会悄悄解析到旧构建，产生看似 dsh 缺陷的失败。

因此，所有 `@deepseek-ai/*` 依赖都锁定精确版本。

### 升级流程

dsh 升级指南提醒预览版本可能包含破坏性变更，所以升级必须有意进行并经评审，不能自动升级。

1. 修改 `package.json` 中的精确版本。
2. 运行 `npm --prefix harness install` 更新 `package-lock.json`。
3. 运行 `npm --prefix harness test`。
4. **人工评审 `egress-blocklist.json`。** dsh 可能新增外发插件或重命名旧插件。`cordis.patch.yml` 中已不存在的插件 ID 不会报错，而是悄悄忽略，只留一行日志。自动检查无法发现这一失败模式，因此每次升级都要人工对照 dsh 发布说明与阻止清单。
5. 在提交信息中记录升级。

## 阶段交接记录

本节记录既有分阶段计划，不因翻译而授权迁移或证明当前产品已接入。

运行时契约和 dsh ACP 驱动的现行说明见[运行时层](../src/server/runtime/README.md)。它**不会**把桌面的 `npx` sidecar 替换为此接缝。该 sidecar 提供 dsh 网页 UI 窗口，而 ACP 驱动有意不提供；在就绪工作和可选原生 dsh 引擎决定其去向前，它仍是过渡实现。

三项工作交给后续阶段：

- `desktop/electron/services/nodeRuntime.ts` 将桌面 Node 最低要求提高到 `24.9.0`，并使用 `src/nodeFloor.js` 的 `checkNodeFloor`；此切换由就绪阶段负责。
- 驱动从 `RuntimeInstallation.executablePath` 读取启动命令，启动器的分发位置由发布阶段决定，不属于驱动改动。
- 将桌面自身的产品分析加入 `egress-blocklist.json`。
