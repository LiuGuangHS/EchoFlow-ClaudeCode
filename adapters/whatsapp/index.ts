const standalone = import.meta.main || process.argv.includes('--whatsapp')
if (standalone) {
  const { initializeProcessStorage } = await import('../../src/services/storageStartup.js')
  await initializeProcessStorage()
}

const runtime = await import('./runtime.js')
export const { bridge, dedup, sessionStore, sessionSelectionController, handleServerMessage, getRuntimeState, clearTransientChatState, createSessionForChat, showProjectPicker, routeUserMessage, handleIncomingMessage, startNewSession, useWhatsAppSocket } = runtime
if (standalone) await runtime.startWhatsAppAdapter()
