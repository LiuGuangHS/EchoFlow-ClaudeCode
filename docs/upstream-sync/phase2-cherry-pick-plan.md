# Phase 2: Cherry-pick Bug 修复 - 详细执行计划

## 阶段概览

**目标**: 选择性 cherry-pick 上游 6 个技术修复提交  
**策略**: 按依赖顺序逐个 cherry-pick，实时处理冲突  
**预计时间**: 4 小时  
**风险等级**: 🟡 中等（技术修复低风险，品牌冲突需要处理）

---

## 提交详细分析

### 提交 1: 9f47bbcd - Agent Teams 继承 lead model ⭐⭐⭐

**优先级**: 最高（其他修复可能依赖此基础）

**变更文件** (7 个):
```
src/components/Settings/Config.tsx                (10 行修改)
src/tools/shared/spawnMultiAgent.callsite.test.ts (3 行修改)
src/tools/shared/spawnMultiAgent.test.ts          (48 行新增)
src/tools/shared/spawnMultiAgent.ts               (22 行修改)
src/utils/config.ts                               (2 行修改)
src/utils/model/fable.test.ts                     (5 行新增)
src/utils/swarm/teammateModel.ts                  (9 行修改)
```

**核心修复**:
```
修复前: 未配置的 teammate 硬编码为 claude-opus-4-8
修复后: 继承主会话的 model，通过 provider mapping 解析
影响: 第三方 provider (如 DeepSeek) 不再触发昂贵的 fallback
```

**品牌冲突预期**: 🟢 **无** - 纯技术修复

**Cherry-pick 命令**:
```bash
git cherry-pick 9f47bbcd
```

**验证步骤**:
```bash
# 1. 运行测试
bun test src/utils/swarm/teammateModel.test.ts
bun test src/tools/shared/spawnMultiAgent.test.ts
bun test src/utils/model/fable.test.ts

# 2. 类型检查
bun run typecheck

# 3. 检查品牌
git diff HEAD~1..HEAD | grep -E "cc-haha|claude-haha|NanmiCoder" || echo "✅ 无品牌泄漏"

# 4. 功能测试（可选，需要桌面环境）
# cd desktop && bun run dev
# 测试 Agent Teams 是否正确继承 model
```

**预期结果**:
- ✅ 无冲突（纯技术修复）
- ✅ 所有测试通过
- ✅ 类型检查通过

---

### 提交 2: 35736f3f - 队友权限提示路由 ⭐⭐⭐

**优先级**: 高（独立新功能，包含新文件）

**变更文件** (23 个，新增 2 个关键文件):
```
新增:
  src/utils/swarm/printLeaderPermissionBridge.ts      (236 行)
  src/utils/swarm/printLeaderPermissionBridge.test.ts (213 行)

修改:
  desktop/src/components/chat/MessageList.tsx        (1 行)
  desktop/src/components/chat/PermissionDialog.tsx   (21 行)
  desktop/src/components/chat/chatBlocks.test.tsx    (40 行)
  desktop/src/i18n/locales/en.ts                     (8 行)
  desktop/src/i18n/locales/jp.ts                     (8 行)
  desktop/src/i18n/locales/kr.ts                     (8 行)
  desktop/src/i18n/locales/zh-TW.ts                  (8 行)
  desktop/src/i18n/locales/zh.ts                     (8 行)
  ... (更多文件)
```

**核心修复**:
```
修复前: Print-mode team leads 将队友的权限请求当作普通聊天处理
修复后: 将权限请求通过 can_use_tool host prompt 转发到主会话
影响: Desktop members 不再无限挂起，显示正确的批准 UI
```

**品牌冲突预期**: ⚠️ **低风险** - 国际化文件可能有品牌引用

**Cherry-pick 命令**:
```bash
git cherry-pick 35736f3f
```

**冲突预测**:
```
可能冲突的文件:
- desktop/src/i18n/locales/zh.ts (我们可能有自定义翻译)
- desktop/src/i18n/locales/en.ts (同上)

冲突类型: 国际化字符串合并
解决策略: 手动合并，保留双方的新增翻译
```

**验证步骤**:
```bash
# 1. 运行新增测试
bun test src/utils/swarm/printLeaderPermissionBridge.test.ts

# 2. 运行相关测试
bun test src/utils/swarm/
bun test desktop/src/components/chat/
bun test desktop/src/stores/chatStore.test.ts

# 3. 类型检查
bun run typecheck

# 4. 检查国际化文件中的品牌
grep -E "cc-haha|claude-haha|Claude Code Haha" desktop/src/i18n/locales/*.ts
# 如果找到，替换为 EchoFlow Code

# 5. 检查品牌泄漏
git diff HEAD~1..HEAD | grep -E "cc-haha|claude-haha|NanmiCoder" || echo "✅ 无品牌泄漏"
```

**预期结果**:
- ⚠️ 可能有国际化文件冲突（手动合并）
- ✅ 新功能测试通过
- ✅ 品牌一致性通过

---

### 提交 3: a4bb7c52 - 会话列表性能优化 ⭐⭐⭐

**优先级**: 高（用户体验显著提升）

**变更文件** (16 个，新增 1 个测试):
```
新增:
  src/server/__tests__/error-handler.test.ts (25 行)

修改:
  desktop/src/components/layout/Sidebar.tsx               (20 行)
  src/server/__tests__/local-index-session-parity.test.ts (52 行修改)
  src/server/__tests__/project-session-history.test.ts    (18 行修改)
  src/server/services/sessionService.ts                   (116 行重构)
  src/server/middleware/errorHandler.ts                   (13 行新增)
  src/server/api/traces.ts                                (2 行)
  ... (更多测试文件)
```

**核心修复**:
```
修复前: 构建中或空的本地索引时，会扫描所有 JSONL 文件
       打开侧边栏或 traces 页面会卡在 GET /api/sessions 直到 120s 超时
修复后: 提供部分 SQLite 行，按 session id 查找 trace 标题
       将客户端断开视为 HTTP 499
影响: 冷启动时会话列表加载速度显著提升
```

**品牌冲突预期**: 🟢 **无** - 纯性能优化

**Cherry-pick 命令**:
```bash
git cherry-pick a4bb7c52
```

**验证步骤**:
```bash
# 1. 运行相关测试
bun test src/server/__tests__/error-handler.test.ts
bun test src/server/__tests__/local-index-session-parity.test.ts
bun test src/server/__tests__/project-session-history.test.ts
bun test src/server/__tests__/sessions.test.ts
bun test src/server/services/localIndex/

# 2. 类型检查
bun run typecheck

# 3. 手动性能测试（需要桌面环境）
# cd desktop && bun run dev
# 清空本地索引，观察会话列表加载速度

# 4. 检查品牌
git diff HEAD~1..HEAD | grep -E "cc-haha|claude-haha" || echo "✅ 无品牌泄漏"
```

**预期结果**:
- ✅ 无冲突
- ✅ 所有测试通过
- ✅ 性能显著提升

---

### 提交 4: 0676c194 - 窗口拖拽恢复 ⭐⭐

**优先级**: 中（功能恢复）

**变更文件** (7 个，新增 3 个测试):
```
新增测试:
  desktop/src/components/layout/TabBar.test.tsx              (34 行)
  desktop/src/components/workbench/WorkspaceSurface.test.tsx (3 行)
  desktop/src/components/workbench/WorkspaceTabStrip.test.tsx (17 行)

修改:
  desktop/src/components/layout/TabBar.tsx           (13 行)
  desktop/src/components/workbench/WorkspaceTabStrip.tsx (7 行)
  desktop/src/theme/globals.css                      (4 行)
  desktop/src/theme/globals.test.ts                  (11 行)
```

**核心修复**:
```
修复前: Sidebar 永久合成层丢弃了 macOS app-region hits（红绿灯附近）
       Workspace header 的空白标题栏区域标记为 no-drag
修复后: 恢复侧边栏和工作区标题的拖拽功能
影响: macOS/Windows 都可以正常拖拽窗口
```

**品牌冲突预期**: 🟢 **无** - UI 行为修复

**Cherry-pick 命令**:
```bash
git cherry-pick 0676c194
```

**验证步骤**:
```bash
# 1. 运行新增测试
bun test desktop/src/components/layout/TabBar.test.tsx
bun test desktop/src/components/workbench/WorkspaceSurface.test.tsx
bun test desktop/src/components/workbench/WorkspaceTabStrip.test.tsx
bun test desktop/src/theme/globals.test.ts

# 2. 类型检查
cd desktop && bun run typecheck

# 3. 手动测试（需要桌面环境）
# cd desktop && bun run dev
# 尝试拖拽侧边栏和标题栏空白区域

# 4. 检查品牌
git diff HEAD~1..HEAD | grep -E "cc-haha|claude-haha" || echo "✅ 无品牌泄漏"
```

**预期结果**:
- ✅ 无冲突
- ✅ 所有测试通过
- ✅ 拖拽功能恢复

---

### 提交 5: 88ea66f8 - 测试连接按钮 UI 修复 ⭐⭐

**优先级**: 中（UI 修复）

**变更文件** (1 个):
```
desktop/src/pages/settings/ProviderSettings.tsx (2 行修改)
```

**核心修复**:
```
修复前: 长错误信息时，测试连接按钮塌陷为两行挤压块
       因为 flex row 中 min-width: auto，button size="sm" h-6
修复后: button 加 shrink-0 whitespace-nowrap
       错误文本加 min-w-0 flex-1 break-words
影响: 长错误信息（包括不可断 URL）正确换行
```

**品牌冲突预期**: ⚠️ **低风险** - 可能与我们的 ProviderSettings 修改冲突

**Cherry-pick 命令**:
```bash
git cherry-pick 88ea66f8
```

**冲突预测**:
```
可能冲突的文件:
- desktop/src/pages/settings/ProviderSettings.tsx

冲突原因: 
- 我们可能修改了同一区域（Provider 设置页面）
- 当前暂存区有 ProviderSettings.tsx 的修改

冲突类型: 同一组件的样式修改
解决策略: 手动合并，应用上游的 shrink-0 和 min-w-0 修复
```

**验证步骤**:
```bash
# 1. 检查冲突
git status

# 2. 如果有冲突，手动合并
git diff desktop/src/pages/settings/ProviderSettings.tsx

# 3. 类型检查
cd desktop && bun run typecheck

# 4. 手动测试（需要桌面环境）
# cd desktop && bun run dev
# 在 Provider 设置中触发长错误，观察按钮不塌陷

# 5. 检查品牌
git diff HEAD~1..HEAD | grep -E "cc-haha|claude-haha" || echo "✅ 无品牌泄漏"
```

**预期结果**:
- ⚠️ 可能有冲突（与当前暂存区冲突）
- ✅ 手动合并后样式正确
- ✅ UI 显示正常

---

### 提交 6: 8a9e3800 - 上下文指示器优化 ⭐

**优先级**: 低（UI 细节优化）

**变更文件** (4 个):
```
desktop/src/components/chat/ContextUsageIndicator.test.tsx (7 行)
desktop/src/components/chat/ContextUsageIndicator.tsx      (22 行)
desktop/src/components/layout/Sidebar.test.tsx             (48 行新增)
desktop/src/components/layout/Sidebar.tsx                  (3 行)
```

**核心修复**:
```
修复前: 折叠按钮在所有展开的项目上显示（包括自动展开的短列表）
修复后: 只在超过 6 个会话的项目上显示折叠按钮
       composer 百分比芯片替换为紧凑环形
影响: UI 更简洁，视觉噪音减少
```

**品牌冲突预期**: 🟢 **无** - UI 优化

**Cherry-pick 命令**:
```bash
git cherry-pick 8a9e3800
```

**验证步骤**:
```bash
# 1. 运行测试
bun test desktop/src/components/chat/ContextUsageIndicator.test.tsx
bun test desktop/src/components/layout/Sidebar.test.tsx

# 2. 类型检查
cd desktop && bun run typecheck

# 3. 手动测试（需要桌面环境）
# cd desktop && bun run dev
# 观察短项目列表是否隐藏折叠按钮
# 观察上下文指示器是否使用环形样式

# 4. 检查品牌
git diff HEAD~1..HEAD | grep -E "cc-haha|claude-haha" || echo "✅ 无品牌泄漏"
```

**预期结果**:
- ✅ 无冲突
- ✅ 所有测试通过
- ✅ UI 优化生效

---

## Cherry-pick 执行流程

### 标准流程（每个提交）

```bash
# Step 1: Cherry-pick
git cherry-pick <commit-hash>

# Step 2: 检查状态
git status

# Step 3a: 如果无冲突
# 跳到 Step 5

# Step 3b: 如果有冲突
git diff --name-only --diff-filter=U

# Step 4: 解决冲突
# 对每个冲突文件:
# - 品牌冲突 → 保留 ours (EchoFlow)
# - 技术修复 → 保留 theirs (上游修复)
# - 混合冲突 → 手动合并

# 标记已解决
git add <resolved-file>

# 继续 cherry-pick
git cherry-pick --continue

# Step 5: 运行验证
bun test <affected-test-files>
bun run typecheck

# Step 6: 检查品牌泄漏
git diff HEAD~1..HEAD | grep -E "cc-haha|claude-haha|NanmiCoder|relakkes" || echo "✅ 无品牌泄漏"

# Step 7: 记录日志
echo "$(git log -1 --oneline): 无冲突，测试通过" >> /tmp/cherry-pick-log.txt
```

---

## 品牌冲突处理脚本

```bash
# 创建品牌修复脚本
cat > /tmp/fix-brand-conflicts.sh << 'SCRIPT'
#!/bin/bash
# 自动检测并修复品牌冲突

echo "=== 扫描品牌冲突 ==="

# 1. 检查冲突文件
CONFLICT_FILES=$(git diff --name-only --diff-filter=U)

if [ -z "$CONFLICT_FILES" ]; then
  echo "✅ 无冲突文件"
  exit 0
fi

echo "发现冲突文件:"
echo "$CONFLICT_FILES"
echo ""

# 2. 对每个冲突文件分析冲突类型
for file in $CONFLICT_FILES; do
  echo "=== 分析 $file ==="
  
  # 检查是否为品牌冲突
  if git diff "$file" | grep -E "<<<<<<.*cc-haha|claude-haha|NanmiCoder|relakkes" > /dev/null; then
    echo "⚠️ 发现品牌冲突"
    
    # 显示冲突区域
    git diff "$file" | grep -E "<<<<<<|======|>>>>>>" -A3 -B3
    
    echo ""
    echo "请手动编辑并解决品牌冲突（保留 EchoFlow）:"
    echo "  code \"$file\""
    echo ""
    read -p "已解决? (y/n) " answer
    
    if [ "$answer" = "y" ]; then
      git add "$file"
      echo "✅ $file 已标记为已解决"
    else
      echo "⏸️ 跳过 $file"
    fi
  else
    echo "ℹ️ 非品牌冲突，需要手动审查"
    read -p "使用 --ours (o), --theirs (t), 或手动编辑 (m)? " strategy
    
    case $strategy in
      o)
        git checkout --ours "$file"
        git add "$file"
        echo "✅ 使用 --ours"
        ;;
      t)
        git checkout --theirs "$file"
        git add "$file"
        echo "✅ 使用 --theirs"
        ;;
      m)
        code "$file"
        read -p "已解决? (y/n) " answer
        if [ "$answer" = "y" ]; then
          git add "$file"
          echo "✅ $file 已标记为已解决"
        fi
        ;;
    esac
  fi
  
  echo ""
done

echo "=== 冲突解决完成 ==="
echo "未解决的冲突:"
git diff --name-only --diff-filter=U
SCRIPT

chmod +x /tmp/fix-brand-conflicts.sh
```

---

## Phase 2 执行检查清单

### 准备阶段
- [ ] 工作区已清理（`git status` 显示 clean）
- [ ] 已在分支 `merge/upstream-v0.6.4-selective`
- [ ] 快照标签 `pre-merge-v0.6.4-snapshot` 已创建
- [ ] Phase 1 文档已审查

### Cherry-pick 阶段

#### 提交 1: 9f47bbcd (Agent Teams)
- [ ] Cherry-pick 成功
- [ ] 无冲突
- [ ] 测试通过 (teammateModel, spawnMultiAgent, fable)
- [ ] 类型检查通过
- [ ] 无品牌泄漏

#### 提交 2: 35736f3f (权限路由)
- [ ] Cherry-pick 成功
- [ ] 冲突已解决（如有）
- [ ] 新功能测试通过 (printLeaderPermissionBridge)
- [ ] 国际化文件品牌已检查
- [ ] 类型检查通过
- [ ] 无品牌泄漏

#### 提交 3: a4bb7c52 (会话列表性能)
- [ ] Cherry-pick 成功
- [ ] 无冲突
- [ ] 测试通过 (error-handler, session-parity)
- [ ] 类型检查通过
- [ ] 无品牌泄漏

#### 提交 4: 0676c194 (窗口拖拽)
- [ ] Cherry-pick 成功
- [ ] 无冲突
- [ ] 测试通过 (TabBar, WorkspaceTabStrip, globals)
- [ ] 桌面类型检查通过
- [ ] 无品牌泄漏

#### 提交 5: 88ea66f8 (测试连接按钮)
- [ ] Cherry-pick 成功
- [ ] 冲突已解决（如有）
- [ ] 样式修复正确应用
- [ ] 桌面类型检查通过
- [ ] 无品牌泄漏

#### 提交 6: 8a9e3800 (上下文指示器)
- [ ] Cherry-pick 成功
- [ ] 无冲突
- [ ] 测试通过 (ContextUsageIndicator, Sidebar)
- [ ] 桌面类型检查通过
- [ ] 无品牌泄漏

### 验证阶段
- [ ] 所有 cherry-pick 已完成
- [ ] Cherry-pick 日志已记录
- [ ] 运行 `bun run verify` 完整测试
- [ ] 品牌一致性最终检查
- [ ] 生成 Phase 2 变更报告

---

## 预期成果

### 成功指标
- ✅ 6 个技术修复已应用
- ✅ 品牌 100% EchoFlow（无泄漏）
- ✅ 所有测试通过
- ✅ 类型检查通过
- ✅ 0-2 个手动解决的冲突

### 变更统计（预计）
```
新增文件: 3 个
  - src/utils/swarm/printLeaderPermissionBridge.ts
  - src/utils/swarm/printLeaderPermissionBridge.test.ts
  - src/server/__tests__/error-handler.test.ts

修改文件: ~40 个
新增代码: ~600 行
删除代码: ~150 行
净增长: ~450 行
```

### 交付物
1. 6 个 cherry-pick 提交（保留原始作者和提交信息）
2. Cherry-pick 日志 (`/tmp/cherry-pick-log.txt`)
3. 品牌一致性报告
4. 测试覆盖报告

---

## 应急回滚方案

### 回滚单个提交
```bash
# 如果某个提交有问题
git revert <commit-hash>

# 或者重置到该提交之前
git reset --hard <commit-hash>~1
```

### 完全回滚 Phase 2
```bash
# 回到 Phase 1 结束状态
git reset --hard merge/upstream-v0.6.4-selective

# 或者回到 main
git reset --hard pre-merge-v0.6.4-snapshot
```

### 重新开始 Phase 2
```bash
# 删除合并分支
git checkout main
git branch -D merge/upstream-v0.6.4-selective

# 从快照重新创建
git checkout -b merge/upstream-v0.6.4-selective pre-merge-v0.6.4-snapshot

# 重新执行 cherry-pick
```

---

## 下一步（Phase 3）

Phase 2 完成后，进入 **Phase 3: 手动合并 UI 优化**，包括：
1. ContextUsageIndicator 布局重构（flex → grid）
2. ChatInput 代码简化
3. **Provider Presets 精确合并**（最复杂部分）

**预计时间**: 3 小时  
**风险等级**: 🔴 高（Provider Presets 冲突复杂）
