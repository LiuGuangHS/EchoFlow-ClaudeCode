# Desktop office connectors

本目录提供连接器目录、安装与授权适配；复用既有插件与 MCP 生命周期，不引入独立执行协议。

- 实现入口：`catalog.ts`、`managedRuntime.ts`、`pluginBridge.ts`、`remoteAdapter.ts`、`skillAdapter.ts`。
- [实现、来源与验收边界](../../../docs/_internal/connectors-evidence.md#connector-implementation)：原 README 的固定包证据、账号语义、安装记录及未验证平台。
- [供应商与技能包研究](research.md)：远程接入建议、固定 commit、许可和未联调限制。
- [技能包锁文件](skillBundles.lock.json)、[品牌资源来源](../../../desktop/public/connectors/SOURCES.md)。

目录、安装、协议发现与业务成功不是同一状态；历史日期和数字已保留在集中正文中，不表示本次重新联调。
