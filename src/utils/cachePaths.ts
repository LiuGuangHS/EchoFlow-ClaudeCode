import { getEchoFlowConfigDir, getEchoFlowInternalDir } from './echoFlowConfigRoot.js'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'path'
import { getFsImplementation } from './fsOperations.js'
import { djb2Hash } from './hash.js'
import { resolveManagedStoragePath } from './managedStoragePath.js'

/** Synchronous callers need stable filenames across subprocesses, not a new random directory. */
export function ensurePrivateStorageTempRoot(): string {
  const root = getEchoFlowConfigDir()
  const internal = getEchoFlowInternalDir(root)
  const temporary = join(internal, 'tmp')
  // The selected root is the trust boundary; managed descendants cannot be links.
  mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const path of [internal, temporary]) {
    resolveManagedStoragePath(path, 'Storage temporary directory')
    try { mkdirSync(path, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const snapshot = lstatSync(path)
    if (!snapshot.isDirectory() || snapshot.isSymbolicLink()) throw new Error('Storage temporary directory contains a link or special entry')
    resolveManagedStoragePath(path, 'Storage temporary directory')
  }
  chmodSync(temporary, 0o700)
  return temporary
}

/** Product scratch data stays private inside the selected storage root. */
export async function createPrivateStorageTempDirectory(prefix: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error('Invalid storage temporary directory prefix')
  const directory = await mkdtemp(join(ensurePrivateStorageTempRoot(), prefix))
  try {
    resolveManagedStoragePath(directory, 'Storage temporary directory')
    await chmod(directory, 0o700)
    return directory
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function getCacheRoot() {
  return join(getEchoFlowConfigDir(), 'Cache')
}

// Local sanitizePath using djb2Hash — NOT the shared version from
// sessionStoragePortable.ts which uses Bun.hash (wyhash) when available.
// Cache directory names must remain stable across upgrades so existing cache
// data (error logs, MCP logs) is not orphaned.
const MAX_SANITIZED_LENGTH = 200
function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${Math.abs(djb2Hash(name)).toString(36)}`
}

function getProjectDir(cwd: string): string {
  return sanitizePath(cwd)
}

export const CACHE_PATHS = {
  baseLogs: () => join(getCacheRoot(), getProjectDir(getFsImplementation().cwd())),
  errors: () =>
    join(getCacheRoot(), getProjectDir(getFsImplementation().cwd()), 'errors'),
  messages: () =>
    join(getCacheRoot(), getProjectDir(getFsImplementation().cwd()), 'messages'),
  mcpLogs: (serverName: string) =>
    join(
      getCacheRoot(),
      getProjectDir(getFsImplementation().cwd()),
      // Sanitize server name for Windows compatibility (colons are reserved for drive letters)
      `mcp-logs-${sanitizePath(serverName)}`,
    ),
}
