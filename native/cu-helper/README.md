# Native Computer Use helper

本目录包含 macOS Swift helper、构建入口 [build.sh](build.sh) 和 `Tests/`。

- [现行协议与验证边界](../../docs/internals/computer-use-contracts.md)：当前源码阅读入口，不是已通过的验收清单。
- [兼容证据与验证边界](../../docs/_internal/cu-helper-evidence.md#native-compatibility)：原 README 的官方构建日期、版本、哈希、事件契约、fixture 记录和未复现问题。
- [历史集成方案入口](INTEGRATION.md)：保留旧引用；其中未实施提案和手工清单不是现行规范或通过证据。

当前授权与执行边界遵循[根规范](../../AGENTS.md#实现规则)，不从历史材料恢复应用分类限制或不确定副作用的自动重放。
