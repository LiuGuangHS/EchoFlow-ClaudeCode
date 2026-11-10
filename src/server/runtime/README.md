# 运行时层

这是 EchoFlow 自有的产品与实际执行会话的引擎之间的层。产品代码访问 `RuntimeHost`；驱动处理 ACP、SDK 或 JSON-RPC。驱动之上的代码不得导入引擎协议类型。

```text
产品 / 桌面 / 服务端功能
  └─ RuntimeHost            controlPlane.ts   安装、会话、能力
      └─ RuntimeDriver      dshDriver.ts      每个文件处理一种引擎协议
          └─ 引擎进程       fixtureAcpAgent.ts 为测试替身
```

## 本层提供的能力

| 能力 | 保证 | 位置 |
| --- | --- | --- |
| 与引擎无关的契约 | 产品只看到一个事件联合、一种会话形状和一组错误；引擎载荷只放在 `native` 中传递。 | `contract.ts` |
| 能力协商 | 每项能力默认 `unsupported`；`RuntimeHost.requireCapability()` 抛错，不静默降级。 | `capabilitySnapshot.ts`、`controlPlane.ts` |
| 事件信封 | 每个事件含 `eventId`、`sessionId`、`runId`、会话内 `seq`、`at` 和 `source`（`engine` 或 `echoflow`）。dsh 没有会话状态事件，因此驱动推导 `session.state` 并标记为 `echoflow`。 | `eventStamp.ts` |
| 更新归一化 | ACP 会话更新转为契约事件；驱动不认识的更新类型转为携带原始载荷的 `diagnostic`，不丢事件也不抛错。 | `acpProjection.ts` |
| 审批桥接 | 引擎权限请求取得产品侧 `requestId`，UI 按该 ID 回答；没有活跃回合时到达的审批回答 `cancelled`，避免引擎永久等待。 | `dshDriver.ts` |
| 回合生命周期 | 每会话仅一个活跃回合；第二次 `send()` 抛 `RuntimeBusyError`，没有隐式队列，因此 `prompt.queue` 为 `unsupported`。`interrupt()` 只在引擎确认后返回 `cancelled`；引擎忽略取消时返回 `cancelling`，回合仍活跃。引擎在流式中退出时，以 `turn.completed(reason: 'error')` 结束回合，下次 `send()` 不抛错。放弃流的消费者只取消自己的回合。消费者阻塞时最多保留 `turnBufferLimit` 个事件（2000），较旧事件丢弃并通过一条警告诊断说明。 | `dshDriver.ts` |
| 引擎主动发起回合 | 每个会话在整个生命周期中使用一个更新泵读取游标，因此用户回合之间的更新进入 `onEngineTurn`，不进入下次 `send()`。ACP 不为此类回合提供结束信号，因此在静默期后（`engineTurnIdleMs`，1 秒）或用户发送时立即结束。每会话同时只允许一个监听器，重复注册抛错；监听器抛错或拒绝时产生 `runtime.engine_listener_failed` 诊断，不停止更新泵。 | `dshDriver.ts` |
| 会话路由 | `RuntimeHost` 持有安装→连接→产品会话映射，未知 ID 返回类型化错误，并遗忘已退出连接的会话。重连安装时关闭被替换连接，旧连接迟到的退出不能清除新连接。并发连接与打开按安装及会话 ID 串行。`close()` 先关闭引擎，再等待在途连接和会话打开，避免资源超出其生命周期；引擎不回答 `session/new` 也不能卡住关闭。连接被替换后才完成打开的会话会被关闭而非注册。使用已关闭 host 抛 `RuntimeHostClosedError`。 | `controlPlane.ts` |
| 配置目录 | `config.changed` 携带引擎完整选项表：带候选项（平铺或分组）的选择值和真正布尔值。模型传输值为 `JSON.stringify([provider, model])`，与 dsh 自身目录发布的形状一致。 | `acpProjection.ts` |
| 启动诊断 | 启动器握手中退出时，在启动超时前以携带进程 stderr 的 `RuntimeStartupError` 拒绝；握手回答不同 ACP 协议版本时同样拒绝。 | `dshDriver.ts` |

## 公开接口

- `createRuntimeHost()`：面向产品的 API，含 `registerDriver`、`connect`、`openSession`、`getSession`、`capabilitiesOf`、`requireCapability`、`send`、`respondApproval`、`interrupt`、`closeSession`、`onConnectionExit`、`close`。
- `createDshDriver()`：dsh 驱动。可注入 `resolveCommand`、`spawn`、`now`、`newApprovalId`、`interruptTimeoutMs`、`closeTimeoutMs`、`sessionCloseTimeoutMs`、`sessionOpenTimeoutMs`。`sessionCloseTimeoutMs`（默认 2000）限制单个会话关闭，`closeTimeoutMs`（默认 10000）限制连接关闭；`sessionOpenTimeoutMs`（默认 15000）限制完整打开过程，`session/new` 与配置选项共享同一预算。因此引擎始终不回答 `session/new` 时会打开失败，而非卡住调用方与 host 关闭。预算耗尽后不再发送请求，失败说明预算而非恰好在途的选项。引擎在预算过期后打开的会话会被关闭，不留半开状态。
- `createEventStamper()`、`projectSessionUpdate()`、`dshBaselineCapabilities()`：供其他驱动复用的组成部分。

## 明确的缺口

以下是已声明而非遗忘的缺口，均在能力快照中为 `unsupported` 或未出现在 API 中。本节描述该层既有实现说明，不代表因文档翻译启动产品迁移：

- 原生会话列表、恢复、分叉、删除。`listSessions()` 和 `resumeSession()` 抛 `UnsupportedRuntimeCapabilityError`。
- 嵌入资源、引导、hook、技能、插件。Stdio MCP 服务均可用；图片和 HTTP MCP 服务只在握手声明对应能力时可用（`promptCapabilities.image`、`mcpCapabilities.http`）。
- `probe()` 在进程 cwd 中运行，报告握手回答的引擎版本，缺省时退回传入的安装版本。
- 尚无桌面、WebSocket 或会话存储接线，本层没有产品消费者。
- dsh 驱动使用 `__fixtures__/fixtureAcpAgent.ts` 测试，不使用真实启动器；真实握手由 `bun run check:harness` 单独覆盖。

## 添加引擎

1. 在新文件实现 `RuntimeDriver`：`probe()` 不得抛错，`start()` 返回带如实能力快照的 `RuntimeConnection`。
2. 用 `createEventStamper()` 派生事件，将引擎载荷放在 `native` 下。
3. 运行 `__fixtures__/contractSuite.ts` 中的共享行为套件 `runRuntimeContractSuite('<label>', factory)`，再添加驱动专属测试。
4. 按 `driverId` 向 `RuntimeHost` 注册，不修改产品代码。

## 验证

```bash
bun test src/server/runtime
bun run check:server
```
