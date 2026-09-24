# 配置分发功能测试指南

## 功能概述

管理员可以生成配置链接，用户点击链接一键导入配置。

## 测试步骤

### 1. 生成配置链接（管理员侧）

1. 启动应用：`cd desktop && bun run dev`
2. 打开设置页面（⚙️图标）
3. 点击左侧 "配置生成器" 标签
4. 配置要分享的内容：
   - **Provider 配置**：点击 "添加 Provider"，选择或新建 Provider（注意：不会包含 API Key）
   - **应用设置**：选择主题、语言、权限模式等
   - **默认模型**：选择默认运行时和模型槽位
5. 点击 "生成链接" 按钮
6. 复制生成的链接（格式：`echoflowcode://config/import?v=1&data=...`）

### 2. 导入配置（用户侧）

**方式一：直接点击链接**
- 如果应用正在运行：会立即弹出导入对话框
- 如果应用未运行：系统会启动应用并弹出导入对话框

**方式二：手动测试（开发环境）**
```bash
# macOS
open "echoflowcode://config/import?v=1&data=..."

# Linux
xdg-open "echoflowcode://config/import?v=1&data=..."

# Windows
start "echoflowcode://config/import?v=1&data=..."
```

### 3. 确认导入

导入对话框会显示：
- 来源标识
- 创建时间
- 将要导入的配置项列表
- 需要用户手动配置的项（如 API Key）

点击 "导入" 后：
- Provider 配置会添加到服务商列表
- 应用设置会立即生效
- 默认模型会更新

## 测试场景

### 场景 1：分享单个 Provider
```
管理员操作：
- 添加 DeepSeek Provider（baseUrl, models）
- 生成链接

用户操作：
- 点击链接
- 确认导入
- 前往 Provider 设置添加 API Key
```

### 场景 2：完整配置分发
```
管理员操作：
- 添加多个 Provider
- 设置主题为 dark
- 设置语言为 zh
- 设置默认运行时为 deepseek
- 生成链接

用户操作：
- 点击链接
- 确认导入
- 验证所有设置已生效
```

### 场景 3：安全验证
```
测试目标：验证敏感信息不会泄露

1. 生成包含 Provider 的链接
2. 解码 base64 payload：
   ```javascript
   const url = 'echoflowcode://config/import?v=1&data=...'
   const data = new URL(url).searchParams.get('data')
   const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
   const json = pako.inflate(bytes, { to: 'string' })
   console.log(JSON.parse(json))
   ```
3. 确认 payload 中 **不包含** `apiKey` 字段
```

## 已知限制

1. **API Key 必须手动配置**：安全考虑，链接中不包含敏感信息
2. **链接有效期**：30 天后过期
3. **版本兼容**：仅支持当前版本的配置格式

## 协议注册验证

### macOS
```bash
# 检查协议是否注册
defaults read com.echoflow.code LSHandlerURLScheme
```

### Windows
```powershell
# 检查注册表
reg query HKEY_CLASSES_ROOT\echoflowcode
```

### Linux
```bash
# 检查 .desktop 文件
cat ~/.local/share/applications/echoflow-code.desktop | grep MimeType
```

## 故障排查

### 点击链接无反应
- 确认应用已安装
- 重新安装应用（重新注册协议）
- 查看控制台日志：`[DeepLink] Processing: ...`

### 导入失败
- 检查链接完整性（复制时可能截断）
- 查看错误提示：
  - `unsupported_version`：版本不兼容
  - `expired`：链接已过期
  - `contains_secrets`：包含敏感信息（不应出现）
  - `invalidLink`：格式错误

### 配置未生效
- 检查是否点击了 "导入" 按钮
- 前往对应设置页面验证
- 查看浏览器控制台日志

## 技术细节

### 链接格式
```
echoflowcode://config/import?v=1&data=<BASE64_PAYLOAD>
```

### Payload 结构
```typescript
{
  version: 1,
  source: string,        // 来源标识
  timestamp: number,     // 创建时间戳
  config: {
    providers?: Array<{
      name: string,
      baseUrl: string,
      // ... 不含 apiKey
    }>,
    settings?: {
      theme?: string,
      locale?: string,
      // ...
    },
    modelDefaults?: {
      runtime?: string,
      slots?: Record<string, string>
    }
  }
}
```

### 编码过程
```
JSON → pako.deflate (gzip 压缩) → base64 → URL 参数
```

## 下一步扩展

- [ ] 添加签名验证（防篡改）
- [ ] 支持配置模板市场
- [ ] 批量用户管理
- [ ] 配置版本历史
