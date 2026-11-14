---
title: 历史上游同步与集成（历史归档）
nav_title: 历史上游同步与集成
description: 合并保存 2026 年的相关设计、计划与任务记录，不作为现行执行指令。
order: 6
---

# 历史上游同步与集成（历史归档）

本页于 2026-11-14 按主题合并旧 Superpowers 资料，保留原设计、计划、任务摘要和进度；仅调整标题层级、旧路径、插件要求与本地绝对路径。原文中的版本、审批、完成状态和测试结果均为当时记录，不代表当前实现、当前授权或本次验证。不得按归档中的命令直接继续旧任务。

现行要求以仓库 AGENTS.md、[执行与信任边界](../../../internals/execution-boundaries.md) 和 [贡献流程](../../../internals/contributing.md) 为准；[返回归档索引](README.md)。

## 来源目录

- [plans/2026-10-19-upstream-v074-merge.md](#plans-2026-10-19-upstream-v074-merge)
- [plans/2026-10-25-upstream-sync-automation.md](#plans-2026-10-25-upstream-sync-automation)

---

<a id="plans-2026-10-19-upstream-v074-merge"></a>

## 上游 v0.7.4 合并与发版执行计划

来源：`plans/2026-10-19-upstream-v074-merge.md`。

日期：2026-10-19
工作树：`<workspace>/EchoFlow-sync-v0.7.4`（分支 `sync/upstream-v0.7.4`）
对照基线：`<repo>`（分支 `clean-history`，HEAD `038bc616`）

### 合并三方

- base（merge base）= `6d8071be8e739d32bf218b1942bec2cece12beb3`
- ours（HEAD）= `94796a413a1325d465324d79cd91ad73857531d1`
- theirs（MERGE_HEAD）= `d256c5b6aec3be1f123e0c8736548c9886d0a688`

---

### 已确认的结构性问题（必须先向用户报告）

**合并的 ours 侧是过期快照。** `94796a41` 与 `clean-history`（`038bc616`）已分叉，
`clean-history` 领先 **245 个提交**。

含义：

- 当前冲突解法凡取 "ours" 的 hunk，实际上是在用一个旧版本覆盖 `clean-history` 上更新过的实现。
- `src/server/config/providerPresets.json` 是反例也是佐证：`94796a41` 里仍带
  `jiekouai`/`shengsuanyun`/`aruhub`/`modelflare`/`atlascloud` 等被禁的第三方中转与推广 preset，
  而 `clean-history` 已经清掉并换成 `echoflowai`。工作树当前取 theirs + EchoFlow 既有清理，
  结果与 `clean-history` 一致 —— 说明此文件的解法碰巧正确，但不能推广到其他文件。
- 因此**不能**把"取 ours"当作默认策略。每个 hunk 都要三方比对。

---

### 已完成的工作

#### 1. indexed session archive 持久化（根因修复）

RED 基线（修复前，`bun test src/server/services/localIndex/sessionProjector.test.ts -t 'persists a session archive state in the indexed session row'`）：

```
Expected: true
Received: undefined
0 pass / 1 fail
```

根因：reducer/projection 侧 `archived` 正常，但 SQLite schema、projector upsert、
`SessionRow`、各显式 SELECT 与 `getProjectionSeed()` 全部缺失该列，indexed 读回得到 `undefined`。

修复内容：

| 文件 | 改动 |
|---|---|
| `migrations.ts` | 新增 additive `SCHEMA_V8`（`archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1))`），`LOCAL_INDEX_SCHEMA_VERSION` 7→8，不重建表 |
| `sessionProjector.ts` | upsert INSERT/VALUES/binding/UPSERT 追加 `archived`；`SKELETON_ROOT_SCALARS` 增加 `archived`；`SESSION_SUMMARY_PARSER_VERSION` 11→12（已有索引行重建） |
| `sessionIndex.ts` | `SessionRow` 增加 `archived`；`sessionFromRow()` 映射；list / suggestion / search / getSession / projectionSeed 的显式 SELECT 全部补列；`getProjectionSeed().summary` 恢复 `archived` |
| `sessionService.ts` | 删除 healthy indexed 路径里的"先取页再过滤 archived"逻辑，改由 SQL 过滤 |
| `sessionIndex.ts` `listSessions` | 新增 `includeArchived` 选项，默认 SQL 层 `AND archived = 0`，total 与 page 同源 |
| `database.test.ts` | 新增 frozen v7 → v8 升级夹具；v5 夹具补 `archived: 0` |
| `sessionProjector.test.ts` | archive 回归测试改为同时断言默认隐藏与 `includeArchived` 返回 |
| `local-index-session-parity.test.ts` | 新增"archived 在下一页时total 不虚高"测试；FakeLocalIndexGateway 改为真实模拟过滤语义 |

保留未动的既有字段：`openai_fast_mode`、`model_config_id`、`model_config_json`、
`runtime_instance_id`、`is_team_worker`、`repository_json`、`worktree_session_json`。

验证（本机实测）：

```
bun test src/server/services/localIndex/                         309 pass / 0 fail
bun test src/server/__tests__/local-index-session-parity.test.ts 33 pass / 0 fail
bun test src/server/services/                                   1155 pass / 0 fail
```

RED→GREEN 已被反向验证：临时把 `sessionService.ts` 改回旧的 caller-side 过滤，
新测试立即失败（32 pass / 1 fail），确认测试真的能捕捉该缺陷。

#### 2. 合并解法引入的回归（基线对照确认）

以 `clean-history` 为 baseline 逐个对照，以下失败**不是** archive 改动引起的，
而是冲突解法错误：

| 失败簇 | 根因 | 处理 |
|---|---|---|
| `connectorService.test.ts` 2 处 | 生产代码 `connectorService.ts` 未变（仍从目录名解析出 `0.9.0`），冲突解法却取了上游的 `1.0.0` | 已改回 `0.9.0`，24 pass / 0 fail |
| `provider-runtime-env.test.ts` 1 处 | 测试残留旧品牌目录 `cc-haha`，生产代码用 `echoflow-code` | 已改，16 pass / 0 fail |
| `providers.test.ts` 3 处 | 同上，4 处 `cc-haha` | 已改，173 pass / 0 fail |
| sessionCollaboration 1 处 | 墙钟断言（`>= 10000ms`）+ 30s 超时，只在 90 文件全量并发下被饿死 | 隔离运行 40 pass / 0 fail，判为负载 flake |
| downloader / conversations 等 | 待并行 agent 处理 | 进行中 |

#### 3. Provider policy 审计（已通过）

- `src/server/config/providerPresets.json` 现含：`official`、`echoflowai`、`deepseek`、
  `zhipuglm`、`kimi`、`minimax`、`opencode-go`、`lmstudio`、`ollama`、`custom`。
- 全部为官方厂商 API / 官方本地集成 / 官方订阅集成（OpenCode Go）/ EchoFlow API / custom，
  符合 `AGENTS.md` 的 provider-preset policy。
- 已无 `jiekouai`、`shengsuanyun`、`teamorouter`、`xuanshuapi`、`fennoai`、`qiniuai`、
  `atlascloud`、`apismart`、`aruhub`、`modelflare`。
- URL 无 `utm_` / `invite` / `referral` / `?code=` 参数（grep 命中数 0）。
- 代码库中剩余命中的都是**拒绝类测试**（`providerPresets.test.ts`、`settings.test.ts`
  等的 forbidden-id 正则），属正确保留。

---

### 待办

#### A. 结构决策（需用户确认，属不可逆方向选择）

是否在合并前先把 `clean-history` 的 245 个提交 rebase/merge 进 `sync/upstream-v0.7.4` 的 ours 侧？
当前在过期 ours 上解冲突，等于用旧实现覆盖 `clean-history` 的更新。

#### B. 冲突解法回归（进行中）

并行 agent 正在处理：ws/handler + conversations（10+5+4 处）、
adapters/provider-service/models-api、storage-upgrade、voice/download、cron、background-task、
trace/near、subagent transcript linking、turn-checkpoints、session messages surface。

#### C. Desktop / release（未开始）

- `desktop/electron/services/updater.ts`：`isUpdateAvailable === false` guard 疑似被 merge 丢掉，
  需恢复并保留 feed diagnostics。
- deep-link：renderer 用 `window.electron?.on`，preload 只暴露 typed `desktopHost`，
  `contextIsolation: true` 下监听实际未注册。
- Trace window（`traceWindow=1&traceSessionId=`）：`desktop/src/main.tsx` 只识别 `petWindow`，
  可能启动第二个 workspace persistence writer。需完整保留或统一退役。
- `desktop/package.json`：version 保持 `0.7.4`；description/homepage/appId/productName
  与 artifact naming 用 EchoFlow。
- `release-notes/v0.7.4.md`：唯一面向用户的 v0.7.4 叙事；禁止"上游""同步""upstream"；
  不得虚构下载 URL / artifact。

#### D. 新会话默认推理强度 = `low`（已验证满足）

三方比对结果：冲突解法在两处都正确保留了 ours。

| 位置 | ours | theirs | 工作树当前 |
|---|---|---|---|
| `src/server/api/models.ts:144` `DEFAULT_EFFORT` | `'low'` | `'medium'` | `'low'` ✅ |
| `desktop/src/stores/settingsStore.ts:216` `effortLevel` | `'low'` | `'medium'` | `'low'` ✅ |

`VALID_SESSION_EFFORT_LEVELS` = `low | medium | high | xhigh | max`（transcriptReducer.ts:147），
`normalizeEffortLevel()` 非法值回落 `DEFAULT_EFFORT`。

**结论：无需改动。** 但需在最终验证时确认 `settings.test.ts` / `publicAccess.test.ts`
中的 effort 断言仍指向 `low`。

#### E. 最终验证（未开始）

`check:server` / `check:persistence-upgrade` / `check:impact` / `check:policy` /
`check:desktop` / `check:electron` / `check:native` / `check:adapters` / `check:docs` /
`check:provider-contract` / `check:chat-contract` / `check:agent-flow` / `check:mobile` /
`check:coverage` / `upstream:audit` / `scripts/release.ts 0.7.4 --dry` / `verify`。

约束：不用真实模型、不连真实 provider、不用凭证、不用真实用户 home/config、
不用的 maintainer override 绕过 impact policy。

---

### 禁止事项（全程有效）

- 不暂存、不提交、不发布、不打 tag、不 push。
- 冲突解法禁止 blanket `--ours` / `--theirs`；禁止未经明确确认 `git add` / `git commit`。
- 不得为了让测试通过而弱化、删除或跳过断言。
- 不得丢失 OpenAI Fast mode / model configuration / runtime instance / team worker /
  repository/worktree metadata 等既有持久化字段。
- 不得允许广告型、第三方中转、赞助、推广、邀请链接类 provider。
- 未跑验证前不得声称"修复""完成""push-ready""merge-ready""release-ready"。

---

<a id="plans-2026-10-25-upstream-sync-automation"></a>

## 上游同步：冲突自动裁决 + 工具整合 实施计划

来源：`plans/2026-10-25-upstream-sync-automation.md`。

**Goal:** 把上游同步里「可确定性裁决」的冲突从人工判断里剥离出来，同时收敛现有 `scripts/upstream/` 的重复逻辑，让一次 127 文件规模的同步从数天压到小时级。

**Architecture:** 三条分界线——**确定性计算进代码**（扩展现有模块，不新增脚本）、**裁决规则进数据**（`sync-policy.json`）、**语义判断进 agent**（Workflow 并行，不写脚本）。`sync-plan.ts` 继续作为纯逻辑宿主，收纳品牌归一化与 hunk 分类；`merge-state.ts` 复用它已有的工作树读写面，新增只写不暂存的 `--resolve-brand`；`pr-conflict-map.ts` 改为从策略数据读规则，不再硬编码文件清单。

**Tech Stack:** Bun、TypeScript（2 空格、无分号、ESM）、`bun:test`、`git merge-tree` / `git status --porcelain -z`

**Spec:** `AGENTS.md`「Upstream Sync Direction」+ `docs/internals/contributing.md`「冲突矩阵模板」+ 本次会话确认的设计约束

### Global Constraints

- **禁止 blanket `--ours`/`--theirs`**：只按 hunk 解，且只有能证明「两边差异仅为品牌词」的 hunk 才自动解（`AGENTS.md`）。
- **`git add` / `git commit` 永远由维护者显式执行**：任何自动化不得暂存、不得提交（`AGENTS.md`）。
- **`src/server/config/providerPresets.json` 永远 `manual`**：上游 provider 新增默认拒绝，按规则裁定而非 id 列表（`AGENTS.md`）。
- **不新增脚本入口**：本次不加 `package.json` 的 `upstream:*` 命令，不加 `scripts/upstream/` 新 `.ts` 文件。唯一新增文件是数据文件 `sync-policy.json`。
- **品牌映射固定**：`Claude-Code-Haha` → `EchoFlow-Code`、`cc-haha` → `echoflow`、`CC_HAHA_` → `ECHOFLOW_`；同时保留上游 `Claude Code` / `claude-code-*` / `CLAUDE_CODE_*` 术语（`AGENTS.md`）。
- **代码风格**：TypeScript，2 空格缩进，ESM import，无分号，`camelCase` 函数，导出用 `export function` / `export type`。
- **只跑最窄的相关测试**；声称完成前跑 `bun run check:policy`。
- **不动无关文件**：工作区当前有 `D CLAUDE.md` 与 `M scripts/upstream/pr-conflict-map.test.ts`（用户既有改动），不得回退、覆盖或重新格式化。

### Review Focus

1. **品牌词替换顺序**：`CC_HAHA_` 与 `cc-haha` 若短词先替换会互相污染。测试必须钉住「最长优先」。
2. **误判 brand-only**：两边都改了语义但恰好品牌词不同 → 必须归 `semantic`，不得自动解。守卫是「归一化后是否相等」。
3. **自动化不得暂存/提交**：`--resolve-brand` 写盘后文件必须仍是 unmerged 状态，等维护者 `git add`。
4. **`providerPresets.json` 被误自动解**：策略 `manual` 文件必须整体跳过，不进 hunk 分类。
5. **冲突标记解析遇边界**：正文含 `=======` 行、modify/delete 冲突（无标准三段标记）必须原样保留、归入待处理，不能崩、不能误解。

---

#### Task 1: 裁决策略数据化 + `areaOf` 去重

**Files:**
- Create: `scripts/upstream/sync-policy.json`
- Modify: `scripts/upstream/sync-plan.ts`
- Modify: `scripts/upstream/sync-plan.test.ts`
- Modify: `scripts/upstream/pr-conflict-map.ts`
- Modify: `scripts/upstream/pr-conflict-map.test.ts`
- Modify: `scripts/upstream/merge-state.ts`
- Modify: `scripts/upstream/merge-state.test.ts`

**Interfaces:**
- Consumes: 现有 `areaOf`（`pr-conflict-map.ts:38` 与 `merge-state.ts:57` 两份完全相同的拷贝）、`BRAND_FILES`/`MANUAL_FILES` 常量（`pr-conflict-map.ts:31-33`）
- Produces:
  - `export type BrandToken = { upstream: string, fork: string }`
  - `export type FileDecision = 'fork-brand-with-upstream-logic' | 'manual'`
  - `export type SyncPolicy = { brandTokens: BrandToken[], fileDecisions: Record<string, FileDecision> }`
  - `export function parseSyncPolicy(json: string): SyncPolicy`
  - `export function decisionFor(path: string, policy: SyncPolicy): FileDecision | null`
  - `export function areaOf(file: string): string`（迁入 `sync-plan.ts`，原两处改为 re-export 或直接 import）
- 数据文件 `sync-policy.json` 形状：

```json
{
  "brandTokens": [
    { "upstream": "Claude-Code-Haha", "fork": "EchoFlow-Code" },
    { "upstream": "CC_HAHA_", "fork": "ECHOFLOW_" },
    { "upstream": "cc-haha", "fork": "echoflow" }
  ],
  "fileDecisions": {
    "package.json": "fork-brand-with-upstream-logic",
    "LICENSE": "fork-brand-with-upstream-logic",
    "README.md": "fork-brand-with-upstream-logic",
    "desktop/package.json": "fork-brand-with-upstream-logic",
    "AGENTS.md": "fork-brand-with-upstream-logic",
    "src/server/config/providerPresets.json": "manual"
  }
}
```

（`brandTokens` 数组顺序即替换顺序：最长优先，见 Task 2。）

- [ ] **Step 1: 写失败测试**（`scripts/upstream/sync-plan.test.ts` 追加）

```ts
describe('parseSyncPolicy', () => {
  test('reads brand tokens and file decisions from policy data', () => {
    const policy = parseSyncPolicy(JSON.stringify({
      brandTokens: [{ upstream: 'cc-haha', fork: 'echoflow' }],
      fileDecisions: { 'package.json': 'fork-brand-with-upstream-logic' },
    }))
    expect(policy.brandTokens).toHaveLength(1)
    expect(policy.fileDecisions['package.json']).toBe('fork-brand-with-upstream-logic')
  })

  test('rejects an unknown file decision', () => {
    expect(() => parseSyncPolicy(JSON.stringify({
      brandTokens: [],
      fileDecisions: { 'x.ts': 'take-theirs' },
    }))).toThrow()
  })
})

describe('decisionFor', () => {
  const policy = parseSyncPolicy(JSON.stringify({
    brandTokens: [],
    fileDecisions: {
      'package.json': 'fork-brand-with-upstream-logic',
      'src/server/config/providerPresets.json': 'manual',
    },
  }))

  test('returns the recorded decision for a known path', () => {
    expect(decisionFor('package.json', policy)).toBe('fork-brand-with-upstream-logic')
  })

  test('returns null for a path with no recorded decision', () => {
    expect(decisionFor('src/server/foo.ts', policy)).toBeNull()
  })
})

describe('areaOf', () => {
  test('buckets the two big trees by their second segment', () => {
    expect(areaOf('desktop/src/pages/Settings.tsx')).toBe('desktop/src')
    expect(areaOf('src/server/config/x.ts')).toBe('src/server')
  })

  test('buckets a root-level file as repository root', () => {
    expect(areaOf('package.json')).toBe('仓库根目录')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test ./scripts/upstream/sync-plan.test.ts -t 'parseSyncPolicy|decisionFor|areaOf'`
Expected: FAIL（`parseSyncPolicy` / `decisionFor` 未定义；`areaOf` 尚未迁入）

- [ ] **Step 3: 实现**

`sync-plan.ts` 顶部新增类型与函数。`parseSyncPolicy` 用 `JSON.parse` 后逐字段校验：`brandTokens` 必须是 `{ upstream, fork }` 数组，`fileDecisions` 的值必须落在 `FileDecision` 联合内，否则 `throw new Error(...)`。`decisionFor(path, policy)` 直接查 `fileDecisions[path]`，未命中返回 `null`。

`areaOf` 从 `pr-conflict-map.ts:38-50` 原样迁入 `sync-plan.ts`；`pr-conflict-map.ts` 与 `merge-state.ts` 改为 `import { areaOf } from './sync-plan'`，删除各自的本地拷贝。两者的 `areaOf` 测试同步迁到 `sync-plan.test.ts`（保留原断言，不改期望值）。

`pr-conflict-map.ts` 删除 `BRAND_FILES`/`MANUAL_FILES` 常量，改为 `readFileSync('scripts/upstream/sync-policy.json', 'utf8')` 后 `parseSyncPolicy`。预填决策改用 `decisionFor`：`fork-brand-with-upstream-logic` → 显示 `'ours（品牌类）'`，`manual` → 显示 `'manual（provider 政策）'`，其余留空。**显示文案保持不变**，因为现有测试断言这些字符串。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test ./scripts/upstream/sync-plan.test.ts ./scripts/upstream/pr-conflict-map.test.ts ./scripts/upstream/merge-state.test.ts`
Expected: PASS（既有断言不改期望值，只改 import 来源）

- [ ] **Step 5: 跑政策回归**

Run: `bun run check:policy`
Expected: 全绿。若 `quality-contract.test.ts` 对文件数量或字节预算有断言，按报错信息把 `sync-policy.json` 纳入其白名单（这是产品决策的一部分，不是绕过）。

- [ ] **Step 6: Commit**

```bash
git add scripts/upstream/sync-policy.json scripts/upstream/sync-plan.ts scripts/upstream/sync-plan.test.ts scripts/upstream/pr-conflict-map.ts scripts/upstream/pr-conflict-map.test.ts scripts/upstream/merge-state.ts scripts/upstream/merge-state.test.ts
git commit -m "refactor(upstream): move sync decisions into policy data and share areaOf" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

#### Task 2: 品牌归一化 + hunk 分类（纯逻辑）

**Files:**
- Modify: `scripts/upstream/sync-plan.ts`
- Modify: `scripts/upstream/sync-plan.test.ts`

**Interfaces:**
- Consumes: `SyncPolicy`、`BrandToken`（Task 1）
- Produces:
  - `export function normalizeForkBrand(text: string, policy: SyncPolicy): string`
  - `export function classifyConflictHunk(input: { ours: string, theirs: string, policy: SyncPolicy }): 'brand-only' | 'semantic'`

- [ ] **Step 1: 写失败测试**

```ts
describe('normalizeForkBrand', () => {
  const policy = parseSyncPolicy(JSON.stringify({
    brandTokens: [
      { upstream: 'Claude-Code-Haha', fork: 'EchoFlow-Code' },
      { upstream: 'CC_HAHA_', fork: 'ECHOFLOW_' },
      { upstream: 'cc-haha', fork: 'echoflow' },
    ],
    fileDecisions: {},
  }))

  test('rewrites upstream brand tokens to fork tokens', () => {
    expect(normalizeForkBrand('from cc-haha-plugin', policy)).toBe('from echoflow-plugin')
    expect(normalizeForkBrand('CC_HAHA_API_KEY', policy)).toBe('ECHOFLOW_API_KEY')
    expect(normalizeForkBrand('Claude-Code-Haha', policy)).toBe('EchoFlow-Code')
  })

  test('replaces longest tokens first so shorter tokens cannot clobber', () => {
    // 若先替换 cc-haha，CC_HAHA_ 不会被改写；若顺序错乱，Claude-Code-Haha 可能被截断。
    expect(normalizeForkBrand('CC_HAHA_X cc-haha Claude-Code-Haha', policy))
      .toBe('ECHOFLOW_X echoflow EchoFlow-Code')
  })

  test('leaves text without brand tokens unchanged', () => {
    expect(normalizeForkBrand('claude-code-plugin CLAUDE_CODE_HOME', policy))
      .toBe('claude-code-plugin CLAUDE_CODE_HOME')
  })
})

describe('classifyConflictHunk', () => {
  const policy = parseSyncPolicy(JSON.stringify({
    brandTokens: [{ upstream: 'cc-haha', fork: 'echoflow' }],
    fileDecisions: {},
  }))

  test('classifies hunks that differ only by brand tokens as brand-only', () => {
    expect(classifyConflictHunk({ ours: 'echoflow-api', theirs: 'cc-haha-api', policy }))
      .toBe('brand-only')
  })

  test('classifies hunks with real code divergence as semantic', () => {
    expect(classifyConflictHunk({ ours: 'echoflow-api-v2', theirs: 'cc-haha-api-v1', policy }))
      .toBe('semantic')
  })

  test('classifies identical sides as brand-only', () => {
    expect(classifyConflictHunk({ ours: 'same', theirs: 'same', policy })).toBe('brand-only')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test ./scripts/upstream/sync-plan.test.ts -t 'normalizeForkBrand|classifyConflictHunk'`
Expected: FAIL（函数未定义）

- [ ] **Step 3: 实现**

`normalizeForkBrand(text, policy)`：按 `policy.brandTokens` **数组顺序**逐个 `replaceAll(token.upstream, token.fork)`。数组顺序即最长优先（数据文件在 Task 1 已按 `Claude-Code-Haha` → `CC_HAHA_` → `cc-haha` 排列）；实现里再加一道保险——若数组未按 `upstream.length` 降序，先排序再替换，并在注释说明原因（短词先替换会污染长词）。

`classifyConflictHunk({ ours, theirs, policy })`：`normalizeForkBrand(ours) === normalizeForkBrand(theirs)` → `'brand-only'`，否则 `'semantic'`。语义即「归一化品牌后是否仍然相等」——这是唯一守卫，不要试图写更聪明的启发式。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test ./scripts/upstream/sync-plan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/upstream/sync-plan.ts scripts/upstream/sync-plan.test.ts
git commit -m "feat(upstream): classify conflict hunks by brand-token-only divergence" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

#### Task 3: `merge-state.ts --resolve-brand`（只写不暂存）

**Files:**
- Modify: `scripts/upstream/merge-state.ts`
- Modify: `scripts/upstream/merge-state.test.ts`

**Interfaces:**
- Consumes: `normalizeForkBrand`、`classifyConflictHunk`、`parseSyncPolicy`（Task 1/2）
- Produces:
  - `export function splitConflictHunks(content: string): Array<{ kind: 'text', text: string } | { kind: 'conflict', ours: string, theirs: string, raw: string }>`
  - `export function resolveBrandOnlyHunks(input: { content: string, policy: SyncPolicy }): { content: string, resolved: number, remaining: number }`
  - CLI 追加 `--resolve-brand` 开关（配合现有 `--cwd`）

**语义：** 每个 `kind: 'conflict'` hunk 若 `classifyConflictHunk` 判为 `'brand-only'`，则整块替换为 `normalizeForkBrand(theirs)`——即「上游逻辑 + fork 品牌」，正是 `AGENTS.md` 要求的取法。hunk 判为 `brand-only` 时 `normalizeForkBrand(ours)` 与 `normalizeForkBrand(theirs)` 必然相等，故取哪边归一化结果一致，测试断言这一点。`'semantic'` hunk 原样保留冲突标记。**不调用 `git add`**。

- [ ] **Step 1: 写失败测试**（`merge-state.test.ts` 追加）

```ts
describe('splitConflictHunks', () => {
  test('separates conflict blocks from surrounding text', () => {
    const parts = splitConflictHunks('a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> x\nb\n')
    expect(parts).toHaveLength(3)
    expect(parts[1]).toMatchObject({ kind: 'conflict', ours: 'ours\n', theirs: 'theirs\n' })
  })

  test('keeps a body line of equals signs outside a conflict intact', () => {
    const parts = splitConflictHunks('top\n=======\nbottom\n')
    expect(parts).toEqual([{ kind: 'text', text: 'top\n=======\nbottom\n' }])
  })
})

describe('resolveBrandOnlyHunks', () => {
  const policy = parseSyncPolicy(JSON.stringify({
    brandTokens: [{ upstream: 'cc-haha', fork: 'echoflow' }],
    fileDecisions: {},
  }))

  test('resolves a brand-only hunk to the fork brand over upstream logic', () => {
    const result = resolveBrandOnlyHunks({
      content: 'a\n<<<<<<< HEAD\nechoflow-api\n=======\ncc-haha-api\n>>>>>>> x\nb\n',
      policy,
    })
    expect(result.content).toBe('a\nechoflow-api\nb\n')
    expect(result.resolved).toBe(1)
    expect(result.remaining).toBe(0)
  })

  test('leaves a semantic hunk marked and counts it as remaining', () => {
    const before = '<<<<<<< HEAD\nv2\n=======\nv1\n>>>>>>> x\n'
    const result = resolveBrandOnlyHunks({ content: before, policy })
    expect(result.content).toBe(before)
    expect(result.resolved).toBe(0)
    expect(result.remaining).toBe(1)
  })

  test('both normalizations agree for a brand-only hunk', () => {
    // 证明取 theirs 再归一化 与 取 ours 再归一化 等价，故自动解无歧义。
    const ours = 'echoflow-api'
    const theirs = 'cc-haha-api'
    expect(normalizeForkBrand(ours, policy)).toBe(normalizeForkBrand(theirs, policy))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test ./scripts/upstream/merge-state.test.ts -t 'splitConflictHunks|resolveBrandOnlyHunks'`
Expected: FAIL（函数未定义）

- [ ] **Step 3: 实现纯函数**

`splitConflictHunks`：按行扫描，只把「以 `<<<<<<< ` 开头 → 以 `=======` 单独一行 → 以 `>>>>>>> ` 开头」的完整三段识别为 `conflict`；`=======` 前后必须确实处在 `<<<<<<<`/`>>>>>>>` 之间才算分隔符，否则算普通文本。缺尾段（modify/delete 常见）的残留标记整体按 `text` 原样返回，不抛错。

`resolveBrandOnlyHunks`：遍历 `splitConflictHunks` 结果，对 `conflict` 逐块分类；`brand-only` → 写 `normalizeForkBrand(theirs, policy)`，`semantic` → 写回 `raw`。返回新内容与两个计数。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test ./scripts/upstream/merge-state.test.ts`
Expected: PASS

- [ ] **Step 5: 写 CLI 失败测试并实现 `--resolve-brand`**

CLI 测试（夹具沿用 `merge-state.test.ts` 既有模式：`mkdtempSync(path.join(tmpdir(), 'merge-state-…-'))` + 第 69 行附近的 git 命令助手，`git checkout -m` 造出未合并文件）：

```ts
test('resolve-brand rewrites file content without staging it', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-resolve-brand-'))
  // 用助手在 repo 里造出 UU 状态的 conflicted.ts，内容含一个 brand-only hunk
  runGit(repo, ['checkout', '-m', 'conflicted.ts'])
  writeFileSync(join(repo, 'conflicted.ts'),
    'a\n<<<<<<< HEAD\nechoflow-api\n=======\ncc-haha-api\n>>>>>>> x\nb\n')

  const result = runMain(['--cwd', repo, '--resolve-brand'])
  expect(result.exitCode).toBe(0)

  const content = readFileSync(join(repo, 'conflicted.ts'), 'utf8')
  expect(content).toContain('echoflow-api')
  expect(content).not.toContain('<<<<<<<')
  // 关键不变量：只写盘不暂存，等维护者 git add
  const status = runGit(repo, ['status', '--porcelain', '-z'])
  expect(status).toMatch(/^UU /m)
})

test('resolve-brand leaves a semantic hunk marked for a human', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-resolve-semantic-'))
  runGit(repo, ['checkout', '-m', 'conflicted.ts'])
  writeFileSync(join(repo, 'conflicted.ts'), '<<<<<<< HEAD\nv2\n=======\nv1\n>>>>>>> x\n')
  runMain(['--cwd', repo, '--resolve-brand'])
  expect(readFileSync(join(repo, 'conflicted.ts'), 'utf8')).toContain('<<<<<<<')
})

test('resolve-brand skips manual policy files entirely', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-resolve-manual-'))
  runGit(repo, ['checkout', '-m', 'src/server/config/providerPresets.json'])
  const before = '<<<<<<< HEAD\nechoflow-api\n=======\ncc-haha-api\n>>>>>>> x\n'
  writeFileSync(join(repo, 'src/server/config/providerPresets.json'), before)
  runMain(['--cwd', repo, '--resolve-brand'])
  expect(readFileSync(join(repo, 'src/server/config/providerPresets.json'), 'utf8')).toBe(before)
})
```

（`runMain` / `runGit` 是测试文件里已有的调用助手；若现有命名不同，按现有命名改写，不新造第三套。）

实现：`main()` 里 `--resolve-brand` 分支先 `readMergeState(root)` 找出 `hasMarkers` 的文件，跳过 `decisionFor(path, policy) === 'manual'` 的路径，对其余文件 `readFileSync` → `resolveBrandOnlyHunks` → `writeFileSync`。**绝不 `git add`**。最后复用 `formatMergeState` 打印剩余待处理项。文件头注释同步改写为「默认只读；`--resolve-brand` 只写文件内容，不暂存、不提交」。

- [ ] **Step 6: 跑测试确认通过 + 政策回归**

Run: `bun test ./scripts/upstream/merge-state.test.ts && bun run check:policy`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add scripts/upstream/merge-state.ts scripts/upstream/merge-state.test.ts
git commit -m "feat(upstream): add --resolve-brand for brand-only conflict hunks" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

#### Task 4: 流程文档 + 并行解冲突规程

**Files:**
- Modify: `docs/internals/contributing.md`
- Modify: `docs/en/internals/contributing.md`
- Modify: `AGENTS.md`（一行指针）

**Interfaces:**
- Consumes: Task 1–3 的命令与语义
- Produces: 维护者可照做的同步流程；agent 可照做的并行解冲突规程

- [ ] **Step 1: 更新中文文档**

`docs/internals/contributing.md`「冲突矩阵模板」一节之后插入「自动裁决与并行解冲突」小节，内容覆盖：

1. 同步四步之后追加一步：`bun run scripts/upstream/merge-state.ts --cwd <worktree> --resolve-brand`，说明它只解「品牌词差异」的 hunk、只写盘不暂存、`manual` 文件整体跳过。
2. 剩余 `semantic` 冲突按 `areaOf` 分区并行处理，每区一个 agent、各自跑所属门禁：

| 区域 | 判断依据 | 验证命令 |
| --- | --- | --- |
| `desktop/src` | 上游 UI 改动意图 + fork 品牌 | `bun run check:desktop` |
| `src/server` | 上游服务端语义 + provider 政策 | `bun run check:server` |
| `desktop/electron` + `src/services` | 宿主进程与运行时 | `bun run check:desktop` / `bun run check:server` |
| `docs/` + 杂项 | 文档一致性、品牌审计 | `bun run check:docs` |

3. 明确纪律：**取 hunk 级混合**——fork 品牌词 + 上游逻辑，不整文件取一边；`providerPresets.json` 逐条按 provider 政策裁定；解完由 `@code-reviewer` 复核，`bun run check:policy` 通过后再请维护者 `git add` / `git commit`。
4. 治本提示：冲突集中在 `desktop/src` 与 `src/server`（本次 76%），新增定制尽量落在配置/adapter/独立模块，减少与上游共享路径的重叠。

- [ ] **Step 2: 同步英文镜像**

`docs/en/internals/contributing.md` 对应小节逐段翻译，保持术语与命令原文。

- [ ] **Step 3: `AGENTS.md` 加一行指针**

在「Upstream Sync Direction」的 `upstream:resolve` 那条命令说明里补一句：解冲突前先跑 `merge-state.ts --resolve-brand` 自动收掉品牌类 hunk，语义 hunk 再按 `docs/internals/contributing.md` 的分区规程并行处理。**只加指针，细则留在 `docs/`**（符合 AGENTS.md 自身的「How This Contract Is Maintained」规则）。

- [ ] **Step 4: 验证文档门禁**

Run: `bun run check:docs && bun run check:policy`
Expected: 全绿（`check:docs` 会 `npm ci`，顺序执行）

- [ ] **Step 5: Commit**

```bash
git add docs/internals/contributing.md docs/en/internals/contributing.md AGENTS.md
git commit -m "docs(upstream): record brand auto-resolve and parallel conflict procedure" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### 超出本计划范围（后续独立计划）

- **减少未来冲突面**：把 fork 在 `desktop/src` / `src/server` 共享路径上的定制逐步迁到配置/adapter/独立模块。这是治本但属重构，需独立 spec 与回归锁，不应与本次工具改动混在一起。
- **`upstream:auto-resolve` 一类新脚本入口**：已明确拒绝——判断属于 agent，规则属于数据，脚本只做确定性计算；再加入口只会复制 git 调用与解析逻辑。
