import type { WebContents } from 'electron'
import { readDedicatedCredential } from './echoFlowLogin'

type LoadFailure = (event: unknown, code: number, description: string, url: string, isMainFrame: boolean) => void

type ListenForLoad = {
  (event: 'did-finish-load', listener: () => void): unknown
  (event: 'did-fail-load', listener: LoadFailure): unknown
}

export type DedicatedContents = Pick<WebContents, 'loadURL' | 'getURL' | 'executeJavaScript' | 'isDestroyed' | 'close'> & {
  on: ListenForLoad
  off: ListenForLoad
}

/**
 * Reads the gateway's persisted login after its window has closed. The token
 * remains in the site's partition; only the in-memory credential is returned.
 */
export async function readStoredDedicatedCredentialWith(
  contents: DedicatedContents,
  origin: string,
  signal?: AbortSignal,
) {
  let finishLoad!: () => void
  const loaded = new Promise<void>(resolve => { finishLoad = resolve })
  let stop!: () => void
  const stopped = new Promise<null>(resolve => { stop = () => resolve(null) })
  const failLoad: LoadFailure = (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) stop()
  }
  const timer = setTimeout(stop, 15_000)

  try {
    signal?.throwIfAborted()
    signal?.addEventListener('abort', stop)
    contents.on('did-finish-load', finishLoad)
    contents.on('did-fail-load', failLoad)
    // Electron's loadURL resolves at did-finish-load, so either signal is sufficient.
    if (await Promise.race([stopped, contents.loadURL(origin), loaded]) === null || signal?.aborted) return null
    return await Promise.race([stopped, readDedicatedCredential({ webContents: contents }, origin)])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
    contents.off('did-finish-load', finishLoad)
    contents.off('did-fail-load', failLoad)
    if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
  }
}

export async function readStoredDedicatedCredential(partition: string, origin: string, signal?: AbortSignal) {
  const { WebContentsView } = await import('electron')
  if (signal?.aborted) return null
  const view = new WebContentsView({ webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  return await readStoredDedicatedCredentialWith(view.webContents, origin, signal)
}
