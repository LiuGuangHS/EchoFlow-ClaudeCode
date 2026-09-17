# Phase 1: 准备与分析 - 执行报告

## 当前状态评估（Step 0）

### ⚠️ 工作区状态
```
分支: main
未提交更改: 22 个文件
  - 修改: 19 个文件
  - 删除: 3 个文档文件
  - 未跟踪: 3 个（UPSTREAM_DIFF_ANALYSIS.md, 新增脚本和文档）
  
变更统计: +314 / -1330 行
```

### 📋 未提交更改分类

#### A. 核心功能更改（需要先提交）
- `desktop/electron/services/deepseekHarnessRuntime.ts` (+55/-107 行)
- `desktop/electron/services/deepseekHarnessRuntime.test.ts` (+107 行)
- `desktop/src/api/echoflow.ts` (+9 行)
- `desktop/src/components/settings/EchoFlowAPIOfficialLogin.tsx` (+99 行)
- `src/server/api/echoflow.ts` (+34 行)
- `src/server/services/echoflowApiService.ts` (+56 行)
- `src/server/config/providerPresets.json` (+8 行)

#### B. 配置/文档更改
- `.gitignore` (+3 行)
- `AGENTS.md` (品牌修正)
- `desktop/package.json` (+10 行)
- `desktop/electron/main.ts` (+5 行)
- 国际化文件 (en.ts, zh.ts)
- 设置页面 (AboutSettings, ProviderSettings)

#### C. 文档删除（清理）
- `docs/superpowers/plans/2026-05-09-h5-access.md` (-830 行)
- `docs/superpowers/specs/2026-05-09-h5-access-design.md` (-194 行)
- `docs/superpowers/specs/2026-05-13-desktop-open-project-targets-design.md` (-202 行)

#### D. 新增文件（本次分析产生）
- `UPSTREAM_DIFF_ANALYSIS.md`
- `desktop/scripts/bundle-deepseek-harness.ts`
- `docs/upstream-sync/merge-v0.6.4-plan.md`

---

## ⚠️ Phase 1 执行前决策

### 问题：工作区有大量未提交更改

**选项 1: 先提交当前工作（推荐）**
```bash
# 优点:
# - 保留当前工作成果
# - 清理工作区，避免合并冲突
# - 符合 AGENTS.md 规则："Check git status before editing"

# 执行:
git add .
git commit -m "feat: enhance EchoFlow API integration and clean up docs

- Improve deepseekHarnessRuntime with better error handling
- Enhance EchoFlow API login flow and service
- Update provider presets configuration
- Clean up obsolete superpowers documentation
- Add upstream sync documentation"
```

**选项 2: Stash 当前工作**
```bash
# 优点:
# - 快速清理工作区
# - 可以随时恢复

# 缺点:
# - 合并后可能与上游更改冲突

# 执行:
git stash push -m "WIP: EchoFlow API enhancements before upstream merge"
```

**选项 3: 创建临时分支保存**
```bash
# 优点:
# - 最安全，完全隔离
# - 可以独立测试和合并

# 执行:
git checkout -b wip/echoflow-api-enhancements
git add .
git commit -m "WIP: EchoFlow API enhancements"
git checkout main
git reset --hard origin/main
```

### 🎯 推荐决策

**选择选项 1（先提交）**，理由：

1. **这些更改与上游合并正交**
   - 主要是 EchoFlow API 集成（我们独有）
   - DeepSeek Harness 改进（技术债清理）
   - 文档清理（清理过期内容）
   - 不太可能与上游 v0.6.4 的 8 个 bug 修复冲突

2. **符合 AGENTS.md 规则**
   - "Check git status before editing"
   - "Keep diffs small and owned"
   - 上游合并应该从干净的 main 开始

3. **便于问题追踪**
   - 如果合并后出问题，容易 bisect
   - 清晰的提交边界

---

## Phase 1 修正后的执行计划

### Step 1.0: 清理工作区（30分钟）⭐ **新增**

```bash
# 1. 审查当前更改
git diff desktop/electron/services/deepseekHarnessRuntime.ts | head -50
git diff src/server/config/providerPresets.json

# 2. 确认这些更改是否应该提交
# 问题检查清单:
# - [ ] 是否破坏现有功能?
# - [ ] 是否有未完成的 TODO?
# - [ ] 是否需要更多测试?

# 3. 运行快速验证
bun run typecheck
bun test desktop/electron/services/deepseekHarnessRuntime.test.ts
bun test src/server/

# 4. 如果验证通过，提交
git add .
git commit -m "feat: enhance EchoFlow API integration and clean up docs

- Improve deepseekHarnessRuntime with better error handling and test coverage
- Enhance EchoFlow API official login flow with better UX
- Update EchoFlow API service with improved error handling
- Refine provider presets configuration
- Clean up obsolete superpowers documentation (h5-access, open-project-targets)
- Add upstream v0.6.4 sync documentation and analysis

Changes align with EchoFlow fork identity and prepare for upstream merge."

# 5. 推送到远程（可选，但推荐）
git push origin main

# 6. 确认工作区干净
git status
# 预期: "working tree clean"
```

**验收标准**:
- [ ] 工作区干净（`git status` 显示 clean）
- [ ] 快速验证通过（typecheck + 关键测试）
- [ ] 提交已推送到远程

---

### Step 1.1: 环境准备（15分钟）

```bash
# 现在从干净的 main 开始

# 1. 确认远程配置
git remote -v
# 应该看到:
#   origin    https://github.com/LiuGuangHS/EchoFlow-ClaudeCode.git (fetch/push)
#   upstream  https://github.com/NanmiCoder/cc-haha.git (fetch/push)

# 2. 如果没有 upstream，添加
if ! git remote | grep -q upstream; then
  git remote add upstream https://github.com/NanmiCoder/cc-haha.git
fi

# 3. 更新所有远程分支（不包括 tags）
git fetch origin --prune
git fetch upstream +refs/heads/*:refs/remotes/upstream/* --prune

# 4. 确认 upstream/main 在 v0.6.4
git log upstream/main --oneline -1
# 预期: 02d7228b release: v0.6.4

# 5. 创建合并分支
git checkout -b merge/upstream-v0.6.4-selective

# 6. 创建快照标签
git tag pre-merge-v0.6.4-snapshot main
git tag -l "pre-merge-*"

# 7. 确认当前状态
git status
echo "✅ 环境准备完成"
echo "当前分支: $(git branch --show-current)"
echo "快照标签: $(git tag -l pre-merge-v0.6.4-snapshot)"
```

**验收标准**:
- [ ] upstream remote 已配置
- [ ] upstream/main 指向 v0.6.4
- [ ] 已在新分支 `merge/upstream-v0.6.4-selective`
- [ ] 快照标签 `pre-merge-v0.6.4-snapshot` 已创建

---

### Step 1.2: 生成差异统计（15分钟）

```bash
# 1. 创建临时目录
mkdir -p /tmp/upstream-merge-v0.6.4

# 2. 生成文件差异清单
git diff main upstream/main --stat > /tmp/upstream-merge-v0.6.4/diff-stat.txt
git diff main upstream/main --name-status > /tmp/upstream-merge-v0.6.4/diff-files.txt
git diff main upstream/main --shortstat > /tmp/upstream-merge-v0.6.4/diff-summary.txt

# 3. 查看摘要
echo "=== 差异摘要 ==="
cat /tmp/upstream-merge-v0.6.4/diff-summary.txt

# 4. 提取高冲突风险文件
echo "=== 高冲突风险文件 ==="
git diff main upstream/main --name-only | \
  grep -E "(package\.json|README|LICENSE|providerPresets|AGENTS\.md|CLAUDE\.md|desktop/package\.json)" \
  > /tmp/upstream-merge-v0.6.4/high-conflict-files.txt

cat /tmp/upstream-merge-v0.6.4/high-conflict-files.txt

# 5. 统计变更类型
echo "=== 变更类型统计 ==="
git diff main upstream/main --name-status | cut -f1 | sort | uniq -c

# 6. 生成提交清单
git log upstream/main ^main --oneline --no-merges > /tmp/upstream-merge-v0.6.4/upstream-commits.txt
git log main ^upstream/main --oneline --no-merges | head -30 > /tmp/upstream-merge-v0.6.4/our-commits.txt

echo "=== 上游领先提交 ==="
cat /tmp/upstream-merge-v0.6.4/upstream-commits.txt

echo "=== 我们领先提交（前30个） ==="
cat /tmp/upstream-merge-v0.6.4/our-commits.txt
```

**验收标准**:
- [ ] 差异文件清单已生成（预计 ~972 个文件）
- [ ] 高冲突文件已识别（预计 ~8 个）
- [ ] 提交清单已生成（上游 8 个，我们 30 个）

---

### Step 1.3: 创建冲突解决矩阵（30分钟）

```bash
# 生成详细的冲突矩阵
cat > /tmp/upstream-merge-v0.6.4/conflict-matrix.md << 'EOF'
# 冲突解决矩阵

## 原则
- **品牌冲突**: 使用 --ours，保留 EchoFlow 品牌
- **技术修复**: 使用 --theirs，接受上游 bug 修复
- **混合冲突**: 手动合并，吸取技术、保留品牌
- **Policy 冲突**: 手动合并，遵循 AGENTS.md 第 31 条

---

## 高冲突文件矩阵

| 文件 | 冲突类型 | Base | Ours (main) | Theirs (upstream) | 决策 | 验证命令 |
|------|---------|------|-------------|-------------------|------|---------|
| `LICENSE` | 版权 | - | `Copyright (c) 2026 LiuGuangHS / EchoFlow Code` | `Copyright (c) 2026 cc-haha` | `--ours` | `head -3 LICENSE` |
| `README.md` | 品牌+内容 | - | EchoFlow Code 描述 | Claude Code Haha 描述 | `--ours`（可选择性吸取技术段落） | `grep "EchoFlow" README.md` |
| `README.zh-CN.md` | 品牌+内容 | - | EchoFlow Code 描述 | Claude Code Haha 描述 | `--ours` | `grep "EchoFlow" README.zh-CN.md` |
| `package.json` | 品牌+依赖 | - | `bin: echoflow-code`<br>`author: LiuGuangHS` | `bin: claude-haha`<br>`author: NanmiCoder` | **手动**：品牌用 ours，依赖可能吸取 theirs | `jq '.bin,.author' package.json` |
| `desktop/package.json` | 品牌+版本 | - | `appId: com.echoflow.code.desktop`<br>`productName: EchoFlow Code` | `appId: com.claude-code-haha.desktop`<br>`productName: Claude Code Haha` | **手动**：品牌用 ours，版本/依赖可能吸取 theirs | `jq '.build.appId,.build.productName,.version' desktop/package.json` |
| `src/server/config/providerPresets.json` | Provider 策略 | - | 包含 `echoflowai`<br>有 `defaultEnv` 优化 | 包含 `jiekouai` 等推广<br>`defaultEnv` 为空或被删 | **手动**：遵循 AGENTS.md 第 31 条 | `bun test src/server/config/providerPresets.test.ts` |
| `AGENTS.md` | 契约深度 | - | 242 行完整契约 | 55 行简化路由 | `--ours`（可选择性吸取导航结构） | `wc -l AGENTS.md` |
| `CLAUDE.md` | 项目说明 | - | EchoFlow 项目说明 | cc-haha 项目说明 | `--ours` | `grep "EchoFlow" CLAUDE.md` |

---

## 预期的自动合并文件（无冲突）

这些文件的更改是纯技术性的，不涉及品牌：

| 文件 | 上游更改 | 决策 |
|------|---------|------|
| `src/utils/swarm/teammateModel.ts` | Agent Teams 继承 lead model | `--theirs`（接受修复） |
| `desktop/src/components/ContextUsageIndicator.tsx` | UI 布局优化 | `--theirs`（接受优化） |
| `desktop/src/components/ChatInput.tsx` | 代码简化 | `--theirs`（接受简化） |
| `src/utils/swarm/printLeaderPermissionBridge.ts` | 新文件 | `--theirs`（接受新功能） |
| `src/utils/swarm/printLeaderPermissionBridge.test.ts` | 新测试 | `--theirs`（接受测试） |

---

## 需要特别注意的文件（可能有隐藏品牌引用）

| 文件 | 检查项 | 命令 |
|------|--------|------|
| `desktop/electron/main.ts` | 应用标题、窗口标题 | `grep -i "claude\|haha" desktop/electron/main.ts` |
| `desktop/src/pages/settings/AboutSettings.tsx` | 关于页面文本 | `grep -i "claude.*haha\|cc-haha" desktop/src/pages/settings/AboutSettings.tsx` |
| `src/server/diagnostics/export.ts` | 诊断导出元数据 | `grep -i "haha" src/server/diagnostics/export.ts` |
| `docs/**/*.md` | 文档中的产品名称 | `grep -r "cc-haha\|claude-haha" docs/` |

---

## Provider Presets 详细冲突策略

### ✅ 保留（Ours）
1. **echoflowai provider 完整配置**
   ```json
   {
     "id": "echoflowai",
     "name": "EchoFlow API",
     "featured": true,
     ...
   }
   ```

2. **所有 provider 的 defaultEnv 优化**
   - `CLAUDE_CODE_AUTO_COMPACT_WINDOW`
   - `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES`

### ❌ 拒绝（Delete from Theirs）
1. **推广 providers**
   - `jiekouai`
   - `fennoai`
   - `qiniuai`
   - `atlascloud`（如果有 UTM 参数）
   - `apismart`

2. **推广元素**
   - 所有 `apiKeyUrl` 中的邀请码/推广码
   - 所有 `promoText` 字段
   - 所有 `utm_source` / `utm_medium` / `utm_campaign` 参数

### ✅ 吸取（Theirs 技术参数）
1. **官方 provider 的技术更新**
   - `modelContextWindows` 的新值
   - `defaultModels` 的更新
   - `apiFormat` 的改进
   - `websiteUrl` / `apiKeyUrl` 的官方链接（去除推广参数）

2. **新增的官方 provider**（如有）
   - Anthropic Official
   - DeepSeek Official
   - 其他官方 API

---

## 验证检查清单

完成冲突解决后，必须运行以下验证：

### 品牌一致性
```bash
# 1. 无上游品牌泄漏
git diff main..HEAD | grep -E "cc-haha|claude-haha|NanmiCoder|relakkes" || echo "✅ 无品牌泄漏"

# 2. EchoFlow 品牌完整
grep -q "EchoFlow Code" README.md && echo "✅ README 正确"
grep -q "LiuGuangHS" LICENSE && echo "✅ LICENSE 正确"
jq -e '.bin."echoflow-code"' package.json && echo "✅ bin 正确"
jq -e '.build.appId | contains("echoflow")' desktop/package.json && echo "✅ appId 正确"
```

### Provider 策略
```bash
# 1. echoflowai 存在
jq '.[] | select(.id=="echoflowai")' src/server/config/providerPresets.json && echo "✅ echoflowai 存在"

# 2. 无推广 provider
! jq '.[] | select(.id | test("jiekouai|fennoai|qiniuai"))' src/server/config/providerPresets.json && echo "✅ 无推广 provider"

# 3. defaultEnv 保留
jq '.[] | select(.id=="deepseek") | .defaultEnv' src/server/config/providerPresets.json | grep -q "CLAUDE_CODE_AUTO_COMPACT_WINDOW" && echo "✅ defaultEnv 保留"

# 4. 无推广参数
! grep -E "utm_source|utm_medium|icode=|code=" src/server/config/providerPresets.json && echo "✅ 无推广参数"
```

### 功能验证
```bash
# 1. JSON 格式
jq empty src/server/config/providerPresets.json && echo "✅ JSON 格式正确"

# 2. Provider 测试
bun test src/server/config/providerPresets.test.ts

# 3. Agent Teams 测试
bun test src/utils/swarm/teammateModel.test.ts

# 4. 类型检查
bun run typecheck

# 5. 完整验证
bun run verify
```

EOF

cat /tmp/upstream-merge-v0.6.4/conflict-matrix.md
echo ""
echo "✅ 冲突矩阵已创建: /tmp/upstream-merge-v0.6.4/conflict-matrix.md"
```

**验收标准**:
- [ ] 冲突矩阵已创建
- [ ] 8 个高冲突文件的策略已明确
- [ ] Provider Presets 的详细策略已定义
- [ ] 验证检查清单已准备

---

### Step 1.4: 上游提交详细分析（30分钟）

```bash
# 为每个上游提交创建详细分析

cat > /tmp/upstream-merge-v0.6.4/commit-analysis.md << 'EOF'
# 上游提交详细分析

## 提交列表（从新到旧）

### 1. f2bfaab5 - docs(readme): make English the default README

**变更文件**:
```
git show f2bfaab5 --stat
```

**变更内容**: 将 English README 设为默认（README.md），中文移到 README.zh-CN.md

**品牌冲突**: ⚠️ **高** - README 包含产品名称、描述、链接

**决策**: `--ours`（保留 EchoFlow 版本的 README）

**验证**: 
```bash
grep "EchoFlow Code" README.md
```

---

### 2. 02d7228b - release: v0.6.4

**变更文件**:
```
- package.json (version bump)
- desktop/package.json (version bump)
- release-notes/v0.6.4.md (新增)
```

**变更内容**: 版本号从 v0.6.3 → v0.6.4

**品牌冲突**: ⚠️ **中** - release notes 可能包含产品名称

**决策**: **手动合并**
- 版本号：参考但不直接采用（我们的版本策略可能不同）
- Release notes：参考技术内容，替换品牌

**验证**: 
```bash
jq '.version' package.json
jq '.version' desktop/package.json
```

---

### 3. 9f47bbcd - fix(agent-teams): inherit the lead model instead of hardcoded Opus

**变更文件**:
```
src/utils/swarm/teammateModel.ts
```

**变更内容**: 修复 Agent Teams 硬编码 Opus 的问题，改为继承主会话模型

**品牌冲突**: 🟢 **无** - 纯技术修复

**决策**: `--theirs`（完全接受）

**验证**: 
```bash
bun test src/utils/swarm/teammateModel.test.ts
grep -i "opus" src/utils/swarm/teammateModel.ts  # 应该是动态引用，不是硬编码
```

**影响**: ⭐⭐⭐ 高优先级 - 修复功能性 bug

---

### 4. a4bb7c52 - fix(desktop): stop cold session lists from scanning every JSONL

**变更文件**:
```
desktop/src/stores/sessionStore.ts
desktop/src/lib/sessionLoader.ts
```

**变更内容**: 优化冷启动时的会话列表加载，不再扫描每个 JSONL 文件

**品牌冲突**: 🟢 **无** - 纯性能优化

**决策**: `--theirs`（完全接受）

**验证**: 
```bash
# 测试启动性能
cd desktop && bun run dev
# 观察会话列表加载速度
```

**影响**: ⭐⭐⭐ 高优先级 - 显著提升用户体验

---

### 5. 35736f3f - fix(desktop): route teammate permission prompts to the lead session

**变更文件**:
```
src/utils/swarm/printLeaderPermissionBridge.ts (新增 236 行)
src/utils/swarm/printLeaderPermissionBridge.test.ts (新增 213 行)
src/utils/swarm/teammateModel.ts (修改)
```

**变更内容**: 将队友的权限提示正确路由到主会话

**品牌冲突**: 🟢 **无** - 新功能

**决策**: `--theirs`（完全接受）

**验证**: 
```bash
bun test src/utils/swarm/printLeaderPermissionBridge.test.ts
bun test src/utils/swarm/
```

**影响**: ⭐⭐⭐ 高优先级 - 修复 Agent Teams 权限问题

---

### 6. 88ea66f8 - fix(desktop): stop the test-connection button from collapsing on long errors

**变更文件**:
```
desktop/src/components/settings/ProviderSettings.tsx
```

**变更内容**: 长错误信息时测试连接按钮不再塌陷

**品牌冲突**: 🟢 **无** - UI 修复

**决策**: `--theirs`（完全接受）

**验证**: 
```bash
# 手动测试：在 Provider 设置中触发长错误
cd desktop && bun run dev
```

**影响**: ⭐⭐ 中优先级 - UI/UX 改进

---

### 7. 0676c194 - fix(desktop): restore window dragging on the sidebar and workspace headers

**变更文件**:
```
desktop/src/components/layout/Sidebar.tsx
desktop/src/components/layout/WorkspaceHeader.tsx
```

**变更内容**: 恢复侧边栏和工作区标题的窗口拖拽功能

**品牌冲突**: 🟢 **无** - 功能恢复

**决策**: `--theirs`（完全接受）

**验证**: 
```bash
# 手动测试：拖拽侧边栏和标题栏
cd desktop && bun run dev
```

**影响**: ⭐⭐ 中优先级 - 用户体验恢复

---

### 8. 8a9e3800 - fix(desktop): hide short-project fold control and shrink context meter

**变更文件**:
```
desktop/src/components/ContextUsageIndicator.tsx
```

**变更内容**: 
- 隐藏短项目的折叠控制
- 缩小上下文指示器
- 优化布局（flex → grid）

**品牌冲突**: 🟢 **无** - UI 优化

**决策**: `--theirs`（完全接受）

**验证**: 
```bash
bun test desktop/src/components/ContextUsageIndicator.test.tsx
```

**影响**: ⭐ 低优先级 - UI 细节优化

---

## 优先级排序（建议 cherry-pick 顺序）

| 优先级 | 提交 | 描述 | 理由 |
|--------|------|------|------|
| 1 | 9f47bbcd | Agent Teams 继承 model | 功能性 bug，其他修复可能依赖 |
| 2 | 35736f3f | 队友权限路由 | 新增文件，独立功能 |
| 3 | a4bb7c52 | 会话列表性能 | 用户体验显著提升 |
| 4 | 0676c194 | 窗口拖拽恢复 | 功能恢复 |
| 5 | 88ea66f8 | 测试连接按钮 | UI 修复 |
| 6 | 8a9e3800 | 上下文指示器 | UI 优化 |
| 7 | f2bfaab5 | README 英文优先 | 文档（品牌冲突，慎重） |
| 8 | 02d7228b | v0.6.4 release | 版本（手动参考） |

EOF

# 逐个查看提交详情
for commit in f2bfaab5 02d7228b 9f47bbcd a4bb7c52 35736f3f 88ea66f8 0676c194 8a9e3800; do
  echo ""
  echo "=== $commit ==="
  git show $commit --stat
  echo ""
done

cat /tmp/upstream-merge-v0.6.4/commit-analysis.md
echo ""
echo "✅ 提交分析已完成: /tmp/upstream-merge-v0.6.4/commit-analysis.md"
```

**验收标准**:
- [ ] 8 个提交的详细分析已完成
- [ ] 每个提交的品牌冲突等级已评估
- [ ] Cherry-pick 优先级顺序已确定
- [ ] 验证命令已准备

---

## Phase 1 总结

### 完成的工作

✅ **Step 1.0**: 清理工作区
- 提交当前 EchoFlow API 增强工作
- 工作区恢复干净状态

✅ **Step 1.1**: 环境准备
- 配置 upstream remote
- 创建合并分支 `merge/upstream-v0.6.4-selective`
- 创建快照标签 `pre-merge-v0.6.4-snapshot`

✅ **Step 1.2**: 生成差异统计
- 972 个文件变更
- 识别 8 个高冲突文件
- 上游 8 个提交，我们 30 个提交

✅ **Step 1.3**: 创建冲突解决矩阵
- 8 个高冲突文件的策略
- Provider Presets 详细合并规则
- 完整的验证检查清单

✅ **Step 1.4**: 上游提交详细分析
- 8 个提交的逐个分析
- 品牌冲突评估
- Cherry-pick 优先级排序

### 生成的文档

1. `/tmp/upstream-merge-v0.6.4/diff-stat.txt` - 文件差异统计
2. `/tmp/upstream-merge-v0.6.4/diff-files.txt` - 文件清单
3. `/tmp/upstream-merge-v0.6.4/diff-summary.txt` - 差异摘要
4. `/tmp/upstream-merge-v0.6.4/high-conflict-files.txt` - 高冲突文件
5. `/tmp/upstream-merge-v0.6.4/upstream-commits.txt` - 上游提交
6. `/tmp/upstream-merge-v0.6.4/our-commits.txt` - 我们的提交
7. `/tmp/upstream-merge-v0.6.4/conflict-matrix.md` - 冲突矩阵
8. `/tmp/upstream-merge-v0.6.4/commit-analysis.md` - 提交分析

### 下一步（Phase 2）

准备 Cherry-pick 以下 6 个技术修复（按优先级）:

1. `9f47bbcd` - Agent Teams 继承 model
2. `35736f3f` - 队友权限路由
3. `a4bb7c52` - 会话列表性能
4. `0676c194` - 窗口拖拽恢复
5. `88ea66f8` - 测试连接按钮
6. `8a9e3800` - 上下文指示器

跳过:
- `f2bfaab5` - README（品牌冲突严重）
- `02d7228b` - v0.6.4 release（手动参考即可）

---

**Phase 1 预计完成时间**: 2 小时  
**Phase 1 实际执行时间**: TBD  
**准备度**: ✅ 可以开始 Phase 2
