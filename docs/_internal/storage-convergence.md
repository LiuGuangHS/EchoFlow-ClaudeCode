---
title: 产品数据单根归并
nav_title: 数据归并
description: 历史数据分布、唯一存储根目标，以及迁移完成的验证边界。
order: 0
---

# 产品数据单根归并

本记录区分历史分布、要求实现的行为与实际验证证据。目录存在、文件修改时间、进程存在都不能单独证明数据正在被谁写入，也不能作为直接删除目录的依据。

## 范围和完成条件

本次目标是把本机 **EchoFlow 自有持久数据** 合并到一个物理根，并让桌面、CLI、server、IM adapter 和子进程统一消费。不接受只改默认路径、双写、业务代码长期回读旧路径，或把源数据和迁移备份留在根外而宣称完成。

- 唯一根记为 `R`；产品内部目录为 `R/echoflow-code`。
- Windows 默认 `R = %LOCALAPPDATA%/EchoFlow Code`。
- macOS 默认 `R = ~/Library/Application Support/EchoFlow Code`。
- Linux 默认 `R = ${XDG_DATA_HOME:-~/.local/share}/echoflow-code`。
- 一个显式完整根覆盖默认值；不同启动控制不能各自选择互不一致的活动根。
- Electron profile、配置、业务数据、日志、缓存和原生运行时均应在 `R` 内；迁移 staging、备份、冲突材料和 journal 也在 `R` 内。
- 旧路径只在集中迁移层识别。验证完成后逐项清理本事务已确认且未发生变化的源文件，只移除空源目录。
- 存在未解决冲突、未知归属、未停止写入者、未完成验证或待清理源时，必须报告阻断或待处理，不能报告归并完成。

这里不包括工作区自有 `.claude`、其他软件自有配置、未证实归属的共享文件，或其他设备的应用沙箱。系统凭据库继续使用系统安全存储，不为了目录布局而降级成明文文件。

## 历史分布与风险

以下为修复前调查结论，不是当前版本应保留的路径契约。

| 历史来源 | 数据类别 | 归并要求 |
| --- | --- | --- |
| 配置根下的 `cc-haha/` | `db/`、`traces/`、`agent-teams/`、diagnostics、配置、OAuth、生成图片、语音及其他产品内部状态 | 作为旧命名空间输入；正常消费者统一使用 `R/echoflow-code` |
| 配置根下的 `echoflow-code/` | provider/settings、协作状态，以及部分旧布局的根级 SQLite 文件 | 必须与另一旧命名空间同时盘点，不只迁移 provider/settings 两个文件 |
| 旧配置根的顶层 | 会话和子会话、工具结果、projects/memory、history、file-history、plans、tasks、teams、workflows、uploads、附件缓存、插件和连接器 | 按所有权迁移；保留不认识的字段和已确认产品目录内的未知文件 |
| Electron 的 Local/Roaming 或其他旧 profile | 窗口/UI 偏好、Chromium profile、Cookies、IndexedDB、LevelDB 等 | 在 profile 打开前处理；不能按普通文件覆盖方式拼接两个活动数据库 |
| 旧便携根、显式 trace 等外置目录 | 同类产品数据或单一类别数据 | 集中处理迁移，不允许继续独立写入；无法确认归属时明确阻断 |
| 安装目录内的历史用户数据 | 被旧安装布局包含的数据 | 升级恢复必须保留；恢复材料最终仍需归入唯一根，而不是永久根外目录 |

最初的 Windows 目录清单约为：旧 `echoflow-code` 1.25 GiB、8 个文件；旧 `cc-haha` 2.31 GiB、49 个文件，其中 DB 约 1.54 GiB，trace 约 775 MiB。它们是用户提供的历史快照，不是本次实际扫描结果；本次没有读取或迁移这些真实数据，也没有确认其 Windows 句柄持有者。

## 必须保护的数据边界

1. **SQLite 与 WAL**：不能仅复制主文件，也不能把字符串 fixture 当作数据库一致性证据。需要真实 WAL 事务和一致性验证；派生索引与业务原始数据分别处理，不能因为称为“索引”就无记录丢弃源材料。
2. **已有目标与多来源**：目标非空仍要盘点所有来源；不同实体可以并入，同一实体内容不同不能凭修改时间覆盖，也不能拼接 JSONL 或 LevelDB 文件。
3. **未知字段与未来版本**：保留未知设置；未来 schema、损坏所有权标识、未知事务格式都要保留原件并阻断，不静默降级。
4. **路径与附件**：同时处理完整根变更和 `cc-haha → echoflow-code` 的内部路径变更；不修改历史 transcript 的原始字节。托管插件和连接器路径只在独立 staging 内更新。
5. **停写与身份**：停写范围包括 host、sidecar、CLI、adapter、数据库、设置队列、诊断、调度和 token 刷新。已注册 PID 清单不是不存在其他写入者的证明。发布和清理前都要复核文件、目录身份与内容。
6. **接受与恢复**：接受新根后不能因清理失败回退旧根、重放业务副作用。清理失败保持待清理；旧写入者重建目录应报告分叉，不能重新导入用户已经删除的设置。
7. **共享配置**：不能把未标记的整个共享 `.claude` 直接当作产品私有根；不能给共享 `settings.json` 添加产品全局 schema 标记。

## 实施与证据状态

当前状态为 **实施中，尚未验收，不可发布**。根解析、多来源事务、历史双命名空间、旧迁移材料归档、已选根内平铺 DB、默认 headless 迁移和合并 sidecar writer 入口已有隔离回归。冷迁移持久交接、安装恢复、四处持久化/恢复缺口、public server library 准入和默认插件路径逃逸均已修复并验证。默认模块接线回归修复后，policy、server、desktop、persistence-upgrade、chat-contract 五项串行复验全部退出 0，随后 mobile 的类型与真实入口 fixture 修复后也通过；各快照及后续定向验证的边界见下表。一次性 Rust toolpath 下 native 链退出 0，compiled-sidecar smoke 与 Linux 静态目录包检查通过；但 Bun 编译阶段出现运行时下载，不能记作全程离线检查，默认 PATH 的 cargo 缺口也未修复。完整旧 profile 所有权、共享顶层数据和真正独立外置来源收养仍不完整；Windows 原生停写证明尚未获得平台验证，继续保持阻断。代码存在或安全拒绝都不等于已满足全部条件。

修复前已运行的隔离回归：

| 检查 | 观察结果 | 能证明什么 |
| --- | --- | --- |
| `bun --no-env-file test ./src/utils/storageRootConvergence.test.ts` | **failed**：3 个用例失败 | 复现默认根、显式根内部目录、空 override 的分裂 |
| `bun --no-env-file test ./src/utils/storageRelocations.test.ts ./src/utils/storageMigrationMetadata.test.ts` | **passed**：9 个测试 | 仅为改动前 relocation/metadata 基线，不验证后续实现 |
| 隔离环境下 `npm --prefix site run build` | **passed**：122 篇公开文档完成构建及静态路由输出 | 不证明迁移或入口接线通过 |
| 隔离环境下 `npm --prefix site run typecheck`、`npm --prefix site run check:docs` | **passed**：122 页、579 个本地链接/图片、22 对双语应用截图 | 双语存储路径文档的类型和站点引用检查 |
| 隔离环境下 `npm --prefix site test` | **passed**：120 个测试，0 失败、0 跳过 | 含内部文档排除、双语路由、静态发布与既有站点行为；不证明数据迁移通过 |
| `bun run check:impact` | 报告生成成功，但策略 **blocked**：CLI core 需要维护者审核及相应标签 | 142 个改动路径、3299 个外部依赖者，选中了跨区域检查；不代表已执行全部 lane |
| 隔离环境下 `node desktop/node_modules/typescript/bin/tsc -p desktop/electron/tsconfig.json` | **failed**：迁移适配器和其恢复测试各有一个未使用 import | 本轮实现中首次 host 类型检查，须修复后重跑 |
| 隔离环境下 `bun --no-env-file test ./src/services/storageMigration.legacyNamespaces.test.ts` | **failed**：1 passed、2 failed；归并及同身份 DB 冲突用例均先被缺失 `providers.json` 阻断 | DB 由生产 `openLocalIndexDatabase` 建立并写入哨兵行；要求从当前 `db/` 路径消费、不同内容冲突不得形成第二份不消费的 DB，同时保留共享设置。无产品证据的任意 SQLite 用例已正确拒绝 |

核心交接时的新增隔离证据（不替代最终接线后的重跑）：

| 检查 | 观察结果 | 范围与缺口 |
| --- | --- | --- |
| 共享事务、persistence-upgrade fixture、root、convergence、relocations、metadata 六文件 | **passed**：77 个测试 | 核心既有回归；不包含仍失败的 legacy namespace 新回归 |
| 桌面 dataMigration、LegacyRecovery、echoFlowDataRoot、migrationCredentials、migrationPermissions 五文件 | **passed**：102 个测试，6 个平台测试 **skipped** | 适配器和恢复 fixture；不证明冷启动入口及真实系统凭据迁移 |
| Electron host `tsc -p electron/tsconfig.json` | **passed** | 已修复首次检查的两个 unused import；后续接线仍须重跑 |
| 隔离环境下实际 Electron 以 `ELECTRON_RUN_AS_NODE=1` 打开 `node:sqlite` 内存 DB 并执行 `PRAGMA quick_check` | **passed**：Electron 42.7.0、Node 24.18.0、`quick_check=ok` | 仅证明已安装 host runtime 具备历史 DB 检查所需 SQLite API，不证明跨进程迁移或 UI |
| 离线校验已准备的 Linux cloudflared manifest 与二进制 | **passed**，未下载 | 仅为后续本地 native 构建前置条件，不是构建通过 |
| `bun run check:persistence-upgrade` | **failed**：2 个 lane | voice vocabulary fixture 仍断言旧命名空间；renderer reading/zoom/editor forward-copy 的 9 项回归失败，已交由该区域唯一写入者调查，未改预期掩盖 |

历史双命名空间与归档修复后的主流程串行证据：

| 检查 | 观察结果 | 范围与缺口 |
| --- | --- | --- |
| `bun --no-env-file test`：storageMigration、legacyNamespaces、server persistence-upgrade、root、convergence、relocations、metadata 七文件 | **passed**：88 tests、0 failed、491 assertions | 包含生产 schema/WAL 所有权检查、实际 `db/` 消费、冲突保留、历史材料隔离归档及 8 个进程退出/冷恢复场景 |
| 临时 Node-target bundle 在实际 Electron host 中执行共享事务 | **passed**：`ready`；活动 DB 哨兵可读、源目录已清理、共享设置和产品未知字段保留 | 私有 fixture 的 providers 先由 Bun 中的生产 schema owner 规范化；host hook 只验证当前 schema，没有声称 Electron 内运行完整 schema 升级或原生 Chromium profile 验证 |
| 最新存储文档 `site run typecheck`、`site run check:docs` | **passed**：122 页、579 个本地链接/图片、22 对截图 | 不等于新的应用构建或完整接线验收 |

上述 host smoke 首次缺少必需 schema hook，正确被阻断；尝试把完整 server schema owner 直接 bundle 到临时 host 时又因未安装的可选 provider/telemetry 包而失败。第一轮将 smoke 限定为生产 owner 已升级的当前 schema fixture，未把可选服务缺失掩盖成完整 host 构建通过。

后续已将 schema owner 与 live provider/OAuth runtime 依赖解耦：ID 判断直接使用既有常量，DeepSeek 纯模型迁移维持原公开 re-export；没有安装依赖或改变升级语义。

| 新增检查 | 观察结果 | 范围与缺口 |
| --- | --- | --- |
| server `persistence-upgrade.test.ts` | **passed**：35 tests、192 assertions | 包含 DeepSeek 模型映射、未知字段和历史 provider schema；验证依赖边界调整未改变既有升级行为 |
| 实际 Electron host 执行生产 `upgradePersistentStorageValue` | **passed**：原始 schema 1 providers 升到当前版本、活动 DB 哨兵可读、源清理和共享哨兵保留 | 不再预升级 fixture 或使用简化 hook；仍不替代 Chromium profile 验证 |
| 桌面 bootstrap/security/startup/appMode 与路径消费者 16 文件 | **passed**：495 tests、1 skipped | 包含空环境 override 使用默认根、空 Chromium switch 仍拒绝；真实 profile 与跨平台证明仍须补全 |
| `storageMigration.inPlace.test.ts` 初次执行 | **failed**：0 passed、3 failed | 已选根的旧平铺 DB 未迁入活动路径、不同内容 DB 未阻断、桌面空 override 被拒绝；空 override 已修并通过桌面回归，其余两项仍在修复 |
| localIndex database 与 legacy namespace 两文件 | **failed**：31 passed、2 failed | 生产数据库升级和 namespace 归并通过；两个当前路径 fixture 仍断言旧 `cc-haha` 活动路径，等待消费者交接后更新 |
| 当前隔离 Electron host `tsc -p electron/tsconfig.json` | **passed** | 将本地 schema owner 的 Bun-only 类型替换为实际使用的最小 DB 结构，消除 Node host 类型依赖；最终接线仍需重跑 |

### 本轮接线后的实际证据（2026-11-17）

以下主会话命令均通过隔离 runner 设置临时 HOME、配置与临时目录，无 provider 网络调用或真实用户状态操作；不是 Windows/macOS 实机验收。历史失败保留在上表，当前结果如下。

| 检查 | 当前观察 | 范围与缺口 |
| --- | --- | --- |
| `bun --no-env-file test ./src/services/storageStartup.migration.test.ts` | 先 **failed：0 passed / 2 failed**；实现后 **passed：5 tests** | 默认真实入口消费两个旧 namespace 和已选根平铺 DB；生产数据库哨兵可读，未知数据与共享哨兵保留。增加 live owner、未来 DB、需原生 Chromium 验证时不接受、不清理来源、不放行 writer 的回归；仅 OS inventory 使用明确私有范围的 fixture |
| 上项与 `./src/services/storageStartup.test.ts` 联跑 | **passed：20 tests / 70 assertions** | 包含 11 个 CLI/server/八 adapter 公共入口在未知所有权时先拒绝、writer 共存、自然退出和 adapter 排空后释放；不是八平台在线聊天测试 |
| `desktop` 下 `bun run test --run sidecars/storageStartup.test.ts` | 先 **failed：2 tests**；修复后 **passed：2 tests** | 合并 sidecar 的 server/adapter 源入口必须在 preload/config/业务启动前取得自身 lease，零 adapter 的显式退出先释放。尚不等于 compiled binary smoke |
| `desktop` 下 `bun run test --run electron/services/migrationCredentials.test.ts electron/services/migrationPermissions.test.ts electron/services/dataMigration.test.ts electron/services/dataMigrationLegacyRecovery.test.ts` | **passed：67 tests，6 skipped** | Windows permissions 与 macOS credentials 唯一实现移到共享层，桌面 re-export 保持兼容；mock 系统存储，不访问真实 keychain。6 项平台测试仍跳过 |
| `bun --no-env-file test`：storageMigration、inPlace、legacyNamespaces、migrationInventory、migrationInventoryWindows、localIndex database、coordinator、searchContentDatabase、searchContentCoordinator、scheduledRunReadModel 共 10 文件 | **passed：210 tests / 1046 assertions** | 已选根四个固定 DB/WAL 家族、cohort 冲突、同内容目标身份、退役文件重建分叉、根内 inspection 副本、中断恢复及 canonical DB 消费者；修复先前两个旧活动路径 fixture 后重跑。不是完整数据库 producer→迁移→所有 UI consumer 证明 |
| Electron host `tsc -p electron/tsconfig.json`，native writer 交接后的快照 | **passed**：已将 native 测试的 Bun-only 静态导入改为已安装 Bun CLI 构建 fixture | 此后又有配置收养、v1 冷恢复及登录集成测试改动，最终候选仍须重跑，不能沿用本次绿灯 |
| 主会话真实 Electron 42.7 / WSLg 的隔离 native reader 矩阵 | **passed：21 tests / 0 failed** | 显式转发四项 GUI 环境变量，其余 HOME/config 仍隔离；验证 LS/IDB 值、file/HTTP origin、package-main dispatcher、坏 LevelDB、未来 schema、workspace v1 合法升级及丢值拒绝。真实生产 quiescence 在本机因 `/proc` 证据不可读被阻断；不是完整生产端到端通过 |
| Windows bounded native inventory 子任务 | **passed：34 tests / 148 assertions**，helper 类型检查通过；平台验收 **blocked** | 固定 transport、严格 per-PID handles/maps 协议仅离线 fixture。WSL 无 PowerShell/C# 编译器，生产保留未获平台资格的明确 barrier；空 owner 或 mock 通过不放行迁移 |

### 配置收养与私有 scratch 的后续证据

以下均为离线隔离 fixture；不同组合有重叠，不相加作为总通过数。

| 检查 | 观察结果 | 范围与缺口 |
| --- | --- | --- |
| 主会话 `bun --no-env-file test`：configAdoption、storageMigration、inPlace、sqliteCohorts、legacyNamespaces、storageStartup、storageStartup.migration 七文件 | **passed：125 tests / 795 assertions**；配置子任务先复现 **0 passed / 14 failed**，最终新增 19 项 | 已证明归属的完整 profile 和选中根内 `.config.json` 收养；原 bytes 备份、未知字段、冲突、同内容目标身份、清理恢复、分叉、替换根及 OAuth 目的地冻结。未认领共享 HOME 配置 |
| 配置子任务 `desktop` 下 `bun run test --run electron/services/desktopStorageStartup.test.ts` | **passed：26 tests**，子任务证据 | 主会话之后开始修改 v1 冷恢复，最终 desktop 候选仍需重跑 |
| SQLite cohort 子任务四文件 | **passed：82 tests / 680 assertions**，子任务证据 | 完整 profile、内部 namespace、平铺 DB 统一保护 base/WAL/SHM/journal；其中相关套件已被上面的主会话七文件复跑覆盖，不重复累计 |
| 主会话 plugin ZIP extraction、private scratch helper、installedPluginsManager、marketplaceManager 四文件 | **passed：19 tests / 36 assertions**；新 extraction 回归先 **0 passed / 2 failed** | extraction 使用私有 `I/tmp`，并发复用、清理再创建、链接拒绝；不证明外置 ZIP cache 已被收养 |
| 主会话 market-install、plugin extraction、private scratch helper 三文件 | **passed：31 tests / 84 assertions**；新增 market staging 回归先 **0 passed / 2 failed** | 真实离线安装 fixture，checksum 成功/失败均清理根内 staging；没有外部下载或依赖安装 |
| 主会话 openTargetService.storage、open-target-service、open-target-launch-options、macAppIcon.storage、macAppIcon 五文件 | **passed：73 tests / 134 assertions** | 两条图标转换链路使用 `I/tmp`，成功/失败清理；转换命令 mock，不是 macOS `sips` 或 Windows 原生命令验收 |
| 主会话 screenshotClipboard.storage、private scratch helper、两条 icon storage、plugin extraction 五文件 | **passed：21 tests / 32 assertions**；截图新回归先 **0 passed / 4 failed** | 剪贴板成功、非零返回、命令异常和渲染异常均清理私有目录；不操作真实系统剪贴板 |
| 主会话 tempfile.storage、private scratch helper、cachePaths、screenshotClipboard.storage、plugin extraction、sessionHistoryScratch、reviewService 七文件 | **passed：108 tests / 396 assertions**；同步文件路径新回归先 **0 passed / 5 failed** | synchronous settings/editor/Git bundle 路径也收敛到 `I/tmp`；content-hash 名跨冷进程保持稳定，随机名独立，链接与路径穿越拒绝。调用方文件生命周期不改；不是在线 Git bundle 上传验收 |
| 主会话 compiled sidecar 测试的默认入口 | **passed：11 tests，4 skipped** | 隔离 source/fixture 契约；fresh sidecar build 和 opt-in compiled binary smoke **not run**，不把默认跳过当作二进制通过 |
| 其他会话 desktop-smoke deterministic/execute 两文件 | **passed：24 tests**，peer 证据 | provider seed 改为当前内部 namespace，真实 ProviderService 子进程由 `activeId=null` 的 RED 转 GREEN；真正 browser smoke 因缺 `agent-browser` **blocked/skipped**，未安装 |

### 冷恢复、选择性收养与 scratch 消费者的后续证据

以下组合仍有重叠，不累计为总数。子任务结果与主会话复跑分开记录。

| 检查 | 观察结果 | 范围与缺口 |
| --- | --- | --- |
| 主会话共享事务八文件：configAdoption、storageMigration、inPlace、sqliteCohorts、legacyNamespaces、storageStartup、storageStartup.migration、selective | **passed：132 tests / 833 assertions** | v1 原始控制字节进入历史归档，不成为活动控制；固定 UI 状态只证明文件而非共享父目录。随后又修改 headless discovery，不能把这次快照当当前整个候选的最终检查 |
| v1 冷恢复子任务的 ColdRecovery、Startup、LegacyRecovery、Validation、Bootstrap 五文件 | **passed：89 tests**，原生验证 **9 skipped**；host `tsc --noEmit --project electron/tsconfig.json` **passed**，均为子任务证据 | 在 hooks/cleanup 前选择最终根，校验真实 launch controls；共享父目录只贡献固定状态与控制投影，过时的独立已归属 profile 进入 opaque history。协议 fixture 不替代 native Chromium 读取。后续冷迁移交接正在改同一区域，旧结果不是最终候选证明 |
| 主会话 headless migration、startup、selective 三文件 | 新增真实入口回归先 **failed：0 passed / 3 failed**；实现后组合 **passed：34 tests / 134 assertions** | 三类共享旧桌面状态的原 bytes 收养；未知字段保留、共享 settings 不变、未知状态在 writer admission 前拒绝、退役文件重建不复活。没有认领整个共享 `.claude` |
| 主会话 cuHelperInstall.storage、cuHelperInstall、privateStorageTempDirectory 三文件 | 新 storage 回归先 **failed：0 passed / 3 failed**；实现后组合 **passed：35 tests / 75 assertions** | 签名提取证书位于 `I/tmp`，成功和证书错误均清理，链接拒绝；mock codesign，不安装或启动 helper，不是 macOS 签名资格证明 |
| IDE scratch 子任务 public `maybeInstallIDEExtension` fixture | 初次 **failed：3 passed / 6 failed**；最终 **passed：9 tests**，与私有目录 helper 组合 **20 tests**，子任务证据 | 假 npmrc/token、mock HTTP 与 IDE command；下载成功、下载错误、安装非零和异常均清理独立根内目录，配置未知字段保留。没有真实下载、IDE 或凭据读取 |
| 主会话 REPL.storage、ide.storage、cuHelperInstall.storage、privateStorageTempDirectory 四文件 | **passed：27 tests / 38 assertions**；transcript 有效 RED 为 **1 passed / 3 failed** | 实际 transcript key handler 经 AST 抽取后在隔离子进程执行；保留防双击和状态语义，文件位于 `I/tmp`。不是完整 Ink UI mount、浏览器或原生桌面 smoke |

### 附件链与物理路径身份补充

| 检查 | 观察结果 | 范围与缺口 |
| --- | --- | --- |
| 主会话 `storageRelocations.test.ts` Unicode 回归 | 先 **failed：5 passed / 2 failed** | NFC 改写会使分解 Unicode 的旧根、目标根和文件名指向不同物理路径，也会错误合并 Unicode-equivalent 的不同根；移除物理路径上的 NFC 改写，保留 traversal 与附件前缀限制 |
| 主会话 relocation、storage-attachment-migration、conversation-attachments、filesystem 四文件 | **passed：26 tests / 105 assertions** | 两个独立子进程分别执行真实 `AttachmentStore` 生产端与 startup 迁移；旧根删除后，filesystem/localFile 两个真实 HTTP handler 仍返回原 PNG bytes，transcript 原 bytes 不改。仅 OS inventory 使用有明确私有范围的 fixture；不代表在线 IM、socket server、浏览器或 native Electron 通过。初次组合另发现 ConversationService fixture 写旧 namespace，修正两处 fixture 路径，原行为断言保留 |
| 主会话 memory paths.storage、memdir、storageRelocations 三文件 | 新 memory 回归先 **failed：0 passed / 3 failed**；修复后组合 **passed：17 tests / 67 assertions** | 默认、Cowork 和 remote memory 位于已选根内部时均保留物理 Unicode spelling，写入和读取同一 MEMORY.md；保持 traversal 拒绝、项目 key 和既有 prompt bytes。没有声称外置 memory 已被收养 |

完整 source 根的活动 coordination lock 曾进入数据 snapshot，与崩溃恢复和旧根 headless writer 准入冲突。shared core 与 cold handoff owner 已修复并正式交接；独立审查另外指出的 accepted 清理末尾中断后的目录重建身份问题也已有效复现并修复：accepted 恢复不再重建源 coordination 目录，源/目标身份、剩余材料与真实停写检查仍保留。

### Shell 与固定端口远程读取链补充

| 检查 | 观察结果 | 范围与缺口 |
| --- | --- | --- |
| shell 子任务 permissions/providers/imagePaste 五文件 | **passed：34 tests，1 Windows native skipped**，子任务证据 | shell/project scratch 统一为 `I/tmp/shell`；不把 R、I 或整个 `I/tmp` 加入 sandbox allowWrite。24 个剪贴板 fixture 覆盖三种模拟平台、成功与失败清理及包含引号/Unicode 的路径；没有真实剪贴板或 native sandbox 执行 |
| shell 子任务 shellStorage、diskOutput 两文件及单独 background-task-output-route | **passed：15 tests** 及 **6 tests**，子任务证据 | 真实 bundled-skill extraction、nonce/read allowlist、provider cwd/env、task output 与 loopback route。旧绝对 `/tmp` task-output 引用仍可能 403；未读取共享临时目录、改写 transcript 或新增业务 fallback，历史输出收养尚未完成 |
| 历史精确 task-output 收养 | **blocked / 未完成** | transcript 只保留生产者路径，缺少写入时归属、最终字节身份、完成标记和停写证据；不扩大通用读取白名单，不扫描或认领旧临时根 |
| 主会话 shell scratch、clipboard、providers、filesystem、diskOutput、background-task-output-route 七文件联跑 | **passed：51 tests / 71 assertions，1 Windows native skipped** | 验证新持久化 lane 的实际组合；与上面子任务用例重叠，不累加。保留原权限/身份/路径和 route 断言，没有真实剪贴板或 native sandbox 执行 |
| 主会话 `storage-public-access-restart.test.ts` | **passed：1 test / 2 subprocess assertions** | 真实 server 的 browser 配对和会话创建后完全退出；第二进程执行 startup 迁移，旧根消失，在原固定端口凭原 cookie 读取历史。devices 未知字段、原 transcript bytes 和 writer drain 保留，未授权请求仍为 401。首轮仅因 inventory mock 缺 export 失败，补齐 fixture 后通过，未称产品 RED。只有 OS inventory 使用私有范围 fixture；不是浏览器 cookie jar/localStorage、真实公网 tunnel 或 native Electron 验收 |

#### 历史 task-output 的已知缺口

transcript 中保留的绝对路径只是生产者的路径证据，不是 EchoFlow 归属、最终字节身份、完成标记或停写证明。EchoFlow 不扫描、打开、迁移、删除或放宽读取旧的 OS tmp 根；范围外的精确路径继续返回 `FORBIDDEN`/403，原字节保持原位。历史 task-output 收养仍属单根归并的未完成缺口，只有在取得可验证的写入时归属证据后才能处理，不能通过扩大通用读取白名单补做。

### 配置引用、冷迁移与安装 bridge 的集成证据

| 检查 | 观察结果 | 范围与缺口 |
| --- | --- | --- |
| 主会话 configured overrides 的首次回归 | **failed**：既有 managed-path 测试通过，新增映射及八条真实入口消费链失败 | plugin/memory 返回旧根，trace/OAuth/WhatsApp 拒绝旧配置；修复复用既有 v2 relocation mappings，只检查新目的地，不重开旧根或扩展附件 HTTP 白名单 |
| 主会话 `fsOperations.storage.test.ts` | 先 **failed：0 passed / 1 failed** | 文件系统封装将 native realpath 改成 NFC，导致分解 Unicode 根下真实 settings 读取 ENOENT；仅移除此处物理路径改写，未声称完成全仓 Unicode 审计 |
| 主会话 managed-path、startup overrides、fsOperations、memory paths、memdir、consolidationLock、ZIP scratch、pathValidation 八文件 | **passed：54 tests / 152 assertions** | 八条真实 startup 后的 plugin、ZIP、Cowork、remote、用户 memory 设置、trace、OAuth、WhatsApp 配置消费；旧根已删除且未重建，transcript bytes 不改，外部未知数据拒绝且不触碰。trace 是 getter、WhatsApp 是配置、OAuth 是假 token 本地读写，不是在线平台验收 |
| cold/core 正式交接九文件及 desktop 十一文件 | 子任务 **passed：146 tests / 910 assertions**；**191 tests，9 native skipped** | 源根持久请求不依赖 launcher PID 存活，旧 host 退出前不复制完整 profile；target cold execution/restricted validation/acceptance/cleanup 使用共享 v2。限定 host 类型检查 0 diagnostics，不是完整 main.ts 图。该交接快照随后被独立审查发现四项缺口，现已修复并在下一节记录新证据 |
| installer bridge 正式交接三文件 | 子任务及主会话集成均 **passed：43 tests / 356 assertions，4 Windows-only skipped** | NSIS 从新包提取 recovery exe 到旧安装外；PowerShell 不再 copy 到 Recovered-* 或写新 pointer；bridge 采用共享 producer/事务。Bun bundle 通过不等于 Windows 编译；原生 profile owner、Windows inventory 未获资格时仍 exit 20，未收养整个旧 UI/native profile |
| 主会话隔离 `bun run check:persistence-upgrade` | **passed：全部 34 个顺序 lane，exit 0** | 含 core/startup 223、private scratch 154、shell 51（1 native skip）、memory 21、cold desktop 145（9 native skip）、installer 43（4 Windows skip）、renderer 17 文件 574 tests；其他 lane 保持完整。筛选测试的 skipped 与原生资格跳过不可混为一谈，也不把重叠组合累加成独立覆盖总数 |
| 同一隔离 runner 中紧接执行默认 `bun run check:chat-contract` | **passed：3 suites，exit 0** | server WS 150、mock CLI conversation 138、desktop 542 tests；默认 Node/PATH，无替代 runtime、无 mise trust/config 改动。离线 mock 不是 live provider 证据 |

上述主会话日志为 `/tmp/echoflow-configured-overrides-consumers-green.log`、`/tmp/echoflow-persistence-integrated.log`、`/tmp/echoflow-chat-contract-default.log`。这是未提交工作区的一次集成快照，尚非最终候选或 Actions 证据。

### 独立审查修复与 public library 真实入口

四项审查问题均由原范围唯一写入者有效复现后修复，主会话已检查生产增量；没有放宽未知材料或平台资格保护。

| 问题与修复 | 有效失败证据 | 修复后证据与限制 |
| --- | --- | --- |
| 多级备份、暂存与发布目录逐层 sync 父目录链接，覆盖 R 在其父目录的链接；已有 publication receipt 重入仍核对 identity | 两个真实 syscall tracing child 分别报 `Unsynced ancestor link` | 子任务 shared 九文件 **153 passed / 939 assertions**；这是实际文件操作的 sync 顺序证据，不是断电硬件验收 |
| accepted 清理恢复不重建已移除的源 coordination 目录 | 实际 rmdir 后注入中断，重入报 `Migration directory was replaced` | 子任务 desktop 十一文件 **193 passed，9 native skipped**；不重跑已接受验证，仍复核身份和剩余材料 |
| target reaper 仅回收精确识别的 lock/writer receipt，未知字段、未知文件名或 PID 不匹配保留并阻断 | 三种未知 receipt 错误进入 validation-required | 上述 shared 组合覆盖未知原 bytes 保留和合法 dead receipt 回收；不把未知 receipt 当作可删缓存 |
| completed exact-args 重入像普通 ready 启动一样取得 writer lease，不要求维护停写 | 正常 target co-writer 使原流程报 `normal target writer is live` | 上述 desktop 组合覆盖正常 writer 共存，仍经完整 move 证据及普通 writer admission |
| public server library 在 runtime singleton 求值前初始化存储，不再仅限 direct main | 新增独立子进程 **0 passed / 2 failed**：unowned import 未拒绝，ready import 无 lease | 独立回归 **2 passed**；主会话 13 文件调用方组合最终 **250 passed / 0 failed**，含真实迁移、旧根删除、固定端口配对 cookie 与原 transcript bytes 重启链 |

Library 保持同步 `startServer` API；公共模块以 top-level await 完成准入后动态加载 runtime。允许同进程切换 fixture 根的内部 runtime 测试改为直接测试 `serverRuntime`，不添加生产测试 bypass。集成首次 **248 passed / 2 failed**，调查后纠正两个 fixture：损坏实际 `getGlobalClaudeFile()` 而非非活动 `.config.json`，并按两个真实 OAuth singleton owner 建立 spy，保留四个兼容 callback case。随后 **249 passed / 1 failed** 暴露被消费 session 的 fixture listener 未关闭，补每例 finally 清理后 250 项全过；未改 OAuth 生产服务，也未放松 409、replay 或未知 state 断言。

审查日志：`/tmp/handoff-review-links-red.log`、`/tmp/handoff-review-core-red.log`、`/tmp/handoff-review-desktop-red.log`、`/tmp/handoff-review-core-final.log`、`/tmp/handoff-review-desktop-final.log`。Library 日志：`/tmp/echoflow-library-startup-red.log`、`/tmp/echoflow-library-startup-green.log`、`/tmp/echoflow-library-callers-final2.log`。最初 tracing fixture 的递归 mock 超时不算有效 RED，采用后续 links-red；文件名带 green 的旧 caller 日志也不代表 exit 0。

修复后完整 persistence/chat 已完成一次复跑：`/tmp/echoflow-persistence-final.log` 的全部 34 lane 通过（首 lane 232 tests，renderer 17 文件 574 tests）；`/tmp/echoflow-chat-contract-final.log` 的 WS 150、mock CLI 138、desktop 542 tests 通过。该快照早于下列默认插件 containment 增量，不将旧结果冒充最终候选证据。

### 默认路径与模块检查的后续修复

| 检查 | 实际结果 | 范围与限制 |
| --- | --- | --- |
| 默认 `plugins` / `cowork_plugins` 物理 containment | 新隔离 child 回归先 **4 passed / 2 failed**，最小修复后六文件组合 **30 passed / 0 failed** | 默认路径与显式 override 共用已有 managed-path resolver；外指链接拒绝且外部哨兵不改。不等于外置插件数据已被导入。日志：`/tmp/echoflow-plugin-default-red.log`、`/tmp/echoflow-plugin-default-green.log` |
| 默认 `bun run check:adapters` | 原 **952 passed / 4 failed**；修复后 **990 passed / 0 failed / 3550 assertions**，69 文件 | 纠正根外 WhatsApp 成功 fixture、unmarked safe-logging fixture 和共享测试进程的永久绑定污染；不加生产 bypass。新增八平台公共 launcher 的 ready/unproven 共 16 个独立 child 回归，业务 runtime 才 mock；实际 SDK/路由仍由原有 suite 覆盖。子任务 targeted 六文件 **195 passed / 1208 assertions**。日志：`/tmp/echoflow-adapter-targeted-storage.log`、`/tmp/echoflow-adapter-default-storage.log` |
| 默认 `bun run check:electron` | 原 **1323 passed / 32 failed / 19 skipped**；修复后 **1355 passed / 0 failed / 19 skipped**，83 文件 | host `tsc`、打包脚本 78 tests 和七个 host bundle 也通过。修复 Bun 缺失的 `vi.mocked` / matcher、空数组参数表展开、旧 namespace 和 bootstrap 变量断言；原调用数、参数、拒绝与停写要求保留。日志：`/tmp/echoflow-electron-final.log`、`/tmp/echoflow-electron-repaired.log` |
| 默认 `bun run check:policy` | 原 **931 passed / 2 failed**；修复后 **933 passed / 0 failed / 4 skipped / 9692 assertions**，52 文件；quarantine 0 entries、0 expired | 删除本次迁移造成的未使用 `os` import；installer 接线断言从已退役独立 copy/pointer 实现改为共享 bridge、ready receipt、原停写/身份/安装目录保护。不是 Windows 运行证据。日志：`/tmp/echoflow-policy-final.log`、`/tmp/echoflow-policy-repaired.log` |
| `actionlint .github/workflows/pr-quality.yml .github/workflows/nightly-quality.yml` | **passed，exit 0** | 不等于 Actions 已运行；未修改 settings、ruleset、labels 或触发远端门禁 |
| 默认 `bun run check:native` | **failed / environment blocked**：`cargo` 不在 PATH；后续阶段未执行 | 已确认现有 stable toolchain 可经绝对路径启动，版本 cargo 1.99.1。没有安装或改用户 PATH，不能声称默认 native 环境已修好。日志：`/tmp/echoflow-native-final.log` |

### 最新串行集成结果

下列三项来自同一串行执行，最终退出 0；构建前后 tracked numstat 与完整 status 清单一致，stub scanner 创建 0 个文件。这些结果早于后续默认模块检查暴露的接线回归及其修复，不冒充最新候选全部复验。

| 实际命令或阶段 | 结果 | 证据边界 |
| --- | --- | --- |
| 临时 `PATH` 加入现有 Cargo 目录，并显式设置现有 `CARGO_HOME` / `RUSTUP_HOME` 后执行 `bun run check:native` | 命令 **passed，exit 0**；全程离线资格 **blocked** | Rust 四组分别 1562、20、49、5 tests 通过，使用 `--locked --offline`；Swift 在 Linux **not applicable**。Bun sidecar 编译日志出现约 42.5 MB 的运行时下载，不能把整个链称为离线。未重复该构建，未修改用户环境。日志：`/tmp/echoflow-native-explicit-toolpath.log` |
| 上述链内 fresh sidecar build 与 opt-in compiled smoke | **passed：49 tests，1 macOS-only skipped**，3 文件 | 真实编译 sidecar 创建并重新打开 SQLite、server 本机访问边界及 adapter flags 经过 smoke；image processor 和下载器 fixture 同跑。下载器测试中的 timeout/HTTP 日志属于 mock，不与前项真实编译下载混淆；不是八平台在线 SDK 流程 |
| 上述链内 Electron host 与 Linux directory packaging | **passed**：host 类型检查、1355 tests / 19 skipped、78 packaging-script tests、七个 host bundle、renderer/H5 构建及静态包检查 | Linux x64 `linux-unpacked`，Electron 42.7.0；静态检查确认 sidecar、native helper、ripgrep、node-pty 和许可证存在。不证明 GUI 启动、安装/升级、AppImage/deb/rpm、Windows/macOS 或发布验收 |
| 隔离默认 `bun run check:persistence-upgrade` | **passed：全部 34 lane** | 首 lane 250 tests、scratch 154、shell 51 / 1 skipped、memory 21、cold desktop 145 / 9 skipped、legacy recovery 15、installer 43 / 4 Windows skipped、renderer 17 文件 574 tests；这些组合有重叠，不累计总数。日志：`/tmp/echoflow-persistence-candidate.log` |
| 隔离默认 `bun run check:chat-contract` | **passed**：WS 150、mock CLI 138、desktop 542 tests | 三组全部通过，31.4s；不使用真实模型或额度。日志：`/tmp/echoflow-chat-candidate.log` |
| 最新隔离 `bun run check:impact` 与 `actionlint` 两工作流 | 命令均退出 0；impact 策略仍 **blocked** | 396 changed paths，areas 为 adapters、cli-core、desktop、docs、mobile、release、server；缺可信 PR/base/审批上下文，不伪造 label 或使用 override。不把选中模块当作全部已经执行。日志：`/tmp/echoflow-impact-candidate.log`、`/tmp/echoflow-actionlint-candidate.log` |

后续验收仍须补全：完整旧 profile 所有权、所有 writer 停写证明、受限原生 profile 的未覆盖存储类别、v1 forward recovery 与安装恢复的实机冷启动、真正独立外置来源及历史绝对 task-output 收养、完整受影响模块和候选 Actions 证据。compiled sidecar 和 Linux 静态打包已补证，但不是原生迁移资格或发布验收。部分条件在当前机器无法获得原生证据，部分实现仍未完成；安全阻断不等于实现完成。

### 默认模块接线回归与复验

首次默认 server 检查有 27 个失败文件、130 个失败测试，全部在隔离诊断重跑中再次失败；desktop 有 3 个失败文件，未进入构建阶段。这些失败没有按 flaky、放宽超时或删断言处理。修复包括当前 namespace fixture、实际 CLI/public server 准入前的所有权初始化、仅用于同进程切换私有根的 internal runtime 测试接线，以及实际 WhatsApp 解绑回归。

- WhatsApp 解绑只读取原始配置来判定清理范围；未归并的外置目录不检查、不删除，只清除账号绑定。根内目录仍经物理 containment 验证；登录和正常启动仍使用严格配置解析。
- collaboration 的历史状态用例通过共享事务迁移，不恢复业务 writer 的旧路径复制逻辑；验收前源 bytes、根内备份和验收后源退役都有断言。
- adapter sidecar 惰性启动测试保留真实 launcher，比较准入前后的目录与 marker bytes，验证无额外写入及 lease 泄漏。
- Bun 原生 installer suite 不再由 Node/Vitest 收集，仍由默认持久化 lane 实际运行。其 source/test 路由新增用例先复现 **112 pass / 2 fail**，精确 persistence prefix 修复后由默认 policy 通过，不扩大排除范围或削弱门禁。

| 实际隔离命令 | 观察结果 | 证据边界与日志 |
| --- | --- | --- |
| `bun run check:policy` | **passed：935 tests，4 skipped，0 failed**；quarantine 无条目/过期项 | 含新增 installer source/test 路由回归；`/tmp/echoflow-module-repaired-policy.log` |
| `bun run check:server` | **passed：879 files，10456 passed-tests，0 failed-tests，0 failed-files** | 实际默认入口，不以失败文件的定向通过代替；`/tmp/echoflow-module-repaired-server.log` |
| `bun run check:desktop` | **passed：710 files，11694 tests；2 files / 21 tests skipped**；lint、renderer build 与 H5 export 通过 | 不包含被准确分配给 Bun lane 的 installer suite，不是 native/GUI 验收；`/tmp/echoflow-module-repaired-desktop.log` |
| `bun run check:persistence-upgrade` | **passed：全部 34 lane**，renderer 574 tests | 原生平台 skips 保留；组合有重叠，不累计总数；`/tmp/echoflow-module-repaired-persistence-upgrade.log` |
| `bun run check:chat-contract` | **passed**：WS 150、mock CLI 138、desktop 542 tests，31.1s | 全部三组通过，无真实模型；React act warnings 不是失败；`/tmp/echoflow-module-repaired-chat-contract.log` |
| `bun run check:mobile` | 首次 **failed**：Expo 要求 `ProcessEnv.NODE_ENV`，纯路径解析器接收空环境时类型错误；修复后再次 **failed：1364 pass / 1 fail**，真实 public server fixture 未先建立所有权；最终 **passed：1365 tests，0 failed**，typecheck、lint、离线 H5 export 通过 | resolver 的环境参数改为只读字符串映射，不改运行时解析；fixture 使用既有 marker helper，保留全部认证/CORS 断言。`/tmp/echoflow-mobile-candidate.log`、`/tmp/echoflow-mobile-repaired.log`、`/tmp/echoflow-mobile-fixture-repaired.log` |
| root/convergence 两文件 | **passed：8 tests，25 assertions** | 对纯路径 resolver 类型修复的定向证据；`/tmp/echoflow-root-env-type-green.log` |
| `bun run check:impact` 与两工作流 `actionlint` | 命令均退出 0，policy **blocked** | 427 changed paths，3704 个 diff 外依赖文件，仍缺可信 PR/base/审批；`/tmp/echoflow-impact-repaired.log`、`/tmp/echoflow-actionlint-repaired.log` |

五项串行默认检查早于后续 mobile 类型/fixture 和 local agent-memory 消费修复；后续定向证据单列，不反向声称该快照覆盖最后字节。先前 compiled sidecar 和 Linux 静态包也早于 WhatsApp 解绑生产改动，不能作为最终候选重新打包的证明。

### memory 消费、性能测量与离线 runtime 后续证据

| 实际隔离命令或修复 | 观察结果 | 证据边界与日志 |
| --- | --- | --- |
| local Agent memory 的 external refusal / relocation 新回归 | 先 **failed：3 passed / 2 failed**；与 memdir、consolidationLock、filesystem permissions、agent-profile attachments 五文件组合后 **passed：29 tests / 110 assertions** | local 分支原先直接消费 `CLAUDE_CODE_REMOTE_MEMORY_DIR`，可能重建退役目录；现复用集中解析后的 memory base。包含分解 Unicode、旧根不重建、路径穿越拒绝及 workspace 默认不变。不证明独立外置 memory 已导入。`/tmp/echoflow-local-agent-memory-red.log`、`/tmp/echoflow-local-agent-memory-green.log` |
| `bun --no-env-file test ./scripts/perf/local-index-corpus.test.ts ./src/server/__tests__/local-index-session-parity.test.ts` | **passed：45 tests / 277 assertions** | benchmark 使用 canonical DB 和隔离 internal runtime。首次响应可能是合法的 empty-building 页，首次有用内容改为原 deadline 内首次非空响应；保留独立 readiness、取消和时限检查，不恢复全 transcript 扫描或预热索引。历史 no-scan 意图已通过只读源码历史核对，不冒充运行过完整 baseline。`/tmp/echoflow-perf-final.log` |
| `bun run check:provider-contract` | **passed：41 deterministic suites** | 仅离线 mock；负路径的预期 proxy 错误日志不等于 suite 失败。`/tmp/echoflow-final-provider-contract.log` |
| `bun run check:agent-flow` | **passed：9 scenarios，0 failed** | 真实 server/CLI 的首回合、审批允许/拒绝、工具/API 失败、interrupt、reconnect replay、stream resume 与 session recovery；无真实 provider。`/tmp/echoflow-final-agent-flow.log` |
| `bun run check:agent-e2e` 首次后续执行 | **failed**：native mock CLI exit 1，未进入工具回合；其后的 replay **not run** | 实际 child stderr 是 migration 被 `/proc` 不可读证据阻断，不是 native 操作失败。当前 fixture 错写旧 namespace 意外触发迁移；修复三处 fixture 配置写入/读取为集中 internal resolver，未放宽迁移 inventory 或原生权限。`/tmp/echoflow-final-agent-e2e.log` |
| `bun run scripts/quality-gate/mock-llm/index.ts --only mock-computer-use-agent-desktop` | 修复后 **passed，exit 0** | 实际 CLI/MCP/bridge，desktop 边界为编译 fixture，无真实 desktop API；原 stale-ref、不自动 replay、interrupt 回收、provider-error 清理、SIGTERM 输入释放先于 session end 等断言保留。`/tmp/echoflow-agent-desktop-fixture-green.log`；不能把定向成功当完整 agent-e2e/replay 通过 |
| 修复 native fixture 后的默认 `bun run check:agent-e2e` | **failed**：native、provider media、model routing、provider routing 已通过，lean profile 在重建空根后报未知所有权；replay **not run** | 比较两种 profile 时原 fixture 删除整个配置根，重建时未恢复 marker。改用已有 async ownership helper；仍清空所有状态，保留同初始状态比较、全部工具/恢复/权限断言，不改生产准入。`/tmp/echoflow-resume5-agent-e2e.log` |
| local-memory 修复后的默认 `bun run check:persistence-upgrade` | **passed：全部 34 lane，exit 0**；memory 22 tests，renderer 17 文件 574 tests | 当前 memory 回归已进入默认持久化 lane；平台 skips 保留，不证明真实原生平台资格。`/tmp/echoflow-resume5-persistence-upgrade.log` |
| 修复 lean reset 后的默认 `bun run check:agent-e2e` | **passed，exit 0**：27 个 server/CLI mock scenarios、21 个 recorded replay scenarios 全过；额外 native desktop、provider media、两种 routing 与 lean 场景通过 | Linux hot-enable **skipped**，不是 macOS/Windows 验收。名称含 live 的场景在此仍使用 scripted model/loopback，不是 live provider。63 条 replay drift 均为录制后的 tool-list 差异；行为断言通过但不等于逐请求零差异，未使用额度重录。`/tmp/echoflow-agent-e2e-lean-repaired.log`，drift：`artifacts/agent-e2e/replay/drift.md` |

### 最后受影响模块与清理边界复验

下列命令均使用既有 sandbox runner、临时 HOME/config 和已安装依赖，串行执行；没有安装依赖、修改真实用户环境或触发 Actions。

| 命令 | 实际结果 | 范围与日志 |
| --- | --- | --- |
| `bun --no-env-file test ./src/server/__tests__/adapters.test.ts` | **passed：43 tests，138 assertions** | 新增外置 `WHATSAPP_AUTH_DIR` 保留两个 fixture 的 credentials，以及 managed auth 外指链接拒绝后外部 bytes、原配置 bytes、链接都不变；正常 managed logout 仍删除 credential。本次只加测试，不再改解绑生产逻辑。`/tmp/echoflow-resume5-whatsapp-cleanup.log` |
| `bun run --cwd harness test` | **passed：11 files，89 tests** | 使用已安装 locked dependencies，无 `npm ci`；`/tmp/echoflow-resume5-harness.log` |
| `bun run audit:harness` | **passed，exit 0**；required failures 为 0 | 可选品牌/文档/eval 建议仍保留，不扩范围修改。`/tmp/echoflow-resume5-harness-audit.log` |
| `npm --offline --update-notifier=false --prefix site run build` | **passed，exit 0**：122 routes，88 redirects | 同时设置 `npm_config_offline=true`、`npm_config_update_notifier=false` 供嵌套 npm 使用；未运行根 `check:docs` 的安装前缀。前一次无这些显式配置的检查出现 npm 更新通知，因此以本次受控重跑作为离线站点证据。`/tmp/echoflow-resume5-site-build-offline.log` |
| `npm --offline --update-notifier=false --prefix site run check` | **passed**：typecheck，122 pages / 579 links and images / 22 screenshot pairs，122 tests | 同上环境；内部材料排除与发布路由检查保留，不是视觉 smoke。`/tmp/echoflow-resume5-site-check-offline.log` |
| `bun run check:policy` | **passed：935 tests，4 Windows native skipped，0 failed**；quarantine 0 entries / 0 expired | `9694` assertions；不改变 override、覆盖或分支保护。`/tmp/echoflow-resume5-policy.log` |
| `bun run check:impact` | 命令 **passed，exit 0**；policy **blocked** | 434 changed paths，3698 个 diff 外 importer；缺可信 PR/base/维护者审批上下文，不能从本机 git user 推定豁免。`/tmp/echoflow-resume5-impact.log` |
| 两个改动工作流 `actionlint` | **passed，exit 0** | `.github/workflows/pr-quality.yml` 与 `nightly-quality.yml`；不代表候选 Actions 已运行。`/tmp/echoflow-resume5-actionlint.log` |

### 最新消费边界审查闭环（2026-11-17）

独立静态审查新提出四项缺陷；主会话已在私有 fixture 中复现并修复，没有更改真实用户状态或放宽迁移/权限保护。此前的 27 mock / 21 replay 结果早于这些修复，不反向当作最后字节的证据。

| 缺陷与修改 | RED → GREEN | 范围 |
| --- | --- | --- |
| Agent memory 只验证 base，拼接 user/remote-local 子目录后可能经过根外链接 | 新增 default-user、remote-user、remote-local 三项目录/后代链接拒绝回归；memory 文件最初 **2 passed / 6 failed**，最终 **8 passed / 0 failed** | `getAgentMemoryDir` 对完整产品目录调用既有 managed resolver；`isAgentMemoryPath` 在自动读写 allowance 前验证完整候选。工作区 project/non-remote local 位置不改，外部 sentinel bytes 不变 |
| `expandPath` 对真实文件路径强制 NFC，可能读错文件或生成第二个物理目录 | 上述六项失败中另三项分别覆盖 default/Cowork/remote 的 decomposed root；修复后经过真实 FileReadTool / FileWriteTool 完成 MEMORY.md 读写，Linux 下 NFC 同名根仍不存在 | 仅移除路径扩展函数五处 Unicode 转换；保留 native path normalization、Windows POSIX 转换、类型和 NUL 校验。不改变既有项目分组 key 的 Unicode 规则 |
| ready 探针先失败时，原函数仍等待 first-useful，具体错误可能被 deadline 覆盖 | 两探针错误的定向用例最初 ready-error 失败；修复后 first-error / ready-error 均立即传播 | `Promise.all` 为两个 promise 同时安装处理器；生产 finally 在停 server 前 abort 原 controller，回收另一侧 pending polling。无新增重试、deadline 放宽或扫描 fallback |
| readiness 时长在两个请求都结束后才取样，可能包含 first-useful 的轮询等待 | first-before-ready 与 ready-before-first 两种顺序及独立时钟断言均通过；四个探针定向用例 **4 passed / 0 failed** | 两个请求分别在自己的 settlement 取时间；runner 使用捕获的 readyDurationMs，不再晚采样 |

RED 日志：`/tmp/echoflow-review-memory-red.log`、`/tmp/echoflow-review-perf-red.log`。定向 GREEN：`/tmp/echoflow-review-memory-green.log`、`/tmp/echoflow-review-perf-green.log`。

| 实际隔离验证 | 结果 | 边界与日志 |
| --- | --- | --- |
| 真实 Read/Write/Edit、PDF、permissions、instruction loading、项目身份、Windows path、attachments、managed paths、memory、consolidation 共 17 文件 | 首次 **124 passed / 1 skipped / 1 failed**；修复 fixture cache 后 **125 passed / 1 Windows-only skipped / 0 failed / 417 assertions** | 组合暴露 `memdir.test.ts` 更换私有 HOME/config 后仍复用进程 memory path cache；仅在 fixture 设置/恢复时清理已有 cache，原路径及 prompt hash 断言不变。`/tmp/echoflow-review-path-consumers.log`、`/tmp/echoflow-review-path-consumers-repaired.log` |
| `bun --no-env-file test ./scripts/perf/local-index-corpus.test.ts ./src/server/__tests__/local-index-session-parity.test.ts` | **passed：48 tests / 280 assertions** | 包含真实 loopback SQLite benchmark、deadline/cleanup、独立探针顺序与错误回归，不是 10k 性能验收。`/tmp/echoflow-review-perf-complete.log` |
| `bun run check:persistence-upgrade` | **passed：全部 34 lane，exit 0**；memory 25 tests，renderer 574 tests | 此次完整链早于随后两行 memdir fixture cache 修复；该修复后重跑同一 memory 三文件 lane，仍 **25 passed / 75 assertions**，并重跑上述完整 17 文件组合。其余生产代码未再改变行为；不伪称再次跑了整条链。`/tmp/echoflow-review-persistence-upgrade.log`、`/tmp/echoflow-review-memory-lane-repaired.log` |
| `bun run check:policy` | **passed：935 tests / 4 Windows native skipped / 0 failed / 9694 assertions** | quarantine 仍为 0 entries / 0 expired；`/tmp/echoflow-review-policy-final.log` |
| `bun run check:impact` | 命令 **passed，exit 0**；policy **blocked** | 435 changed paths，3697 个 diff 外 importer；缺可信 PR/base/审批上下文，不推定身份或伪造 override。`/tmp/echoflow-review-impact-final.log` |

本轮最终检查与记录：`git diff --check`、增量 diff 审阅和 `git status --short`；候选指纹保存在 `artifacts/storage-convergence/review-final-checkpoint.json`，验证命令、状态、日志内容散列与环境记录在 `artifacts/storage-convergence/review-final-validation.json`。指纹是检查后的稳定快照，不是先前各轮命令的自动 pre/post 证明，也不能替代对应候选 Actions。生成材料不提交。

四项最新审查缺陷已闭环，但以下独立外置来源、所有权与原生平台缺口仍然存在，整体目标仍为 **未完成 / 不可发布**。

### 真正独立外置来源：静态复核结论

独立只读复核确认：`storageStartup.overrides.test.ts` 的八类 override 全在已标记旧 profile 的 `cc-haha/custom-*` 子树内。这些用例证明已归属 profile 的重定位消费，不证明 profile 外另一处目录或文件已经收养。

当前 `storageStartup.ts` 的发现入口不盘点真正独立的 trace/plugin/OAuth/memory/WhatsApp 来源；`managedStoragePath.ts` 只读取已有 v2 mapping 并检查 containment，没有导入数据的能力。共享事务的普通 source 会递归收集、清理整个选中目录，不能把 OAuth 文件的父目录、共享 trace 目录或 remote memory base 直接当作已归属目录。

- trace 生产 reader 明确允许自定义目录混有其他 JSONL；格式看起来相似不是独占所有权。
- OAuth override 是一个精确文件，token 形状不证明所属应用；不得因此收养或清理整个父目录。
- plugin 目录包含不可按缓存丢弃的 persistent data，路径重定位还需处理安装 metadata。
- remote memory base 与单个项目 memory 子树不是同一范围；不能只按 `MEMORY.md` 名称判归属。
- WhatsApp 使用 multifile auth/key cohort，不能只迁移 `creds.json`，也不能凭该文件存在就认领所有同目录文件。

共享事务已支持显式批准的同目录精确文件清单：回执冻结目的地和文件身份，恢复核对完整操作集，只发布逐文件映射，接受后才清理原文件，不认领共享父目录。更换已归属的完整根时，旧批准回执作为迁移历史保存，不变成新根的活动授权。

CLI 提供 `storage adopt openai-oauth --file /absolute/path/openai-oauth.json`，经交互确认后只收养指定文件。桌面在「设置 → 数据」提供对应入口，由宿主选择文件并确认，在停写和重启后执行迁移。两个入口都在确认前检查文件格式。迁移后的文件由桌面管理的 OpenAI provider 使用，独立 CLI 可通过 `OPENAI_CODEX_OAUTH_FILE` 显式选择新根内的该文件。未指定 override 时，独立 CLI 仍按原有安全存储规则选择凭据。OAuth override 本身不构成迁移授权。Trace、plugin、memory 和 WhatsApp 仍缺类别限定的批准、停写证明和入口接线。

迁移锁和 writer 回执的空文件、半写文件都缺少可验证的进程身份，继续阻断自动恢复。进程若恰好在创建文件后、写入完成前退出，需要人工核实停写及事务归属。

WSL 本地不默认重复全量验证；完整 PR/全量门禁由对应候选的 Actions 证据证明。本次尚未运行的检查不能记作通过，Linux fixture 也不替代 Windows/macOS 安装、句柄和系统凭据库实机证据。
