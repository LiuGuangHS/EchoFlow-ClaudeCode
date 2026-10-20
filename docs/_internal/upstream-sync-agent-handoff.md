# 上游同步：机制优化分析、Agent 交接提示词、定时任务

> 生成日期：2026-10-19。本文是 `docs/internals/contributing.md`「上游同步（维护者）」的配套文档：
> 第一部分分析现有机制可优化之处，第二、三部分是可以直接复制使用的产物。
>
> 分析基于当前仓库实际状态：`main` 为同步基线，fork 版本 `0.7.1`，
> 上游 `v0.7.2` / `v0.7.3` / `v0.7.4` 全部未合入（且 v0.7.2、v0.7.3 都是 v0.7.4 的祖先），
> `v0.7.1..v0.7.4` 之间 50 个提交；`../EchoFlow-sync-v0.7.4` worktree 里
> 正在进行中的合并有 **115 个未解决冲突文件**。

---

## 第一部分：机制优化分析

### 先说结论

现有机制的骨架是对的，**不要推翻**：只读探测、人工确认 `git add`/`git commit`、
禁止 blanket `--ours`/`--theirs`、merge commit 不 rebase、跟 release tag 不跟上游 `main` 顶端
——这五条都是踩过坑后写进 `AGENTS.md` 的，价值高于任何自动化收益。

真正值得动的是**流程上的断点**，不是决策逻辑。按性价比排序：

| # | 问题 | 级别 | 成本 |
| --- | --- | --- | --- |
| A | 文档化的命令顺序跑不通：`upstream:resolve` 依赖 `upstream:sync` 先发布分支 | 高 | 改文档 / 改脚本，都很小 |
| B | 中间 release 的 release note 没有任何脚本枚举，容易被整包漏掉 | 高 | 小 |
| C | 没有品牌扫描脚本，而 `AGENTS.md` 要求审计 8 类公开身份面 | 中高 | 小 |
| D | `upstream:resolve` 在主 checkout 切分支，与 `upstream:state` 的 worktree 假设不一致 | 中 | 中 |
| E | 半成品合并无人抢救：115 个文件的工作只存在于一个 worktree 里 | 中 | 小 |
| F | 盯梢 issue 每次覆写正文，丢失「已经挂了多久」 | 中 | 小 |
| G | `check:policy` / `verify` 只写在文档里，流程上没有任何提醒 | 低 | 小 |
| H | `areaOf` 在两个脚本里重复实现 | 低 | 很小 |
| I | 仓库卫生：`pr-body.md`、`strategy/`、过期 sync 分支 | 低 | 很小 |

---

### A. 命令顺序跑不通（高）

这是当前最实际的一个坑 —— 照文档走会在第一步就报错。

`AGENTS.md:169` 和 `upstream-probe.yml:119-123` 里写的顺序都是
`check → resolve → 解决冲突 → audit → sync`。但 `sync.ts:285` 的 `--prepare-local` 实现是：

```ts
git(['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
git(['switch', '--track', '--force-create', branch, `origin/${branch}`])
```

它要求 `origin/sync/upstream-vX.Y.Z` **已经存在**。而这个分支只有 `upstream:sync`（`--publish`）
会创建。也就是说：**必须先 `--publish`，才能 `--prepare-local`**，与文档顺序正好相反。
在一个全新的 release 上，fetch 会直接以「couldn't find remote ref」失败退出。

连带第二个问题：`--force-create` 会覆盖同名本地分支。脚本只检查了「工作区干净」
（`sync.ts:279`），这个检查保护不到「本地分支上有未推送的解决成果」这种情况。

**已修复（2026-10-19）**：`sync.ts` 现在先 `fetchRelease()` 再进 `--prepare-local`，
origin 没有分支时用 release commit 本地建分支；覆盖同名本地分支前会拒绝并提示备份
（需 `--force` 才继续）。`AGENTS.md`、中英文 `contributing.md`、`upstream-probe.yml`
的顺序与 worktree 步骤均已同步改正。

---

### B. 中间 release 的 release note 会被整包漏掉（高）

`sync-plan.ts:110` 的 `pendingRelease` 从新到旧遍历，返回**第一个**未合入的 release。
当前状态下 `v0.7.2`、`v0.7.3` 都是 `v0.7.4` 的祖先，所以合并 v0.7.4 在提交图意义上确实
一次性涵盖了三个 release —— 这个判断没错。

但**提交图涵盖了 ≠ 内容被处理了**。契约要求把上游 release note 的用户可见内容归并进
fork 的 note，再删掉上游 note 文件。而：

- 没有任何脚本枚举「这次要归并哪些上游 note 文件」；
- `upstream:audit`（`audit.ts:29-39`）只在**合并完成后**报错说
  「release notes newer than the current EchoFlow version remain: …」。
  它是个事后闸门，不是事前清单。等你看到这条错误时，工作已经做完了。

以当前状态为例：worktree 里躺着上游的 `release-notes/v0.7.2.md`、`v0.7.3.md`、`v0.7.4.md`
三份 note，全都要归并。没有任何东西在开始时告诉你这一点。

**已修复（2026-10-19）**：新增纯函数 `pendingReleaseNotes()`（`sync-plan.ts`），
从目标 release 往回走到第一个已合入项，返回全部待归并的 release。结果接进
`syncPullRequestBody()` 与 `writeReport()`，报告与 PR body 都会逐条列出
`release-notes/vX.Y.Z.md`。决策逻辑未动。

---

### C. 品牌扫描：契约要求 8 个面，脚本只查了 1 个（中高）

`AGENTS.md:167` 要求每次合并后审计：

> README、docs、release notes、包元数据、诊断导出、签名/隐私页面、更新链接，
> 以及桌面端「关于」/个人资料默认值

而 `audit.ts:41` 只检查了 release note 这一个文件里的 4 个标记：

```ts
for (const marker of ['Claude Code Haha', 'Claude-Code-Haha-', 'NanmiCoder/cc-haha', 'cc-haha/compare'])
```

`scripts/pr/` 下没有任何品牌扫描脚本（已确认）。而当前 worktree 里冲突的文件恰好就包括
`README.md`、`package.json`、`desktop/package.json` —— 三个最典型的品牌面，
**解决完之后没有任何东西会去验证它们**。

**已修复（2026-10-19）**：`upstream:audit` 现在扫 `README.md`、`package.json`、
`desktop/package.json`、`AGENTS.md` 四个固定文件（清单导出为 `BRAND_FILES`），
标记在原来 4 个基础上加了「阿江」。`AGENTS.md` 里那条**描述本规则自身的说明行**
按固定特征豁免，否则扫描会对自己报红；豁免是按行的，文件里真正的违规照样报。
全仓扫描不做 —— 固定清单误报率低，且正好覆盖冲突高发区。

---

### D. 两条路径假设不一致：主 checkout vs worktree（中）

- `upstream:resolve`（`sync.ts:278`）在**当前 checkout** 里 `git switch`。
- `upstream:state`（`merge-state.ts:15`）的文档示例是
  `bun run upstream:state --cwd ../EchoFlow-sync-v0.7.4`，假设合并活在**独立 worktree** 里。
- 而**没有任何脚本帮你建那个 worktree**，得手工 `git worktree add`。

结果就是：按 `resolve` 的路子走，你的主 checkout 被切走并可能覆盖同名分支；
按 `state` 的路子走，你得先手工建 worktree。两条路都能用，但文档没说明白该走哪条。

**建议收敛**：统一到 worktree 路径。给 `--prepare-local` 加一个 `--worktree <path>`，
自己 `git worktree add` 好再切分支合并。这样 `upstream:resolve` 和 `upstream:state`
的 `--cwd` 就对上了，主 checkout 也不会被切走。

（当前 `../EchoFlow-sync-v0.7.4` 这个 worktree 就是手工建的，说明这条路是实际在走的。）

---

### E. 半成品合并没有兜底（中）

`../EchoFlow-sync-v0.7.4` 里有 115 个未解决冲突文件，按区域分布：

```
38  desktop/src      37  src/server     8  docs          8  desktop/electron
 7  scripts           5  src/services   2  src/utils     2  仓库根目录
 1  src/tools  1  src/cli  1  release-notes  1  desktop/scripts
 1  desktop/build  1  desktop  1  adapters  1  .agents
```

根目录那 2 个是 `README.md` 和 `package.json`。

`merge-state.ts` 是**只读**的 —— 它报告进度，不备份。这个 worktree 一旦被删
（清理磁盘、重装系统、`git worktree prune`），这 115 个文件的裁决工作就全没了。

而 v0.6.4 那次是打了快照 tag `pre-merge-v0.6.4-snapshot` 的，这次没有。

**最小修复**：把「开打前先打快照 tag」写进检查清单，并让 `merge-state.ts` 在
报告里提醒「当前无快照 tag」。不需要自动化 —— 提醒就够了。

---

### F. 盯梢 issue 每次覆写正文，丢掉时间信息（中）

`upstream-probe.yml:129` 用 `gh issue edit` **原地覆写**整个正文。
于是「v0.7.4 从哪天开始挂着」这个问题，第二天就答不出来了 —— 而「挂了多久」
恰恰是决定「要不要现在动手」的关键信息。

另外：**盯梢 issue 完全不知道 worktree 里有个半成品合并**。它每天重算
`merge-tree`，每天都报同样的「冲突 N 个文件」，好像什么都没发生过。
在一个持续数天的合并战役里，这个 issue 是噪音。

**最小修复**：在 issue 正文里维护一行「首次发现日期」，只在首次创建时写入、
后续 edit 时原样带回来。改动很小，把 `gh issue edit` 前先 `gh issue view` 读出
旧正文里的那一行即可。

---

### G. `check:policy` / `verify` 只存在于文档里（低）

契约（`AGENTS.md:168`）要求暂存前跑 `bun run check:policy`、
声称可推送前跑 `bun run verify`。现在完全是靠人记住。
流程上没有任何提醒 —— 连 `upstream:audit` 都不会提示下一步该跑什么。

**最小修复**：`upstream:audit` 通过时，在输出里把下一跳命令打出来
（`bun run check:policy` → 人工 `git add`/`commit` → `bun run verify` → `upstream:sync`）。
一行 `console.log` 的事。

---

### H. `areaOf` 重复实现（低）

`merge-state.ts:57-69` 和 `pr-conflict-map.ts:38-50` 定义了两份完全相同的 `areaOf`。
抽到共享模块里，顺手把「仓库根目录 / `desktop|X` / `X`」这套分桶规则固定住。

---

### I. 仓库卫生（低）

当前工作区有几样东西和上游同步无关，混在一起会污染这次改动：

- **`pr-body.md`**（仓库根目录）：内容是另一份完全无关的 PR 描述
  （bash 安全检查、router context、secureStorage 权限、组件定时器、覆盖率超时）。
  属于临时草稿，不该提交到根目录。
- **`strategy/2026-07-next-phase-direction.md`**：产品方向草案。它自己的第 8 节
  就写明「本次未能运行任何仓库检查命令」。要么移进 `docs/` 并标明是草案，
  要么挪出仓库。放在根目录作为未跟踪文件不合适。
- **过期的本地分支** `sync/upstream-v0.6.7`、`sync/upstream-v0.6.8`：
  `sync.ts:390` 的 branch-diverged 守卫看的是**远端**分支内容，所以本地残留不影响探测。
  风险低，但会让人误判「是不是还有旧同步没做完」。

---

### 关于 GITHUB_TOKEN「PR 拿不到 CI」这个历史阻塞点

结论：**可以解决，但不值得优先解决。**

这条记录得很清楚（`contributing.md`「自动化边界」）：用默认 `GITHUB_TOKEN` 开的 PR
不触发 `pull_request` 工作流，所以自动开的同步 PR 永远拿不到 CI 结果。

技术上它是可解的，按推荐度排序：

| 方案 | 评价 |
| --- | --- |
| **GitHub App 安装令牌**（`actions/create-github-app-token`） | **正解**。用 App 令牌开的 PR 会正常触发 `pull_request`。作用域收敛到本仓库的 `contents:write` + `pull_requests:write`。成本：建 App、安装、把 App ID 和私钥存成 secret —— 目前仓库里两者都没有。 |
| 细粒度 PAT 存 secret | 也能触发，配置更快。但它是**某个人的身份令牌**，带着这个人的权限，且会过期轮换。 |
| PAT 触发 `workflow_dispatch` | 能work，但绕。 |
| `pull_request_target` | **不可接受**。它会用高权限令牌执行 PR 里的代码。同步 PR 的 head 是上游的 release 提交 —— 等于拿写权限去跑第三方代码。 |

**但优先级应该放低**：当年那个自动 PR 之所以一直没合进去，真正原因不是缺 CI，
而是**冲突裁决本身是人的工作** —— 契约里 provider 政策、品牌取舍、release note 归并
全都是人来判断的。CI 补上了，PR 照样会停在那里等人。

所以正确的顺序是：先把 A–G 这些流程断点补齐（都是小改动、立刻能减少人肉时间），
App 令牌这件事等哪天真的觉得「自动开 PR 有价值」了再做。

---

## 第二部分：交给 Agent 的合并提示词

下面这段可以直接复制给执行合并的 agent。它是自包含的 —— agent 不需要再回头查契约。

````text
你负责把上游 release 合并进 EchoFlow Code 的 `main`。这是一个 fork 仓库
（上游 remote 是 `upstream`，即 NanmiCoder/cc-haha）。

# 一、你的权限边界（不可协商）

**可以做**：读取、分析、探测、编辑冲突文件的内容、运行检查命令、生成报告。

**绝对不可以做**：
1. **不执行 `git add`**
2. **不执行 `git commit`**
3. **不执行 `git push`**
4. **不运行 `bun run upstream:sync`** —— 它是 `sync.ts --publish`，最后一步就是 `git push`（`sync.ts:526`）。第 3 条已经禁止推送，这条是它的具体形态，不要因为它是 npm script 就当成"普通检查命令"。
5. **不执行 `git checkout --ours/--theirs` 之类的批量裁决**
6. **不删除任何上游 release note 文件**（除非下面第五节明确要求）
7. **不执行 `git merge --abort` 或 `git reset --hard`**

第 1–4 条必须由维护者显式确认后自己执行。你做完内容工作后**停下来**，
把报告交给人，等确认。这是 `AGENTS.md`「Upstream Sync Direction」的硬性要求。

# 二、硬编码策略常量（照抄，不要自己推断）

**品牌类文件 —— 判 `ours`，但要单独确认「上游逻辑是否需要一并带走」**：
`package.json`、`LICENSE`、`README.md`、`desktop/package.json`、`AGENTS.md`

**永远 `manual` —— 逐条按 provider 政策裁定，不允许整文件取任一边**：
`src/server/config/providerPresets.json`

**禁止出现在产物里的上游身份标记**（来自 `scripts/upstream/audit.ts`）：
`Claude Code Haha`、`Claude-Code-Haha-`、`NanmiCoder/cc-haha`、`cc-haha/compare`
（还有中文名「阿江」。这些都不得把上游写成当前 EchoFlow 的作者、维护者、联系人或产品。）

**同步分支命名**：`sync/upstream-vX.Y.Z`

# 三、命令顺序

## 维护者先做（你接手之前必须已经完成）

```bash
# 1. 只读探测 —— 确认目标 release、冲突数、同步分支。
bun run upstream:check --base main

# 2. 发布同步分支（--publish）。第 3 步的 worktree 和第 4 步的 resolve 都要求
#    origin 上已经有这个分支。这条会 git push，所以只能由维护者执行。
bun run upstream:sync --base main
```

如果 origin 上还没有 `sync/upstream-v<版本>`，说明第 2 步没做，**停下来问维护者**，
不要自己补跑。

## 你（agent）执行

```bash
# 3. 开独立 worktree。不要用主 checkout 跑下一步 —— 它会强制切分支。
git worktree add ../EchoFlow-sync-v<版本> sync/upstream-v<版本>
cd ../EchoFlow-sync-v<版本>

# 4. 在本地把 main 合进来，冲突留在工作区，不提交。
#    若 origin 上没有该分支，它也能自愈（用 release commit 本地建分支），
#    但那次合并没有可推送的目标，属于异常路径，先报告维护者。
bun run upstream:resolve

# 5. 取完整冲突清单 —— 这是你写矩阵的唯一依据。
git diff --name-only --diff-filter=U
```

# 四、冲突矩阵：先写全，再动手

**在修改任何文件之前**，先把完整矩阵写完。禁止「发现一个补一个」。

矩阵必须覆盖 `git diff --name-only --diff-filter=U` 输出的**每一个**文件，
每行四列：

| 文件 | base / ours / theirs 各做了什么 | 最终决策 | 验证命令 |
| --- | --- | --- | --- |

裁决规则：
- **禁止 blanket `--ours` / `--theirs`**，逐 hunk 裁决。
- 品牌类文件判 `ours`，但**必须单独确认上游的改动里有没有需要一并带走的逻辑** ——
  「取 fork 品牌 + 吸上游逻辑」是常见正解，不是二选一。
- `providerPresets.json` 永远 `manual`：逐条按 provider 政策裁定。
  默认**拒绝**上游新增的 provider 预设。参考 `contributing.md` 里 v0.6.4 的先例：
  上游新增的 7 个预设全部拒绝（5 个上游自己标了 deprecated，1 个链接带
  `utm_campaign=cc-haha`，1 个是赞助商）。
- 混合文件（fork 品牌 + 上游逻辑）：逐字段取舍。

# 五、release note 与版本号

**归并**：把本次涵盖的**每一个**上游 release note 的用户可见内容，
归并进 fork 的 release note。

**不保留**：上游版本标题、作者、资产名、compare 链接、仓库地址。

**删除**：上游的 release note 文件在归并完成后删除（作为 fork note 的那一份保留并改写）。

**版本号规则**（`contributing.md`「同步发版的版本号跟随」）：
- **同步驱动的发版，fork 版本号跟随上游**。
- **纯 fork 自己的发版不跟随**，走 fork 自己的版本线递增 patch。
- `desktop/package.json`、归并后的 note、发布脚本、tag 计划必须用同一个版本号。

**多 release 一并合入时**（例如 v0.7.2 + v0.7.3 + v0.7.4 一起）：
fork 版本号取**最高**的那个（`0.7.4`），三个上游 note 的用户可见内容
**全部**归并进 fork 的 `release-notes/v0.7.4.md`，然后删掉 `v0.7.2.md`、`v0.7.3.md`。

# 六、解决过程中的进度自检

```bash
bun run upstream:state --cwd ../EchoFlow-sync-v<版本>
```
按区域列出未解决冲突，分成「已改完待暂存」和「仍需处理」两类。
有未解决冲突时退出码为 1。

# 七、收尾检查（按顺序全部跑过）

```bash
bun run upstream:audit                    # 未解决冲突 / note 版本 / 品牌标记
bun run check:provider-contract           # provider 政策
bun run check:policy                      # 契约门禁
# 如果本次改动触及本地 JSON / localStorage / 配置持久化格式：
bun run check:persistence-upgrade
```

**持久化约束**（`AGENTS.md`「Persistent Storage Compatibility」）：
合并上游时**默认保留 EchoFlow 的迁移来源**，除非维护者明确说迁移窗口已关闭。

**品牌扫描**：`upstream:audit` 现在会自动扫 `README.md`、`package.json`、
`desktop/package.json`、`AGENTS.md` 四个冲突高发面，以及当前 release note 内的
全部 5 个标记。但 `AGENTS.md` 要求的完整清单还有 docs、诊断导出、签名/隐私页面、
更新链接、桌面端「关于」/个人资料默认值 —— 这五项仍需人工核对。

# 八、停下来，交给维护者

内容工作全部完成后**停止**，输出报告，等待维护者确认。报告必须包含：

1. **改动文件清单**（按区域分组）
2. **逐冲突文件的决策**：每个文件选了什么、为什么（尤其是品牌类和 provider 类）
3. **release note 归并说明**：归并了哪几个上游 note、删了哪些文件、定的是哪个 fork 版本号
4. **检查命令及结果**：每条命令的通过/失败计数，不是「已通过」三个字
5. **品牌审计结论**：第二节那 5 个标记在上述 8 个面上的核对结果
6. **剩余风险与回滚方案**

维护者确认后，由他自己执行：
```bash
git add <files> && git commit                    # 维护者执行
bun run verify                                   # 绿色才算可推送
git push origin sync/upstream-v<版本>             # 推的是解决后的分支头
# 然后手工开 PR：sync/upstream-vX.Y.Z -> main
```

**不要用 `bun run upstream:sync` 收尾。** 它推的是 `${commit}:refs/heads/${branch}`，
而 `commit` 是上游 release commit（`sync.ts:425` 的 `fetchRelease()` 返回值），不是你的
解决提交。实测：解决冲突后重跑它，远端分支头**不会变化**；若远端在此期间已是别的
内容，它会以 branch-diverged 拒绝。收尾必须用普通 `git push`。

**在 `bun run verify` 全绿之前，不得声称这次合并可推送。**

# 九、安全提醒

- `--prepare-local` 内部是 `git switch --track --force-create`：
  **会切分支并覆盖同名本地分支**。所以第三步必须先用独立 worktree。
- 它同时要求**工作区干净**，有未提交改动会直接报错退出。
- 开打前建议先打快照 tag（v0.6.4 那次的先例是 `pre-merge-v0.6.4-snapshot`）。
  这一步是可选的，但强烈建议 —— 冲突文件可能上百个，工作周期以天计。
````

---

## 第三部分：定时任务

### 原则

契约禁止自动提交。所以分界线很清楚：

- **可以定时**：任何只读、只产出情报、不碰 `git add`/`commit`/`push` 的事。
- **不可以定时**：任何会改变仓库状态的事。

### 绝对不要定时执行的

| 任务 | 为什么 |
| --- | --- |
| `git add` / `git commit` / `git push` | `AGENTS.md` 明确要求人工确认 |
| `bun run upstream:sync`（`--publish`） | 推送，且 `--force-with-lease` 覆盖远端分支 |
| `bun run upstream:resolve`（`--prepare-local`） | **强制切分支并覆盖同名本地分支**。无人值守环境下跑这个极其危险 —— 可能把主 checkout 切走 |
| 自动合并 PR / 自动 approve | 冲突裁决是人的工作 |
| `--ours` / `--theirs` 批量裁决 | 契约明令禁止 |

### 已有的定时

`.github/workflows/upstream-probe.yml` 每天 `0 1 * * *`（UTC）= 北京时间 09:00，
维护一个盯梢 issue。**保留，不要重复造。**

### 建议新增的本地定时任务

以下用 `CronCreate` 的格式（5 段 cron，**本地时区 Asia/Shanghai**）。
刻意避开整点和半整点，避免和 CI 的 09:00 挤在一起。

**任务 1：上游同步周报（推荐，长期）**

```
cron:    7 10 * * 1          # 每周一 10:07
```

触发的提示词：

```text
只读探测上游同步状态并汇报，不要修改任何文件、不要执行 git add/commit/push。

1. 运行 `GIT_CONFIG_PARAMETERS= bun run upstream:check --base main`
   （前缀 GIT_CONFIG_PARAMETERS= 是必需的：仓库记忆里记了代理环境变量会让
   GIT_CONFIG_PARAMETERS 破坏 github.com 连接，置空即可绕过。）
2. 汇报：
   - fork 当前版本 vs 上游最新 release
   - 本次涵盖哪几个上游 release tag（可能不止一个 —— 中间 release 的提交图
     会被最新的那个包含，但 release note 必须逐个归并）
   - 需要归并的上游 release note 文件路径清单
   - 落后提交数、冲突文件数、按区域分布
3. 检查是否有本地合并正在进行：
   `git worktree list` 看看有没有 sync worktree，有的话对每个跑
   `bun run upstream:state --cwd <path>`，汇报剩余冲突数。
4. 如果某个 release 已挂超过 14 天，显式标出来。

只汇报，不行动。
```

**任务 2：合并战役期间的日报（临时，按需开启）**

只在有半成品合并时开。战役结束后 `CronDelete` 掉。

```
cron:    13 9 * * 1-5        # 工作日 09:13
```

触发的提示词：

```text
只读汇报进行中的上游合并进度，不要修改任何文件、不要 git add/commit/push。

1. `git worktree list` 找到所有 sync worktree
2. 对每个跑 `bun run upstream:state --cwd <path> --json`
3. 汇报：剩余未解决数、已改完待暂存数、按区域分布、仍需处理的文件清单
4. 如果剩余数为 0，提示可以进入收尾检查阶段（upstream:audit → check:policy →
   人工 git add/commit → verify → git push origin sync/upstream-v<版本>）
5. 检查是否存在快照 tag（`git tag -l 'pre-merge-*'`），没有就提醒：
   上百个冲突文件的裁决工作只存在于 worktree 里，删掉就没了。

只汇报，不行动。
```

### 关于 7 天自动过期

本环境的 `CronCreate` 里，周期性任务**会在 7 天后自动过期**，
触发最后一次然后删除。所以：

- **任务 2（战役日报）**正好合适 —— 战役通常也就一两周，过期等于自动清理。
- **任务 1（周报）**需要长期存在，创建时把 `durable: true` 打开，
  这样它会写进 `.claude/scheduled_tasks.json` 并在会话重启后恢复。

另外：周报的第 3、4 步（查 worktree、看挂了多久）恰好补上了第一部分
F 节说的盯梢 issue 缺陷 —— issue 原地覆写丢掉了时间信息，周报从本地侧把它找回来。
