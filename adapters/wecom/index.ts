const { initializeProcessStorage } = await import('../../src/services/storageStartup.js')
await initializeProcessStorage()
await import('./runtime.js')
