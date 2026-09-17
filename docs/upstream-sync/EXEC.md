# 上游 v0.6.4 合并执行清单

## 决策摘要

### ✅ 吸取（Cherry-pick 6 个提交）
```bash
git cherry-pick 9f47bbcd  # Agent Teams 继承 model
git cherry-pick 35736f3f  # 权限路由（新增 449 行）
git cherry-pick a4bb7c52  # 会话列表性能
git cherry-pick 0676c194  # 窗口拖拽
git cherry-pick 88ea66f8  # 测试连接按钮
git cherry-pick 8a9e3800  # 上下文指示器
```

### 🔧 手动合并（3 个文件）
1. `desktop/src/components/chat/ContextUsageIndicator.tsx` - flex→grid
2. `desktop/src/components/ChatInput.tsx` - 简化代码
3. `src/server/config/providerPresets.json` - **最复杂**

### ❌ 拒绝
- 品牌回退（LICENSE, README, package.json 等）
- 7 个推广 providers
- 所有 promoText 和 UTM 参数

---

## 立即执行

### 1. 提交当前工作
```bash
git add .
git commit -m "feat: enhance EchoFlow API and docs"
git push origin main
```

### 2. 创建合并分支
```bash
git checkout -b merge/upstream-v0.6.4-selective
git tag pre-merge-v0.6.4-snapshot main
git remote add upstream https://github.com/NanmiCoder/cc-haha.git
git fetch upstream
```

### 3. Cherry-pick（逐个执行，遇到冲突就停下来问我）
```bash
git cherry-pick 9f47bbcd && bun test src/utils/swarm/
git cherry-pick 35736f3f && bun test src/utils/swarm/printLeaderPermissionBridge.test.ts
git cherry-pick a4bb7c52 && bun test src/server/__tests__/
git cherry-pick 0676c194 && bun test desktop/src/components/layout/
git cherry-pick 88ea66f8 && bun test desktop/src/pages/settings/
git cherry-pick 8a9e3800 && bun test desktop/src/components/chat/
```

### 4. 手动合并 Provider Presets（关键文件）

**创建自动合并脚本**:
```bash
cat > /tmp/merge-providers.js << 'EOF'
const fs = require('fs');
const our = JSON.parse(fs.readFileSync('src/server/config/providerPresets.json', 'utf8'));
const upstream = JSON.parse(fs.execSync('git show upstream/main:src/server/config/providerPresets.json').toString());

// 1. 从上游开始
let merged = upstream.filter(p => !['jiekouai','shengsuanyun','xuanshuapi','fennoai','qiniuai','atlascloud','apismart'].includes(p.id));

// 2. 恢复 echoflowai
const echoflow = our.find(p => p.id === 'echoflowai');
merged.splice(merged.findIndex(p => p.id === 'anthropic') + 1, 0, echoflow);

// 3. 恢复 defaultEnv
['deepseek','kimi','minimax','zhipu'].forEach(id => {
  const ourP = our.find(p => p.id === id);
  const mergedP = merged.find(p => p.id === id);
  if (ourP?.defaultEnv && mergedP) mergedP.defaultEnv = ourP.defaultEnv;
});

// 4. 清理推广
merged.forEach(p => {
  delete p.promoText;
  if (p.apiKeyUrl) {
    const url = new URL(p.apiKeyUrl);
    ['icode','code','utm_source','utm_medium','utm_campaign','source'].forEach(k => url.searchParams.delete(k));
    p.apiKeyUrl = url.origin + url.pathname.replace(/\/$/, '');
  }
});

fs.writeFileSync('src/server/config/providerPresets.json', JSON.stringify(merged, null, 2) + '\n');
console.log('✅ 合并完成');
EOF

node /tmp/merge-providers.js
```

**验证**:
```bash
# 检查 echoflowai 存在
jq '.[] | select(.id=="echoflowai")' src/server/config/providerPresets.json

# 检查无推广 providers
jq '.[] | select(.id | test("jiekouai|atlascloud"))' src/server/config/providerPresets.json
# 预期: 无输出

# 检查 defaultEnv 恢复
jq '.[] | select(.id=="deepseek") | .defaultEnv' src/server/config/providerPresets.json
# 预期: 有 4 个配置

git add src/server/config/providerPresets.json
git commit -m "refactor: merge provider presets, keep echoflowai, reject promotional"
```

### 5. 验证
```bash
bun run typecheck
cd desktop && bun run typecheck && cd ..
bun run verify

# 品牌检查
git diff main..HEAD | grep -E "cc-haha|claude-haha" && echo "❌ 品牌泄漏" || echo "✅ 无泄漏"
```

### 6. 推送
```bash
git push origin merge/upstream-v0.6.4-selective
# 然后在 GitHub 创建 PR
```

---

## 如果遇到冲突

**国际化文件冲突** (35736f3f 可能遇到):
```bash
# 保留双方的翻译，手动合并
code desktop/src/i18n/locales/zh.ts
git add desktop/src/i18n/locales/*.ts
git cherry-pick --continue
```

**ProviderSettings 冲突** (88ea66f8 可能遇到):
```bash
# 应用上游的 shrink-0 和 min-w-0 修复
code desktop/src/pages/settings/ProviderSettings.tsx
git add desktop/src/pages/settings/ProviderSettings.tsx
git cherry-pick --continue
```

---

## 回滚
```bash
# 如果出错，回到开始
git checkout main
git branch -D merge/upstream-v0.6.4-selective
git tag -d pre-merge-v0.6.4-snapshot
```
