# Phase 3: 手动合并 UI 优化与 Provider Presets - 详细执行计划

## 阶段概览

**目标**: 手动合并上游的 UI 优化代码，精确处理 Provider Presets 冲突  
**策略**: 逐文件 diff 分析 + 手动应用 + Provider 策略严格执行  
**预计时间**: 3 小时  
**风险等级**: 🔴 高（Provider Presets 是最复杂的冲突）

---

## 任务划分

| 子任务 | 文件 | 复杂度 | 预计时间 | 优先级 |
|--------|------|--------|---------|--------|
| 3.1 | ContextUsageIndicator.tsx | 🟡 中 | 30分钟 | ⭐⭐ |
| 3.2 | ChatInput.tsx | 🟢 低 | 15分钟 | ⭐ |
| 3.3 | **Provider Presets** | 🔴 高 | 90分钟 | ⭐⭐⭐ |
| 3.4 | 验证与测试 | 🟡 中 | 45分钟 | ⭐⭐⭐ |

---

## 3.1 ContextUsageIndicator 重构（30分钟）

### 变更分析

**上游改进**:
```typescript
// 布局: flex → grid
- <div className="flex items-center gap-2">
+ <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">

// 触摸目标统一
- className="h-7 w-7"  // 不一致
+ className="h-8 w-8"  // 统一为 h-8 w-8 或 h-11 w-11

// 紧凑模式隐藏单位
- {compact ? 'K' : 'tokens'}
+ {compact ? '' : 'tokens'}

// 悬停过渡优化
+ transition-all duration-200 ease-in-out
```

### 执行步骤

```bash
# 1. 查看完整差异
git diff upstream/main:desktop/src/components/chat/ContextUsageIndicator.tsx \
         main:desktop/src/components/chat/ContextUsageIndicator.tsx \
         > /tmp/context-indicator-diff.txt

less /tmp/context-indicator-diff.txt

# 2. 备份当前版本
cp desktop/src/components/chat/ContextUsageIndicator.tsx \
   desktop/src/components/chat/ContextUsageIndicator.tsx.backup

# 3. 手动应用改进（在编辑器中）
code desktop/src/components/chat/ContextUsageIndicator.tsx
```

### 需要应用的改进清单

**改进 1: flex → grid 布局**
```typescript
// 找到主容器
// 将 flex 改为 grid grid-cols-[auto_1fr_auto]
```

**改进 2: 统一触摸目标**
```typescript
// 查找所有 h-7 w-7 或不一致的尺寸
// 统一改为 h-8 w-8（小）或 h-11 w-11（大）
```

**改进 3: 紧凑模式隐藏单位**
```typescript
// 查找单位显示逻辑
// 紧凑模式下完全隐藏单位（不显示 'K'）
```

**改进 4: 悬停过渡**
```typescript
// 添加 transition-all duration-200 ease-in-out
// 到可交互元素
```

### 验证步骤

```bash
# 1. 类型检查
cd desktop && bun run typecheck

# 2. 运行测试
bun test desktop/src/components/chat/ContextUsageIndicator.test.tsx

# 3. 对比差异
git diff desktop/src/components/chat/ContextUsageIndicator.tsx

# 4. 提交
git add desktop/src/components/chat/ContextUsageIndicator.tsx
git commit -m "refactor(desktop): optimize ContextUsageIndicator layout

- Use grid layout instead of flex for better alignment
- Unify touch target sizes (h-8 w-8 / h-11 w-11)
- Hide unit label in compact mode
- Add smooth hover transitions

Cherry-picked improvements from upstream 8a9e3800"
```

**验收标准**:
- [ ] 布局从 flex 改为 grid
- [ ] 触摸目标尺寸统一
- [ ] 紧凑模式隐藏单位
- [ ] 悬停过渡流畅
- [ ] 测试通过
- [ ] 类型检查通过

---

## 3.2 ChatInput 模型标签简化（15分钟）

### 变更分析

**上游优化**:
```typescript
// 冗长写法（我们当前）
const runtimeModelLabel = runtimeSelection
  ? runtimeSelection.modelId
  : currentModel?.name ?? currentModel?.id

// 简洁写法（上游优化）
const runtimeModelLabel = runtimeSelection?.modelId ?? currentModel?.name ?? currentModel?.id
```

### 执行步骤

```bash
# 1. 查看差异
git diff upstream/main:desktop/src/components/ChatInput.tsx \
         main:desktop/src/components/ChatInput.tsx \
         | grep -A10 -B10 "runtimeModelLabel"

# 2. 定位并修改
code desktop/src/components/ChatInput.tsx
# 搜索 "runtimeModelLabel"
# 应用简洁写法
```

### 验证步骤

```bash
# 1. 类型检查
cd desktop && bun run typecheck

# 2. 运行测试（如果有）
bun test desktop/src/components/ChatInput.test.tsx

# 3. 提交
git add desktop/src/components/ChatInput.tsx
git commit -m "refactor(desktop): simplify runtimeModelLabel logic in ChatInput

Use optional chaining for cleaner code:
runtimeSelection?.modelId ?? currentModel?.name ?? currentModel?.id

Cherry-picked simplification from upstream"
```

**验收标准**:
- [ ] 代码从三元改为可选链
- [ ] 逻辑等价
- [ ] 类型检查通过

---

## 3.3 Provider Presets 精确合并（90分钟）⭐⭐⭐

### 风险评估

**这是整个合并过程中最复杂的部分**，因为：

1. **上游删除了我们的 provider**: `echoflowai`
2. **上游新增了 7 个 provider**: 其中 5 个带推广性质
3. **上游清空了所有 `defaultEnv`**: 我们有技术优化配置
4. **上游添加了邀请码和 UTM 参数**: 违反我们的 Fork Policy

### 差异摘要

#### 上游删除（我们必须恢复）
```json
{
  "id": "echoflowai",
  "name": "清云 API",
  "baseUrl": "https://api.echoflow.cn",
  "featured": true,
  // ... 完整配置
}
```

#### 上游新增（需要分类处理）

**❌ 拒绝（推广性质）**:
1. `jiekouai` - 接口AI（已标记 deprecated，但仍有）
2. `shengsuanyun` - 胜算云（deprecated）
3. `xuanshuapi` - 玄枢API（deprecated）
4. `fennoai` - FennoAI（deprecated）
5. `qiniuai` - 七牛云 AI（deprecated）

**⚠️ 审查（featured 赞助商）**:
6. `atlascloud` - Atlas Cloud（featured + UTM 参数）
7. `apismart` - ApiSmart（featured）

#### 上游清空（我们必须恢复）

**DeepSeek `defaultEnv`**:
```json
"defaultEnv": {
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "thinking,effort,adaptive_thinking,max_effort",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "thinking,effort,adaptive_thinking,max_effort",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "thinking,effort,adaptive_thinking,max_effort"
}
```

**智谱 GLM `defaultEnv`**:
```json
"defaultEnv": {
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000"
}
```

**Kimi `defaultEnv`**:
```json
"defaultEnv": {
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "thinking,required_thinking,effort,max_effort",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "thinking,required_thinking,effort,max_effort",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "thinking,required_thinking,effort,max_effort"
}
```

**MiniMax `defaultEnv`**:
```json
"defaultEnv": {
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking"
}
```

#### 上游修改（需要吸取技术参数）

**智谱 GLM 新增推广**:
```json
"apiKeyUrl": "https://www.bigmodel.cn/invite?icode=d41B2qi8Z5xNwTGLNPPF3OZLO2QH3C0EBTSr%2BArzMw4%3D",
"promoText": "智谱 GLM 为 cc-haha 用户准备了专属邀请福利..."
```

**MiniMax 新增推广**:
```json
"apiKeyUrl": "https://platform.minimaxi.com/subscribe/token-plan?code=1TG2Cseab2&source=link"
```

### 合并策略详解

#### 策略 1: 保留 echoflowai（我们独有）

```bash
# 从当前 main 提取 echoflowai 配置
jq '.[] | select(.id=="echoflowai")' src/server/config/providerPresets.json > /tmp/echoflowai.json

cat /tmp/echoflowai.json
# 确认配置完整
```

#### 策略 2: 拒绝推广 providers

**完全不添加以下 providers**:
- `jiekouai`
- `shengsuanyun`
- `xuanshuapi`
- `fennoai`
- `qiniuai`
- `atlascloud`（有 UTM）
- `apismart`（featured 赞助商）

**理由**: 违反 AGENTS.md 第 31 条 Provider Policy

#### 策略 3: 恢复 defaultEnv 优化

```bash
# 从当前 main 提取所有 defaultEnv
jq '.[] | select(.defaultEnv and (.defaultEnv | length > 0)) | {id: .id, defaultEnv: .defaultEnv}' \
  src/server/config/providerPresets.json > /tmp/our-default-envs.json

cat /tmp/our-default-envs.json
```

#### 策略 4: 吸取官方 provider 的技术参数

**可能吸取的更新**:
- `modelContextWindows` 的新值
- `defaultModels` 的更新
- `apiFormat` 的改进
- 官方 `websiteUrl` 和 `apiKeyUrl`（去除推广参数）

### 执行步骤

#### Step 1: 备份当前配置（5分钟）

```bash
# 1. 备份当前版本
cp src/server/config/providerPresets.json \
   src/server/config/providerPresets.json.our-version

# 2. 保存上游版本
git show upstream/main:src/server/config/providerPresets.json \
   > src/server/config/providerPresets.json.upstream-version

# 3. 提取关键配置
jq '.[] | select(.id=="echoflowai")' \
   src/server/config/providerPresets.json.our-version \
   > /tmp/echoflowai-config.json

jq '.[] | select(.defaultEnv and (.defaultEnv | length > 0))' \
   src/server/config/providerPresets.json.our-version \
   > /tmp/our-defaultenvs.json

echo "✅ 备份完成"
ls -lh src/server/config/providerPresets.json.*
ls -lh /tmp/echoflowai-config.json /tmp/our-defaultenvs.json
```

#### Step 2: 生成合并后的配置（30分钟）

```bash
# 创建合并脚本
cat > /tmp/merge-provider-presets.js << 'SCRIPT'
const fs = require('fs');

// 加载三个版本
const ourVersion = JSON.parse(fs.readFileSync('src/server/config/providerPresets.json.our-version', 'utf8'));
const upstreamVersion = JSON.parse(fs.readFileSync('src/server/config/providerPresets.json.upstream-version', 'utf8'));

// 1. 从上游开始（获取官方 provider 的技术更新）
let merged = JSON.parse(JSON.stringify(upstreamVersion));

// 2. 移除推广 providers（按 AGENTS.md 第 31 条）
const promotionalProviders = [
  'jiekouai',
  'shengsuanyun',
  'xuanshuapi',
  'fennoai',
  'qiniuai',
  'atlascloud',  // 有 UTM 参数
  'apismart'     // featured 赞助商
];

merged = merged.filter(p => !promotionalProviders.includes(p.id));

console.log(`✅ 移除了 ${promotionalProviders.length} 个推广 providers`);

// 3. 恢复 echoflowai（从我们的版本）
const echoflowai = ourVersion.find(p => p.id === 'echoflowai');
if (echoflowai) {
  // 插入到 anthropic 之后
  const anthropicIndex = merged.findIndex(p => p.id === 'anthropic');
  merged.splice(anthropicIndex + 1, 0, echoflowai);
  console.log('✅ 恢复了 echoflowai provider');
} else {
  console.warn('⚠️ 未找到 echoflowai 配置');
}

// 4. 恢复 defaultEnv（从我们的版本）
const providersWithDefaultEnv = ourVersion.filter(p => 
  p.defaultEnv && Object.keys(p.defaultEnv).length > 0
);

providersWithDefaultEnv.forEach(ourProvider => {
  const mergedProvider = merged.find(p => p.id === ourProvider.id);
  if (mergedProvider) {
    mergedProvider.defaultEnv = ourProvider.defaultEnv;
    console.log(`✅ 恢复了 ${ourProvider.id} 的 defaultEnv`);
  }
});

// 5. 移除推广元素（从保留的 providers）
merged.forEach(provider => {
  // 移除 promoText
  if (provider.promoText) {
    delete provider.promoText;
    console.log(`✅ 移除了 ${provider.id} 的 promoText`);
  }
  
  // 清理 apiKeyUrl 中的推广参数
  if (provider.apiKeyUrl) {
    const url = new URL(provider.apiKeyUrl);
    
    // 移除邀请码参数
    if (url.searchParams.has('icode') || 
        url.searchParams.has('code') ||
        url.searchParams.has('utm_source') ||
        url.searchParams.has('utm_medium') ||
        url.searchParams.has('utm_campaign')) {
      
      // 如果只是追踪参数，清理 URL
      url.searchParams.delete('icode');
      url.searchParams.delete('code');
      url.searchParams.delete('utm_source');
      url.searchParams.delete('utm_medium');
      url.searchParams.delete('utm_campaign');
      url.searchParams.delete('source');
      
      // 如果清理后 URL 只剩域名，简化
      const cleanUrl = url.origin + url.pathname.replace(/\/$/, '');
      const hasParams = Array.from(url.searchParams).length > 0;
      
      provider.apiKeyUrl = hasParams ? url.toString() : cleanUrl;
      console.log(`✅ 清理了 ${provider.id} 的 apiKeyUrl 推广参数`);
    }
  }
});

// 6. 验证结果
console.log('\n=== 合并结果摘要 ===');
console.log(`总 providers: ${merged.length}`);
console.log(`保留的 featured: ${merged.filter(p => p.featured).map(p => p.id).join(', ')}`);
console.log(`有 defaultEnv 的: ${merged.filter(p => p.defaultEnv && Object.keys(p.defaultEnv).length > 0).map(p => p.id).join(', ')}`);

// 检查 echoflowai
const hasEchoflow = merged.find(p => p.id === 'echoflowai');
if (!hasEchoflow) {
  console.error('❌ 错误: echoflowai 缺失！');
  process.exit(1);
}

// 检查是否有推广泄漏
const hasPromo = merged.some(p => p.promoText || 
  (p.apiKeyUrl && (p.apiKeyUrl.includes('icode=') || 
                   p.apiKeyUrl.includes('utm_source=') ||
                   p.apiKeyUrl.includes('code='))));
if (hasPromo) {
  console.error('❌ 错误: 检测到推广内容泄漏！');
  const promoProviders = merged.filter(p => p.promoText || 
    (p.apiKeyUrl && (p.apiKeyUrl.includes('icode=') || 
                     p.apiKeyUrl.includes('utm_source='))));
  console.error('问题 providers:', promoProviders.map(p => p.id));
  process.exit(1);
}

// 7. 写入结果
fs.writeFileSync(
  'src/server/config/providerPresets.json.merged',
  JSON.stringify(merged, null, 2) + '\n',
  'utf8'
);

console.log('\n✅ 合并完成: src/server/config/providerPresets.json.merged');
SCRIPT

# 执行合并脚本
node /tmp/merge-provider-presets.js
```

#### Step 3: 人工审查合并结果（30分钟）

```bash
# 1. 查看合并结果
code src/server/config/providerPresets.json.merged

# 2. 对比三个版本
# 安装 diff 工具（如果需要）
# diff -u src/server/config/providerPresets.json.our-version \
#          src/server/config/providerPresets.json.merged

# 3. 验证关键点
echo "=== 验证清单 ==="

# 检查 echoflowai
echo "1. echoflowai 存在:"
jq '.[] | select(.id=="echoflowai") | .name' src/server/config/providerPresets.json.merged

# 检查无推广 providers
echo "2. 无推广 providers:"
jq '.[] | select(.id | test("jiekouai|shengsuanyun|xuanshuapi|fennoai|qiniuai|atlascloud|apismart"))' \
  src/server/config/providerPresets.json.merged \
  && echo "❌ 发现推广 provider" || echo "✅ 无推广 provider"

# 检查 defaultEnv
echo "3. defaultEnv 已恢复:"
jq '.[] | select(.id=="deepseek") | .defaultEnv | keys' src/server/config/providerPresets.json.merged

# 检查无推广参数
echo "4. 无推广参数:"
jq '.[] | select(.apiKeyUrl | test("icode=|utm_source=|utm_medium="))' \
  src/server/config/providerPresets.json.merged \
  && echo "❌ 发现推广参数" || echo "✅ 无推广参数"

# 检查无 promoText
echo "5. 无 promoText:"
jq '.[] | select(.promoText)' src/server/config/providerPresets.json.merged \
  && echo "❌ 发现 promoText" || echo "✅ 无 promoText"
```

#### Step 4: 应用合并结果（10分钟）

```bash
# 1. 如果验证通过，应用合并
mv src/server/config/providerPresets.json.merged \
   src/server/config/providerPresets.json

# 2. 验证 JSON 格式
jq empty src/server/config/providerPresets.json && echo "✅ JSON 格式正确"

# 3. 运行测试（如果有）
bun test src/server/config/providerPresets.test.ts || echo "⚠️ 无测试文件"

# 4. 提交
git add src/server/config/providerPresets.json
git commit -m "refactor(server): merge upstream provider presets with fork policy

KEEP (ours):
- echoflowai provider (EchoFlow identity)
- All defaultEnv optimizations (auto-compact, thinking capabilities)

REJECT (policy violation per AGENTS.md line 31):
- jiekouai, shengsuanyun, xuanshuapi, fennoai, qiniuai (promotional)
- atlascloud, apismart (featured sponsors with UTM tracking)
- All promoText fields
- All invitation codes and UTM parameters in apiKeyUrl

ADOPT (technical improvements):
- Official provider modelContextWindows updates
- Official provider defaultModels updates
- Clean official apiKeyUrl and websiteUrl

Result: ${PROVIDER_COUNT} providers, EchoFlow policy compliant"
```

#### Step 5: 最终验证（15分钟）

```bash
# 1. Provider 策略完整检查
echo "=== Provider 策略验证 ==="

# 1.1 echoflowai 完整性
echo "检查 echoflowai 配置..."
jq '.[] | select(.id=="echoflowai") | {
  id, name, baseUrl, featured, promoText,
  hasDefaultModels: (.defaultModels != null),
  hasModelContextWindows: (.modelContextWindows != null)
}' src/server/config/providerPresets.json

# 1.2 defaultEnv 完整性
echo ""
echo "检查 defaultEnv 恢复情况..."
jq '.[] | select(.defaultEnv and (.defaultEnv | length > 0)) | {
  id,
  envCount: (.defaultEnv | length),
  envKeys: (.defaultEnv | keys)
}' src/server/config/providerPresets.json

# 1.3 推广内容检查
echo ""
echo "检查推广内容泄漏..."
jq '.[] | select(.promoText or (.apiKeyUrl and (.apiKeyUrl | test("icode=|utm_|code=")))) | {
  id,
  hasPromoText: (.promoText != null),
  apiKeyUrl
}' src/server/config/providerPresets.json \
  && echo "❌ 发现推广泄漏" || echo "✅ 无推广泄漏"

# 1.4 推广 provider 检查
echo ""
echo "检查推广 providers..."
PROMO_PROVIDERS=$(jq -r '.[] | select(.id | test("jiekouai|shengsuanyun|xuanshuapi|fennoai|qiniuai|atlascloud|apismart")) | .id' \
  src/server/config/providerPresets.json)

if [ -n "$PROMO_PROVIDERS" ]; then
  echo "❌ 发现推广 providers: $PROMO_PROVIDERS"
  exit 1
else
  echo "✅ 无推广 providers"
fi

# 2. 功能验证
echo ""
echo "=== 功能验证 ==="

# 2.1 JSON 有效性
jq empty src/server/config/providerPresets.json && echo "✅ JSON 格式有效" || (echo "❌ JSON 格式无效" && exit 1)

# 2.2 Provider 数量
PROVIDER_COUNT=$(jq '. | length' src/server/config/providerPresets.json)
echo "Provider 总数: $PROVIDER_COUNT"

# 2.3 Featured providers
echo "Featured providers:"
jq -r '.[] | select(.featured) | .id' src/server/config/providerPresets.json

# 3. 类型检查
echo ""
echo "=== 类型检查 ==="
bun run typecheck && echo "✅ 类型检查通过" || (echo "❌ 类型检查失败" && exit 1)

# 4. 测试
echo ""
echo "=== 测试验证 ==="
bun test src/server/ --filter "provider" && echo "✅ Provider 测试通过" || echo "⚠️ 部分测试失败"

echo ""
echo "=== Phase 3.3 完成 ==="
```

**验收标准**:
- [ ] echoflowai provider 完整保留
- [ ] 所有 defaultEnv 优化已恢复
- [ ] 7 个推广 providers 已拒绝
- [ ] 所有 promoText 已移除
- [ ] 所有 apiKeyUrl 的推广参数已清理
- [ ] JSON 格式有效
- [ ] 类型检查通过
- [ ] Provider 测试通过

---

## 3.4 验证与测试（45分钟）

### 完整验证清单

#### 品牌一致性检查（15分钟）

```bash
# 1. 扫描所有更改中的品牌
echo "=== 品牌一致性检查 ==="

git diff main..HEAD | grep -E "cc-haha|claude-haha|Claude Code Haha|NanmiCoder|relakkes" \
  && echo "❌ 发现品牌泄漏" || echo "✅ 无品牌泄漏"

# 2. 检查关键文件
echo ""
echo "检查关键文件品牌..."

grep -i "echoflow" README.md && echo "✅ README 正确"
grep -i "LiuGuangHS" LICENSE && echo "✅ LICENSE 正确"
jq -e '.bin."echoflow-code"' package.json && echo "✅ bin 正确"
jq -e '.build.appId | contains("echoflow")' desktop/package.json && echo "✅ appId 正确"

# 3. 生成品牌报告
cat > /tmp/brand-consistency-report.md << 'REPORT'
# 品牌一致性报告

## 检查时间
$(date)

## 品牌扫描结果
$(git diff main..HEAD | grep -c "EchoFlow" || echo "0") 处 EchoFlow 引用
$(git diff main..HEAD | grep -c "cc-haha" || echo "0") 处 cc-haha 泄漏（应为 0）

## 关键文件验证
- LICENSE: $(grep -c "LiuGuangHS" LICENSE) 处作者引用
- package.json bin: $(jq -r '.bin | keys[]' package.json)
- desktop appId: $(jq -r '.build.appId' desktop/package.json)

## 结论
$(if git diff main..HEAD | grep -q "cc-haha"; then echo "❌ 品牌一致性检查失败"; else echo "✅ 品牌一致性检查通过"; fi)
REPORT

cat /tmp/brand-consistency-report.md
```

#### 功能测试（20分钟）

```bash
# 1. 运行所有受影响的测试
echo "=== 功能测试 ==="

# Desktop 测试
cd desktop
bun test src/components/chat/ContextUsageIndicator.test.tsx
bun test src/components/ChatInput.test.tsx
bun test src/components/layout/
bun test src/components/workbench/

# Server 测试
cd ..
bun test src/server/config/
bun test src/server/services/

# 2. 完整测试套件
echo ""
echo "运行完整测试套件..."
bun run verify

# 3. 生成测试报告
TEST_RESULT=$?
if [ $TEST_RESULT -eq 0 ]; then
  echo "✅ 所有测试通过"
else
  echo "❌ 测试失败，退出码: $TEST_RESULT"
  exit 1
fi
```

#### 变更统计（10分钟）

```bash
# 生成 Phase 3 变更报告
cat > /tmp/phase3-changes-report.md << 'REPORT'
# Phase 3 变更报告

## 变更摘要
$(git diff main..HEAD --stat)

## 提交历史
$(git log main..HEAD --oneline)

## UI 优化
- ContextUsageIndicator: grid 布局 + 统一触摸目标
- ChatInput: 简化模型标签逻辑

## Provider Presets 合并
### 保留（Ours）
- echoflowai: $(jq '.[] | select(.id=="echoflowai") | .name' src/server/config/providerPresets.json)
- defaultEnv 优化: $(jq '[.[] | select(.defaultEnv and (.defaultEnv | length > 0)) | .id] | length' src/server/config/providerPresets.json) 个 providers

### 拒绝（Policy）
- jiekouai, shengsuanyun, xuanshuapi, fennoai, qiniuai
- atlascloud, apismart (featured sponsors)
- 所有 promoText 和推广参数

### 吸取（Technical）
- 官方 provider 的技术参数更新
- modelContextWindows 更新
- defaultModels 更新

## 验证结果
- 品牌一致性: $(if git diff main..HEAD | grep -q "cc-haha"; then echo "❌ 失败"; else echo "✅ 通过"; fi)
- 测试: $(if [ $TEST_RESULT -eq 0 ]; then echo "✅ 通过"; else echo "❌ 失败"; fi)
- Provider 策略: $(if jq '.[] | select(.id | test("jiekouai"))' src/server/config/providerPresets.json >/dev/null 2>&1; then echo "❌ 失败"; else echo "✅ 通过"; fi)

## 下一步
准备进入 Phase 4: 最终验证与清理
REPORT

cat /tmp/phase3-changes-report.md
```

---

## Phase 3 执行检查清单

### 3.1 ContextUsageIndicator
- [ ] 差异分析完成
- [ ] 当前版本已备份
- [ ] flex → grid 布局已应用
- [ ] 触摸目标已统一
- [ ] 紧凑模式单位已隐藏
- [ ] 悬停过渡已优化
- [ ] 测试通过
- [ ] 类型检查通过
- [ ] 已提交

### 3.2 ChatInput
- [ ] 差异分析完成
- [ ] 模型标签逻辑已简化
- [ ] 类型检查通过
- [ ] 已提交

### 3.3 Provider Presets ⭐⭐⭐
- [ ] 当前配置已备份
- [ ] 上游配置已提取
- [ ] 合并脚本已生成
- [ ] 合并脚本已执行
- [ ] echoflowai 已恢复
- [ ] defaultEnv 优化已恢复
- [ ] 7 个推广 providers 已拒绝
- [ ] 所有 promoText 已移除
- [ ] 所有推广参数已清理
- [ ] 人工审查完成
- [ ] JSON 格式有效
- [ ] Provider 策略验证通过
- [ ] 测试通过
- [ ] 已提交

### 3.4 验证
- [ ] 品牌一致性检查通过
- [ ] 所有测试通过
- [ ] 变更报告已生成
- [ ] Phase 3 完成

---

## 预期成果

### 成功指标
- ✅ 2 个 UI 组件已优化
- ✅ Provider Presets 符合 Fork Policy
- ✅ echoflowai 完整保留
- ✅ defaultEnv 优化完整恢复
- ✅ 0 个推广 providers
- ✅ 0 个推广参数
- ✅ 品牌 100% EchoFlow
- ✅ 所有测试通过

### 变更统计（预计）
```
修改文件: 3 个
  - desktop/src/components/chat/ContextUsageIndicator.tsx
  - desktop/src/components/ChatInput.tsx
  - src/server/config/providerPresets.json

代码变化:
  - ContextUsageIndicator: ~30 行修改
  - ChatInput: ~3 行修改
  - providerPresets: -200 行（移除推广），+30 行（恢复 echoflowai）
```

---

## 应急回滚方案

### 回滚单个文件
```bash
# 回滚 Provider Presets
git checkout HEAD~1 -- src/server/config/providerPresets.json

# 回滚 UI 组件
git checkout HEAD~1 -- desktop/src/components/chat/ContextUsageIndicator.tsx
```

### 完全回滚 Phase 3
```bash
# 回到 Phase 2 结束状态
git reset --hard <phase2-last-commit>
```

---

## 下一步（Phase 4）

Phase 3 完成后，进入 **Phase 4: 验证与清理**：
1. 完整品牌一致性检查
2. 运行 `bun run verify` 完整测试
3. 生成合并报告
4. 推送远程分支并创建 PR

**预计时间**: 3 小时  
**风险等级**: 🟡 中
