// 落地页的 title / description：运行时的 setPageMeta 和静态构建
// （scripts/prepare-static-output.mjs）共用这一份，两边不会漂移。
export const landingMeta = {
  zh: {
    title: 'EchoFlow Code — Claude Code 的本地优先桌面客户端',
    description: 'EchoFlow Code 是 Claude Code 的本地优先桌面客户端（macOS、Windows、Linux）：多 Agent 协作看得见，每处改动逐文件审阅并可撤销，手机或 IM 里就能批准权限，模型自己选。'
  },
  en: {
    title: 'EchoFlow Code — a local-first desktop client for Claude Code',
    description: 'A local-first desktop client for Claude Code on macOS, Windows and Linux. Watch Agent Teams work, review and undo every change, approve from your phone or IM, and bring your own model.'
  }
}
