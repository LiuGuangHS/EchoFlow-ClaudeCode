# 后续任务路线图 - EchoFlow v0.6.4 上游合并

## 概览

本文档规划了提交当前工作后的完整任务路线图，涵盖上游合并、功能增强和发布准备。

---

## 阶段 1: 上游 v0.6.4 选择性合并（优先级：⭐⭐⭐⭐⭐）

**目标**: 吸收上游 8 个 bug 修复和功能改进，同时保持 EchoFlow 品牌和 policy 完整性

**预计时长**: 9 小时（分 3 个工作日）

---

### Phase 1: 准备与分析（2小时）

**执行文档**: [phase1-execution-report.md](./phase1-execution-report.md)

#### Step 1.1: 环境准备（15分钟）
- [ ] 配置 upstream remote
- [ ] 更新所有远程分支
- [ ] 创建合并分支 `merge/upstream-v0.6.4-selective`
- [ ] 创建快照标签 `pre-merge-v0.6.4-snapshot`

**命令**:
```bash
cd "c:\Users\17259\Documents\New project"
git remote add upstream https://github.com/NanmiCoder/cc-haha.git
git fetch origin --prune
git fetch upstream +refs/heads/*:refs/remotes/upstream/* --prune
git checkout -b merge/upstream-v0.6.4-selective
git tag pre-merge-v0.6.4-snapshot main
```

#### Step 1.2: 生成差异统计（15分钟）
- [ ] 生成文件差异清单（预计 ~972 个文件）
- [ ] 识别高冲突文件（预计 ~8 个）
- [ ] 统计提交清单（上游 8 个，我们 30+ 个）

**命令**:
```bash
mkdir -p /tmp/upstream-merge-v0.6.4
git diff main upstream/main --stat > /tmp/upstream-merge-v0.6.4/diff-stat.txt
git diff main upstream/main --name-status > /tmp/upstream-merge-v0.6.4/diff-files.txt
git log upstream/main ^main --oneline --no-merges > /tmp/upstream-merge-v0.6.4/upstream-commits.txt
```

#### Step 1.3: 创建冲突解决矩阵（30分钟）
- [ ] 定义 8 个高冲突文件的策略
- [ ] 制定 Provider Presets 详细合并规则
- [ ] 准备验证检查清单

**输出**: `/tmp/upstream-merge-v0.6.4/conflict-matrix.md`

#### Step 1.4: 上游提交详细分析（60分钟）
- [ ] 逐个分析 8 个上游提交
- [ ] 评估品牌冲突等级
- [ ] 确定 Cherry-pick 优先级

**输出**: `/tmp/upstream-merge-v0.6.4/commit-analysis.md`

---

### Phase 2: Cherry-pick 技术修复（2小时）

**执行文档**: [phase2-cherry-pick-plan.md](./phase2-cherry-pick-plan.md)

#### 目标提交（按优先级）

1. ⭐⭐⭐ **9f47bbcd** - Agent Teams 继承 model（15分钟）
   ```bash
   git cherry-pick 9f47bbcd
   bun test src/utils/swarm/teammateModel.test.ts
   ```

2. ⭐⭐⭐ **35736f3f** - 队友权限路由（20分钟）
   ```bash
   git cherry-pick 35736f3f
   bun test src/utils/swarm/printLeaderPermissionBridge.test.ts
   ```

3. ⭐⭐⭐ **a4bb7c52** - 会话列表性能优化（20分钟）
   ```bash
   git cherry-pick a4bb7c52
   # 手动测试启动性能
   ```

4. ⭐⭐ **0676c194** - 窗口拖拽恢复（15分钟）
   ```bash
   git cherry-pick 0676c194
   # 手动测试拖拽功能
   ```

5. ⭐⭐ **88ea66f8** - 测试连接按钮 UI 修复（15分钟）
   ```bash
   git cherry-pick 88ea66f8
   # 手动测试长错误消息
   ```

6. ⭐ **8a9e3800** - 上下文指示器优化（15分钟）
   ```bash
   git cherry-pick 8a9e3800
   bun test desktop/src/components/ContextUsageIndicator.test.tsx
   ```

**跳过的提交**:
- ❌ **f2bfaab5** - README 英文优先（品牌冲突严重）
- ❌ **02d7228b** - v0.6.4 release（手动参考版本号即可）

#### 冲突处理策略

**预期冲突点**:
- `src/utils/swarm/teammateModel.ts` - 如果我们修改过 Agent Teams
- `desktop/src/components/settings/ProviderSettings.tsx` - 如果我们修改过 Provider 设置

**解决原则**:
1. 技术修复优先：接受上游的 bug 修复
2. 品牌保留：保留我们的 EchoFlow 品牌引用
3. 手动合并：当冲突涉及业务逻辑时，理解双方意图后合并

---

### Phase 3: 手动合并品牌冲突（3小时）

**执行文档**: [phase3-manual-merge-plan.md](./phase3-manual-merge-plan.md)

#### 高冲突文件处理

##### 3.1 LICENSE（10分钟）
```bash
git show upstream/main:LICENSE > /tmp/upstream-LICENSE
git show main:LICENSE > /tmp/our-LICENSE
# 决策: 完全使用 --ours
cp /tmp/our-LICENSE LICENSE
git add LICENSE
```

##### 3.2 README.md / README.zh-CN.md（30分钟）
```bash
# 决策: 使用 --ours，选择性吸取技术段落
git checkout --ours README.md README.zh-CN.md
# 手动检查上游是否有值得吸取的技术描述
git diff upstream/main -- README.md | grep -A10 "## Features"
```

##### 3.3 package.json（30分钟）
```bash
# 品牌: --ours
# 依赖/版本: 手动合并
jq -s '.[0] * {
  name: .[1].name,
  version: .[1].version,
  author: .[1].author,
  bin: .[1].bin,
  homepage: .[1].homepage,
  repository: .[1].repository
}' <(git show upstream/main:package.json) <(git show main:package.json) > package.json.merged

# 审查后应用
mv package.json.merged package.json
git add package.json
```

##### 3.4 desktop/package.json（30分钟）
```bash
# build.appId, build.productName: --ours
# version, dependencies: 手动评估
# 类似 package.json 的合并策略
```

##### 3.5 src/server/config/providerPresets.json（60分钟）⚠️ **最复杂**

**策略**:
1. ✅ 保留 `echoflowai` provider（完整配置）
2. ✅ 保留所有 provider 的 `defaultEnv` 优化
3. ❌ 删除推广 providers: `jiekouai`, `fennoai`, `qiniuai`, `atlascloud`, `apismart`
4. ❌ 删除所有 `apiKeyUrl` 中的邀请码/UTM 参数
5. ❌ 删除所有 `promoText` 字段
6. ✅ 吸取官方 provider 的技术更新（`modelContextWindows`, `defaultModels`）

**执行**:
```bash
# 使用 jq 进行精细合并
jq '
  # 从上游获取所有官方 providers（排除推广）
  [.[] | select(.id | test("jiekouai|fennoai|qiniuai|apismart") | not)] as $upstream |
  
  # 从我们的版本获取 echoflowai 和 defaultEnv
  [.[] | select(.id == "echoflowai" or .defaultEnv != null)] as $ours |
  
  # 合并逻辑...
' <(git show upstream/main:src/server/config/providerPresets.json) \
  <(git show main:src/server/config/providerPresets.json) \
  > providerPresets.merged.json

# 验证
jq '.[] | select(.id=="echoflowai")' providerPresets.merged.json
! jq '.[] | select(.id | test("jiekouai|fennoai"))' providerPresets.merged.json
bun test src/server/__tests__/provider-presets.test.ts
```

##### 3.6 AGENTS.md / CLAUDE.md（20分钟）
```bash
# 决策: 完全使用 --ours（我们的契约更详细）
git checkout --ours AGENTS.md CLAUDE.md
git add AGENTS.md CLAUDE.md
```

#### 最终验证（30分钟）
```bash
# 品牌一致性
git diff main..HEAD | grep -E "cc-haha|claude-haha|NanmiCoder" || echo "✅ 无品牌泄漏"
grep -q "EchoFlow Code" README.md && echo "✅ README 正确"

# Provider 策略
jq '.[] | select(.id=="echoflowai")' src/server/config/providerPresets.json && echo "✅ echoflowai 存在"
! jq '.[] | select(.id | test("jiekouai|fennoai"))' src/server/config/providerPresets.json && echo "✅ 无推广"

# 完整验证
bun run verify
```

---

### Phase 4: 合并提交与推送（30分钟）

```bash
# 创建合并提交
git add -A
git commit -m "merge: selective merge from upstream v0.6.4

Cherry-picked commits:
- 9f47bbcd: Agent Teams inherit lead model
- 35736f3f: Route teammate permission prompts to lead
- a4bb7c52: Optimize cold session list loading
- 0676c194: Restore window dragging on headers
- 88ea66f8: Fix test-connection button collapse
- 8a9e3800: Improve context usage indicator

Manual merges:
- providerPresets.json: absorbed technical updates, removed promotions
- package.json: preserved EchoFlow branding, updated dependencies
- README/LICENSE/AGENTS: preserved EchoFlow identity

Skipped commits:
- f2bfaab5: README language priority (brand conflict)
- 02d7228b: v0.6.4 release tag (referenced, not merged)

Verification:
- All tests passing
- No brand leakage (cc-haha, NanmiCoder)
- EchoFlow identity intact
- Provider policy compliant (AGENTS.md §31)

Resolves upstream technical debt while maintaining fork integrity."

# 合并到 main
git checkout main
git merge --no-ff merge/upstream-v0.6.4-selective -m "Merge upstream v0.6.4 selective"

# 推送
git push origin main
git push origin merge/upstream-v0.6.4-selective
git push origin --tags
```

---

## 阶段 2: DeepSeek Harness Bundled Runtime 完善（优先级：⭐⭐⭐⭐）

**目标**: 完成 Bundled Runtime 机制的构建集成

**预计时长**: 4 小时

---

### Task 2.1: 实现 bundle-deepseek-harness.ts 构建脚本（2小时）

**文件**: `desktop/scripts/bundle-deepseek-harness.ts`（已创建框架）

**待实现功能**:
```typescript
// 1. 下载 @deepseek-ai/dsh@0.1.5-rc.2
await downloadPackage('@deepseek-ai/dsh', '0.1.5-rc.2', tempDir)

// 2. 提取必要文件（去除 node_modules, 保留 lib/）
await extractEssentials(tempDir, bundleDir)

// 3. 复制到 resources/ 目录
await copyToResources(bundleDir, resourcesPath)

// 4. 验证完整性
await validateBundle(resourcesPath)
```

**集成到构建流程**:
```json
// desktop/package.json
{
  "scripts": {
    "prebuild": "bun run bundle-deepseek-harness",
    "bundle-deepseek-harness": "bun run scripts/bundle-deepseek-harness.ts"
  }
}
```

### Task 2.2: 测试 Bundled Runtime 回退逻辑（1小时）

**测试场景**:
1. ✅ 用户未安装时，使用 bundled 版本启动
2. ✅ 用户安装后，优先使用用户版本
3. ✅ 用户版本损坏时，回退到 bundled 版本
4. ✅ 更新机制不影响 bundled 版本

**验证命令**:
```bash
# 清除用户安装
rm -rf "%APPDATA%/EchoFlow Code/deepseek-harness"

# 测试 bundled 启动
cd desktop && bun run dev
# 导航到 Settings > DeepSeek Harness > Start
# 预期：直接启动，无需等待 npm install

# 测试用户安装
# 点击 "Install/Update"
# 预期：安装到用户目录，后续启动使用用户版本
```

### Task 2.3: 更新文档（1小时）

**文件**:
- `docs/features/deepseek-harness.md`（新增）
- `README.md`（添加 DeepSeek Harness 说明）
- `desktop/src/pages/DeepSeekHarness.tsx`（完善 UI 提示）

**内容**:
- Bundled runtime 机制说明
- 用户安装 vs. Bundled 版本的区别
- 更新流程说明
- 故障排除指南

---

## 阶段 3: EchoFlow API 集成完善（优先级：⭐⭐⭐）

**目标**: 完善 EchoFlow API 官方服务的集成体验

**预计时长**: 6 小时

---

### Task 3.1: 完善登录流程（2小时）

**改进点**:
1. 添加 OAuth 回调处理
2. 改进 token 刷新机制
3. 添加登出功能
4. 优化错误提示（网络错误 vs. 认证错误）

**文件**:
- `desktop/src/components/settings/EchoFlowAPIOfficialLogin.tsx`
- `src/server/services/echoflowApiService.ts`

### Task 3.2: 添加账户信息展示（2小时）

**功能**:
- 显示当前登录用户
- 显示配额使用情况
- 显示订阅状态
- 添加"管理账户"链接

**UI 设计**:
```typescript
// desktop/src/pages/settings/ProviderSettings.tsx
<EchoFlowAccountInfo>
  <Avatar />
  <UserInfo>
    <Name>user@example.com</Name>
    <Plan>Pro Plan</Plan>
  </UserInfo>
  <QuotaBar used={75} total={100} />
  <ManageButton />
</EchoFlowAccountInfo>
```

### Task 3.3: E2E 测试（2小时）

**测试场景**:
1. 新用户首次登录
2. Token 过期自动刷新
3. 网络错误处理
4. 登出后状态清理

**工具**: Playwright + agent-browser

---

## 阶段 4: 文档与发布准备（优先级：⭐⭐⭐）

**目标**: 完善文档，准备发布 v0.5.4-echoflow

**预计时长**: 4 小时

---

### Task 4.1: 更新 Release Notes（1小时）

**文件**: `release-notes/v0.5.4.md`

**内容**:
```markdown
# EchoFlow Code v0.5.4

## 🎉 新特性

### DeepSeek Harness Bundled Runtime
- 首次启动无需等待 npm 安装
- 自动回退到打包版本
- 改进更新机制

### 上游 v0.6.4 技术修复
- Agent Teams 继承主模型（不再硬编码 Opus）
- 队友权限正确路由到主会话
- 会话列表冷启动性能优化
- 窗口拖拽功能恢复
- UI 细节改进

### EchoFlow API 增强
- 改进官方登录流程
- 更好的错误处理
- 优化服务层

## 🐛 Bug 修复
- 修复 quit lifecycle 中缺失的 DeepSeek Harness 引用
- 修复测试中的类型错误

## 📚 文档
- 添加上游合并文档
- 清理过期设计文档
- 更新品牌引用

## 🔧 技术债务
- 移除未使用的依赖注入
- 改进测试覆盖率
```

### Task 4.2: 更新用户文档（2小时）

**文件**:
- `docs/start/installation.md` - 添加 DeepSeek Harness 说明
- `docs/features/providers.md` - 更新 EchoFlow API 说明
- `docs/contributing/upstream-sync.md` - 记录上游合并流程

### Task 4.3: 更新 CHANGELOG（1小时）

**文件**: `CHANGELOG.md`

**格式**: 遵循 [Keep a Changelog](https://keepachangelog.com/)

---

## 阶段 5: 性能优化与监控（优先级：⭐⭐）

**目标**: 改进应用性能和用户体验

**预计时长**: 8 小时（可延后）

---

### Task 5.1: 桌面应用启动性能（3小时）

**问题**:
- 冷启动扫描所有 JSONL（已被上游修复，验证）
- Electron 窗口创建延迟

**优化**:
1. 验证上游的 session loader 优化是否生效
2. 添加启动性能指标
3. 优化首屏渲染

### Task 5.2: 内存使用优化（3小时）

**分析工具**:
- Chrome DevTools Memory Profiler
- Electron 内存监控

**重点**:
- 检查 MCP 服务器内存泄漏
- 优化大型会话的内存占用
- 添加内存使用警告

### Task 5.3: 添加性能监控（2小时）

**指标**:
- 启动时间
- 首次渲染时间
- API 响应时间
- 内存使用峰值

**工具**: 集成到 diagnostics export

---

## 阶段 6: 功能增强（优先级：⭐）

**目标**: 添加社区需求的功能

**预计时长**: TBD（根据反馈调整）

---

### Task 6.1: 自定义 Provider 模板

**功能**: 允许用户从模板快速添加自定义 Provider

**预计时长**: 4 小时

### Task 6.2: 会话导入/导出

**功能**: 支持会话的批量导入导出

**预计时长**: 6 小时

### Task 6.3: 多语言支持完善

**功能**: 完善 i18n 覆盖率（目前 ~80%）

**预计时长**: 4 小时

---

## 优先级矩阵

| 阶段 | 优先级 | 预计时长 | 建议开始时间 | 阻塞因素 |
|------|--------|----------|-------------|---------|
| 1. 上游合并 | ⭐⭐⭐⭐⭐ | 9h | 立即 | 无 |
| 2. Bundled Runtime | ⭐⭐⭐⭐ | 4h | 上游合并后 | 阶段 1 |
| 3. EchoFlow API | ⭐⭐⭐ | 6h | 并行 | 无 |
| 4. 文档与发布 | ⭐⭐⭐ | 4h | 阶段 1+2 完成后 | 阶段 1, 2 |
| 5. 性能优化 | ⭐⭐ | 8h | 发布后 | 阶段 4 |
| 6. 功能增强 | ⭐ | TBD | 根据反馈 | 无 |

---

## 里程碑

### M1: 上游合并完成（Week 1）
- ✅ 所有技术修复已集成
- ✅ 品牌完整性验证通过
- ✅ 完整测试套件通过

### M2: Bundled Runtime 集成（Week 1）
- ✅ 构建脚本完成
- ✅ 回退逻辑测试通过
- ✅ 文档更新

### M3: v0.5.4 发布准备（Week 2）
- ✅ Release notes 完成
- ✅ 用户文档更新
- ✅ CHANGELOG 更新
- ✅ 最终验证通过

### M4: v0.5.4 发布（Week 2）
- ✅ GitHub Release 创建
- ✅ 桌面应用打包
- ✅ 发布公告

---

## 风险与缓解

### 风险 1: 上游合并冲突超出预期

**概率**: 中  
**影响**: 高  
**缓解**:
- 已有详细的冲突矩阵
- 每个 cherry-pick 后立即验证
- 保留快照标签便于回滚

### 风险 2: Bundled Runtime 打包体积过大

**概率**: 低  
**影响**: 中  
**缓解**:
- 只打包必要文件（lib/，去除 node_modules）
- 压缩资源
- 监控最终 app 大小

### 风险 3: EchoFlow API 集成复杂度高

**概率**: 中  
**影响**: 低  
**缓解**:
- 可以延后到 v0.5.5
- 当前版本已基本可用
- 增量改进

---

## 总预计时长

- **核心工作**（阶段 1-4）: 23 小时 ≈ 3 个工作日
- **优化工作**（阶段 5）: 8 小时 ≈ 1 个工作日
- **功能增强**（阶段 6）: TBD

**建议工作节奏**:
- Week 1 Day 1-2: 完成阶段 1（上游合并）
- Week 1 Day 3: 完成阶段 2（Bundled Runtime）
- Week 2 Day 1: 完成阶段 3（EchoFlow API）+ 阶段 4（文档）
- Week 2 Day 2: 发布 v0.5.4
- Week 3+: 根据用户反馈，进行阶段 5-6

---

## 成功标准

### 技术标准
- [ ] 所有测试通过（`bun run verify`）
- [ ] 无品牌泄漏（无 cc-haha/NanmiCoder 引用）
- [ ] Provider policy 合规（AGENTS.md §31）
- [ ] 性能无回退（启动时间、内存使用）

### 用户体验标准
- [ ] DeepSeek Harness 首次启动 < 5 秒
- [ ] EchoFlow API 登录流程清晰
- [ ] 上游修复带来的体验改进可感知

### 文档标准
- [ ] 所有新功能有文档
- [ ] 上游合并流程有记录
- [ ] Release notes 清晰完整

---

## 后续考虑

### 长期维护
1. **定期上游同步**: 每个 upstream release 后 1 周内评估
2. **Provider policy 审查**: 每次合并后检查推广内容
3. **品牌一致性检查**: 自动化 CI 检查（grep -r "cc-haha|NanmiCoder"）

### 社区反馈
1. 收集用户对 Bundled Runtime 的反馈
2. 监控 EchoFlow API 使用情况
3. 根据反馈调整阶段 6 的优先级

---

**文档版本**: v1.0  
**创建时间**: 2026-09-18  
**最后更新**: 2026-09-18  
**维护者**: EchoFlow Development Team
