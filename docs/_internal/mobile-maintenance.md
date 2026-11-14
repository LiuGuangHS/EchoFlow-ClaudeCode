---
title: 移动端维护资料
nav_title: 移动端维护
description: 移动端实现说明、发布与推送操作资料、本地 fixture 和已有验收记录的集中入口。
order: 30
---

# 移动端维护资料

这里集中原移动端模块中的长篇说明，供维护者查阅。此次仅整理文档，没有执行安装、构建、签名、发布、真实模型或推送测试；正文中的既有验证记录不代表本次重新验证。

## 来源与阅读边界

| 原路径 | 本文位置 | 状态 |
| --- | --- | --- |
| `mobile/README.md` | [实现、开发与验证](#mobile-overview) | 保留实现说明及 2026-10-24 的验收记录和未完成项 |
| `mobile/RELEASING.md` | [发布操作](#mobile-release) | 维护者运行手册；真实账号、签名及发布仍需明确授权 |
| `mobile/PUSH_NOTIFICATIONS.md` | [推送与实时活动](#mobile-push) | 通道、配置与协议说明；配置存在不等于真机实投成功 |
| `mobile/scripts/README.md` | [本地协议 Fixture](#mobile-fixture) | 仅回环模拟服务，不能替代原生或生产验收 |

原路径保留兼容入口，包含应用设置页使用的推送链接和既有发布引用。原文未统一标注编写日期；正文中的日期、历史包身份、验证数字和未验证标记均保留。字体许可仍在 [mobile/assets/fonts/OFL.txt](../../mobile/assets/fonts/OFL.txt)，移动端许可仍在 [mobile/LICENSE](../../mobile/LICENSE)，未随资料整理改写。

除 Markdown 链接重定位及标题层级调整外，下文保留原文。代码路径仍按来源文件的模块或仓库根目录解释；命令按各节原有工作目录说明执行，不以 `docs/_internal/` 为工作目录。

**保留的口径差异，尚未在此次整理中核验：**

- 原 README「通知配置」把 APNs / FCM 配置写成后台推送前提，而推送与发布正文还记录了 Expo 中转和 Android 手机拉取。不要把直连凭据的要求泛化为所有通道都需要；本次没有新增任何通道的投递证据。
- 原 README 页面表中「定时任务」提到手机时区推算及桌面修改高级配置，后续同名章节则记录更完整的手机编辑能力及电脑返回的下次执行时间。保留两处来源，待结合对应版本与验收证据核对，不以本次迁移裁定已发布行为。
- 2026-10-24 的构建、模型与 APNs 记录只证明当时记录的边界；Android FCM、最终界面及真机等未完成项仍是未完成项。

<a id="mobile-overview"></a>

## EchoFlow Code 移动端

React Native / Expo 58 / Expo Router 的 iOS、Android 客户端。按「EchoFlow Code 移动端主题提案」重做界面和功能分工：手机负责收到提醒、做决定、派任务、查看结果和及时停止；模型执行、仓库和配置保留在电脑上。

### 页面与真实行为

| 页面 | 行为与桌面端边界 |
| --- | --- |
| 首页（浅色 / 深色） | 大标题是当前电脑，点开查看这台电脑（定时任务、后台活动、新任务默认模型）或切换电脑；常驻搜索与项目筛选；按“等你决定 / 进行中 / 最近”分组，工具审批可在首页直接允许或拒绝（经会话页重新校验后提交）；运行时间来自桌面任务时钟，一次网络抖动不判离线 |
| 会话与审批 | 流式内容、历史分页、工具步骤时间线；运行中追加的消息在手机上排队，这一轮顺利结束后自动发送（出错或未确认送达时暂停，停止或离开会话时退回输入框）；允许 / 本会话同类不再询问 / 拒绝并说明；文件修改审批显示差异；审批只发送当前主机、会话和请求 ID |
| 提问 | 单选、多选、自定义答案；桌面提供的 AI 代答倒计时与取消；问题和工具权限使用不同协议 |
| 计划 | 查看完整计划，选择执行权限和当前会话模型；批准后执行，或反馈后继续规划 |
| 新任务 | 目录、分支、工作树、Standard / Lean、权限与模型；等待 WebSocket 同步及运行配置确认后才发送首条任务 |
| 输入与材料 | 图片、相机、文件、电脑已有技能引用、下一条消息的 Teams 设置；听写使用系统键盘；有明确材料大小限制，不静默丢弃 |
| 改动 | 检查点文件差异、代码 / 对话 / 两者回退；可复制、编辑重发、分叉消息，使用服务器实际消息标识 |
| 后台活动 | 真实后台任务及耗时；单项或全部停止；任务由电脑运行，不依赖手机保持前台 |
| 定时任务 | 列表、详情、启停、立即运行、改执行时间与最近结果；按每天 / 工作日和电脑本地时刻新建；“下次运行”按手机时区推算，手机和电脑不在同一时区时可能不准；已有任务内容与高级配置在桌面修改 |
| 你的电脑与扫码 | 多主机独立地址、凭据和草稿；局域网连接与 HTTPS 原生配对；移除前撤销推送登记 |
| 设置 | 通知、勿扰、AI 代答、外观；电脑默认模型在首页“这台电脑”里；API Key、MCP、插件和系统权限留在桌面端 |
| 工作区 | 文件树、文本和差异只读预览，原生保存或分享文件；下载经过带认证的固定主机连接与大小限制 |
| 系统通知与 Live Activity | iOS 原生锁屏 / Dynamic Island，Android 通知；动作进入 App 后重新校验当前审批，过期内容不允许直接批准 |

外观是「值守」设计（`src/ui/palette.ts` + `src/ui/kit.tsx`）：系统字体，命令、路径和计时用 Geist Mono（许可位于 `assets/fonts/OFL.txt`）；颜色只表达状态——琥珀是等你决定、蓝是运行、绿是完成、红是出错，主按钮用墨色，品牌陶土色只出现在标识上。额外的加载、断线、权限未授权、空列表、失败和大字体状态属于运行时必须处理的情况，不能用设计稿样例数据替代。

### 单一移动端实现

移动端只有本目录这一套 Expo 应用：旧的 `mobile/legacy-webview/` Android WebView 壳和它的 `release-mobile-apk.yml` 发版链路已删除，唯一发布链路是根目录 `.github/workflows/release-mobile.yml`（EAS）。桌面服务端托管的 H5（`desktop/dist/m`，路径 `/m/`）是给手机**浏览器**用的同一套界面，不是 APK，也不需要 WebView 壳。

旧壳里值得保留的行为已由原生实现承接，并由 `src/core/mobileParity.test.ts` 与 `plugins/singleMobileApp.test.ts` 固定成回归契约：

| 旧壳行为 | 现在的承接方式 |
| --- | --- |
| 扫描 / 粘贴桌面局域网二维码（`?serverUrl=&h5Token=`） | `src/core/connection.ts#parseConnectionInput` 仍解析同一格式；`src/ui/connect/Scanner.tsx` 用 expo-camera 取帧、本地 ML Kit 解码，不依赖 Google Play 服务 |
| 连接前验证 `/health` 与访问令牌 | `src/core/connectHost.ts` 先 `verify()` / 原生 `pair` + `claim` 批准，凭据才写入 SecureStore；访问校验按认证方式分流，不再单独打 `/health` |
| AndroidKeyStore 加密保存凭据、最近 5 个服务器地址回填 | `expo-secure-store` + AsyncStorage，每台电脑独立元数据与版本迁移，`hosts` 页可保存任意多台 |
| 断开 / 切换时清除凭据与会话 | 移除电脑先撤销通知登记再清理凭据；原生应用没有 WebView，自然无 Cookie / WebStorage 残留 |
| WebSocket 权限审批（`permission_request` / `permission_response`） | `src/core/chatActions.ts` 与原生审批界面；通知动作重新校验后才提交 |
| 同源校验、限制跳转到别的 origin | `normalizeHostUrl` 只收纯净 http(s) 主机地址；`plugins/withPinnedWebSockets.js` 关闭重定向 |
| 网页文件上传 | `expo-document-picker` / `expo-image-picker` 选取材料，工作区文件走带认证、带大小限制的原生下载与分享 |
| 旧 Android 壳的 `codemobile://` 深链接 | 当前 Expo 应用同样注册 `codemobile`；Android / iOS 包身份统一为 `com.echoflow.code.mobile` |

这里的「scheme 沿用」只针对旧 Android 壳。旧 Expo 应用使用的是 `cchaha`，Android package 为 `app.cchaha.mobile`、iOS Bundle ID 为 `com.yunce.cchaha.mobile`；不能将两条历史混为同一次原地升级。当前应用仅注册 `codemobile`，不会认领旧 Expo 的 `cchaha` 链接。新包身份不自动继承旧 App 沙箱：请在新 App 重新连接 / 扫码配对，并重新授权通知、登记推送和 Live Activity；不承诺跨沙箱自动搬迁凭据。详见 [发布与迁移边界](#旧安装与新包的迁移边界)。

有意不迁移的旧做法：WebView 容器（新应用是纯原生 UI）、依赖 Google Play 服务的 Google Code Scanner（`plugins/cameraBarcodeAvailability.test.ts` 固化本地解码这一点）、把令牌放进 URL 查询串（现在原生请求走 `Authorization` 头）、以及旧品牌蓝色图标与脚手架占位资源。新应用另外提供旧壳没有的系统推送、Android 前台值守服务、iOS Live Activity、原生文件 / 图片 / 语音、定时任务与工作区等能力。

### 运行与构建

正式 CI 签名、随 Release 发布 APK / TestFlight、独立版本号及失败重试，见 [移动端发布](#mobile-release)。

以下命令在 `mobile/` 执行。需要 Bun、Node；iOS 需要 Xcode / CocoaPods，Android 需要 JDK / Android SDK。

```sh
bun install --frozen-lockfile
bun run ios
# 或
bun run android
```

原生目录由 Expo 根据 `app.json`、`app.config.ts` 和配置插件生成，禁止手工维护生成的 `ios/`、`android/`。原生依赖或配置变化后需要重新构建。

Android 必须使用独立构建：`plugins/withPinnedWebSockets.js` 关闭 WebSocket 的自动跨地址重定向；Expo Go 不具备该保护，代码会阻止其连接。网页 `bun run web` 仅用于布局和协议检查，凭据仅保存在页面内存；刷新后需重新连接，不能替代原生验收。

同一套界面也是手机浏览器的 H5：桌面 `bun run build` 调用 `bun run export:h5`，以 `EXPO_PUBLIC_CC_HAHA_H5=1` 导出到 `desktop/dist/m`，由桌面服务端托管在 `/m/`。H5 只连接托管它的电脑（`src/state/h5.ts`），沿用桌面 H5 入口验证过的令牌或远程设备 Cookie；扫码、多台电脑、推送和锁屏实时活动不进入 H5，文件改为浏览器下载。expo-router 在子路径下会把 `/member`、`/models` 误剥成 `/ember`、`/odels`，`patches/expo-router@58.0.25.patch` 修正了这一点；升级 expo-router 时用 `src/core/h5BasePath.test.ts` 确认是否还需要它。

Release 模拟器构建可运行 `bunx expo run:ios --configuration Release`。直接调用 `xcodebuild` 时应保留正常的模拟器代码签名；完全关闭签名会使 SecureStore / Keychain 不能保存连接凭据。模拟器 `.app` 不能作为手机 IPA 安装。

Android 本地测试包：

```sh
bunx expo prebuild --platform android --no-install
./android/gradlew -p android :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m' \
  --max-workers=4
```

上述 JVM 参数已用于本地成功构建，避免新增原生模块使默认 512 MiB Metaspace 不足。仅应用界面或业务逻辑改动、原生依赖与配置不变时，可直接增量执行 Gradle，无须再次 prebuild。本地 release 默认仍使用测试 keystore。正式商店签名、商店提交、EAS 发布与生产凭据不是本地构建的一部分。

### 连接电脑

局域网：电脑启用「手机连接」，手机扫描连接二维码，或输入电脑可达的 `http://局域网IP:端口` 和访问令牌。实体手机的 `127.0.0.1` 指向手机自身；同机 iOS 模拟器可访问 Mac 的回环地址。

外网：在桌面「设置 → 手机连接 → 外出连接」选择 **Cloudflare 快速连接**，开启连接后用手机扫码，再在电脑上批准。无需额外安装组网 App、注册账号或购买域名。桌面使用已打包的连接程序，连接过程遵循「设置 → 通用 → 网络代理」。手机网络仍需能够访问公网地址。

快速连接使用临时的 `https://随机名称.trycloudflare.com` 地址，重新建立隧道后地址会变，需要重新扫码。希望重启后仍使用同一地址时，可选择 **固定域名**：在 Cloudflare 创建隧道，将 Published application 的 Service URL 指向桌面显示的**独立受限网关**（默认 `http://127.0.0.1:17463`），填写固定 HTTPS 地址和 Tunnel Token 后开启连接。不要映射桌面主服务端口。

电脑会确认公网地址确实到达当前网关后再显示二维码。用蜂窝网络扫描 / 粘贴 `https://host/remote#pair=一次性码`，随后在电脑批准手机。旧远程配置不会自动启动，需要重新开启 Cloudflare 并配对。快速与固定连接的完整步骤、网络代理和故障定位见 [手机远程连接说明](../desktop/remote.md)。Quick Tunnel 适合临时使用，不保证持续可用；国内运营商和蜂窝网络需要实际验证。

后端必须包含本次原生配对协议：`pair` 带 `clientType: native`；`claim` 返回 `native_` Bearer 凭据、设备 ID 和真实期限。后续请求及 WebSocket 在固定 origin 上发送凭据，拒绝公开 HTTP、重定向和 URL 查询 token。浏览器继续使用独立 Cookie 配对流程；电脑撤销授权后手机必须重新配对。

每台电脑独立保存元数据（AsyncStorage）与连接凭据（SecureStore）。手机设置有版本迁移；不能读取的未来版本不会被覆盖。远程 HTTPS 地址保持不变时，临时断线或网关重启后使用原凭据重连并同步历史和运行状态，结果不确定的消息不自动重发；确认凭据失效才要求重新配对。远程设备凭据有效 30 天，当前不自动续期。电脑休眠或退出时 App 不能代替电脑执行任务，也不提供远程唤醒；桌面启动后恢复远程入口仍需用户主动开启对应选项。快速连接重建后要重新扫码；固定域名恢复后可继续使用已保存的连接。

移除电脑只取决于手机本身：先请电脑撤销已登记的通知和 Live Activity（只试一次，最多等 3 秒），再清理手机上的连接和凭据。电脑休眠、换了地址、拒绝凭据或没有回应，都不会拦住移除；没送达的登记留在电脑上，最长 30 天后失效；远程连接的手机在桌面撤销授权时也会一并清掉。电脑会话不会被删除。

### 定时任务

从电脑页面进入「定时任务」可直接创建和修改计划，与桌面共用 `schedule`（单次或 Cron、明确时区）和 `execution`（新建或已有会话）契约。支持每天、工作日、指定星期、每月、分钟/小时间隔和自定义五段 Cron。

常用场景可点「30 分钟后」「明早 9 点」「工作日 9 点」，名称留空时由执行内容生成；项目默认显示最近使用的目录，可在创建前更换。模型、已有会话、工作树和通知在「执行设置」中展开。已有会话沿用其模型、目录与权限；新建会话使用表单显示的模型和目录无人值守执行。电脑需要保持运行。

旧任务直接打开再保存不会改变电脑本地时区、重复规则或调度起点；修改时带修订号，其他设备已修改时需要重新读取。单次任务及其时区会在列表中显示，下次执行时间优先使用电脑返回的结果。

### 通知配置

详见 [PUSH_NOTIFICATIONS.md](#mobile-push)。前台本地提醒、系统通知授权和后台远程推送是不同路径。没有 APNs / FCM 配置时，设置页会明确提示，不能据此声称后台远程投递成功。

- iOS：构建包含通知与 ActivityKit entitlement，桌面端显式配置 APNs 密钥、Team ID、Key ID、topic 及环境。私钥不进入手机或仓库。
- Android：构建前设置 `CC_HAHA_GOOGLE_SERVICES_FILE=/绝对路径/google-services.json`，文件必须含 `com.echoflow.code.mobile` 的 Firebase 客户端；重新 prebuild / 构建。桌面另需 FCM 服务账户。这两个 JSON 用途不同，不能互相代替。参见 [Expo 官方配置说明](https://docs.expo.dev/push-notifications/fcm-credentials/)。
- 服务端登记按设备权限、偏好、勿扰时段与期限校验；令牌加密保存。推送不携带模型密钥。通知按钮会重新验证审批，AskUserQuestion 和计划不能被普通「允许」动作替代。

### 验证

```sh
bun run typecheck
bun run lint
bun run test
bun scripts/fixture-server.ts --self-test
bun test scripts/design-fixture.test.ts
bun run export
```

测试使用假凭据、内存、临时 HOME 和回环服务，不读写开发者真实 `~/.claude`、Keychain 或模型。根目录的 `bun run verify` 和 `bun run check:persistence-upgrade` 覆盖服务器及持久化边界。静态 export 只产生 JavaScript 与资源，不是 APK / IPA。

设计验收服务：

```sh
bun scripts/design-fixture.ts --port=3467 --second-port=3468
```

同机模拟器连接 `http://127.0.0.1:3467` 或 `:3468`，测试 token 为 `mobile-fixture`。六条设计会话支持审批、问答、计划、材料、差异、回退、后台停止、定时任务和主机隔离。数据只在内存中，**没有模型、命令执行或真实文件修改**。测试专用场景切换见 `scripts/design-fixture.ts`，这些接口不进入生产服务器。

真实模型验证须另获维护者授权，在独立桌面配置和临时工作区运行。UI Fixture、真实协议、打包构建、模拟器触屏及远程推送投递应分别记录证据，任何一种都不能替代其他验证。

2026-10-24 的验证记录：移动端单元与协议测试 261 项通过，typecheck / lint 通过；根目录 `bun run verify` 的 8 个选中检查通过，5 个检查按影响范围跳过。iOS、Android Release 包及独立 iPhone 开发签名包已构建并校验，Android 已安装到专用模拟器，实际相机扫码能够解析桌面连接凭据。

真实模型验证使用两份独立桌面配置和 `/tmp` 工作区，由 iOS App 驱动 DeepSeek Flash 多轮编写、修改和执行票据 API / CLI 与日志聚合 CLI。独立黑盒检查最终分别通过 37 项、18 项及 13 项；日志 CLI 首轮发现的服务名排序错误已由真实模型修复并复测。实际文件下载、系统保存、重新附加和模型读取的内容哈希一致。Sandbox APNs 已经 Apple 实投到 iOS 模拟器，通知点击进入对应会话和待审批请求。

以上记录不表示全部原生验收完成：最终 Android 包的新任务模型请求、单个「完成」按钮保存思考强度、最终后台活动页输出与停止操作仍需继续验收；Live Activity 锁屏外观尚无充分视觉证据。Android FCM 缺少客户端及服务端配置，尚未实投；最新 iPhone 包的真机验收由用户另行完成。

<a id="mobile-release"></a>

## 移动端发布

移动端使用独立的用户版本号。桌面 Release 继续使用 `vX.Y.Z`，只改桌面时不用升级移动端；发布说明应链接现有移动版本。iOS 自动交付到 App Store Connect / TestFlight，正式 App Store 审核与上架另行处理；Android 发布正式签名 APK，不提交 Google Play。

### 项目标识（由账号持有人在 CI 配置）

- Expo owner / Project ID / App Store Connect App ID：由 CI 变量 `EXPO_OWNER`、`EXPO_PROJECT_ID`、`ASC_APP_ID` 注入，仓库内不登记账号标识。
- iOS Bundle ID：`com.echoflow.code.mobile`
- iOS Widget：`com.echoflow.code.mobile.widgets`
- App Group：`group.com.echoflow.code.mobile`
- Android package：`com.echoflow.code.mobile`

项目标识可公开，凭据不能提交。EAS 管理生产签名凭据；保管并备份 Android keystore，后续升级必须保持签名身份。

#### 旧安装与新包的迁移边界

旧 Android WebView 壳已使用 `codemobile`，当前 Expo 应用沿用这一 scheme；旧 Expo 应用则使用 `cchaha`，Android package 为 `app.cchaha.mobile`，iOS Bundle ID 为 `com.yunce.cchaha.mobile`。当前两个平台均为 `com.echoflow.code.mobile`，只注册 `codemobile`，不注册旧 `cchaha` scheme，也不接管旧 App 的链接。

scheme 相同不代表安装身份或沙箱相同。新身份的包不能视为旧包的原地升级，不自动继承旧沙箱的连接凭据、通知 token 或 Live Activity 登记。用户需在新 App 重新连接 / 扫码配对，并重新授权通知、登记推送和 Live Activity；不承诺跨 App、跨沙箱自动迁移凭据。发布验收须分别记录 Android 会话通知正文 / 允许 / 拒绝点击，以及 iOS 本地卡片、远端更新后的按钮和整体点击；远端 content-state 的 URL 正确并不证明原生卡片创建时的整体链接已被更新；离线契约测试或 H5 导出不能替代原生点击验收。

### 一次性账号设置

本节是 iOS + Android 全量配置。**只发 Android 时见下一节**：步骤 1、2、4 以及 `ASC_APP_ID`、Apple Developer 协议、App Store Connect 应用、iOS 描述文件、APNs Push Key、ASC API Key、Widget 与 App Group 注册都可以跳过。

1. 账户持有人在 Apple Developer / App Store Connect 接受当前协议，在 App Store Connect 创建上述 Bundle ID 的应用。
2. 注册主 App、Widget 和 App Group，配置通知等实际使用的 capabilities，为主 App 和扩展分别准备 App Store 分发描述文件。
3. 在 `mobile/` 使用 `bunx eas-cli@25.3.0 credentials:configure-build --platform ios --profile production` 配置签名；Android 将 `ios` 改为 `android`。这会访问真实账号，不属于离线测试。
4. 通过 `bunx eas-cli@25.3.0 credentials --platform ios` 配置 EAS Submit 使用的 App Store Connect API Key。它与 APNs 推送密钥不同。
5. GitHub Actions Secrets 配置 `EXPO_TOKEN`，推荐专用发布机器人。Variables 配置 `EXPO_PROJECT_ID`、`EXPO_OWNER` 和数字形式的 `ASC_APP_ID`。
6. 首次构建和交付确认可用后，设置 GitHub variable `MOBILE_RELEASE_ENABLED=true`，启用随桌面正式 Release 自动交付。此前桌面发布不会被未完成的移动端账号设置影响。

仓库根目录 `.easignore` 保留移动端及共享源码，排除 Git 对象、其他产品目录、生成的原生工程和签名文件；EAS 会从 Expo 配置重新生成原生工程。

`eas.json` 固定 EAS CLI 版本，使用 `production` 环境、远程签名凭据、自动递增构建号，Android 产物明确设为 APK。不要使用本地默认 debug keystore 作为公开分发签名。

Android FCM 如果需要启用，在 EAS production 环境设置文件变量 `CC_HAHA_GOOGLE_SERVICES_FILE`，内容是匹配 `com.echoflow.code.mobile` 的 Firebase Android 客户端 JSON。服务账户私钥不能放进应用。可选：Android 默认走手机拉取，不需要 FCM。详见 [推送说明](#mobile-push)。

### 只发 Android 的最小配置

首发建议只交付 Android。需要满足：

- 一个**已公开发布**的桌面正式 Release tag（`vX.Y.Z`）。该 tag 必须包含 `release-mobile.yml`、`scripts/mobile-release.ts`、`mobile/eas.json`、`mobile/app.config.ts`；CI 按 tag 检出代码，工作区未提交的改动不会生效。
- GitHub Secret `EXPO_TOKEN`（建议专用发布机器人），GitHub Variables `EXPO_PROJECT_ID`（EAS 项目 UUID）和 `EXPO_OWNER`。
- 在 `mobile/` 执行 `bunx eas-cli@25.3.0 credentials:configure-build --platform android --profile production` 配置并备份 Android keystore。`eas.json` 的 `cli.appVersionSource: "remote"` 与 `autoIncrement: true` 由 EAS 管理构建号，首次需要初始化。
- Android FCM 可选：不配 `CC_HAHA_GOOGLE_SERVICES_FILE` 时默认走手机拉取，不影响交付。
- **不需要**：`ASC_APP_ID`、Apple Developer 协议与账号、App Store Connect 应用、iOS 描述文件、APNs Push Key、EAS Submit 的 ASC API Key、TestFlight。

两种设置方式：

1. **手动（推荐首发）**：不设 `MOBILE_RELEASE_ENABLED`。GitHub Actions → `Release Mobile` → `Run workflow`，填 `release_tag=vX.Y.Z`、`platform=android`；先用默认 `dry_run=true` 看计划，确认后改成 `false` 真正交付。
2. **自动化**：先设 GitHub variable `MOBILE_RELEASE_PLATFORM=android`，再设 `MOBILE_RELEASE_ENABLED=true`。桌面正式 Release 完成后只会走 Android 分支；手动触发时传入 `platform` 仍可覆盖该变量。

产物是正式签名 APK（`eas.json` 的 `production.android.buildType: "apk"`），不提交 Google Play。上传前用 apksigner 校验安装包结构与签名并拒绝默认 debug keystore；成功后在 Release 附件写入 `mobile-release-android.json`（源码提交、输入摘要、移动版本、EAS build ID、APK 名与 SHA-256）。

### 凭据获取与 GitHub 配置

- **`EXPO_TOKEN`**：CI 里 EAS CLI 不做交互式 `eas login`，只认 `EXPO_TOKEN` 环境变量。登录 Expo 账号后打开 `https://expo.dev/settings/access-tokens`，点 **Create token** 生成并复制（只显示一次）。生产建议使用 **robot user**：在账号或组织里建一个非交互成员、授予 Developer 或更高角色，再为它单独建 token —— 权限可收敛、可单独吊销，也不会随个人账号变动失效。
- **`EXPO_PROJECT_ID`**：EAS 项目的 UUID。可在 expo.dev 项目页看到，或在 `mobile/` 执行 `bunx eas-cli@25.3.0 project:info` 读取；首次可用 `eas init` 关联项目。仓库故意不把账号标识写进 `app.json`，`app.config.ts#withEasProject` 会在构建时校验 UUID 格式并注入 `extra.eas.projectId`。
- **`EXPO_OWNER`**：拥有该项目的 Expo 账号名或组织 slug，与 `EXPO_PROJECT_ID` 同属公开标识。
- **GitHub 配置位置**：仓库 → Settings → Secrets and variables → Actions。Secret 用 **New repository secret** 建 `EXPO_TOKEN`；Variables 标签用 **New repository variable** 建 `EXPO_PROJECT_ID`、`EXPO_OWNER`，以及按需的 `MOBILE_RELEASE_PLATFORM`、`MOBILE_RELEASE_ENABLED`。也可用 `gh secret set EXPO_TOKEN` 与 `gh variable set <NAME>`。
- **Android keystore**：在 `mobile/` 执行 `bunx eas-cli@25.3.0 credentials:configure-build --platform android --profile production`，按提示让 EAS 生成或上传现有 keystore，并**离线备份**；后续升级必须保持同一签名身份。`eas.json` 的 `cli.appVersionSource: "remote"` 与 `autoIncrement: true` 由 EAS 管理构建号，首次需要初始化。

### 桌面发版与手机包的关系

移动端使用独立的用户版本号，只由 `scripts/release.ts --mobile` 显式递增；release-please 不再同步 `mobile/package.json` 和 `mobile/app.json`。这两个文件是移动端交付指纹的一部分，若每次桌面发版都改版本号，指纹必然变化，会导致每个桌面版本都重新构建手机包。

桌面专用改动（移动端未 import 的共享文件）、测试、文档和生成文件不触发新包。`scripts/mobile-release.ts` 对比该平台**上一次成功交付**的输入摘要：摘要不变时 Android 把上次 APK 挂到新 Release（不重新构建），iOS 直接跳过；摘要变了但移动版本没递增会阻止发布，提示先 bump 版本。

### 日常发版

在根目录准备 release notes 后，沿用现有 release PR 流程：

```sh
# 桌面更新，移动端保持原版本
bun run scripts/release.ts patch --dry

# 同时升级移动端版本；先预览，再移除 --dry 执行
bun run scripts/release.ts patch --mobile patch --dry
```

移动端的 `mobile/app.json#expo.version` 和 `mobile/package.json#version` 必须一致。Release 脚本只在显式传入 `--mobile` 时更新这两个文件。生产代码变化而用户版本未升级会阻止移动端交付，提示先补版本；不会影响已经发布的桌面产物。

移动端调用由 `Release Desktop` 在正式发布完成后显式执行，不依赖 `release.published` 事件。GitHub Token 产生的 Release 事件不能用来可靠触发另一条工作流。

每个平台在 Release 附件中保存 `mobile-release-ios.json` 或 `mobile-release-android.json`。它们记录该平台成功交付的源码提交、构建输入摘要、移动版本和 EAS build ID；安卓另含 APK 名称及 SHA-256。iOS 成功仅代表上传完成，不代表苹果审核通过。

判定覆盖移动端代码、插件、依赖、资源、构建配置，以及移动端实际导入的共享源码和运行时传递依赖（不沿仅类型导入扩展）；未被移动端使用的共享文件不会触发移动发布。测试、文档和生成文件不触发新包。无法解析的本地运行时依赖会阻止发布，避免误判为无需更新。它对比该平台上一次成功交付，而不是上一个桌面标签，所以之前失败的交付不会被漏过。没有历史记录时执行首发。

### 失败重试与只读预览

GitHub Actions → `Release Mobile` → `Run workflow`：

- `release_tag`：包含这套发布代码的、已经公开发布的稳定标签，例如 `v1.2.3`。工作流检出标签对应提交，不构建当前默认分支。
- `platform`：`ios`、`android` 或 `all`。
- `dry_run`：默认开启，仅分析，不构建、上传或消耗 EAS 构建配额。真正交付时关闭。

已成功的平台会跳过。构建已成功但交付失败时优先复用同一提交、版本和输入摘要的 EAS build；正在进行中的同一构建不会重复启动。Apple 上传成功而 GitHub 成功记录写入失败时，重试会先检查该 build 的提交结果。仅在上传/发布完成后写成功记录，不能手工伪造记录来消除失败。

自动上传和手动重试共享串行锁，不取消正在进行的商店上传。安卓 APK 在附加到 Release 前验证安装包结构与签名，拒绝默认 Android Debug 签名。

### 首次 App Store 提审

准备真实截图、描述、支持网址、移动端隐私政策与隐私披露、年龄分级、出口合规和目标地区所需资料。当前支持 iPad，需包含相应验收和展示。

该 App 依赖桌面配对，审核说明需要提供可实际访问的隔离测试环境与操作步骤。内部 fixture 服务不是已经可用的正式审核入口。TestFlight 真机验证通过后，再选择构建提交 App Review；CI 上传成功不能替代此步骤。

后台推送不需要桌面配置凭据：iOS 经 Expo 推送服务中转（需要在 EAS 项目凭据里配好 APNs Push Key，并保持 Enhanced Push Security 关闭），Android 由 App 的前台服务直接向已配对电脑拉取。不可把开发者私钥打包进桌面端或移动端。详见 [推送说明](#mobile-push)。

### 确定性检查

```sh
bun run check:mobile
bun test scripts/mobile-release.test.ts scripts/release.test.ts
bun run check:policy
bun run check:impact
```

完整验证使用 `bun run verify`。移动端检查隔离 HOME、关闭 Expo 网络与遥测，不使用生产凭据。EAS 构建、TestFlight 真机体验及实际推送属于另外记录的线上证据。

<a id="mobile-push"></a>

## 系统推送与实时活动

手机前台连接和系统推送是两条独立链路。电脑定期读取真实运行状态：进入等待时提醒审批、问答或计划；收到新的持久化成功结果时提醒完成；从运行转为失败时提醒错误。停止、离线和未知状态不会当作成功，初次发现的历史成功只建立基线。成功投递后同一状态不会重复发送。暂时失败最多尝试 3 次（间隔 5 秒、10 秒），每次重新检查当前状态与设备授权；已失效的审批不会重放。运行中超过 5 分钟没有进展时，错误偏好可触发一次提醒，等待用户批准不算无进展。初次发现历史失败或空闲状态不会伪造新通知。

### 三条投递通道

普通用户的电脑没有发布者的 APNs / FCM 私钥，也不应该有。所以推送按手机登记时选的 `provider` 分三条路，手机根据 `GET` 返回的能力自己选：

| 通道 | `provider` | 谁持有凭据 | 适用 |
| --- | --- | --- | --- |
| Expo 中转 | `expo` | Expo 推送服务（EAS 项目里上传的 APNs Key） | iOS（TestFlight / App Store），电脑零配置 |
| 手机拉取 | `desktop` | 不需要凭据：手机的前台服务长轮询这台电脑 | Android，任何品牌，不依赖 Google 服务、不需要上架 |
| 电脑直连 | 缺省 | 这台电脑自己的 APNs / FCM 环境变量 | 发布者自己的电脑；实时活动只走这条 |

选择规则（`mobile/src/state/pushProvider.ts`）：Android 有 `desktop` 就用 `desktop`；否则电脑自己配了该平台凭据就直连；iOS 再退到 `expo`。旧电脑不返回 `providers`，手机按原来的直连流程登记，不发送 `provider` 字段。

**Expo 中转的前提**（发布者一次性操作，不在仓库里）：在 expo.dev 的项目凭据里为 `com.echoflow.code.mobile` 配好 APNs Push Key（`bunx eas-cli credentials --platform ios`），并保持 Expo 的 Enhanced Push Security 关闭——开启后发送需要 Expo access token，而这个 token 不能放进分发给用户的电脑。关闭时，持有手机 Expo token 的人都能给这台手机发通知；token 只登记在已配对的电脑上，且加密保存。电脑把通知发往 `https://exp.host/--/api/v2/push/send`（走 EchoFlow Code 网络设置里的代理），通知标题和正文会经过 Expo 和 Apple；不想让命令原文经过第三方的用户可以关掉「锁屏上显示命令」。Expo 只回执 `DeviceNotRegistered` 时电脑删除登记，其余错误按投递失败重试；最近一次 Expo 发送失败的原因通过 `GET` 的 `relayErrors.expo` 告诉手机，下一次发送成功后清除，手机设置页据此显示「推送发送失败」并提示配置网络代理。电脑的推送轮询分两条互不等待的通道：手机拉取只是入队，Expo / APNs / FCM 要等网络（连不上时每次最多 15 秒），所以中转卡住不会拖慢安卓的提醒。

**手机拉取**：Android 对每台电脑生成一个随机拉取 token（32 字节，存 SecureStore；一台电脑只知道自己的那个，移除电脑时删除）。App 每次登记成功后把这台电脑的地址、认证头和 token 单独交给本地模块 `mobile/modules/cchaha-duty` 的前台服务（类型 `specialUse`，通知栏常驻「正在值守」）；服务自己保存电脑列表，App 只增删单台电脑，所以启动时暂时连不上的电脑不会被挤出列表。服务对每台电脑循环 `POST /api/sessions/mobile-push/pull`，电脑最多挂起 25 秒，有通知立即返回；手机按 id 去重并在下一次请求里 `ack`，电脑删除已确认的条目，未确认的保留 10 分钟、每个 token 最多 32 条。耗电上，服务只在被唤醒（回复到达、重试到期、放弃半开连接）到下一次拉取发出之间持有唤醒锁，拉取挂在电脑上时靠电脑的回复唤醒手机。连接失败按 2 秒起倍增、最长 30 秒重试；一台电脑连续 5 分钟连不上（换了网络、电脑合盖）后改为每 5 分钟试一次，打开 App 或网络变化时立即重连。线程计时在 CPU 休眠时不走，所以服务另有一个约每分钟的系统闹钟（`setAndAllowWhileIdle`，Doze 下会被拉长）：只处理已到期的重试和超过 40 秒没有回音的半开连接，其余时候不持锁。配置用 Android Keystore 加密保存，开机和 App 更新后自动恢复。只有电脑本身的两种回答会让服务停止拉取这台电脑：401（配对凭据被拒）和 404 `NO_REGISTRATION`（电脑没有这台手机的登记），直到 App 重新登记；隧道、代理返回的 403/5xx 都按网络错误重试。国产 ROM 仍可能清理后台：设置页会引导「允许后台运行」（电池优化豁免）和到应用设置里打开自启动。

### 电脑配置

没有任何配置时，新版电脑通过 Expo 中转和手机拉取即可推送；`platforms` 只表示这台电脑自己的 APNs / FCM 凭据。旧版电脑没有凭据时接口返回 `notConfigured`，手机显示「电脑未配置系统推送」，不影响聊天、手动刷新和前台提醒。

iOS 直连需要与已安装 App 的 bundle ID 和签名环境对应的 APNs 配置。仅从明确设置的环境变量读取；不会扫描钥匙串或开发者目录。

```sh
CC_HAHA_APNS_KEY_PATH=/absolute/path/AuthKey.p8
CC_HAHA_APNS_KEY_ID=YOUR_KEY_ID
CC_HAHA_APNS_TEAM_ID=YOUR_TEAM_ID
CC_HAHA_APNS_TOPIC=com.echoflow.code.mobile
CC_HAHA_APNS_SANDBOX=false
```

`SANDBOX=true` 用于开发 APNs 环境，Ad Hoc / TestFlight / 正式分发通常使用生产环境。应以实际签名 entitlement 为准，不能用手机型号判断。普通通知使用 bundle topic；实时活动自动使用 `.push-type.liveactivity` 后缀。实时活动需要用户允许、系统支持及具备正确 entitlement 的原生构建。

Android 使用 `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json`。当前支持显式 service-account ADC 文件；不自动读取 gcloud 用户登录或云机器元数据。手机必须配置属于同一 Firebase 项目的原生 FCM 文件并获得设备 token。通知 channel 默认为 `cc-haha`；登记带 `delivery.channels: 'split'` 时按事件使用 `cc-haha-decisions` / `cc-haha-completed` / `cc-haha-errors`。没有这部分配置不能宣称后台推送可用。

电脑必须保持运行且可连接 Apple / Google。系统免打扰、设备网络、通知权限和系统节流仍会影响展示；接口的 `configured` 仅表明已配置文件，不能证明真机已收到。投递失败显示不含凭据的诊断，APNs / FCM 报废的 token 会移除。

### 手机 API

所有请求复用当前主机的 LAN 或远程配对认证。不能在请求中提交 owner/device ID；远程设备归属来自服务端验证的配对凭据。

- `GET /api/sessions/mobile-push` → `{ platforms: { ios, android }, providers: { expo, desktop }, status: 'configured' | 'notConfigured', error?, relayErrors?: { expo } }`。`platforms` 是电脑直连凭据，`providers` 是无需凭据的通道；旧电脑没有 `providers`。不列出设备或 token。
- `POST /api/sessions/mobile-push/pull`，body `{ token: pullToken, ack?: lastNotificationId }` → `{ notifications: [{ id, title, body, data, category, channelId }] }`；没有新通知时最多挂起 25 秒后返回空数组。只有已用 `provider: 'desktop'` 登记该 token 的调用者（LAN 为 token 归属，远程为已验证的配对设备）能读取，否则 404 `NO_REGISTRATION`。此路由不计入慢请求诊断。
- `PUT /api/sessions/mobile-push` → `{ registered, status: 'registered' | 'notConfigured', id?, expiresAt? }`。
- `DELETE /api/sessions/mobile-push`，body `{ token: ordinaryDevicePushToken, hostId }` → `{ removed: number }`，幂等删除本手机在此主机的普通通知和关联的实时活动。未配置 provider 时也能删除旧登记。
- `DELETE /api/sessions/mobile-push/:id`，body `{ token }` 保留单项注销；不匹配返回 404。
- `POST /api/sessions/mobile-push/test`，body `{ token: ordinaryDevicePushToken, hostId?: string }` → `{ status: 'sent' | 'notConfigured' | 'noRegistration' | 'failed', error? }`。只匹配当前调用者（LAN 为该 token 的归属，远程为已验证的配对设备）自己的普通通知登记，不接受 owner/device ID；`hostId` 给出时只发该主机的登记。发送标题“测试通知 · cc-haha”、正文“电脑推送正常：这条是电脑发给你手机的。”，APNs category 为 `cchahaResult`，data 为 `{ hostId, eventType: 'test' }`（没有 sessionId）。这是用户主动测试，不受通知类别偏好和免打扰限制。测试是为了看到横幅：Android 在拆分渠道下使用高重要程度的 `cc-haha-decisions`（「任务完成」渠道是默认重要程度，只响铃不弹横幅），手机在 App 前台时也照常弹出测试通知（其余提醒在前台只进通知栏）。`notConfigured` 表示电脑没有该平台的 APNs / FCM 配置，`noRegistration` 表示没有匹配登记，`failed` 的 `error` 不含 token 或凭据。

普通注册 body：

```ts
{
  platform: 'ios' | 'android',
  provider?: 'expo' | 'desktop',  // 缺省：电脑直连；只在电脑的 providers 列出时发送
  token: nativeDevicePushToken,   // expo：ExponentPushToken[…]；desktop：手机的拉取 token（43+ 位 base64url，仅 Android）
  hostId: phoneLocalHostId,
  hostName: optionalDisplayName,
  kind: 'notification',
  preferences: { decisions: true, completed: true, errors: true },
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  timeZone: 'Asia/Shanghai'
}
```

可选的 `delivery`（普通通知和实时活动登记都可携带，缺省即旧行为）：

```ts
delivery?: {
  channels?: 'split',                       // Android：按事件拆分通知渠道
  timeSensitive?: boolean,                  // iOS：决定类推送使用时间敏感级别
  liveActivity?: 'running' | 'decisions',   // 实时活动远程更新范围
  showCommand?: boolean                     // false：实时活动不携带原始命令 / 预览
}
```

- 各字段类型严格校验，未知字段被拒绝；随登记保存，再次注册会整体替换（不带 `delivery` 的注册会清除旧值）。旧数据没有该字段也能原样加载。
- `channels: 'split'`：FCM `channel_id` 按事件选择，等待审批 / 问答 / 计划为 `cc-haha-decisions`，完成为 `cc-haha-completed`，失败和无进展为 `cc-haha-errors`；否则一律 `cc-haha`。手机需要自己创建这三个渠道。
- `timeSensitive: true`：决定类推送的 aps 带 `"interruption-level": "time-sensitive"`，其他类型保持默认 `active`。
- `liveActivity: 'decisions'`：只在等待决定时远程更新实时活动；运行中状态不发 `update`，而是对仅在运行的活动发送 `end` 并移除登记，避免远程推送把它重新唤起。缺省或 `'running'` 保持原样。
- `showCommand: false`：实时活动 `detail` 不含原始命令 / 预览：等待中的 Bash 为“打开 App 查看命令”，其他等待为“需要你做决定”，运行中为空，结束为“本次运行已结束”。

`hostId` 仅用于返回手机后的主机导航，不能建立或改变授权。客户端需要安全保存注册 ID 及原 token，以便重启后、移除主机时或 token 轮换时撤销旧登记。因关闭通知权限等原因撤销时，离线注销不能表示成功，应保留待注销记录以重试；移除电脑是例外：连不上电脑也必须能移除，所以只尝试撤销一次（最多等 3 秒），失败不拦移除也不再重试——连接凭据随移除一起删除，没送达的登记留在电脑上等它过期或撤销配对。注册有效期为 30 天，不超过远程配对的实际期限；实时活动登记最多 8 小时。

Live Activity 只走电脑直连（Expo 中转不支持 ActivityKit 推送），登记不能带 `provider`。Live Activity 增加 `{ kind: 'liveActivity', sessionId, activityId, name: 'CCHahaTaskActivity', deviceToken: ordinaryDevicePushToken }`，`token` 使用 ActivityKit 的专用推送 token；`deviceToken` 只保存摘要，用于关联普通设备登记和整机注销。服务端发送 `aps.event=update/end`、`timestamp`、`stale-date`，以及 `content-state: { name, props: JSON.stringify(props) }`。持续运行或等待中的活动每 60 秒刷新一次，stale-date 延长到本次投递后 90 秒；电脑离线时不会继续伪造新鲜状态。真实会话结束后会发送 end 并移除登记。客户端仍应在本地结束活动时撤销注册。

普通通知 data 为 `{ hostId, sessionId, requestId?, eventType }`。APNs category 为 `cchahaTool`、`cchahaDecision` 或 `cchahaResult`。只有普通工具权限提供允许/拒绝动作（手机拉取通道由前台服务发出同样的两个按钮，点按后打开 App）；问答、计划和 Computer Use 必须打开 App 处理。动作到达 App 后必须再次核对原主机、原会话及仍待处理的 request ID；推送本身不批准权限。

### 持久化与撤销

配置目录的 `cc-haha/mobile-push.json` 保存 token 摘要、设备归属、偏好和 AES-GCM 密文；相邻 `.key` 文件为随机本地加密密钥。两者权限为 0600。未注册时不会创建文件。空 v0 数据迁移为 v1，未知扩展字段保留，未来 schema 拒绝写入。不要把这些文件加入 Git 或同步到公共存储。

撤销配对、配对到期后，服务端删除该远程设备的登记。远程入口暂时关闭（包括 cloudflared 重连时监听短暂停止）期间只暂停投递、保留登记，入口恢复后补发仍成立的状态；这样隧道每次重连都不会要求所有手机重新登记。迁移或关闭服务时停止轮询并等待在途工作，避免迁移过程中写回数据。

参考：[Apple APNs token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)、[ActivityKit push updates](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications)、[FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api)。

<a id="mobile-fixture"></a>

## 移动端本地协议 Fixture

这是供 App 界面验收使用的**模拟服务**，不是 cc-haha 后端或中继服务器。所有会话、供应商、文件内容和回复只保存在进程内存中；重启即重置。它不读取 `~/.claude`，不持有真实凭据，不调用模型，不执行 shell，也不创建或修改电脑文件。

### 启动和连接

在仓库的 `mobile/` 目录运行：

```sh
bun scripts/fixture-server.ts --port=3457
```

在 App 的局域网添加主机界面填写：

| 字段 | 测试值 |
| --- | --- |
| 名称 | 本地 Fixture |
| 地址 | `http://127.0.0.1:3457` |
| Token | `mobile-fixture` |

默认端口为 `3457`，可用 `--port=3458` 同时启动第二个独立实例以检查多主机隔离。`--port=0` 使用系统分配的空闲端口。启动日志会输出实际地址。

服务固定绑定 `127.0.0.1`，没有配置其他监听地址的选项。可用于同机浏览器预览及能够访问宿主机回环地址的模拟器；实体手机上的 `127.0.0.1` 指手机自身，不能用这个地址连接电脑。此服务不模拟 HTTPS、公网配对或原生安全存储；这些需要对应的服务器测试与真机验收。

浏览器 Origin 只接受 `localhost`、`127.0.0.1`、`[::1]`，支持本地 Expo web 页面的跨域预检。HTTP 使用 `Authorization: Bearer mobile-fixture`；WebSocket 同时接受该 header 或 `?token=mobile-fixture`。这个固定 token 只用于本地假数据。

### 可以验收的路径

启动后有四个带 `Fixture` 标识的会话：普通聊天与历史、操作审批、回答问题、确认计划。后三个已有待处理请求，打开即可检查恢复后的决策界面。

| 操作 | 模拟行为 |
| --- | --- |
| 任意普通消息 | 回显用户消息、思考块、Read 工具调用与结果、分段文本回复、用量与结束事件 |
| `/approval` | Bash 操作审批；允许、拒绝和会话内记住允许均可演示，但不会执行命令 |
| `/edit` | Edit 文件修改审批（只展示改动预览，不写文件）；勾选“自动接受文件编辑”时把会话权限模式切到 acceptEdits |
| `/question` | 一个单选问题和一个多选问题；使用正式 `updatedInput.answers` 协议 |
| `/plan` | 计划确认；可携带执行模型、思考强度与会话权限模式 |
| `/slow` | 慢速分段输出，方便检查停止；停止后取消所有未发送的事件 |
| `/error` | 明确标注的模拟失败，随后可以重新发送 |
| `/retry` | 发出一次重试状态，再继续正常回复 |
| `/steps` | 工具时间线样本：读取、搜索、编辑、后台子 Agent 和一条运行约 8 秒的命令，随后正常结束；子 Agent 留在后台直到停止 |
| 修改模型 / 思考强度 | `set_runtime_config` 验证后返回 `runtime_config_applied`；修改保存在该会话 |
| 新建 / 改名 / 删除会话 | 操作当前进程的内存列表 |
| 加载更多历史 | 普通会话每页 6 条；写入新消息后旧游标返回 `409 HISTORY_PAGE_STALE` |
| 查看工作区 | 展示内存中的文件树、文件和差异；这些路径不对应真实文件 |
| 修改主机默认模型 / 设置 / 供应商 | 修改该 fixture 实例的内存配置；不改变已有会话运行配置 |

普通聊天的历史包含同一 `tool_use` 记录中的文本与工具块，适合检查历史转换是否错误地丢失助手文本。重连时服务器重发待处理请求和 `permission_requests_snapshot`，收到 `sync_state` 后返回真实的当前内存运行状态。

需要主动触发断线重连时，在另一个终端执行：

```sh
curl -X POST -H 'Authorization: Bearer mobile-fixture' \
  http://127.0.0.1:3457/__fixture/disconnect
```

`GET /__fixture/status`（同样需要 token）提供内存会话数和连接数。`GET /health` 是公开的 fixture 声明，不返回真实用户数据。`Ctrl+C` 结束服务。

### 自动自检

```sh
bun scripts/fixture-server.ts --self-test
```

自检使用随机回环端口并自动关闭服务，覆盖认证、分页与失效游标、运行配置确认、工具和文本流、三种决策、停止后的事件取消。它不需要先启动 fixture。

该服务只覆盖移动端首版使用的协议子集，不模拟真实模型行为、附件传输落盘、后台任务执行、分支回退、持久化、Git 操作或公网授权。未实现的 HTTP 路径明确返回 `404`；停止后尚未结束的文本流不写回历史。通过 fixture 验收能证明界面与协议接线正常，不能替代真实桌面服务和 iOS / Android 真机测试。
