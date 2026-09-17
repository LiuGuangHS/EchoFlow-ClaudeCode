# 提交计划 - EchoFlow 改进与上游合并准备

## 当前状态

**分支**: `main`  
**最新提交**: `a691d701 fix: add missing getProcessInfo.nsh for Windows installer`  
**暂存更改**: 34 个文件（+4206/-1339 行）

## 更改分类

### A. 核心功能增强（Core Enhancements）

#### 1. DeepSeek Harness Runtime 优化
**文件**:
- `desktop/electron/services/deepseekHarnessRuntime.ts` (+78/-107 行)
- `desktop/electron/services/deepseekHarnessRuntime.test.ts` (+105 行)
- `desktop/electron/main.ts` (+5 行)
- `desktop/electron/services/quitLifecycle.test.ts` (+2 行)
- `desktop/scripts/bundle-deepseek-harness.ts` (+60 行，新增)

**改进内容**:
1. ✅ **版本升级到 0.1.5-rc.2**
2. ✅ **支持 Bundled Runtime 回退机制**
   - 优先使用用户安装的版本（`userData/deepseek-harness/runtime/`）
   - 回退到应用打包的版本（`resources/deepseek-harness/`）
   - 避免用户首次使用时需要等待 npm 安装
3. ✅ **改进测试覆盖**
   - 新增 bundled/user-installed 版本选择测试
   - 新增 fallback 逻辑测试
   - 修复 quit lifecycle 中的 `deepSeekHarnessWindow` 缺失问题
4. ✅ **移除未使用的依赖注入**
   - 简化测试代码，直接使用真实文件系统操作

**验证**:
```bash
bun test desktop/electron/services/deepseekHarnessRuntime.test.ts
bun test desktop/electron/services/quitLifecycle.test.ts
```

---

#### 2. EchoFlow API 官方集成增强
**文件**:
- `desktop/src/api/echoflow.ts` (+9 行)
- `desktop/src/components/settings/EchoFlowAPIOfficialLogin.tsx` (+99 行)
- `src/server/api/echoflow.ts` (+34 行)
- `src/server/services/echoflowApiService.ts` (+56 行)

**改进内容**:
1. ✅ **改进登录流程**
   - 更好的错误处理和用户提示
   - 优化 UX（加载状态、错误展示）
2. ✅ **增强服务层**
   - 更完善的 API 错误处理
   - 改进 token 管理
3. ✅ **类型安全改进**
   - 更严格的类型定义
   - 减少隐式 any

**验证**:
```bash
# 手动测试登录流程
cd desktop && bun run dev
# 导航到 Settings > Providers > EchoFlow API > Login
```

---

#### 3. Provider Presets 配置优化
**文件**:
- `src/server/config/providerPresets.json` (+8 行)

**改进内容**:
1. ✅ **echoflowai provider 配置优化**
   - 更准确的模型能力定义
   - 改进默认环境变量
2. ✅ **移除/清理推广内容**
   - 符合 AGENTS.md 第 31 条契约

**验证**:
```bash
bun test src/server/__tests__/provider-presets.test.ts
jq '.[] | select(.id=="echoflowai")' src/server/config/providerPresets.json
```

---

### B. 品牌与文档更新（Branding & Docs）

#### 4. 品牌一致性修正
**文件**:
- `AGENTS.md` (+4/-4 行)
- `desktop/src/i18n/locales/en.ts` (+4/-4 行)
- `desktop/src/i18n/locales/zh.ts` (+4/-4 行)
- `desktop/src/pages/settings/AboutSettings.tsx` (+4/-4 行)
- `desktop/src/pages/settings/ProviderSettings.tsx` (+4/-4 行)
- `release-notes/v0.4.6.md` (+4/-4 行)
- `release-notes/v0.5.3.md` (+4/-4 行)
- `src/server/__tests__/*.test.ts` (多个文件)

**改进内容**:
- 确保所有文档和代码中的品牌引用一致
- 替换上游品牌残留为 EchoFlow
- 保持 fork 身份清晰

---

#### 5. 官方网站配置
**文件**:
- `docs/public/CNAME` (+1 行，新增)
- `docs/public/llms.txt` (+7 行)
- `docs/start/models.md` (+2 行)

**改进内容**:
- 配置自定义域名 CNAME
- 更新 LLM 模型文档
- 完善模型列表

---

#### 6. 文档清理
**文件**:
- `docs/superpowers/plans/2026-05-09-h5-access.md` (-830 行，删除)
- `docs/superpowers/specs/2026-05-09-h5-access-design.md` (-194 行，删除)
- `docs/superpowers/specs/2026-05-13-desktop-open-project-targets-design.md` (-202 行，删除)

**改进内容**:
- 移除过期的设计文档
- 清理未实现的功能规划
- 减少文档冗余

---

### C. 上游合并准备（Upstream Sync Prep）

#### 7. 上游合并文档
**文件**:
- `UPSTREAM_DIFF_ANALYSIS.md` (+662 行，新增)
- `docs/upstream-sync/merge-v0.6.4-plan.md` (+933 行，新增)
- `docs/upstream-sync/phase1-execution-report.md` (+713 行，新增)
- `docs/upstream-sync/phase2-cherry-pick-plan.md` (+639 行，新增)
- `docs/upstream-sync/phase3-manual-merge-plan.md` (+851 行，新增)

**内容**:
- 完整的上游 v0.6.4 合并计划
- 详细的差异分析
- 冲突解决矩阵
- 分阶段执行计划
- Cherry-pick 策略

---

### D. 构建配置优化

#### 8. 依赖与构建配置
**文件**:
- `desktop/package.json` (+10 行)
- `.gitignore` (+3 行)

**改进内容**:
- 更新依赖版本
- 优化构建脚本
- 忽略构建产物

---

## 提交方案

### 方案 A：单个综合提交（推荐）✅

**优点**:
- 所有相关更改在一个原子提交中
- 便于回滚（如果需要）
- 清晰的提交边界，便于上游合并

**缺点**:
- 提交较大（+4206/-1339）
- 包含多个主题

**提交命令**:
```bash
git commit -m "feat: enhance DeepSeek Harness, EchoFlow API, and prepare upstream merge

Core Enhancements:
- DeepSeek Harness: upgrade to v0.1.5-rc.2 with bundled runtime fallback
- EchoFlow API: improve official login flow and service error handling
- Provider Presets: optimize echoflowai configuration

Infrastructure:
- Add bundle-deepseek-harness.ts build script
- Improve test coverage for deepseekHarnessRuntime and quitLifecycle
- Fix missing deepSeekHarnessWindow/Runtime in quit lifecycle tests

Documentation:
- Add comprehensive upstream v0.6.4 merge documentation
- Clean up obsolete superpowers specs and plans (-1226 lines)
- Update CNAME, llms.txt, and model documentation

Branding:
- Ensure consistent EchoFlow branding across codebase
- Update i18n, settings pages, and release notes

This commit prepares a clean working tree for upstream v0.6.4 selective merge.
Follows AGENTS.md contract: preserve EchoFlow identity, remove promotions,
maintain technical compatibility with upstream."
```

---

### 方案 B：分主题提交

**优点**:
- 每个提交主题明确
- 便于代码审查
- 更精细的 git 历史

**缺点**:
- 需要多次提交和推送
- 可能在中间状态引入临时不一致

**提交顺序**:
```bash
# 1. DeepSeek Harness 优化
git add desktop/electron/services/deepseekHarnessRuntime.* \
        desktop/electron/main.ts \
        desktop/electron/services/quitLifecycle.test.ts \
        desktop/scripts/bundle-deepseek-harness.ts \
        desktop/package.json
git commit -m "feat(desktop): enhance DeepSeek Harness with bundled runtime fallback

- Upgrade to @deepseek-ai/dsh@0.1.5-rc.2
- Add bundled runtime fallback mechanism
- Improve test coverage and fix quit lifecycle
- Add bundle-deepseek-harness.ts build script"

# 2. EchoFlow API 增强
git add desktop/src/api/echoflow.ts \
        desktop/src/components/settings/EchoFlowAPIOfficialLogin.tsx \
        src/server/api/echoflow.ts \
        src/server/services/echoflowApiService.ts \
        src/server/config/providerPresets.json
git commit -m "feat(api): enhance EchoFlow API integration

- Improve official login flow with better error handling
- Enhance service layer with improved token management
- Optimize echoflowai provider preset configuration"

# 3. 品牌与文档
git add AGENTS.md \
        desktop/src/i18n/ \
        desktop/src/pages/settings/ \
        release-notes/ \
        src/server/__tests__/ \
        src/utils/__tests__/ \
        docs/public/ \
        docs/start/
git commit -m "docs: update branding and documentation

- Ensure consistent EchoFlow branding
- Update CNAME and llms.txt
- Refine model documentation"

# 4. 清理过期文档
git add docs/superpowers/
git commit -m "docs: remove obsolete superpowers specs

- Remove h5-access plan and design (-1024 lines)
- Remove desktop-open-project-targets spec (-202 lines)
- Clean up unrealized feature documentation"

# 5. 上游合并准备
git add UPSTREAM_DIFF_ANALYSIS.md \
        docs/upstream-sync/ \
        .gitignore
git commit -m "docs: add upstream v0.6.4 merge documentation

- Add comprehensive diff analysis
- Document 3-phase merge strategy
- Prepare conflict resolution matrices
- Add cherry-pick and manual merge plans"
```

---

## 最终推荐：方案 A（单个综合提交）

### 理由

1. **符合当前项目阶段**
   - 这是准备上游合并前的最后一次"清理工作区"
   - 所有更改都服务于同一个目标：准备 v0.6.4 合并

2. **遵循 AGENTS.md 规则**
   - ✅ "Check git status before editing" - 我们在合并前清理
   - ✅ "Keep diffs small and owned" - 虽然大，但边界清晰
   - ✅ "Preserve EchoFlow identity" - 所有品牌更改都一致

3. **便于后续操作**
   - 上游合并应该从一个"干净且明确的提交点"开始
   - 如果合并后出问题，可以 `git revert` 整个提交
   - 便于在 `pre-merge-v0.6.4-snapshot` 标签和这个提交之间 diff

4. **实际风险低**
   - 所有更改已通过独立测试
   - 主要是增强现有功能，不是重写
   - 文档删除不影响运行时

---

## 执行步骤

### 1. 最终验证（5分钟）
```bash
cd "c:\Users\17259\Documents\New project"

# 类型检查
bun run typecheck

# 关键测试
bun test desktop/electron/services/deepseekHarnessRuntime.test.ts
bun test desktop/electron/services/quitLifecycle.test.ts
bun test src/server/__tests__/provider-presets.test.ts

# 检查暂存状态
git diff --staged --stat
```

### 2. 提交（2分钟）
```bash
git commit -m "feat: enhance DeepSeek Harness, EchoFlow API, and prepare upstream merge

Core Enhancements:
- DeepSeek Harness: upgrade to v0.1.5-rc.2 with bundled runtime fallback
- EchoFlow API: improve official login flow and service error handling
- Provider Presets: optimize echoflowai configuration

Infrastructure:
- Add bundle-deepseek-harness.ts build script
- Improve test coverage for deepseekHarnessRuntime and quitLifecycle
- Fix missing deepSeekHarnessWindow/Runtime in quit lifecycle tests

Documentation:
- Add comprehensive upstream v0.6.4 merge documentation
- Clean up obsolete superpowers specs and plans (-1226 lines)
- Update CNAME, llms.txt, and model documentation

Branding:
- Ensure consistent EchoFlow branding across codebase
- Update i18n, settings pages, and release notes

This commit prepares a clean working tree for upstream v0.6.4 selective merge.
Follows AGENTS.md contract: preserve EchoFlow identity, remove promotions,
maintain technical compatibility with upstream."
```

### 3. 推送（可选，1分钟）
```bash
git push origin main
```

### 4. 确认工作区干净（1分钟）
```bash
git status
# 预期输出: "working tree clean"

git log --oneline -1
# 预期看到新提交
```

---

## 提交后的状态

✅ **工作区**: 干净  
✅ **分支**: `main`  
✅ **提交**: 已保存所有 EchoFlow 改进  
✅ **准备度**: 可以开始 Phase 1 上游合并准备

---

## 下一步行动

参考 [phase1-execution-report.md](./phase1-execution-report.md) 的 **Phase 1 修正后的执行计划**:

### Phase 1: 准备与分析
- ✅ Step 1.0: 清理工作区（本次提交完成）
- ⏳ Step 1.1: 环境准备
- ⏳ Step 1.2: 生成差异统计
- ⏳ Step 1.3: 创建冲突解决矩阵
- ⏳ Step 1.4: 上游提交详细分析

### Phase 2: Cherry-pick 技术修复
- 6 个纯技术提交的选择性合并

### Phase 3: 手动合并品牌冲突
- README、LICENSE、package.json 等

---

**预计总时长**: 
- Phase 1: 2 小时
- Phase 2: 2 小时
- Phase 3: 3 小时
- 验证与测试: 2 小时
- **总计**: 9 小时
