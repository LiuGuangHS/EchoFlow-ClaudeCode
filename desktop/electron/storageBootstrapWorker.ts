import { workerData } from 'node:worker_threads'
import type { DesktopStorageLaunch } from './services/desktopStorageStartup'

const input = workerData as { launch: DesktopStorageLaunch; memory: SharedArrayBuffer }
const state = new Int32Array(input.memory, 0, 2)
const bytes = new Uint8Array(input.memory, 8)

void (async () => {
  let response: { ok: true; binding: DesktopStorageLaunch['binding']; controls: DesktopStorageLaunch['controls'] } | { ok: false; error: string }
  try {
    // Catch bundled module initialization failures while the main thread waits.
    const { initializeDesktopStorage } = await import('./services/desktopStorageStartup')
    const { createDesktopStorageHooks, validateRestrictedDesktopStorage } = await import('./services/desktopStorageValidation')
    const admitted = await initializeDesktopStorage(input.launch, createDesktopStorageHooks, validateRestrictedDesktopStorage)
    response = { ok: true, binding: admitted.binding, controls: input.launch.controls }
    // Workers share the host PID. Keep its writer receipt for the entire host
    // lifetime (including Chromium shutdown); the shared core reaps it after exit.
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  let encoded = new TextEncoder().encode(JSON.stringify(response))
  if (encoded.length > bytes.length) encoded = new TextEncoder().encode('{"error":"Storage bootstrap diagnostic exceeded the startup buffer"}')
  bytes.set(encoded)
  Atomics.store(state, 1, encoded.length)
  Atomics.store(state, 0, 1)
  Atomics.notify(state, 0)
})()
