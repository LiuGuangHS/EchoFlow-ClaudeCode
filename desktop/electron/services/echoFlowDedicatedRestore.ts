import type { WebContents } from 'electron'
import { parseDedicatedCredential } from './echoFlowLogin'

export type DedicatedContents = Pick<WebContents, 'loadURL' | 'getURL' | 'executeJavaScript' | 'close'> & {
  once(event: 'did-finish-load' | 'did-fail-load', listener: () => void): unknown
}

/**
 * Reads the gateway's persisted login after its window has closed. The token
 * remains in the site's partition; only the in-memory credential is returned.
 */
export async function readStoredDedicatedCredentialWith(
  contents: DedicatedContents,
  origin: string,
) {
  try {
    // loadURL resolving only means navigation started; storage is readable after the page finishes loading.
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('dedicated page load timed out')), 15000)
      contents.once('did-finish-load', () => {
        clearTimeout(timer)
        resolve()
      })
      contents.once('did-fail-load', () => {
        clearTimeout(timer)
        reject(new Error('dedicated page failed to load'))
      })
    })
    loaded.catch(() => {})
    await contents.loadURL(origin)
    await loaded
    if (new URL(contents.getURL()).origin !== origin) return null
    const raw = await contents.executeJavaScript(
      '(() => ({ token: localStorage.getItem("auth_token"), user: localStorage.getItem("auth_user"), expiresAt: localStorage.getItem("token_expires_at") }))()',
      true,
    )
    if (!raw || typeof raw !== 'object') return null
    const snapshot = raw as { token?: unknown; user?: unknown; expiresAt?: unknown }
    return parseDedicatedCredential({
      token: typeof snapshot.token === 'string' ? snapshot.token : null,
      user: typeof snapshot.user === 'string' ? snapshot.user : null,
      expiresAt: typeof snapshot.expiresAt === 'string' ? snapshot.expiresAt : null,
    })
  } catch {
    return null
  } finally {
    contents.close()
  }
}

export async function readStoredDedicatedCredential(partition: string, origin: string) {
  const { WebContentsView } = await import('electron')
  const view = new WebContentsView({ webPreferences: { partition } })
  return await readStoredDedicatedCredentialWith(view.webContents, origin)
}
