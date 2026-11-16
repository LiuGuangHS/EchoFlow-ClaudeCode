import type { App } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function prepareProfileRecovery(app: Pick<App, 'setPath'>): () => void {
  const directory = mkdtempSync(join(tmpdir(), 'echoflow-profile-recovery-'))
  const cleanup = () => {
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch (error) {
      // Chromium may still hold cache files on Windows; never touch the original profiles.
      console.warn('[profile-recovery] Temporary recovery directory retained:', directory, error)
    }
  }
  try {
    app.setPath('userData', directory)
    app.setPath('sessionData', directory)
  } catch (error) {
    cleanup()
    throw error
  }
  return cleanup
}
