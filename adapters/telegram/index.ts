const standalone = import.meta.main || process.argv.includes('--telegram')
if (standalone) {
  const { initializeProcessStorage } = await import('../../src/services/storageStartup.js')
  await initializeProcessStorage()
}

export const { bot, startTelegramAdapter, stopTelegramAdapter } = await import('./runtime.js')
if (standalone) startTelegramAdapter()
