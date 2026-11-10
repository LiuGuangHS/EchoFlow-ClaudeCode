# 移动端发布

移动端使用独立的用户版本号。桌面 Release 继续使用 `vX.Y.Z`，只改桌面时不用升级移动端；发布说明应链接现有移动版本。iOS 自动交付到 App Store Connect / TestFlight，正式 App Store 审核与上架另行处理；Android 发布正式签名 APK，不提交 Google Play。

## 项目标识（由账号持有人在 CI 配置）

- Expo owner / Project ID / App Store Connect App ID：由 CI 变量 `EXPO_OWNER`、`EXPO_PROJECT_ID`、`ASC_APP_ID` 注入，仓库内不登记账号标识。
- iOS Bundle ID：`com.echoflow.code.mobile`
- iOS Widget：`com.echoflow.code.mobile.widgets`
- App Group：`group.com.echoflow.code.mobile`
- Android package：`com.echoflow.code.mobile`

项目标识可公开，凭据不能提交。EAS 管理生产签名凭据；保管并备份 Android keystore，后续升级必须保持签名身份。

## 一次性账号设置

本节是 iOS + Android 全量配置。**只发 Android 时见下一节**：步骤 1、2、4 以及 `ASC_APP_ID`、Apple Developer 协议、App Store Connect 应用、iOS 描述文件、APNs Push Key、ASC API Key、Widget 与 App Group 注册都可以跳过。

1. 账户持有人在 Apple Developer / App Store Connect 接受当前协议，在 App Store Connect 创建上述 Bundle ID 的应用。
2. 注册主 App、Widget 和 App Group，配置通知等实际使用的 capabilities，为主 App 和扩展分别准备 App Store 分发描述文件。
3. 在 `mobile/` 使用 `bunx eas-cli@25.3.0 credentials:configure-build --platform ios --profile production` 配置签名；Android 将 `ios` 改为 `android`。这会访问真实账号，不属于离线测试。
4. 通过 `bunx eas-cli@25.3.0 credentials --platform ios` 配置 EAS Submit 使用的 App Store Connect API Key。它与 APNs 推送密钥不同。
5. GitHub Actions Secrets 配置 `EXPO_TOKEN`，推荐专用发布机器人。Variables 配置 `EXPO_PROJECT_ID`、`EXPO_OWNER` 和数字形式的 `ASC_APP_ID`。
6. 首次构建和交付确认可用后，设置 GitHub variable `MOBILE_RELEASE_ENABLED=true`，启用随桌面正式 Release 自动交付。此前桌面发布不会被未完成的移动端账号设置影响。

仓库根目录 `.easignore` 保留移动端及共享源码，排除 Git 对象、其他产品目录、生成的原生工程和签名文件；EAS 会从 Expo 配置重新生成原生工程。

`eas.json` 固定 EAS CLI 版本，使用 `production` 环境、远程签名凭据、自动递增构建号，Android 产物明确设为 APK。不要使用本地默认 debug keystore 作为公开分发签名。

Android FCM 如果需要启用，在 EAS production 环境设置文件变量 `CC_HAHA_GOOGLE_SERVICES_FILE`，内容是匹配 `com.echoflow.code.mobile` 的 Firebase Android 客户端 JSON。服务账户私钥不能放进应用。可选：Android 默认走手机拉取，不需要 FCM。详见 [推送说明](PUSH_NOTIFICATIONS.md)。

## 只发 Android 的最小配置

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

## 凭据获取与 GitHub 配置

- **`EXPO_TOKEN`**：CI 里 EAS CLI 不做交互式 `eas login`，只认 `EXPO_TOKEN` 环境变量。登录 Expo 账号后打开 `https://expo.dev/settings/access-tokens`，点 **Create token** 生成并复制（只显示一次）。生产建议使用 **robot user**：在账号或组织里建一个非交互成员、授予 Developer 或更高角色，再为它单独建 token —— 权限可收敛、可单独吊销，也不会随个人账号变动失效。
- **`EXPO_PROJECT_ID`**：EAS 项目的 UUID。可在 expo.dev 项目页看到，或在 `mobile/` 执行 `bunx eas-cli@25.3.0 project:info` 读取；首次可用 `eas init` 关联项目。仓库故意不把账号标识写进 `app.json`，`app.config.ts#withEasProject` 会在构建时校验 UUID 格式并注入 `extra.eas.projectId`。
- **`EXPO_OWNER`**：拥有该项目的 Expo 账号名或组织 slug，与 `EXPO_PROJECT_ID` 同属公开标识。
- **GitHub 配置位置**：仓库 → Settings → Secrets and variables → Actions。Secret 用 **New repository secret** 建 `EXPO_TOKEN`；Variables 标签用 **New repository variable** 建 `EXPO_PROJECT_ID`、`EXPO_OWNER`，以及按需的 `MOBILE_RELEASE_PLATFORM`、`MOBILE_RELEASE_ENABLED`。也可用 `gh secret set EXPO_TOKEN` 与 `gh variable set <NAME>`。
- **Android keystore**：在 `mobile/` 执行 `bunx eas-cli@25.3.0 credentials:configure-build --platform android --profile production`，按提示让 EAS 生成或上传现有 keystore，并**离线备份**；后续升级必须保持同一签名身份。`eas.json` 的 `cli.appVersionSource: "remote"` 与 `autoIncrement: true` 由 EAS 管理构建号，首次需要初始化。

## 桌面发版与手机包的关系

移动端使用独立的用户版本号，只由 `scripts/release.ts --mobile` 显式递增；release-please 不再同步 `mobile/package.json` 和 `mobile/app.json`。这两个文件是移动端交付指纹的一部分，若每次桌面发版都改版本号，指纹必然变化，会导致每个桌面版本都重新构建手机包。

桌面专用改动（移动端未 import 的共享文件）、测试、文档和生成文件不触发新包。`scripts/mobile-release.ts` 对比该平台**上一次成功交付**的输入摘要：摘要不变时 Android 把上次 APK 挂到新 Release（不重新构建），iOS 直接跳过；摘要变了但移动版本没递增会阻止发布，提示先 bump 版本。

## 日常发版

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

## 失败重试与只读预览

GitHub Actions → `Release Mobile` → `Run workflow`：

- `release_tag`：包含这套发布代码的、已经公开发布的稳定标签，例如 `v1.2.3`。工作流检出标签对应提交，不构建当前默认分支。
- `platform`：`ios`、`android` 或 `all`。
- `dry_run`：默认开启，仅分析，不构建、上传或消耗 EAS 构建配额。真正交付时关闭。

已成功的平台会跳过。构建已成功但交付失败时优先复用同一提交、版本和输入摘要的 EAS build；正在进行中的同一构建不会重复启动。Apple 上传成功而 GitHub 成功记录写入失败时，重试会先检查该 build 的提交结果。仅在上传/发布完成后写成功记录，不能手工伪造记录来消除失败。

自动上传和手动重试共享串行锁，不取消正在进行的商店上传。安卓 APK 在附加到 Release 前验证安装包结构与签名，拒绝默认 Android Debug 签名。

## 首次 App Store 提审

准备真实截图、描述、支持网址、移动端隐私政策与隐私披露、年龄分级、出口合规和目标地区所需资料。当前支持 iPad，需包含相应验收和展示。

该 App 依赖桌面配对，审核说明需要提供可实际访问的隔离测试环境与操作步骤。内部 fixture 服务不是已经可用的正式审核入口。TestFlight 真机验证通过后，再选择构建提交 App Review；CI 上传成功不能替代此步骤。

后台推送不需要桌面配置凭据：iOS 经 Expo 推送服务中转（需要在 EAS 项目凭据里配好 APNs Push Key，并保持 Enhanced Push Security 关闭），Android 由 App 的前台服务直接向已配对电脑拉取。不可把开发者私钥打包进桌面端或移动端。详见 [推送说明](PUSH_NOTIFICATIONS.md)。

## 确定性检查

```sh
bun run check:mobile
bun test scripts/mobile-release.test.ts scripts/release.test.ts
bun run check:policy
bun run check:impact
```

完整验证使用 `bun run verify`。移动端检查隔离 HOME、关闭 Expo 网络与遥测，不使用生产凭据。EAS 构建、TestFlight 真机体验及实际推送属于另外记录的线上证据。
