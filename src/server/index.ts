// Library and direct launches must bind storage before evaluating business singletons.
const { initializeProcessStorage } = await import('../services/storageStartup.js')
await initializeProcessStorage()

const runtime = await import('./serverRuntime.js')

export const HTTP_CONNECTION_IDLE_TIMEOUT_SECONDS = runtime.HTTP_CONNECTION_IDLE_TIMEOUT_SECONDS
export const startBackgroundIndexesInPriorityOrder = runtime.startBackgroundIndexesInPriorityOrder
export const startServer = runtime.startServer
export const quiesceServerRuntimeForMigration = runtime.quiesceServerRuntimeForMigration
export const quiesceServerRuntimeForRecovery = runtime.quiesceServerRuntimeForRecovery
export const stopServerRuntimeForShutdown = runtime.stopServerRuntimeForShutdown

if (import.meta.main) startServer()
