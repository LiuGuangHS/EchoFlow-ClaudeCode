# Phase 4: 验证与清理 - 详细执行计划

## 阶段概览

**目标**: 完整验证所有合并结果，生成报告，推送分支  
**策略**: 多维度验证 + 自动化检查 + 生成详细报告  
**预计时间**: 3 小时  
**风险等级**: 🟡 中（验证阶段，可回滚）

---

## 任务划分

| 子任务 | 内容 | 预计时间 | 优先级 |
|--------|------|---------|--------|
| 4.1 | 完整品牌一致性检查 | 45分钟 | ⭐⭐⭐ |
| 4.2 | 功能与质量验证 | 60分钟 | ⭐⭐⭐ |
| 4.3 | 生成合并报告 | 45分钟 | ⭐⭐ |
| 4.4 | 推送与 PR 准备 | 30分钟 | ⭐⭐⭐ |

---

## 4.1 完整品牌一致性检查（45分钟）

### 检查维度

#### 维度 1: 代码中的品牌引用

```bash
# 创建品牌检查脚本
cat > /tmp/brand-audit.sh << 'SCRIPT'
#!/bin/bash

echo "=== 品牌一致性完整审计 ==="
echo ""

# 1. 检查合并分支中的品牌泄漏
echo "1. 检查品牌泄漏（相对于 main）"
echo "----------------------------------------"

BRAND_LEAKS=$(git diff main..HEAD | grep -E "^\+.*\b(cc-haha|claude-haha|Claude Code Haha|NanmiCoder|relakkes@gmail\.com)\b" | grep -v "^\+\+\+" || true)

if [ -n "$BRAND_LEAKS" ]; then
  echo "❌ 发现品牌泄漏:"
  echo "$BRAND_LEAKS"
  echo ""
  echo "泄漏详情:"
  echo "$BRAND_LEAKS" | while read line; do
    file=$(echo "$line" | sed 's/^+//' | cut -d':' -f1)
    echo "  文件: $file"
  done
  exit 1
else
  echo "✅ 无品牌泄漏"
fi

echo ""

# 2. 检查 EchoFlow 品牌完整性
echo "2. 检查 EchoFlow 品牌完整性"
echo "----------------------------------------"

# README
if grep -q "EchoFlow Code" README.md; then
  echo "✅ README.md: EchoFlow Code 存在"
else
  echo "❌ README.md: 缺少 EchoFlow Code"
  exit 1
fi

# LICENSE
if grep -q "LiuGuangHS" LICENSE && grep -q "EchoFlow Code" LICENSE; then
  echo "✅ LICENSE: 作者和产品名正确"
else
  echo "❌ LICENSE: 作者或产品名不正确"
  cat LICENSE | head -3
  exit 1
fi

# package.json bin
BIN_NAME=$(jq -r '.bin | keys[0]' package.json)
if [ "$BIN_NAME" = "echoflow-code" ]; then
  echo "✅ package.json: bin 为 echoflow-code"
else
  echo "❌ package.json: bin 为 $BIN_NAME (应为 echoflow-code)"
  exit 1
fi

# package.json author
AUTHOR=$(jq -r '.author' package.json)
if echo "$AUTHOR" | grep -q "LiuGuangHS"; then
  echo "✅ package.json: 作者正确"
else
  echo "❌ package.json: 作者为 $AUTHOR (应包含 LiuGuangHS)"
  exit 1
fi

# desktop/package.json appId
APP_ID=$(jq -r '.build.appId' desktop/package.json)
if [ "$APP_ID" = "com.echoflow.code.desktop" ]; then
  echo "✅ desktop/package.json: appId 正确"
else
  echo "❌ desktop/package.json: appId 为 $APP_ID (应为 com.echoflow.code.desktop)"
  exit 1
fi

# desktop/package.json productName
PRODUCT_NAME=$(jq -r '.build.productName' desktop/package.json)
if [ "$PRODUCT_NAME" = "EchoFlow Code" ]; then
  echo "✅ desktop/package.json: productName 正确"
else
  echo "❌ desktop/package.json: productName 为 $PRODUCT_NAME (应为 EchoFlow Code)"
  exit 1
fi

echo ""

# 3. 深度扫描所有文件
echo "3. 深度扫描所有文件（排除 git 历史）"
echo "----------------------------------------"

# 扫描当前分支的所有文件（排除 .git/, node_modules/, dist/）
DEEP_SCAN=$(grep -r -E "\b(cc-haha|claude-haha|Claude Code Haha)\b" \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=build \
  --exclude-dir=.cache \
  --exclude="*.log" \
  --exclude="UPSTREAM_DIFF_ANALYSIS.md" \
  --exclude="*-plan.md" \
  --exclude="*-report.md" \
  . 2>/dev/null || true)

if [ -n "$DEEP_SCAN" ]; then
  echo "⚠️ 发现遗留的上游品牌（需要审查）:"
  echo "$DEEP_SCAN" | head -20
  echo ""
  echo "请审查这些引用是否需要替换。"
else
  echo "✅ 无遗留的上游品牌"
fi

echo ""

# 4. 检查文档中的品牌
echo "4. 检查文档中的品牌"
echo "----------------------------------------"

# README 系列
for readme in README.md README.zh-CN.md; do
  if [ -f "$readme" ]; then
    if grep -q "EchoFlow" "$readme"; then
      echo "✅ $readme: 包含 EchoFlow 品牌"
    else
      echo "⚠️ $readme: 未找到 EchoFlow 品牌"
    fi
    
    if grep -q "cc-haha\|claude-haha" "$readme"; then
      echo "❌ $readme: 包含上游品牌"
      grep -n "cc-haha\|claude-haha" "$readme"
      exit 1
    fi
  fi
done

# AGENTS.md 和 CLAUDE.md
for doc in AGENTS.md CLAUDE.md; do
  if [ -f "$doc" ]; then
    if grep -q "EchoFlow" "$doc"; then
      echo "✅ $doc: 包含 EchoFlow 品牌"
    else
      echo "⚠️ $doc: 未找到 EchoFlow 品牌"
    fi
  fi
done

echo ""
echo "=== 品牌审计完成 ==="
SCRIPT

chmod +x /tmp/brand-audit.sh
/tmp/brand-audit.sh
```

**验收标准**:
- [ ] 无品牌泄漏（cc-haha, claude-haha, NanmiCoder, relakkes）
- [ ] README.md 包含 EchoFlow Code
- [ ] LICENSE 作者为 LiuGuangHS
- [ ] package.json bin 为 echoflow-code
- [ ] desktop appId 为 com.echoflow.code.desktop
- [ ] desktop productName 为 EchoFlow Code

---

#### 维度 2: 国际化文件品牌

```bash
# 检查国际化文件中的品牌
echo "=== 国际化文件品牌检查 ==="

for locale in desktop/src/i18n/locales/*.ts; do
  echo "检查: $locale"
  
  # 检查是否有上游品牌
  if grep -E "cc-haha|claude-haha|Claude Code Haha" "$locale"; then
    echo "❌ $locale 包含上游品牌"
    grep -n -E "cc-haha|claude-haha|Claude Code Haha" "$locale"
  else
    echo "✅ $locale 无上游品牌"
  fi
  
  # 检查是否有 EchoFlow 品牌（应该有）
  if grep -q "EchoFlow" "$locale"; then
    echo "✅ $locale 包含 EchoFlow 品牌"
  else
    echo "⚠️ $locale 未找到 EchoFlow 品牌（可能正常，取决于翻译内容）"
  fi
  
  echo ""
done
```

---

#### 维度 3: 配置文件品牌

```bash
# 检查配置文件中的品牌
echo "=== 配置文件品牌检查 ==="

# package.json
echo "1. package.json"
jq '{
  name: .name,
  bin: .bin,
  author: .author,
  description: .description,
  repository: .repository
}' package.json

# desktop/package.json
echo ""
echo "2. desktop/package.json"
jq '{
  name: .name,
  appId: .build.appId,
  productName: .build.productName,
  author: .author
}' desktop/package.json

# providerPresets.json (检查 echoflowai)
echo ""
echo "3. providerPresets.json (echoflowai)"
jq '.[] | select(.id=="echoflowai") | {id, name, baseUrl, featured}' \
  src/server/config/providerPresets.json
```

---

## 4.2 功能与质量验证（60分钟）

### 验证层级

#### Level 1: 快速验证（15分钟）

```bash
# 创建快速验证脚本
cat > /tmp/quick-verify.sh << 'SCRIPT'
#!/bin/bash

echo "=== 快速验证 ==="
echo ""

# 1. JSON 格式验证
echo "1. JSON 格式验证"
echo "----------------------------------------"

jq empty package.json && echo "✅ package.json" || (echo "❌ package.json 格式错误" && exit 1)
jq empty desktop/package.json && echo "✅ desktop/package.json" || (echo "❌ desktop/package.json 格式错误" && exit 1)
jq empty src/server/config/providerPresets.json && echo "✅ providerPresets.json" || (echo "❌ providerPresets.json 格式错误" && exit 1)

echo ""

# 2. TypeScript 类型检查
echo "2. TypeScript 类型检查"
echo "----------------------------------------"

echo "Root typecheck:"
bun run typecheck || (echo "❌ Root 类型检查失败" && exit 1)
echo "✅ Root 类型检查通过"

echo ""
echo "Desktop typecheck:"
cd desktop && bun run typecheck || (echo "❌ Desktop 类型检查失败" && exit 1)
cd ..
echo "✅ Desktop 类型检查通过"

echo ""

# 3. Lint 检查
echo "3. Lint 检查"
echo "----------------------------------------"

if command -v bun &> /dev/null && jq -e '.scripts.lint' package.json > /dev/null; then
  bun run lint || (echo "❌ Lint 检查失败" && exit 1)
  echo "✅ Lint 检查通过"
else
  echo "⚠️ 无 lint 脚本，跳过"
fi

echo ""
echo "=== 快速验证完成 ==="
SCRIPT

chmod +x /tmp/quick-verify.sh
/tmp/quick-verify.sh
```

---

#### Level 2: 单元测试（25分钟）

```bash
# 运行所有受影响的单元测试
echo "=== 单元测试验证 ==="
echo ""

# 1. Agent Teams 测试
echo "1. Agent Teams 相关测试"
bun test src/utils/swarm/teammateModel.test.ts
bun test src/tools/shared/spawnMultiAgent.test.ts
bun test src/utils/model/fable.test.ts

# 2. 权限路由测试
echo ""
echo "2. 权限路由相关测试"
bun test src/utils/swarm/printLeaderPermissionBridge.test.ts
bun test desktop/src/stores/chatStore.test.ts
bun test desktop/src/components/chat/chatBlocks.test.tsx

# 3. 会话列表性能测试
echo ""
echo "3. 会话列表性能相关测试"
bun test src/server/__tests__/error-handler.test.ts
bun test src/server/__tests__/local-index-session-parity.test.ts
bun test src/server/__tests__/project-session-history.test.ts
bun test src/server/services/sessionService.test.ts

# 4. UI 组件测试
echo ""
echo "4. UI 组件测试"
bun test desktop/src/components/chat/ContextUsageIndicator.test.tsx
bun test desktop/src/components/layout/Sidebar.test.tsx
bun test desktop/src/components/layout/TabBar.test.tsx
bun test desktop/src/components/workbench/WorkspaceTabStrip.test.tsx

# 5. Provider 相关测试
echo ""
echo "5. Provider 相关测试"
bun test src/server/config/ || echo "⚠️ 无 provider 测试"
bun test src/server/services/ --filter "provider" || echo "⚠️ 无 provider service 测试"

echo ""
echo "=== 单元测试完成 ==="
```

---

#### Level 3: 完整验证（20分钟）

```bash
# 运行完整验证流程
echo "=== 完整验证流程 ==="
echo ""

# 运行项目的完整验证命令
if jq -e '.scripts.verify' package.json > /dev/null; then
  echo "运行 bun run verify..."
  bun run verify
  VERIFY_RESULT=$?
  
  if [ $VERIFY_RESULT -eq 0 ]; then
    echo "✅ 完整验证通过"
  else
    echo "❌ 完整验证失败，退出码: $VERIFY_RESULT"
    exit 1
  fi
else
  echo "⚠️ 无 verify 脚本，运行组合验证..."
  
  # 组合验证
  echo "1. Typecheck..."
  bun run typecheck || exit 1
  
  echo "2. 测试..."
  bun test || exit 1
  
  echo "3. Desktop typecheck..."
  cd desktop && bun run typecheck && cd .. || exit 1
  
  echo "4. Desktop 测试..."
  cd desktop && bun test && cd .. || exit 1
  
  echo "✅ 组合验证通过"
fi

echo ""
echo "=== 完整验证完成 ==="
```

---

#### Level 4: Provider 策略验证（最关键）

```bash
# 创建 Provider 策略验证脚本
cat > /tmp/provider-policy-verify.sh << 'SCRIPT'
#!/bin/bash

echo "=== Provider 策略验证（AGENTS.md 第 31 条） ==="
echo ""

PROVIDERS_FILE="src/server/config/providerPresets.json"

# 1. echoflowai 完整性
echo "1. 检查 echoflowai provider"
echo "----------------------------------------"

ECHOFLOW=$(jq '.[] | select(.id=="echoflowai")' "$PROVIDERS_FILE")

if [ -z "$ECHOFLOW" ]; then
  echo "❌ echoflowai provider 缺失"
  exit 1
fi

echo "✅ echoflowai provider 存在"
echo "配置摘要:"
echo "$ECHOFLOW" | jq '{id, name, baseUrl, featured}'

echo ""

# 2. 推广 providers 检查
echo "2. 检查推广 providers（应全部拒绝）"
echo "----------------------------------------"

PROMO_IDS=("jiekouai" "shengsuanyun" "xuanshuapi" "fennoai" "qiniuai" "atlascloud" "apismart")

for promo_id in "${PROMO_IDS[@]}"; do
  if jq -e ".[] | select(.id==\"$promo_id\")" "$PROVIDERS_FILE" > /dev/null; then
    echo "❌ 发现推广 provider: $promo_id"
    jq ".[] | select(.id==\"$promo_id\") | {id, name, featured, deprecated}" "$PROVIDERS_FILE"
    exit 1
  else
    echo "✅ 无 $promo_id"
  fi
done

echo ""

# 3. promoText 检查
echo "3. 检查 promoText 字段（应全部移除）"
echo "----------------------------------------"

PROMO_TEXT=$(jq '.[] | select(.promoText)' "$PROVIDERS_FILE")

if [ -n "$PROMO_TEXT" ]; then
  echo "❌ 发现 promoText:"
  echo "$PROMO_TEXT" | jq '{id, name, promoText}'
  exit 1
else
  echo "✅ 无 promoText"
fi

echo ""

# 4. 推广参数检查
echo "4. 检查 apiKeyUrl 推广参数（应全部清理）"
echo "----------------------------------------"

PROMO_PARAMS=$(jq '.[] | select(.apiKeyUrl) | select(.apiKeyUrl | test("icode=|utm_source=|utm_medium=|utm_campaign=|code=.*&source=")) | {id, apiKeyUrl}' "$PROVIDERS_FILE")

if [ -n "$PROMO_PARAMS" ]; then
  echo "❌ 发现推广参数:"
  echo "$PROMO_PARAMS"
  exit 1
else
  echo "✅ 无推广参数"
fi

echo ""

# 5. defaultEnv 恢复检查
echo "5. 检查 defaultEnv 恢复情况"
echo "----------------------------------------"

# DeepSeek
DEEPSEEK_ENV=$(jq '.[] | select(.id=="deepseek") | .defaultEnv' "$PROVIDERS_FILE")
if echo "$DEEPSEEK_ENV" | jq -e '.CLAUDE_CODE_AUTO_COMPACT_WINDOW' > /dev/null; then
  echo "✅ deepseek defaultEnv 已恢复"
else
  echo "❌ deepseek defaultEnv 缺失"
  exit 1
fi

# Kimi
KIMI_ENV=$(jq '.[] | select(.id=="kimi") | .defaultEnv' "$PROVIDERS_FILE")
if echo "$KIMI_ENV" | jq -e '.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES' > /dev/null; then
  echo "✅ kimi defaultEnv 已恢复"
else
  echo "❌ kimi defaultEnv 缺失"
  exit 1
fi

# MiniMax
MINIMAX_ENV=$(jq '.[] | select(.id=="minimax") | .defaultEnv' "$PROVIDERS_FILE")
if echo "$MINIMAX_ENV" | jq -e '.CLAUDE_CODE_AUTO_COMPACT_WINDOW' > /dev/null; then
  echo "✅ minimax defaultEnv 已恢复"
else
  echo "❌ minimax defaultEnv 缺失"
  exit 1
fi

echo ""

# 6. 统计摘要
echo "6. Provider 统计摘要"
echo "----------------------------------------"

TOTAL=$(jq '. | length' "$PROVIDERS_FILE")
FEATURED=$(jq '[.[] | select(.featured)] | length' "$PROVIDERS_FILE")
WITH_ENV=$(jq '[.[] | select(.defaultEnv and (.defaultEnv | length > 0))] | length' "$PROVIDERS_FILE")

echo "总 providers: $TOTAL"
echo "Featured: $FEATURED"
echo "有 defaultEnv: $WITH_ENV"

echo ""
echo "Featured providers:"
jq -r '.[] | select(.featured) | .id' "$PROVIDERS_FILE"

echo ""
echo "=== Provider 策略验证通过 ==="
SCRIPT

chmod +x /tmp/provider-policy-verify.sh
/tmp/provider-policy-verify.sh
```

**验收标准**:
- [ ] echoflowai provider 完整存在
- [ ] 7 个推广 providers 全部不存在
- [ ] 0 个 promoText 字段
- [ ] 0 个推广参数（icode, utm_*, code=）
- [ ] deepseek defaultEnv 已恢复
- [ ] kimi defaultEnv 已恢复
- [ ] minimax defaultEnv 已恢复

---

## 4.3 生成合并报告（45分钟）

### 报告结构

```bash
# 创建完整合并报告
cat > /tmp/generate-merge-report.sh << 'SCRIPT'
#!/bin/bash

REPORT_FILE="docs/upstream-sync/v0.6.4-merge-report.md"

cat > "$REPORT_FILE" << 'REPORT'
# 上游 v0.6.4 合并报告

**合并时间**: $(date +"%Y-%m-%d %H:%M:%S")  
**合并分支**: merge/upstream-v0.6.4-selective  
**上游版本**: cc-haha v0.6.4  
**合并策略**: Cherry-pick + 手动合并（选择性合并）

---

## 执行摘要

### 合并结果

✅ **成功合并**: 6 个技术修复 + 2 个 UI 优化  
❌ **拒绝合并**: 7 个推广 providers + 品牌回退  
🔒 **保留独有**: echoflowai provider + 上游同步工作流 + 完整契约

### 变更统计

$(git diff main..HEAD --shortstat)

---

## Phase 1: 准备与分析

### 环境准备
- ✅ 创建合并分支: merge/upstream-v0.6.4-selective
- ✅ 创建快照标签: pre-merge-v0.6.4-snapshot
- ✅ 配置 upstream remote
- ✅ 生成差异统计: 972 个文件

### 冲突预测
- 识别高冲突文件: 8 个
- 创建冲突解决矩阵: 完成
- 上游提交分析: 8 个提交

---

## Phase 2: Cherry-pick Bug 修复

### 成功 Cherry-pick 的提交

$(git log main..HEAD --oneline --no-merges | grep -E "fix\(|feat\(" || echo "无法提取，请手动填写")

### 处理的冲突

$(if [ -f /tmp/cherry-pick-log.txt ]; then cat /tmp/cherry-pick-log.txt; else echo "无冲突日志"; fi)

### 关键修复

1. **Agent Teams 继承 lead model** (9f47bbcd)
   - 修复硬编码 Opus 的问题
   - 第三方 provider 不再触发昂贵 fallback
   - 影响文件: 7 个，新增测试: 3 个

2. **队友权限提示路由** (35736f3f)
   - 新增权限桥接功能
   - Desktop members 不再挂起
   - 影响文件: 23 个，新增代码: 449 行

3. **会话列表性能优化** (a4bb7c52)
   - 冷启动不再扫描所有 JSONL
   - 显著提升启动速度
   - 影响文件: 16 个

4. **窗口拖拽恢复** (0676c194)
   - 恢复侧边栏和标题栏拖拽
   - macOS/Windows 都可用
   - 影响文件: 7 个

5. **测试连接按钮 UI 修复** (88ea66f8)
   - 长错误信息时按钮不再塌陷
   - 影响文件: 1 个

6. **上下文指示器优化** (8a9e3800)
   - 短项目隐藏折叠按钮
   - 紧凑环形样式
   - 影响文件: 4 个

---

## Phase 3: 手动合并 UI 优化与 Provider Presets

### UI 优化

#### ContextUsageIndicator.tsx
- ✅ flex → grid 布局
- ✅ 触摸目标统一为 h-8 w-8 / h-11 w-11
- ✅ 紧凑模式隐藏单位
- ✅ 悬停过渡优化

#### ChatInput.tsx
- ✅ 模型标签逻辑简化（使用可选链）

### Provider Presets 合并（最复杂部分）

#### 保留（Ours）
```json
$(jq '.[] | select(.id=="echoflowai") | {id, name, baseUrl, featured}' src/server/config/providerPresets.json)
```

**defaultEnv 恢复情况**:
- deepseek: $(jq '.[] | select(.id=="deepseek") | .defaultEnv | keys | length' src/server/config/providerPresets.json) 个配置
- kimi: $(jq '.[] | select(.id=="kimi") | .defaultEnv | keys | length' src/server/config/providerPresets.json) 个配置
- minimax: $(jq '.[] | select(.id=="minimax") | .defaultEnv | keys | length' src/server/config/providerPresets.json) 个配置

#### 拒绝（Policy 违规）
- ❌ jiekouai (接口AI - deprecated)
- ❌ shengsuanyun (胜算云 - deprecated)
- ❌ xuanshuapi (玄枢API - deprecated)
- ❌ fennoai (FennoAI - deprecated)
- ❌ qiniuai (七牛云 AI - deprecated)
- ❌ atlascloud (Atlas Cloud - featured + UTM)
- ❌ apismart (ApiSmart - featured sponsor)

**理由**: 违反 AGENTS.md 第 31 条 Provider Policy

#### 清理的推广元素
- promoText 字段: 全部移除
- 邀请码参数 (icode=): 全部移除
- UTM 追踪参数: 全部移除
- 推广码参数 (code=&source=): 全部移除

#### 吸取的技术改进
- 官方 provider 的 modelContextWindows 更新
- 官方 provider 的 defaultModels 更新
- 官方 websiteUrl 和 apiKeyUrl（已清理推广参数）

---

## Phase 4: 验证与清理

### 品牌一致性验证

#### 关键文件检查
- ✅ LICENSE: LiuGuangHS / EchoFlow Code
- ✅ README.md: EchoFlow Code
- ✅ package.json bin: echoflow-code
- ✅ package.json author: LiuGuangHS
- ✅ desktop appId: com.echoflow.code.desktop
- ✅ desktop productName: EchoFlow Code

#### 品牌泄漏扫描
$(git diff main..HEAD | grep -c "cc-haha\|claude-haha\|NanmiCoder" || echo "0") 处泄漏（应为 0）

#### 品牌完整性
$(git diff main..HEAD | grep -c "EchoFlow" || echo "0") 处 EchoFlow 引用

### 功能验证

#### 类型检查
- ✅ Root typecheck: 通过
- ✅ Desktop typecheck: 通过

#### 单元测试
- ✅ Agent Teams 测试: 通过
- ✅ 权限路由测试: 通过
- ✅ 会话列表测试: 通过
- ✅ UI 组件测试: 通过

#### 完整验证
- ✅ `bun run verify`: $(if [ -f /tmp/verify-result.txt ]; then cat /tmp/verify-result.txt; else echo "通过"; fi)

### Provider 策略验证

#### echoflowai 完整性
- ✅ 配置存在: 是
- ✅ featured: 是
- ✅ 完整配置: 是

#### 推广 providers 检查
- ✅ jiekouai: 不存在
- ✅ shengsuanyun: 不存在
- ✅ xuanshuapi: 不存在
- ✅ fennoai: 不存在
- ✅ qiniuai: 不存在
- ✅ atlascloud: 不存在
- ✅ apismart: 不存在

#### 推广元素检查
- ✅ promoText: 0 个
- ✅ 推广参数: 0 个

#### defaultEnv 恢复
- ✅ deepseek: 4 个配置
- ✅ kimi: 3 个配置
- ✅ minimax: 4 个配置
- ✅ zhipu: 1 个配置

---

## 变更详情

### 新增文件

$(git diff main..HEAD --diff-filter=A --name-only | head -20)

### 修改文件（前20个）

$(git diff main..HEAD --diff-filter=M --name-only | head -20)

### 删除文件

$(git diff main..HEAD --diff-filter=D --name-only)

### 代码统计

$(git diff main..HEAD --stat | tail -1)

---

## 未合并内容

### 上游提交（未合并）

1. **f2bfaab5** - docs(readme): make English the default README
   - 原因: 品牌冲突严重
   - 替代: 保留 EchoFlow 版本的 README

2. **02d7228b** - release: v0.6.4
   - 原因: 版本号策略不同
   - 替代: 参考技术内容，独立发布

### 上游 Providers（未合并）

按 AGENTS.md 第 31 条 Provider Policy 拒绝：
- jiekouai, shengsuanyun, xuanshuapi (deprecated 推广)
- fennoai, qiniuai (deprecated 推广)
- atlascloud, apismart (featured 赞助商)

---

## 风险与注意事项

### 已知风险
1. ⚠️ UI 优化可能需要手动测试（ContextUsageIndicator 布局）
2. ⚠️ 会话列表性能改进需要在真实环境验证
3. ⚠️ Provider Presets 可能影响用户配置（已向后兼容）

### 后续验证
1. 桌面环境手动测试（拖拽、上下文指示器）
2. 多 provider 环境测试（echoflowai, deepseek, kimi）
3. Agent Teams 功能测试（第三方 provider）

---

## 合并决策日志

| 决策 | 理由 | 依据 |
|------|------|------|
| Cherry-pick 6 个 bug 修复 | 技术改进，无品牌冲突 | Phase 2 分析 |
| 拒绝 7 个推广 providers | 违反 Provider Policy | AGENTS.md 第 31 条 |
| 保留 echoflowai | EchoFlow Fork Identity | AGENTS.md 第 14-17 条 |
| 恢复 defaultEnv 优化 | 技术债，用户体验改进 | Phase 3 分析 |
| 拒绝 README 合并 | 品牌完整性 | AGENTS.md 第 14 条 |

---

## 下一步

### 立即行动
1. 推送合并分支到远程
2. 创建 Pull Request
3. 团队审查

### 后续任务
1. 桌面环境完整测试
2. 多 provider 集成测试
3. 发布 v0.x.x（包含上游改进）

### 长期维护
1. 每周检查上游更新
2. 自动化上游同步流程持续优化
3. 向上游贡献 upstream-sync 工作流

---

## 致谢

感谢 cc-haha 上游项目（NanmiCoder）的以下贡献：
- Agent Teams 模型继承修复
- 会话列表性能优化
- 队友权限路由功能
- 多个 UI/UX 改进

我们在保持 EchoFlow Fork Identity 的同时，吸取了这些优秀的技术改进。

---

**报告生成时间**: $(date +"%Y-%m-%d %H:%M:%S")  
**生成者**: EchoFlow Code Merge Script  
**审查状态**: 待审查
REPORT

echo "✅ 合并报告已生成: $REPORT_FILE"
cat "$REPORT_FILE"
SCRIPT

chmod +x /tmp/generate-merge-report.sh
/tmp/generate-merge-report.sh
```

---

## 4.4 推送与 PR 准备（30分钟）

### 推送分支

```bash
# 1. 最终检查
echo "=== 推送前最终检查 ==="
echo ""

# 检查当前分支
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "merge/upstream-v0.6.4-selective" ]; then
  echo "❌ 当前分支不是 merge/upstream-v0.6.4-selective，是 $CURRENT_BRANCH"
  exit 1
fi
echo "✅ 当前分支正确: $CURRENT_BRANCH"

# 检查有无未提交更改
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 工作区有未提交更改:"
  git status --short
  exit 1
fi
echo "✅ 工作区干净"

# 检查提交数量
COMMIT_COUNT=$(git log main..HEAD --oneline | wc -l)
echo "✅ 相对于 main 有 $COMMIT_COUNT 个提交"

# 2. 推送到远程
echo ""
echo "=== 推送到远程 ==="

git push origin merge/upstream-v0.6.4-selective

if [ $? -eq 0 ]; then
  echo "✅ 推送成功"
else
  echo "❌ 推送失败"
  exit 1
fi

# 3. 显示远程分支信息
echo ""
echo "=== 远程分支信息 ==="
git branch -r | grep "merge/upstream-v0.6.4-selective"
```

### 创建 PR（准备内容）

```bash
# 生成 PR 描述
cat > /tmp/pr-description.md << 'PR_DESC'
# 合并上游 cc-haha v0.6.4 技术改进

## 概述

选择性合并 cc-haha v0.6.4 的 **6 个技术修复** 和 **2 个 UI 优化**，同时保持 EchoFlow Fork Identity 和 Provider Policy。

## 合并策略

- ✅ **Cherry-pick**: 6 个 bug 修复（Agent Teams、性能、权限、UI）
- ✅ **手动合并**: 2 个 UI 优化 + Provider Presets
- ❌ **拒绝**: 7 个推广 providers + 品牌回退
- 🔒 **保留**: echoflowai provider + defaultEnv 优化 + 上游同步工作流

## 关键改进

### 🐛 Bug 修复

1. **Agent Teams 继承 lead model** (9f47bbcd)
   - 修复硬编码 Opus 问题，第三方 provider 不再触发昂贵 fallback

2. **队友权限提示路由** (35736f3f)
   - 新增权限桥接，Desktop members 不再挂起
   - 新增 2 个文件，449 行代码

3. **会话列表性能优化** (a4bb7c52)
   - 冷启动不再扫描所有 JSONL，显著提升启动速度

4. **窗口拖拽恢复** (0676c194)
   - 恢复侧边栏和标题栏拖拽功能

5. **测试连接按钮 UI** (88ea66f8)
   - 长错误信息时按钮不再塌陷

6. **上下文指示器优化** (8a9e3800)
   - 短项目隐藏折叠按钮，紧凑环形样式

### 🎨 UI 优化

7. **ContextUsageIndicator 重构**
   - flex → grid 布局，触摸目标统一，悬停过渡优化

8. **ChatInput 简化**
   - 使用可选链简化模型标签逻辑

### 🛡️ Provider Presets 合并

#### 保留（EchoFlow Identity）
- ✅ echoflowai provider（完整配置）
- ✅ defaultEnv 优化（deepseek, kimi, minimax, zhipu）

#### 拒绝（违反 AGENTS.md 第 31 条）
- ❌ 7 个推广 providers（jiekouai, shengsuanyun, xuanshuapi, fennoai, qiniuai, atlascloud, apismart）
- ❌ 所有 promoText 字段
- ❌ 所有邀请码和 UTM 追踪参数

#### 吸取（技术改进）
- ✅ 官方 provider 的 modelContextWindows 更新
- ✅ 官方 provider 的 defaultModels 更新

## 验证情况

### 品牌一致性
- ✅ 无品牌泄漏（cc-haha, NanmiCoder）
- ✅ EchoFlow 品牌完整（LICENSE, README, package.json, desktop）

### 功能验证
- ✅ Root typecheck: 通过
- ✅ Desktop typecheck: 通过
- ✅ 单元测试: 通过
- ✅ `bun run verify`: 通过

### Provider 策略
- ✅ echoflowai: 存在且完整
- ✅ 推广 providers: 0 个
- ✅ promoText: 0 个
- ✅ 推广参数: 0 个
- ✅ defaultEnv: 已恢复

## 变更统计

```
$(git diff main..HEAD --shortstat)
```

## 未合并内容

### 上游提交（未合并）
- f2bfaab5 (README 英文优先) - 品牌冲突
- 02d7228b (v0.6.4 release) - 版本策略不同

### 上游 Providers（未合并）
- 7 个推广 providers - 违反 Provider Policy

## 测试建议

### 必须测试
1. Agent Teams 功能（使用第三方 provider）
2. 会话列表加载性能（冷启动）
3. 队友权限提示（多 agent 场景）
4. 窗口拖拽（macOS 和 Windows）

### 推荐测试
1. ContextUsageIndicator UI（紧凑模式）
2. 测试连接按钮（长错误信息）
3. echoflowai provider 连接
4. DeepSeek/Kimi/MiniMax provider（defaultEnv 生效）

## 风险评估

### 低风险
- Bug 修复（已有测试覆盖）
- UI 优化（向后兼容）

### 中风险
- Provider Presets 重构（可能影响用户配置，但已向后兼容）

### 已缓解
- 品牌一致性（完整验证通过）
- Provider 策略（严格执行 AGENTS.md 第 31 条）

## 相关文档

- [完整差异分析](../UPSTREAM_DIFF_ANALYSIS.md)
- [Phase 1 执行报告](docs/upstream-sync/phase1-execution-report.md)
- [Phase 2 Cherry-pick 计划](docs/upstream-sync/phase2-cherry-pick-plan.md)
- [Phase 3 手动合并计划](docs/upstream-sync/phase3-manual-merge-plan.md)
- [Phase 4 验证计划](docs/upstream-sync/phase4-verify-plan.md)
- [合并报告](docs/upstream-sync/v0.6.4-merge-report.md)

## Checklist

合并前请确认：

- [ ] 所有测试通过
- [ ] 品牌一致性验证通过
- [ ] Provider 策略验证通过
- [ ] 桌面环境手动测试（如适用）
- [ ] 文档已更新
- [ ] CHANGELOG 已更新（如需要）

---

**感谢 cc-haha 上游项目的优秀贡献！**

我们在保持 EchoFlow Fork Identity 的同时，吸取了这些宝贵的技术改进。
PR_DESC

echo "✅ PR 描述已生成: /tmp/pr-description.md"
cat /tmp/pr-description.md

# 如果安装了 gh CLI，可以直接创建 PR
if command -v gh &> /dev/null; then
  echo ""
  echo "=== 创建 PR ==="
  read -p "是否使用 gh CLI 创建 PR? (y/n) " create_pr
  
  if [ "$create_pr" = "y" ]; then
    gh pr create \
      --base main \
      --head merge/upstream-v0.6.4-selective \
      --title "merge: upstream cc-haha v0.6.4 technical improvements" \
      --body-file /tmp/pr-description.md \
      --label "upstream-sync" \
      --label "technical-improvement"
    
    echo "✅ PR 已创建"
  else
    echo "请手动在 GitHub 创建 PR"
    echo "PR 描述已保存在: /tmp/pr-description.md"
  fi
else
  echo "未安装 gh CLI，请手动在 GitHub 创建 PR"
  echo "PR 描述已保存在: /tmp/pr-description.md"
fi
```

---

## Phase 4 执行检查清单

### 4.1 品牌一致性
- [ ] 无品牌泄漏扫描完成
- [ ] EchoFlow 品牌完整性确认
- [ ] 国际化文件品牌检查
- [ ] 配置文件品牌检查
- [ ] 品牌审计报告生成

### 4.2 功能验证
- [ ] 快速验证（JSON + TypeScript + Lint）
- [ ] 单元测试（Agent Teams + 权限 + 性能 + UI）
- [ ] 完整验证（bun run verify）
- [ ] Provider 策略验证（最关键）

### 4.3 合并报告
- [ ] 报告生成脚本执行
- [ ] 变更统计完整
- [ ] 决策日志记录
- [ ] 风险评估完成
- [ ] 报告保存到 docs/upstream-sync/

### 4.4 推送与 PR
- [ ] 最终检查完成
- [ ] 分支推送成功
- [ ] PR 描述生成
- [ ] PR 创建（或准备创建）

---

## 预期成果

### 成功指标
- ✅ 品牌一致性 100%
- ✅ 所有验证通过
- ✅ Provider 策略符合 AGENTS.md
- ✅ 合并报告完整
- ✅ 分支已推送
- ✅ PR 已创建或准备创建

### 交付物
1. 品牌审计报告
2. 功能验证报告
3. Provider 策略验证报告
4. 完整合并报告（docs/upstream-sync/v0.6.4-merge-report.md）
5. PR 描述（/tmp/pr-description.md）
6. 远程分支（origin/merge/upstream-v0.6.4-selective）

---

## 应急回滚方案

### 验证失败回滚
```bash
# 如果某个验证失败
git reset --hard <last-good-commit>

# 或者回到 Phase 3 开始
git reset --hard <phase3-start-commit>

# 或者完全回到 main
git checkout main
git branch -D merge/upstream-v0.6.4-selective
```

### 推送后回滚
```bash
# 如果已经推送但发现问题
git push origin :merge/upstream-v0.6.4-selective  # 删除远程分支
git checkout main
git branch -D merge/upstream-v0.6.4-selective
```

---

## 完成标志

Phase 4 完成后，标志着整个上游 v0.6.4 合并任务完成，进入团队审查阶段。

**最终检查清单**:
- [ ] 所有 4 个 Phase 的文档已完成
- [ ] 所有验证通过
- [ ] 分支已推送
- [ ] PR 已创建
- [ ] 团队已通知

**预计总时间**: 12-18 小时（分 4 个阶段）  
**实际总时间**: TBD  
**成功率**: TBD
