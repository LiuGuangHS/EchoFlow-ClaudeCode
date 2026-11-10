import { parseConnectionInput, queueIncomingConnection } from '../core/connection'

/** 冷启动和已打开时都先路由到连接页，避免旧 scheme 被当成不存在的页面。 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (!/^codemobile:/i.test(path)) return path
  try {
    const url = new URL(path)
    // 普通 codemobile://chat 等路由仍交给 Expo Router。
    if (!url.searchParams.has('serverUrl') && !url.searchParams.has('h5Token')) return path
    parseConnectionInput(path)
    return `/connect?incoming=${queueIncomingConnection(path)}`
  } catch {
    return '/connect?invalidLink=1'
  }
}
