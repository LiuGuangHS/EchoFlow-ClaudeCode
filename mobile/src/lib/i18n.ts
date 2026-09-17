/**
 * EchoFlow Code mobile i18n — Minimal Chinese-first translation layer.
 * Matches the EchoFlow Desktop zh.ts pattern for shared concepts.
 */
export const zh = {
  // ConnectScreen
  'connect.eyebrow': 'EchoFlow Code',
  'connect.title': '连接到你的桌面',
  'connect.description':
    '输入 EchoFlow 桌面端的 H5 服务器地址和令牌。局域网内可使用 HTTP，外网请使用 HTTPS 或私有隧道。',
  'connect.scanQr': '📷 扫描二维码',
  'connect.serverUrlLabel': '服务器地址',
  'connect.h5TokenLabel': 'H5 令牌',
  'connect.warningLan':
    '局域网 HTTP 测试允许明文传输。同网络下的其他设备可能截获 H5 令牌。',
  'connect.warningNonLan':
    '明文 HTTP 仅应在可信私有网络中使用。建议为该地址启用 HTTPS。',
  'connect.connect': '连接',
  'connect.clipboardDetected': '检测到连接链接：',
  'connect.clipboardFill': '填入',
  'connect.qrInvalid': '不是有效的 EchoFlow Code 二维码。请扫描 EchoFlow 桌面端 H5 接入设置里的二维码。',
  'connect.loading': '正在加载 EchoFlow Code...',
  'connect.credentialLoadError': '无法加载已保存的 EchoFlow Code 凭据。',
  'connect.timeout': '连接超时（10 秒）',
  'connect.unableToConnect': '无法连接到 EchoFlow H5 服务。',

  // H5WebViewScreen
  'webview.title': 'EchoFlow Code',
  'webview.back': '返回',
  'webview.reload': '重载',
  'webview.disconnect': '断开',
  'webview.loading': '正在加载 EchoFlow H5...',
  'webview.loadError': '无法加载 EchoFlow H5。',
  'webview.httpError': 'H5 返回 HTTP',

  // ConnectionSnackbar
  'snackbar.disconnected': '与服务器连接已断开，请重新加载页面。',
  'snackbar.reconnecting': '正在重新连接...',

  // ErrorBanner
  'error.retry': '重试',

  // PermissionModal
  'permission.title': '需要权限确认',
  'permission.command': '命令',
  'permission.details': '详情',
  'permission.deny': '拒绝',
  'permission.allow': '允许',

  // QR Camera
  'qr.title': '扫描二维码',
  'qr.close': '关闭二维码扫描',
  'qr.permissionNeeded': '需要相机权限',
  'qr.preparingCamera': '正在准备相机...',
  'qr.permissionDeniedPermanently': '请在系统设置中开启相机权限，然后返回继续扫描。',
  'qr.permissionRequest': '请允许相机权限，用于扫描 EchoFlow 桌面端显示的二维码。',
  'qr.grantPermission': '允许相机权限',
  'qr.hint': '将相机对准 EchoFlow 桌面端 H5 接入设置里的二维码。',
  'qr.scanned': '已识别二维码，正在处理...',
  'qr.rescan': '重新扫描',

  // h5Access error messages
  'h5.error.invalidUrl': '请输入服务器地址。',
  'h5.error.invalidFormat': '请输入有效的 HTTP 或 HTTPS 服务器地址。',
  'h5.error.unsupportedProtocol': '服务器地址必须以 http:// 或 https:// 开头。',
  'h5.error.missingToken': '请输入桌面端的 H5 令牌。',
  'h5.error.unreachable': '无法访问 EchoFlow 服务器健康检查端点。',
  'h5.error.healthStatus': '健康检查未返回正常状态。',
  'h5.error.verifyFailed': '无法验证 H5 令牌。',
  'h5.error.invalidToken': 'H5 令牌无效或已过期。',
} as const

export type CodeMobileKey = keyof typeof zh

export function t(key: CodeMobileKey): string {
  return zh[key] ?? key
}
