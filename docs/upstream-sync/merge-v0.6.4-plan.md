# 上游 v0.6.4 合并任务规划

## 任务概述

**目标**: 选择性合并 cc-haha v0.6.4 的技术改进，拒绝品牌回退和推广内容  
**策略**: Cherry-pick + 手动合并（精确控制）  
**预计时间**: 12-18 小时（分 4 个阶段）  
**风险等级**: 🟡 中等（技术改进低风险，品牌冲突高风险）

---

## 阶段划分

| 阶段 | 任务 | 优先级 | 预计时间 | 风险 |
|------|------|--------|---------|------|
| **Phase 1** | 准备与分析 | ⭐⭐⭐ | 2h | 🟢 低 |
| **Phase 2** | Cherry-pick Bug 修复 | ⭐⭐⭐ | 4h | 🟡 中 |
| **Phase 3** | 手动合并 UI 优化 | ⭐⭐ | 3h | 🟡 中 |
| **Phase 4** | 验证与清理 | ⭐⭐⭐ | 3h | 🟡 中 |

---

## Phase 1: 准备与分析（2小时）

### 1.1 环境准备（30分钟）

```bash
# 1. 确保工作区干净
git status
git stash  # 如果有未提交的更改

# 2. 确认远程配置
git remote -v
# 应该看到:
#   origin    https://github.com/LiuGuangHS/EchoFlow-ClaudeCode.git
#   upstream  https://github.com/NanmiCoder/cc-haha.git

# 3. 更新所有远程分支
git fetch origin --prune
git fetch upstream --prune

# 4. 创建合并分支
git checkout main
git pull origin main
git checkout -b merge/upstream-v0.6.4-selective

# 5. 创建快照标签
git tag pre-merge-v0.6.4-snapshot
```

**验收标准**:
- [ ] 工作区干净（`git status` 显示 clean）
- [ ] 已在新分支 `merge/upstream-v0.6.4-selective`
- [ ] 快照标签已创建
- [ ] upstream/main 指向 v0.6.4

---

### 1.2 生成冲突预测报告（30分钟）

```bash
# 生成完整差异清单
git diff main upstream/main --stat > /tmp/upstream-diff-stat.txt
git diff main upstream/main --name-status > /tmp/upstream-diff-files.txt

# 识别高冲突风险文件
git diff main upstream/main --name-only | \
  grep -E "(package\.json|README|LICENSE|providerPresets|AGENTS\.md|CLAUDE\.md)" \
  > /tmp/high-conflict-files.txt

# 查看具体提交
git log upstream/main ^main --oneline --no-merges > /tmp/upstream-commits.txt
git log main ^upstream/main --oneline --no-merges > /tmp/our-commits.txt
```

**创建冲突矩阵文件**:

```bash
# 创建冲突解决矩阵
cat > /tmp/conflict-matrix.md << 'EOF'
# 冲突解决矩阵

| 文件 | 冲突类型 | Base | Ours | Theirs | 决策 | 验证命令 |
|------|---------|------|------|--------|------|---------|
| package.json | 品牌 | cc-haha | echoflow-code | cc-haha | ours | `jq .bin package.json` |
| LICENSE | 版权 | - | LiuGuangHS | cc-haha | ours | `head -3 LICENSE` |
| README.md | 品牌+内容 | - | EchoFlow | cc-haha | ours+部分吸取 | manual |
| providerPresets.json | Provider策略 | - | +echoflowai | +jiekouai等 | 手动合并 | `bun test providerPresets` |
| desktop/package.json | 品牌 | - | EchoFlow | cc-haha | ours | `jq .build.appId desktop/package.json` |
| AGENTS.md | 契约深度 | - | 242行完整 | 55行简化 | ours | `wc -l AGENTS.md` |
EOF
```

**验收标准**:
- [ ] 差异文件清单已生成
- [ ] 高冲突文件已识别（预计 ~60 个）
- [ ] 冲突矩阵已创建

---

### 1.3 上游提交分析（1小时）

**需要逐个审查的 8 个上游提交**:

```bash
# 详细查看每个提交
git show 9f47bbcd --stat  # Agent Teams fix
git show a4bb7c52 --stat  # 会话列表性能
git show 35736f3f --stat  # 权限路由
git show 88ea66f8 --stat  # 测试连接按钮
git show 0676c194 --stat  # 窗口拖拽
git show 8a9e3800 --stat  # 上下文指示器
git show f2bfaab5 --stat  # README 英文优先
git show 02d7228b --stat  # v0.6.4 release
```

**为每个提交创建分析笔记**:

```markdown
## 9f47bbcd - Agent Teams 继承 lead model

**变更文件**: 
- src/utils/swarm/teammateModel.ts

**变更内容**:
- 修复硬编码 Opus 问题
- 现在正确继承主会话模型

**品牌冲突**: 无

**决策**: ✅ 完整接受

**验证**: 
```bash
bun test src/utils/swarm/teammateModel.test.ts
```
```

**验收标准**:
- [ ] 8 个提交的分析笔记已完成
- [ ] 每个提交的品牌冲突已识别
- [ ] 每个提交的验证命令已准备

---

## Phase 2: Cherry-pick Bug 修复（4小时）

### 2.1 依次 Cherry-pick（2.5小时）

**执行顺序**（按依赖关系排序）:

```bash
# 1. Agent Teams fix (可能其他修复依赖此)
git cherry-pick 9f47bbcd
# 如遇冲突，暂停并记录

# 2. 会话列表性能优化
git cherry-pick a4bb7c52

# 3. 队友权限提示路由
git cherry-pick 35736f3f

# 4. 测试连接按钮 UI
git cherry-pick 88ea66f8

# 5. 窗口拖拽恢复
git cherry-pick 0676c194

# 6. 上下文指示器优化
git cherry-pick 8a9e3800
```

**每次 cherry-pick 后的标准流程**:

```bash
# A. 检查冲突
git status

# B. 如果有冲突，分析冲突类型
git diff --name-only --diff-filter=U

# C. 查看冲突详情
git diff <conflicted-file>

# D. 按冲突矩阵解决
# - 品牌冲突 → 保留 ours (EchoFlow)
# - 技术修复 → 保留 theirs (上游修复)
# - 混合冲突 → 手动合并

# E. 标记已解决
git add <resolved-file>

# F. 继续 cherry-pick
git cherry-pick --continue

# G. 运行相关测试
bun test <affected-test-file>

# H. 记录到冲突日志
echo "9f47bbcd: 无冲突，测试通过" >> /tmp/cherry-pick-log.txt
```

**验收标准**:
- [ ] 6 个技术修复提交已 cherry-pick
- [ ] 所有冲突已按矩阵解决
- [ ] Cherry-pick 日志已完整记录

---

### 2.2 处理品牌冲突（1小时）

**预期品牌冲突文件**:
```
desktop/src/components/controls/CliRuntimeSelector.tsx
desktop/src/lib/desktopRuntime.ts
src/server/diagnostics/export.ts
```

**统一处理策略**:

```bash
# 1. 查找所有品牌引用
git diff --name-only --diff-filter=U | while read file; do
  echo "=== $file ==="
  git diff "$file" | grep -E "<<<<<<|======|>>>>>>" -A3 -B3
done > /tmp/brand-conflicts.txt

# 2. 批量替换品牌标识
# 使用脚本统一处理
cat > /tmp/fix-brand-conflicts.sh << 'SCRIPT'
#!/bin/bash
# 修复品牌冲突：保留 EchoFlow，应用上游技术修复

for file in $(git diff --name-only --diff-filter=U); do
  echo "Processing $file"
  
  # 备份原始冲突
  cp "$file" "$file.conflict-backup"
  
  # 手动编辑（这里需要人工介入）
  echo "  请在编辑器中解决 $file 的品牌冲突"
  code "$file"
  
  read -p "  已解决? (y/n) " answer
  if [ "$answer" = "y" ]; then
    git add "$file"
  fi
done
SCRIPT

chmod +x /tmp/fix-brand-conflicts.sh
/tmp/fix-brand-conflicts.sh
```

**品牌一致性检查**:

```bash
# 检查是否有遗漏的上游品牌
git diff main..HEAD | grep -E "cc-haha|claude-haha|NanmiCoder|relakkes" || echo "✅ 无品牌泄漏"

# 验证 EchoFlow 品牌完整
git diff main..HEAD | grep -E "echoflow-code|EchoFlow Code|LiuGuangHS" | wc -l
```

**验收标准**:
- [ ] 所有品牌冲突已解决
- [ ] 无上游品牌标识泄漏
- [ ] EchoFlow 品牌完整保留

---

### 2.3 验证 Cherry-pick 结果（30分钟）

```bash
# 1. 运行受影响的测试
bun test src/utils/swarm/teammateModel.test.ts
bun test desktop/src/components/
bun test desktop/electron/services/

# 2. 类型检查
bun run typecheck

# 3. Lint 检查
bun run lint

# 4. 构建测试
cd desktop && bun run build:check && cd ..

# 5. 生成变更报告
git diff main..HEAD --stat > /tmp/phase2-changes.txt
git log main..HEAD --oneline > /tmp/phase2-commits.txt
```

**验收标准**:
- [ ] 所有相关测试通过
- [ ] 类型检查通过
- [ ] Lint 无错误
- [ ] 构建成功
- [ ] 变更报告已生成

---

## Phase 3: 手动合并 UI 优化（3小时）

### 3.1 ContextUsageIndicator 重构（1小时）

```bash
# 1. 查看上游改动
git diff upstream/main:desktop/src/components/ContextUsageIndicator.tsx \
         main:desktop/src/components/ContextUsageIndicator.tsx \
         > /tmp/context-indicator-diff.txt

# 2. 手动应用改进
code desktop/src/components/ContextUsageIndicator.tsx
```

**需要应用的改进**:
- [ ] 从 `flex` 布局改为 `grid` 布局
- [ ] 统一触摸目标尺寸（`h-8 w-8` / `h-11 w-11`）
- [ ] 紧凑模式隐藏字体单位
- [ ] 优化悬停状态过渡

**验证**:
```bash
bun test desktop/src/components/ContextUsageIndicator.test.tsx
cd desktop && bun run dev  # 手动测试 UI
```

---

### 3.2 ChatInput 模型标签简化（30分钟）

```bash
# 查看差异
git diff upstream/main:desktop/src/components/ChatInput.tsx \
         main:desktop/src/components/ChatInput.tsx \
         | grep -A5 -B5 "runtimeModelLabel"
```

**改进**:
```typescript
// 当前（冗长）
const runtimeModelLabel = runtimeSelection
  ? runtimeSelection.modelId
  : currentModel?.name ?? currentModel?.id

// 改为（简洁）
const runtimeModelLabel = runtimeSelection?.modelId ?? currentModel?.name ?? currentModel?.id
```

**验证**:
```bash
bun test desktop/src/components/ChatInput.test.tsx
```

---

### 3.3 新增队友权限桥接（1小时）

```bash
# 复制上游新增文件
git show upstream/main:src/utils/swarm/printLeaderPermissionBridge.ts \
  > src/utils/swarm/printLeaderPermissionBridge.ts

git show upstream/main:src/utils/swarm/printLeaderPermissionBridge.test.ts \
  > src/utils/swarm/printLeaderPermissionBridge.test.ts

# 添加到 Git
git add src/utils/swarm/printLeaderPermissionBridge.ts
git add src/utils/swarm/printLeaderPermissionBridge.test.ts

# 检查品牌引用
grep -r "cc-haha\|claude-haha\|NanmiCoder" src/utils/swarm/printLeaderPermissionBridge.*

# 运行测试
bun test src/utils/swarm/printLeaderPermissionBridge.test.ts
```

**验收标准**:
- [ ] 新文件已添加
- [ ] 无品牌泄漏
- [ ] 测试通过
- [ ] 与现有 swarm 逻辑集成正确

---

### 3.4 提交 UI 优化（30分钟）

```bash
# 创建独立提交
git add desktop/src/components/ContextUsageIndicator.tsx
git commit -m "feat(desktop): optimize ContextUsageIndicator layout and touch targets

- Switch from flex to grid layout for consistent sizing
- Unify touch targets to h-8/w-8 and h-11/w-11
- Hide font units in compact mode
- Improve hover state transitions

Cherry-picked improvements from upstream v0.6.4"

git add desktop/src/components/ChatInput.tsx
git commit -m "refactor(desktop): simplify ChatInput model label logic

Use optional chaining for cleaner code

Cherry-picked from upstream v0.6.4"

git add src/utils/swarm/printLeaderPermissionBridge.*
git commit -m "feat(swarm): add teammate permission bridge

Adds printLeaderPermissionBridge for routing teammate permission
prompts to the lead session.

Cherry-picked from upstream v0.6.4"
```

**验收标准**:
- [ ] 3 个独立提交已创建
- [ ] 提交信息清晰
- [ ] 每个提交可独立验证

---

## Phase 4: 验证与清理（3小时）

### 4.1 Provider Presets 手动合并（1.5小时）

这是**最复杂**的部分，需要精确处理。

```bash
# 1. 备份当前配置
cp src/server/config/providerPresets.json \
   src/server/config/providerPresets.json.backup

# 2. 查看上游完整差异
git diff main upstream/main -- src/server/config/providerPresets.json \
  > /tmp/provider-presets-diff.txt

# 3. 使用三路合并工具
code --diff \
  src/server/config/providerPresets.json.backup \
  <(git show upstream/main:src/server/config/providerPresets.json)
```

**合并原则**（按优先级）:

#### A. 保留我们的 echoflowai Provider
```json
{
  "id": "echoflowai",
  "name": "EchoFlow API",
  "baseUrl": "https://api.echoflowai.cc",
  "apiFormat": "anthropic",
  "defaultModels": {
    "main": "claude-sonnet-4-6",
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-7"
  },
  "needsApiKey": true,
  "websiteUrl": "https://api.echoflowai.cc/",
  "apiKeyUrl": "https://api.echoflowai.cc/register",
  "promoText": "一站式接入 500+ 模型，支持 Claude / OpenAI 协议，访问高速稳定。新用户注册赠送试用。",
  "featured": true,
  "authStrategy": "auth_token",
  "modelContextWindows": {
    "claude-sonnet-4-6": 1000000,
    "claude-haiku-4-5": 200000,
    "claude-opus-4-7": 1000000
  }
}
```

#### B. 拒绝上游的推广 Providers
```json
// ❌ 删除整个块
{ "id": "jiekouai", ... }
{ "id": "fennoai", ... }
{ "id": "qiniuai", ... }
{ "id": "atlascloud", "apiKeyUrl": "...?utm_source=...", ... }
{ "id": "apismart", ... }
```

#### C. 吸取官方 Provider 的技术参数
```bash
# DeepSeek
# ✅ 保留我们的 defaultEnv 配置
"defaultEnv": {
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "thinking,effort,adaptive_thinking,max_effort",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "thinking,effort,adaptive_thinking,max_effort",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "thinking,effort,adaptive_thinking,max_effort"
}

# 智谱 GLM
# ❌ 删除邀请码
- "apiKeyUrl": "https://www.bigmodel.cn/invite?icode=...",
+ "apiKeyUrl": "https://open.bigmodel.cn/usercenter/apikeys",

# ❌ 删除 promoText
- "promoText": "智谱 GLM 为 cc-haha 用户准备了专属邀请福利...",

# ✅ 保留我们的 defaultEnv
"defaultEnv": {
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000"
}

# Kimi
# ✅ 保留我们的 defaultEnv
"defaultEnv": {
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "thinking,required_thinking,effort,max_effort",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "thinking,required_thinking,effort,max_effort",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "thinking,required_thinking,effort,max_effort"
}

# MiniMax
# ❌ 删除推广链接
- "apiKeyUrl": "https://platform.minimaxi.com/subscribe/token-plan?code=1TG2Cseab2&source=link",
+ "apiKeyUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key",

# ✅ 保留我们的 defaultEnv
"defaultEnv": {
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking"
}
```

#### D. 吸取技术参数更新
- ✅ 更新 `modelContextWindows`（如果上游有新模型）
- ✅ 更新 `defaultModels`（如果有更好的默认选择）
- ✅ 更新 `apiFormat`（如果有协议升级）

**验证**:
```bash
# 1. JSON 格式验证
jq empty src/server/config/providerPresets.json

# 2. 运行 Provider 测试
bun test src/server/config/providerPresets.test.ts

# 3. 检查品牌泄漏
grep -E "jiekouai|fennoai|qiniuai|atlascloud.*utm|apismart" \
  src/server/config/providerPresets.json && echo "❌ 发现推广内容" || echo "✅ 无推广内容"

# 4. 验证 echoflowai 存在
jq '.[] | select(.id=="echoflowai")' src/server/config/providerPresets.json

# 5. 验证 defaultEnv 保留
jq '.[] | select(.id=="deepseek") | .defaultEnv' src/server/config/providerPresets.json
```

**提交**:
```bash
git add src/server/config/providerPresets.json
git commit -m "feat(providers): merge upstream v0.6.4 technical improvements

- Preserve echoflowai provider (EchoFlow policy)
- Reject promotional providers (jiekouai, atlascloud, apismart, etc.)
- Remove referral URLs and promo text
- Keep our defaultEnv optimizations (auto compact, thinking capabilities)
- Update model context windows and capabilities from upstream

Follows Fork Policy: only official vendors, local integrations, EchoFlow API, and custom"
```

**验收标准**:
- [ ] echoflowai provider 完整保留
- [ ] 所有推广 provider 已删除
- [ ] 所有邀请码/UTM 参数已删除
- [ ] 我们的 defaultEnv 优化已保留
- [ ] 技术参数已更新
- [ ] JSON 格式正确
- [ ] 测试通过

---

### 4.2 完整品牌一致性检查（30分钟）

```bash
# 1. 全局搜索上游品牌
echo "🔍 检查品牌泄漏..."

# 检查 cc-haha
git diff main..HEAD | grep -i "cc-haha" && echo "❌ 发现 cc-haha" || echo "✅ 无 cc-haha"

# 检查 claude-haha
git diff main..HEAD | grep -i "claude-haha" && echo "❌ 发现 claude-haha" || echo "✅ 无 claude-haha"

# 检查 NanmiCoder
git diff main..HEAD | grep -i "nanmicoder" && echo "❌ 发现 NanmiCoder" || echo "✅ 无 NanmiCoder"

# 检查 relakkes
git diff main..HEAD | grep -i "relakkes" && echo "❌ 发现 relakkes" || echo "✅ 无 relakkes"

# 2. 验证 EchoFlow 品牌完整
echo "🔍 验证 EchoFlow 品牌..."

# 检查关键文件
grep -q "EchoFlow Code" README.md && echo "✅ README 品牌正确"
grep -q "LiuGuangHS" LICENSE && echo "✅ LICENSE 版权正确"
jq -e '.bin."echoflow-code"' package.json && echo "✅ package.json bin 正确"
jq -e '.build.appId | contains("echoflow")' desktop/package.json && echo "✅ desktop appId 正确"

# 3. 生成品牌检查报告
cat > /tmp/brand-check-report.md << 'EOF'
# 品牌一致性检查报告

## 上游品牌清理
- [ ] 无 cc-haha 引用
- [ ] 无 claude-haha 引用
- [ ] 无 NanmiCoder 引用
- [ ] 无 relakkes 引用

## EchoFlow 品牌验证
- [ ] README.md 标题正确
- [ ] LICENSE 版权正确
- [ ] package.json bin 正确
- [ ] desktop/package.json appId 正确
- [ ] desktop/package.json productName 正确

## 文档链接验证
- [ ] code.echoflow.cn 链接存在
- [ ] api.echoflowai.cc 链接存在
- [ ] 无 cchaha.ai 链接

## Provider 策略验证
- [ ] echoflowai provider 存在
- [ ] 无 jiekouai provider
- [ ] 无推广链接
EOF
```

**验收标准**:
- [ ] 所有品牌检查通过
- [ ] 品牌检查报告已生成
- [ ] 关键文件品牌正确

---

### 4.3 完整测试套件（1小时）

```bash
# 1. 运行完整验证
echo "🧪 运行完整测试套件..."
bun run verify

# 2. 如果失败，分步诊断
if [ $? -ne 0 ]; then
  echo "❌ 验证失败，开始分步诊断..."
  
  # 类型检查
  echo "1️⃣ 类型检查..."
  bun run typecheck
  
  # Lint
  echo "2️⃣ Lint 检查..."
  bun run lint
  
  # 单元测试
  echo "3️⃣ 单元测试..."
  bun test
  
  # 桌面端测试
  echo "4️⃣ 桌面端测试..."
  cd desktop && bun test && cd ..
  
  # 影响范围检查
  echo "5️⃣ 影响范围检查..."
  bun run check:impact
  
  # Provider 冒烟测试
  echo "6️⃣ Provider 冒烟测试..."
  bun test src/server/config/providerPresets.test.ts
  
  # Agent Teams 测试
  echo "7️⃣ Agent Teams 测试..."
  bun test src/utils/swarm/
fi

# 3. 生成测试报告
echo "📊 生成测试报告..."
cat > /tmp/test-report.md << EOF
# 测试报告

## 测试执行时间
$(date)

## 测试结果
- 类型检查: $(bun run typecheck > /dev/null 2>&1 && echo "✅ 通过" || echo "❌ 失败")
- Lint 检查: $(bun run lint > /dev/null 2>&1 && echo "✅ 通过" || echo "❌ 失败")
- 单元测试: $(bun test > /dev/null 2>&1 && echo "✅ 通过" || echo "❌ 失败")
- 桌面端测试: $(cd desktop && bun test > /dev/null 2>&1 && echo "✅ 通过" || echo "❌ 失败"; cd ..)

## 受影响的文件
$(git diff main..HEAD --name-only | wc -l) 个文件

## 提交数量
$(git log main..HEAD --oneline | wc -l) 个提交

## 代码变更
$(git diff main..HEAD --stat | tail -1)
EOF
```

**验收标准**:
- [ ] `bun run verify` 完全通过
- [ ] 所有分步测试通过
- [ ] 测试报告已生成
- [ ] 无回归问题

---

### 4.4 生成合并报告与清理（30分钟）

```bash
# 1. 生成完整的合并报告
cat > MERGE_REPORT_v0.6.4.md << 'EOF'
# 上游 v0.6.4 合并报告

## 执行摘要
- **合并日期**: $(date +%Y-%m-%d)
- **上游版本**: v0.6.4 (8 commits)
- **合并策略**: Cherry-pick + 手动合并（选择性）
- **变更文件**: $(git diff main..HEAD --name-only | wc -l) 个
- **新增代码**: $(git diff main..HEAD --shortstat | grep -oP '\d+(?= insertions)')
- **删除代码**: $(git diff main..HEAD --shortstat | grep -oP '\d+(?= deletions)')

## ✅ 已合并内容

### Bug 修复（6 个提交）
- [x] 9f47bbcd - Agent Teams 继承 lead model
- [x] a4bb7c52 - 冷启动会话列表性能优化
- [x] 35736f3f - 队友权限提示路由修复
- [x] 88ea66f8 - 测试连接按钮 UI 修复
- [x] 0676c194 - 窗口拖拽恢复
- [x] 8a9e3800 - 上下文指示器优化

### UI 改进
- [x] ContextUsageIndicator grid 布局重构
- [x] ChatInput 模型标签简化
- [x] 触摸目标尺寸统一

### 新增功能
- [x] printLeaderPermissionBridge 队友权限桥接

### Provider 技术改进
- [x] 更新官方 Provider 的技术参数
- [x] 保留 echoflowai provider
- [x] 保留 defaultEnv 优化配置

## ❌ 已拒绝内容

### 品牌回退
- [x] 拒绝所有 cc-haha → EchoFlow 的回退
- [x] 拒绝 LICENSE 版权变更
- [x] 拒绝 package.json 作者信息变更
- [x] 拒绝 desktop appId 变更

### Provider 推广
- [x] 拒绝 jiekouai provider（带推广码）
- [x] 拒绝 atlascloud provider（带 UTM 追踪）
- [x] 拒绝 apismart provider（赞助商）
- [x] 拒绝 fennoai / qiniuai providers
- [x] 删除智谱 GLM / MiniMax 的邀请码链接

### 文档商业化
- [x] 拒绝赞助商章节
- [x] 拒绝捐赠二维码
- [x] 拒绝联系邮箱推广

### 工作流删除
- [x] 保留 upstream-sync.yml
- [x] 保留 audit:harness 脚本
- [x] 保留 upstream:* 命令

## 🔍 冲突解决统计

### 冲突文件
- 品牌冲突: $(grep -c "品牌" /tmp/conflict-matrix.md) 个
- Provider 冲突: 1 个（手动合并）
- 文档冲突: $(grep -c "文档" /tmp/conflict-matrix.md) 个

### 解决策略
- --ours: 品牌文件、工作流
- --theirs: Bug 修复、技术改进
- 手动合并: providerPresets.json

## 📊 验证结果
- [x] 类型检查通过
- [x] Lint 检查通过
- [x] 单元测试通过（$(bun test --list | wc -l) 个测试）
- [x] 桌面端测试通过
- [x] 品牌一致性验证通过
- [x] Provider 策略验证通过

## 🎯 Fork Policy 遵守情况
- [x] 品牌标识: 100% EchoFlow
- [x] Provider 策略: 符合 AGENTS.md 第 31 条
- [x] 上游同步自动化: 已保留
- [x] 质量工具: 已保留
- [x] 文档中立性: 已保留

## 📝 后续建议
1. 监控下一个上游 release（v0.6.5）
2. 考虑向上游贡献 upstream-sync 工作流
3. 添加 CI 品牌一致性检查
4. 完善 Provider 技术参数自动同步

## 🔗 相关资源
- 上游 v0.6.4 Release: https://github.com/NanmiCoder/cc-haha/releases/tag/v0.6.4
- 差异分析: UPSTREAM_DIFF_ANALYSIS.md
- 冲突矩阵: /tmp/conflict-matrix.md
- 测试报告: /tmp/test-report.md

---
**生成时间**: $(date)
**执行人**: $(git config user.name)
**合并分支**: merge/upstream-v0.6.4-selective
EOF

# 2. 清理临时文件
echo "🧹 清理临时文件..."
rm -f /tmp/upstream-*.txt
rm -f /tmp/conflict-*.txt
rm -f /tmp/cherry-pick-*.txt
rm -f /tmp/provider-*.txt
rm -f src/server/config/providerPresets.json.backup
rm -f *.conflict-backup

# 3. 推送到远程
echo "📤 准备推送..."
git log main..HEAD --oneline
echo ""
echo "准备推送 $(git log main..HEAD --oneline | wc -l) 个提交到 origin/merge/upstream-v0.6.4-selective"
echo ""
read -p "确认推送? (y/n) " answer
if [ "$answer" = "y" ]; then
  git push origin merge/upstream-v0.6.4-selective
  echo "✅ 已推送到远程"
fi
```

**验收标准**:
- [ ] 合并报告已生成
- [ ] 临时文件已清理
- [ ] 分支已推送到远程
- [ ] 所有检查项已完成

---

## 最终验收清单

### 技术验收
- [ ] 所有 bug 修复已 cherry-pick
- [ ] UI 优化已应用
- [ ] 新功能已集成
- [ ] Provider 配置正确合并
- [ ] 所有测试通过
- [ ] 类型检查通过
- [ ] Lint 无错误
- [ ] 构建成功

### Fork Policy 验收
- [ ] 品牌标识 100% EchoFlow
- [ ] 无上游品牌泄漏（cc-haha/NanmiCoder/relakkes）
- [ ] echoflowai provider 存在
- [ ] 无推广 provider（jiekouai 等）
- [ ] defaultEnv 优化配置已保留
- [ ] upstream-sync 工作流已保留
- [ ] audit:harness 脚本已保留

### 文档验收
- [ ] 合并报告已完成
- [ ] 冲突矩阵已归档
- [ ] 测试报告已生成
- [ ] 品牌检查报告已完成

### Git 验收
- [ ] 提交历史清晰
- [ ] 每个提交可独立验证
- [ ] 提交信息符合 Conventional Commits
- [ ] 分支已推送到远程

---

## 应急回滚方案

如果合并后发现严重问题：

```bash
# 方案 1: 回滚到快照（最安全）
git checkout main
git reset --hard pre-merge-v0.6.4-snapshot
git push origin main --force-with-lease

# 方案 2: 撤销合并分支（保留分支）
git branch -D merge/upstream-v0.6.4-selective
git checkout -b merge/upstream-v0.6.4-selective main

# 方案 3: 逐个 revert 提交（保留历史）
git revert <commit-hash>..HEAD
```

---

## 时间线

| 时间节点 | 阶段 | 预计完成 |
|---------|------|---------|
| Day 1 上午 | Phase 1: 准备与分析 | 2h |
| Day 1 下午 | Phase 2: Cherry-pick Bug 修复 | 4h |
| Day 2 上午 | Phase 3: 手动合并 UI 优化 | 3h |
| Day 2 下午 | Phase 4: 验证与清理 | 3h |
| **总计** | | **12h** |

---

## 负责人与协作

| 角色 | 负责内容 | 联系方式 |
|------|---------|---------|
| **主执行人** | 整体合并流程 | - |
| **技术审查** | 代码审查、冲突解决 | - |
| **测试负责** | 测试执行、问题诊断 | - |
| **文档负责** | 报告生成、归档 | - |

---

**创建时间**: 2026-09-18  
**计划版本**: v1.0  
**下次更新**: 执行后根据实际情况调整
