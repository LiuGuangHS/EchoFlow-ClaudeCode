const standalone = import.meta.main || process.argv.includes('--feishu')
if (standalone) {
  const { initializeProcessStorage } = await import('../../src/services/storageStartup.js')
  await initializeProcessStorage()
}

const runtime = await import('./runtime.js')
export const { bridge, dedup, sessionStore, sessionSelectionController, handleServerMessage, getRuntimeState, clearTransientChatState, createSessionForChat, showProjectPicker, handleMessage, handleCardAction, larkClient, prepareNewSession } = runtime
if (standalone) runtime.startFeishuAdapter()
