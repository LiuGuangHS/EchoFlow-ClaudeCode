# @echoflow/egress-guard

这是 EchoFlow 自有的 dsh bundle，不属于 dsh，也不包含 dsh 代码。它是 EchoFlow 差异化层的首个组件，因为仅靠配置的补丁文件无法阻止后续层重新启用条目。

## 提供的保证

配置的 `cordis.patch.yml` 禁用 `harness/egress-blocklist.json` 列出的所有插件和路由。它只是静态层。用户目录补丁（`$DSH_HOME/cordis.patch.yml`）、`--patch` 覆盖或未来重载器在其后应用，因此必须根据 Loader 实际运行的有效配置判断，不能只读配置自身的补丁文件。

守卫在三个时点检查：

| 时点 | 负责人 | 违规行为 |
| --- | --- | --- |
| `boot()` 前 | EchoFlow 启动器 | 拒绝启动 |
| `boot()` 完成后 | EchoFlow 启动器 | 拒绝提供服务 |
| `app-boot/config-reload` 后 | 本 bundle | 拒绝重载并以非零码退出 |

每次检查都读取结构化 Loader 状态：条目 ID、有效配置和 `Entry.disabled`（会计算 `!!js` 表达式并考虑被禁用的父分组）。这里不解析 YAML 文本，也不猜测条目边界。

规则：

- 每个阻止清单 ID 必须存在且有效禁用。缺失 ID 意味着上游改名逃过审计，属于违规，不算通过。
- `requiredPlugins` 中每个 ID 必须存在且保持启用，守卫不能被后续层关闭。
- 任何启用条目的配置都不能引用被阻止的主机或路由。

## 不提供的保证

这是对 EchoFlow 声明插件的策略检查，不是操作系统网络防火墙。自行打开 socket 的代码，例如独立脚本、自带遥测的依赖或浏览器，不在其控制范围内。它只是防护的一层，还需评审锁定依赖树及桌面自身的外发策略。

## 使用

它是普通 dsh bundle：随附 `cordis.patch.yml` 插入 `egress-guard` 条目，配置在 `dsh.profile.bundles` 中列出它。

纯规则集导出供测试和启动器使用：

```js
import { verifyEffectiveConfig, snapshotLoaderTree } from '@echoflow/egress-guard/verify'
```
