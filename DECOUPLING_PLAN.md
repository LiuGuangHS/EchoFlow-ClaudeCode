# 运行时与模型解耦重构方案

> 适用范围：`desktop`、`server`、`provider/runtime`、`agent-loop`、`docs`。
>
> 本方案基于当前仓库的真实实现，尤其是 `ConversationService.requestControl()` 和 CLI 已有的 `set_model` control request。它不把“运行时池”当作第一阶段前置条件，也不把现有 session JSONL 错误地改写成 SQL schema。

## 1. 结论先行

当前问题不是文案问题，而是领域对象和消息语义错误地合并了：

```text
ModelSelector
  -> chatStore.setSessionRuntime()
  -> set_runtime_config
  -> runtimeOverrides[sessionId]
  -> restartSessionWithRuntimeConfig()
  -> stop CLI
  -> start CLI
```

`RuntimeSelection` 中实际只有 `providerId`、`modelId` 和 `effortLevel`，它描述的是模型调用配置，不描述 CLI 进程。因此模型选择天然走进了运行时重启路径。

目标关系必须是：

```text
ModelConfig 1  ─────┬── RuntimeInstance A ─── Session A
                    ├── RuntimeInstance B ─── Session B
                    └── RuntimeInstance C ─── Session C

Session
  ├── modelConfigId       // 使用哪个模型配置
  └── runtimeInstanceId   // 由哪个 CLI 运行时实例承载
```

第一阶段继续保持当前事实：一个 Session 通常对应一个 CLI 进程。这里的“解耦”不等于立即实现多个 Session 共享同一个 CLI 进程；它要求多个独立的 RuntimeInstance 可以引用同一个不可变 ModelConfig。

CLI runtime binary（`bundled` / `installed`）是第三个独立概念，不能和 ModelConfig 或 RuntimeInstance 混用。

## 2. 已确认的根因

### 2.1 前端把模型选择命名成运行时选择

`desktop/src/types/runtime.ts` 的 `RuntimeSelection` 只有：

```ts
{
  providerId: string | null
  modelId: string
  effortLevel?: ReasoningEffortLevel
}
```

`desktop/src/stores/sessionRuntimeStore.ts` 的 `selections` 保存的也是上述模型字段，而不是进程 ID、进程状态、CLI binary 或运行时能力。

`ModelSelector.tsx` 选择模型或 reasoning effort 时调用：

```ts
useChatStore.getState().setSessionRuntime(sessionId, selection)
```

### 2.2 WebSocket 消息把模型配置定义成 runtime config

`chatStore.setSessionRuntime()` 发送：

```ts
{
  type: 'set_runtime_config',
  providerId,
  modelId,
  effortLevel,
}
```

服务端 `handleSetRuntimeConfig()` 将它保存到 `runtimeOverrides`，并在已有 CLI session 时调用 `restartSessionWithRuntimeConfig()`。

### 2.3 服务端确实执行了 stop/start

当前重启函数执行：

```ts
await conversationService.stopSessionAndWait(sessionId)
await conversationService.startSession(sessionId, workDir, sdkUrl, runtimeSettings)
```

因此界面显示“重启运行时”与实际行为一致；真正错误的是模型切换不应默认进入这条路径。

### 2.4 “点击没有反应”的直接原因

`ModelSelector.tsx` 在请求状态为 `pending` 时直接 return，并且将模型按钮和 effort 按钮设为 disabled。一次慢的 stop/start、启动失败后的未确认状态，都会让用户后续点击看起来像没有反应。

新的模型请求必须允许“最新请求覆盖等待中的请求”，而不是用运行时重启状态锁住整个模型列表。

## 3. CLI 动态切换能力的真实边界

仓库已经有可复用的控制通道：

- `ConversationService.requestControl()` 会等待 SDK control channel，发送 `control_request`，匹配 `control_response`，处理超时、断开和取消。
- `src/entrypoints/sdk/controlSchemas.ts` 中已有：

  ```ts
  {
    subtype: 'set_model'
    model?: string
  }
  ```

- `src/cli/print.ts` 收到 `set_model` 后会更新 `activeUserSpecifiedModel`、`setMainLoopModelOverride(model)`，并明确表示该模型用于后续 conversation turns，然后返回 success。

这意味着同一 provider 内的模型切换可以优先尝试：

```ts
await conversationService.requestControl(sessionId, {
  subtype: 'set_model',
  model: config.modelId,
})
```

但该 control request **只接收 model，不接收 provider 或 effort**。因此不能未经验证地宣称所有 ModelConfig 变化都可以无重启完成。

当前正确的应用策略是：

| 变化 | 第一阶段策略 |
|---|---|
| 同 provider、只改变 model | 通过 `set_model` 无重启应用 |
| provider 改变 | 重启 RuntimeInstance，重建 provider 环境和 API client |
| effort 改变 | 当前 `set_model` 不覆盖；除非另行实现并验证动态 effort，否则重启 |
| CLI runtime binary 改变 | 保持现有 `set_cli_runtime`，由运行时管理逻辑重启 |
| permission mode 改变 | 保持现有独立 permission 流程 |

`set_max_thinking_tokens` 不能直接当作 effort 切换协议：它改变的是 thinking token 上限，而不是当前 provider 的 `effort` 语义。特别是 OpenAI 官方 provider 的 reasoning effort 还涉及启动环境变量，不能静默当成普通模型切换。

因此，“模型和运行时解耦”的含义是：

1. ModelSelector 只提交 ModelConfig。
2. RuntimeManager 决定如何让当前 RuntimeInstance 应用该配置。
3. 必要的重启是运行时能力限制下的应用策略，不是模型选择器的领域行为。

## 4. 领域模型

### 4.1 ModelConfig

ModelConfig 是不可变的值对象。配置一旦被 RuntimeInstance 引用，不原地修改；用户再次选择不同字段时创建或复用另一个配置。

```ts
export type ModelConfig = {
  id: string
  providerId: string | null
  modelId: string
  effortLevel?: ReasoningEffortLevel
  displayName?: string
}
```

规则：

- `id` 只由规范化后的 `providerId`、`modelId`、`effortLevel` 生成。
- `displayName`、能力快照和 UI 标签不参与 ID，避免改文案导致配置身份变化。
- provider/model/effort 的规范化继续复用 `runtimeSelection.ts` 及服务端已有的 provider 解析逻辑，包括 Grok model alias、OpenAI effort 和官方 Claude model 解析。
- 服务端必须再次规范化和校验，不能信任前端生成的 ID。
- 相同规范化三元组在所有 Session 和 RuntimeInstance 中得到同一个 ID。

配置注册表提供：

```ts
register(config: ModelConfigInput): ModelConfig
get(configId: string): ModelConfig | null
findOrCreate(config: ModelConfigInput): ModelConfig
```

第一阶段注册表可以是服务端进程内的 canonical map，并从 session metadata 懒加载；不要为了实现解耦引入未经现有持久化约定验证的 SQL 数据库。

### 4.2 RuntimeInstance

RuntimeInstance 描述 CLI 进程的生命周期和承载能力，而不是模型配置的身份：

```ts
export type RuntimeInstance = {
  id: string
  sessionId: string
  status: 'starting' | 'ready' | 'busy' | 'stopping' | 'stopped' | 'error'
  cliRuntimeId: 'bundled' | 'installed'
  providerId: string | null
  appliedModelConfigId: string | null
  processGeneration: number
  capabilities: {
    dynamicModel: boolean
    dynamicEffort: boolean
  }
}
```

说明：

- `providerId` 是当前进程 provider context 的运行时镜像，不是 RuntimeInstance 的业务身份。
- `appliedModelConfigId` 是“当前进程已经应用的配置”镜像，不是 Session 的期望配置来源。
- 不持久化 OS PID，也不把一次进程的 PID 当作稳定 runtime ID。
- 第一阶段 `id` 可以是稳定的 session runtime binding ID，进程重启只增加 `processGeneration`；后续实现真正运行时池时再把 `sessionId` 从结构中解开。

### 4.3 Session

Session 同时拥有两个独立引用：

```ts
export type SessionBinding = {
  modelConfigId: string
  runtimeInstanceId: string
}
```

一个 ModelConfig 可以被任意多个 RuntimeInstance 引用；切换一个 Session 的 ModelConfig 不会修改其他 Session 的引用，也不会修改已注册的 ModelConfig。

## 5. 服务端分层

### 5.1 ModelConfigService

建议新增 `src/server/services/modelConfigService.ts`，职责只包括：

- 规范化和校验 ModelConfig。
- 生成稳定 ID。
- 注册/读取配置。
- 将旧的 `runtimeProviderId`、`runtimeModelId`、`effortLevel` 转换为 ModelConfig。
- 不启动、停止或重启 CLI。

### 5.2 RuntimeManager

第一阶段可以在现有 `handler.ts` 和 `ConversationService` 之上增加薄的运行时管理层，不必立即实现 runtime pool：

- `getRuntimeInstance(sessionId)`
- `applyModelConfig(sessionId, config)`
- `restartRuntimeInstance(sessionId, reason)`
- `setCliRuntime(sessionId, cliRuntimeId)`
- `getRuntimeStatus(sessionId)`

`ConversationService` 继续专注于子进程、SDK socket 和 control channel；`RuntimeManager` 决定何时调用 `requestControl()` 或 stop/start。

### 5.3 模型应用算法

```text
1. 收到 set_model_config
2. 服务端规范化输入，注册/取得 canonical ModelConfig
3. 写入 desiredModelConfigId 和递增 request generation
4. 若与 desired config 相同，返回/重发已应用状态
5. 读取 RuntimeInstance 当前 provider、applied config 和 turn 状态
6. 若 provider 相同、仅 model 改变、动态模型能力可用：
     requestControl({ subtype: 'set_model', model })
     成功后更新 appliedModelConfigId
7. 否则：
     将配置应用计划标记为 restart-required
     active turn 期间只保留 latest desired config，等 turn boundary
     idle 后重启 RuntimeInstance
8. 只有成功应用后才发送 model_config_applied
9. 失败时不覆盖 lastAppliedModelConfigId，发送 model_config_apply_failed
```

重启分支必须沿用现有的 stopped-agent、background-task、startup rollback 和 stale-version 保护。模型切换不应复制一份新的、没有版本保护的 stop/start 逻辑。

### 5.4 并发与最新请求优先

现有 `enqueueRuntimeTransition()` 适合保证同一个 Session 的运行时操作串行，但不能单独解决连续模型点击问题。新增模型应用状态：

```ts
const desiredModelConfigBySession = new Map<string, string>()
const appliedModelConfigBySession = new Map<string, string>()
const modelApplyGenerationBySession = new Map<string, number>()
const modelApplyPromises = new Map<string, Promise<void>>()
```

要求：

- 新点击立即替换 pending desired config。
- 正在等待的 control response 即使晚到，也不能覆盖更高 generation 的配置。
- 不为每个点击排队完整 stop/start。
- applied 事件必须带 `requestId` 或 generation，前端只接受当前 desired generation 的结果。
- persist 的是最终成功配置；如果产品要求重启前恢复用户选择，则另外持久化 desired 状态，并在失败时回滚。

## 6. WebSocket 协议

### 6.1 新的客户端消息

```ts
export type ModelConfigInput = {
  providerId: string | null
  modelId: string
  effortLevel?: string
}

export type SetModelConfigMessage = {
  type: 'set_model_config'
  configId?: string
  config?: ModelConfigInput
  requestId: string
}
```

`configId` 和 `config` 同时存在时，服务端规范化 `config` 并验证 ID；只有 `configId` 时从注册表读取。第一阶段桌面端发送二者，确保服务端重启后不会因为只有一个无法反解的 hash ID 而丢失配置。

### 6.2 新的服务端事件

```ts
{ type: 'model_config_applied'
  requestId: string
  configId: string
  application: 'noop' | 'in_place' | 'runtime_restart' | 'deferred'
  runtimeInstanceId: string
  providerId: string | null
  modelId: string
  effortLevel?: string
}

{ type: 'model_config_apply_failed'
  requestId: string
  configId: string
  previousConfigId?: string
  code: string
  message: string
}

{ type: 'runtime_status'
  runtimeInstanceId: string
  state: 'starting' | 'ready' | 'busy' | 'stopping' | 'stopped' | 'error'
  processGeneration: number
  reason?: string
}
```

`runtime_config_applied` 保留为旧客户端兼容事件，但新客户端不再用它驱动模型选择状态。`runtime_restarting` 等提示只由 RuntimeStore 根据 `runtime_status` 渲染。

### 6.3 旧客户端兼容

继续接受：

```ts
{ type: 'set_runtime_config', providerId, modelId, effortLevel }
```

服务端将其转换为 `findOrCreateModelConfig()` 后进入同一个 `handleSetModelConfig()`，而不是保留第二套重启逻辑。旧客户端仍可收到 `runtime_config_applied`；新客户端可同时收到新事件。

旧消息名只作为协议迁移兼容，不再新增任何依赖 `RuntimeOverride` 的业务代码。

### 6.4 独立的运行时操作

需要显式重启或切换 CLI runtime 时使用独立消息：

```ts
{ type: 'restart_runtime'; requestId: string; reason?: string }
{ type: 'set_cli_runtime'; cliRuntimeId: 'bundled' | 'installed' }
```

`set_cli_runtime` 保持现有语义。`restart_runtime` 的处理只能触碰 RuntimeInstance 生命周期，不能接收 `providerId`、`modelId` 或 `effortLevel`。

## 7. 持久化与迁移

当前真实持久化是 session JSONL 的 `session-meta`，不是数据库表。第一阶段不引入 SQL schema。

### 7.1 新字段

在新的 `session-meta` 中增加：

```ts
{
  modelConfigId: string,
  modelConfig?: {
    providerId: string | null,
    modelId: string,
    effortLevel?: string
  },
  runtimeInstanceId?: string
}
```

`modelConfig` 是用于从 session 文件恢复配置的规范化 snapshot；`modelConfigId` 才是 Session 的业务引用。不要持久化 PID 或瞬时 `status`。

### 7.2 读取优先级

```text
1. 合法的 modelConfigId + modelConfig snapshot
2. 旧 runtimeProviderId/runtimeModelId/effortLevel
3. 当前 provider/model 默认值
```

读取旧记录时：

- 不重写历史 JSONL。
- 懒注册 canonical ModelConfig。
- 在下一次成功启动或成功应用模型后追加一条带新字段的 session-meta。
- 旧字段在迁移窗口内继续读取；必要时继续写入，保证旧版本客户端能够恢复。
- 未知字段保持原有 session metadata 兼容策略，不做破坏性清理。

### 7.3 桌面 localStorage

现有 `echoflow-code-session-runtime` 不能直接删除。迁移策略：

- 新 store 先读取旧 key。
- 将旧 `Record<sessionId, RuntimeSelection>` 转换成 `ModelConfig` 和 session selection。
- 写入新 key 后保留旧 key 的读取兼容窗口。
- draft selection 也按 ModelConfig 处理，不能再把 draft 误当作 RuntimeInstance。

所有 JSON、localStorage 和 app-config shape 变化必须同时提交：

1. forward migration；
2. 旧 JSONL/localStorage fixture 回归测试；
3. `bun run check:persistence-upgrade`。

## 8. 桌面状态与 UI

### 8.1 Store 分离

建议新增/重构为：

```ts
// modelConfigStore
configs: Record<string, ModelConfig>
sessionConfigIds: Record<string, string>
modelApplyStatusBySessionId: Record<string, 'idle' | 'pending' | 'failed'>
lastAppliedConfigIds: Record<string, string>

// runtimeStore
runtimeBySessionId: Record<string, RuntimeStatus>
restartRequestStatusBySessionId: Record<string, ...>
```

旧 `sessionRuntimeStore` 在迁移期可以保留兼容 facade，但新生产代码不能继续把 `selections` 或 `runtimeRequestStatus` 当作模型应用和进程状态的共同来源。

### 8.2 ChatStore API

新增清晰的动作：

```ts
setSessionModelConfig(sessionId: string, config: ModelConfig): void
restartSessionRuntime(sessionId: string, reason?: string): void
setSessionCliRuntime(sessionId: string, runtimeId: 'bundled' | 'installed'): void
```

`setSessionModelConfig()` 只发送 `set_model_config`，不调用重启函数。旧 `setSessionRuntime()` 只作为兼容适配，内部转换到 `setSessionModelConfig()`。

### 8.3 ModelSelector

`ModelSelector` 只接受/返回 ModelConfig 或 ModelConfigInput：

- 删除 `handleRuntimeSelect` 这个语义。
- provider、model、effort 的规范化保留，但迁移到 model-config helper。
- 不再根据 runtime restart pending 禁用所有模型按钮。
- 乐观更新 `desired` 显示；收到失败事件时回滚到 `lastApplied`。
- pending 期间再次点击时覆盖前一个 pending desired config。
- 文案使用“应用模型配置”或“切换模型”，不使用“重启运行时”。

`CliRuntimeSelector` 继续负责 bundled/installed CLI runtime，并显示独立的重启状态。

### 8.4 ChatInput

当前以 `runtimeKey` 读取模型配置。迁移期可以保留参数名以避免大范围一次性改动，但其语义必须改成 session model-config key；后续重命名为 `sessionId` 或 `modelConfigKey`。

模型标签、context refresh nonce 和 applied 事件只由 ModelConfig 状态驱动；运行时 status 只控制运行时状态提示，不得阻止普通模型选择。

## 9. 分阶段实施

### 阶段 0：协议和回归基线（P0）

- 锁定现有 `set_runtime_config`、重启顺序和旧 metadata 行为。
- 增加 `ModelConfig` normalize/identity 测试。
- 增加 `set_model` control request 的 ConversationService mock 测试。
- 不修改用户的 `desktop/electron/services/deepseekHarnessRuntime.ts`。

### 阶段 1：模型配置领域化（P0）

- 引入 ModelConfig 类型和 canonical registry。
- 将 `runtimeOverrides` 拆为 session desired/applied model config 引用。
- 增加 `set_model_config` 和 `model_config_applied`。
- 旧 `set_runtime_config` 适配到新 handler。
- 增加 session JSONL 和 localStorage 迁移。
- 这一阶段即使某些切换仍需重启，也不能让 ModelSelector 直接调用重启语义。

### 阶段 2：热切换与运行时策略（P0/P1）

- 同 provider 且仅 model 改变时调用 `requestControl({ subtype: 'set_model' })`。
- provider/effort 或能力不兼容时由 RuntimeManager 选择 restart。
- 将 runtime status 和 model apply status 分离。
- 加入 latest-wins、generation、active-turn defer 和失败回滚。
- 用真实 mock SDK CLI 验证跨 WebSocket、control channel、桌面 store 的完整链路。

### 阶段 3：显式运行时管理（P1）

- `restart_runtime` 只处理 RuntimeInstance 生命周期。
- `set_cli_runtime`、permission mode 和 provider environment 的重启原因分别记录。
- 统一 runtime restart rollback、status 和诊断事件。
- 清理内部新增的 `runtimeOverride` 命名；旧事件/字段只保留在兼容边界。

### 阶段 4：配置注册表与运行时池（后续）

- 若产品需要跨应用进程共享用户预设，再增加持久化 ModelConfig registry。
- 评估多个 Session 共享一个 RuntimeInstance 的调度、并发、上下文隔离和权限边界。
- 运行时池不是阶段 1/2 完整解耦的前置条件，也不能为了“共享配置”直接共享 CLI 进程。

## 10. 测试矩阵

### Server / agent-loop

- 同一个 canonical ModelConfig 被两个 Session/RuntimeInstance 引用。
- 同 provider model 变更发送 `set_model`，不调用 stop/start。
- provider 变更调用 restart，并保留原有 stopped-agent 和 rollback 顺序。
- effort 变更按明确能力策略处理，不能误报为 in-place success。
- control response 超时、CLI 断开和 error response 会恢复 last applied config。
- 连续 A → B → C 点击最终只应用 C，迟到的 A/B response 不覆盖 C。
- active turn 期间的 restart-required 变更在 turn boundary 后应用。
- 旧 `set_runtime_config` 继续工作并发送兼容 applied 事件。
- 旧 session metadata 和旧 localStorage fixture 可以恢复。

### Desktop

- ModelSelector 不再调用 `setSessionRuntime` 重启路径。
- pending 模型请求不会禁用模型列表；第二次选择替换第一次 desired config。
- `model_config_applied` 只确认当前 request/generation。
- `model_config_apply_failed` 回滚显示值。
- runtime status 只影响 RuntimeStore/运行时提示。
- ProviderStore、ChatInput、EmptySession 和 draft selection 迁移后保持行为。

### Cross-process / E2E

至少通过仓库已有的 mock SDK CLI 验证：

```text
桌面 ModelSelector
  -> WebSocket set_model_config
  -> RuntimeManager
  -> ConversationService.requestControl
  -> CLI set_model
  -> control_response
  -> model_config_applied
  -> 桌面 applied state
```

需要运行的门禁：

```text
bun run check:server
bun run check:desktop
bun run check:chat-contract
bun run check:persistence-upgrade
bun run check:impact
bun run verify
```

不使用真实 provider、OAuth token 或 live model 检查。

## 11. 验收标准

### 领域与行为

- ModelConfig、RuntimeInstance、CLI runtime binary 三者有独立类型、store、消息语义。
- 多个 RuntimeInstance 可以引用同一个 ModelConfig，互不修改对方状态。
- ModelSelector 的请求不会直接调用 runtime restart。
- 同 provider 仅模型变化时，当前 CLI 通过 `set_model` 无重启应用。
- provider 或当前能力确实要求重启时，重启由 RuntimeManager 决定，并明确报告 runtime status。

### 交互

- 点击模型立即更新 desired UI。
- pending 不会让模型列表失去响应。
- 快速连续切换最终稳定在最后一次选择。
- 失败时回滚到最后成功配置，并显示模型应用失败，而不是假装运行时重启成功。

### 兼容性

- 旧 `set_runtime_config`、`runtime_config_applied` 和旧 session metadata 在迁移窗口内继续可用。
- 旧 localStorage fixture 可升级。
- 未知持久化字段不丢失。
- 不破坏 CLI control protocol、插件接口和 EchoFlow provider policy。

## 12. 明确不做的事情

- 不把 ModelConfig 再命名成 RuntimeSelection 或 RuntimeOverride。
- 不把所有模型切换都强制 stop/start。
- 不把 `set_max_thinking_tokens` 未经验证地当成 effort 热切换。
- 不因为多个 RuntimeInstance 使用相同 ModelConfig 就共享同一个 CLI 进程。
- 不直接创建与当前 session JSONL 体系无关的 SQL `model_configs` 表。
- 不覆盖或恢复现有 DeepSeek Harness 工作树修改。
