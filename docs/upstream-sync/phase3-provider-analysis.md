# Phase 3: Provider Presets 合并分析

## 📊 差异总览

### 上游新增的 7 个 Providers

| ID | 名称 | featured | deprecated | apiKeyUrl | 决策 |
|---|---|---|---|---|---|
| `jiekouai` | 接口AI | ❌ | ✅ | N/A | ❌ **拒绝** |
| `shengsuanyun` | 胜算云 | ❌ | ✅ | N/A | ❌ **拒绝** |
| `xuanshuapi` | 玄枢API | ❌ | ✅ | N/A | ❌ **拒绝** |
| `fennoai` | FennoAI | ❌ | ✅ | N/A | ❌ **拒绝** |
| `qiniuai` | 七牛云 AI | ❌ | ✅ | N/A | ❌ **拒绝** |
| `atlascloud` | Atlas Cloud | ✅ | ❌ | 带 UTM 追踪 | ❌ **拒绝** |
| `apismart` | ApiSmart | ✅ | ❌ | 无追踪 | ❌ **拒绝** |

**拒绝理由**：
- 前 5 个已被上游标记为 `deprecated: true`
- `atlascloud` 的 `apiKeyUrl` 包含 UTM 追踪参数 `utm_campaign=cc-haha`
- `apismart` 是 featured 赞助商，违反我们的 Provider Policy

---

### 上游删除的 Provider

| ID | 名称 | 决策 |
|---|---|---|
| `echoflowai` | EchoFlow API | ✅ **必须恢复** |

**恢复理由**：这是我们的核心 Provider，符合 AGENTS.md 第 31 条 Fork Policy

---

### 共有 Providers 的关键差异

#### 1. **DeepSeek** - 技术优化配置差异

**我们的配置**（更优）：
```json
"defaultEnv": {
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "thinking,effort,adaptive_thinking,max_effort",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "thinking,effort,adaptive_thinking,max_effort",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "thinking,effort,adaptive_thinking,max_effort"
}
```

**上游配置**：
```json
"defaultEnv": {}
```

**决策**: ✅ **保留我们的技术优化**

---

#### 2. **Zhipu GLM** - 推广内容差异

**上游新增**：
```json
"apiKeyUrl": "https://www.bigmodel.cn/invite?icode=d41B2qi8Z5xNwTGLNPPF3OZLO2QH3C0EBTSr%2BArzMw4%3D",
"promoText": "智谱 GLM 为 cc-haha 用户准备了专属邀请福利，使用此链接注册后可领取新用户权益。"
```

**我们的配置**：
```json
"defaultEnv": {
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000"
}
// 无 apiKeyUrl（使用默认）
// 无 promoText
```

**决策**: ✅ **保留我们的中立配置 + 技术优化**

---

#### 3. **Kimi** - 技术配置差异

**我们的配置**（更优）：
```json
"defaultEnv": {
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "thinking,required_thinking,effort,max_effort",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "thinking,required_thinking,effort,max_effort",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "thinking,required_thinking,effort,max_effort"
}
```

**上游配置**：
```json
"defaultEnv": {}
```

**决策**: ✅ **保留我们的技术优化**

---

#### 4. **MiniMax** - 推广链接差异

**上游新增**：
```json
"apiKeyUrl": "https://platform.minimaxi.com/subscribe/token-plan?code=1TG2Cseab2&source=link"
```

**我们的配置**：
```json
"defaultEnv": {
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "thinking,adaptive_thinking"
}
// 无 apiKeyUrl（使用默认）
```

**决策**: ✅ **保留我们的中立配置 + 技术优化**

---

## 🎯 合并策略

### 最终 Provider 列表

保持我们当前的 9 个 Providers，**不添加上游的任何新 Provider**：

1. ✅ `official` - Claude Official
2. ✅ `echoflowai` - EchoFlow API（我们独有）
3. ✅ `deepseek` - DeepSeek（保留我们的 defaultEnv）
4. ✅ `zhipuglm` - Zhipu GLM（保留我们的 defaultEnv，拒绝推广）
5. ✅ `kimi` - Kimi（保留我们的 defaultEnv）
6. ✅ `minimax` - MiniMax（保留我们的 defaultEnv，拒绝推广链接）
7. ✅ `lmstudio` - LM Studio
8. ✅ `ollama` - Ollama
9. ✅ `custom` - Custom

### 合并原则

- ✅ **保留所有技术优化** (`defaultEnv` 配置)
- ❌ **拒绝所有推广内容** (带推广码的 `apiKeyUrl`, 推广性 `promoText`)
- ❌ **拒绝所有新增的第三方中继/赞助商**
- ❌ **拒绝已废弃的 Providers** (`deprecated: true`)
- ✅ **保留 `echoflowai`**

---

## 📝 执行结论

**当前 providerPresets.json 无需修改**！

理由：
1. 我们的版本已经包含了所有官方厂商（Anthropic、DeepSeek、Zhipu、Kimi、MiniMax）
2. 我们的技术优化配置（`defaultEnv`）优于上游的空配置
3. 上游新增的 7 个 providers 全部违反我们的 Provider Policy
4. 我们的 `echoflowai` 必须保留

**Phase 3.1 结论**: ✅ **providerPresets.json 保持不变**
