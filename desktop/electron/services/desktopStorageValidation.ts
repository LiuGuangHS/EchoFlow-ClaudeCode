import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertUnlinkedDirectoryPath, readStorageMigrationStatus } from '../../../src/services/storageMigration'
import { DatabaseSync } from 'node:sqlite'
import { validateStorageSQLite as validateDesktopSQLite } from '../../../src/services/storageMigrationValidation'
export { createStorageMigrationHooks as createDesktopStorageHooks } from '../../../src/services/storageMigrationValidation'
export { validateDesktopSQLite }
import type { StorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { APP_ZOOM_STORAGE_KEY, LEGACY_UI_ZOOM_STORAGE_KEY, isValidStoredAppZoomLevel, normalizeAppZoomLevel } from '../../src/lib/appZoom'
import { CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION, DESKTOP_PERSISTENCE_VERSION_KEY, runDesktopPersistenceMigrations } from '../../src/lib/persistenceMigrations'
import { WORKSPACE_STORAGE_KEY, WORKSPACE_STORAGE_VERSION } from '../../src/lib/workspace/storageKey'
import { ECHOFLOW_LOGIN_PROFILES, type EchoFlowLoginEndpoint } from './echoFlowLogin'
import { resolveRendererEntry } from './rendererEntry'

export type NativeStorageSnapshot = {
  localStorage: Record<string, string>
  indexedDB: { name: string; version: number; stores: { name: string; keyPath: string | string[] | null; autoIncrement: boolean; indexes: unknown[]; records: unknown[] }[] }[]
  login?: { storageDigest: string; localCount: number; indexedCount: number; cookieDigest: string; cookieCount: number }
}
export type StorageValidationRequest = {
  version: 1
  directory: string
  profile: string
  url: string
  login?: { endpoint: EchoFlowLoginEndpoint; proofKey: string }
}

function retained(before: unknown, after: unknown): boolean {
  if (Array.isArray(before)) return Array.isArray(after) && before.length === after.length && before.every((value, index) => retained(value, after[index]))
  if (before !== null && typeof before === 'object') return after !== null && typeof after === 'object' && !Array.isArray(after) &&
    Object.entries(before).every(([key, value]) => Object.hasOwn(after, key) && retained(value, (after as Record<string, unknown>)[key]))
  return before === after
}

/** Exercise the real schema owner without starting stores or writing a published profile. */
export function validateDesktopStorageSnapshot(snapshot: NativeStorageSnapshot): void {
  if (!snapshot || !snapshot.localStorage || typeof snapshot.localStorage !== 'object' || Array.isArray(snapshot.localStorage) ||
    !Object.values(snapshot.localStorage).every(value => typeof value === 'string') || !Array.isArray(snapshot.indexedDB)) throw new Error('Invalid native storage snapshot')
  const values = new Map(Object.entries(snapshot.localStorage))
  const version = values.get(DESKTOP_PERSISTENCE_VERSION_KEY)
  if (version !== undefined && (!/^\d+$/.test(version) || Number(version) > CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION)) throw new Error('Unsupported desktop persistence schema')
  const workspace = values.get(WORKSPACE_STORAGE_KEY)
  if (workspace !== undefined) {
    const parsed = JSON.parse(workspace)
    if (!parsed || ![1, WORKSPACE_STORAGE_VERSION].includes(parsed.version)) throw new Error('Unsupported workspace persistence schema')
  }
  const report = runDesktopPersistenceMigrations({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } })
  for (const [key, before] of Object.entries(snapshot.localStorage)) {
    if (key === DESKTOP_PERSISTENCE_VERSION_KEY) continue
    const after = values.get(key)
    if (before === after) continue
    if (key === LEGACY_UI_ZOOM_STORAGE_KEY && after === undefined && isValidStoredAppZoomLevel(before)) {
      const canonical = values.get(APP_ZOOM_STORAGE_KEY)
      if (canonical !== undefined && isValidStoredAppZoomLevel(canonical) &&
        normalizeAppZoomLevel(canonical) === normalizeAppZoomLevel(before)) continue
    }
    let preserved = false
    try {
      const expected = JSON.parse(before)
      // Only the workspace owner's declared version transition may replace metadata.
      if (key === WORKSPACE_STORAGE_KEY && expected?.version === 1) expected.version = WORKSPACE_STORAGE_VERSION
      preserved = after !== undefined && retained(expected, JSON.parse(after))
    } catch { /* Scalar changes are not lossless. */ }
    if (!preserved) throw new Error('Desktop schema owner would discard or replace saved data; migration requires explicit recovery')
  }
  if (report.status !== 'completed') throw new Error(`Desktop persistence migration is ${report.status}; migration requires explicit recovery`)
}

export function assertDesktopStoragePreserved(source: NativeStorageSnapshot, target: NativeStorageSnapshot): void {
  for (const [key, value] of Object.entries(source.localStorage)) {
    if (!Object.hasOwn(target.localStorage, key) || target.localStorage[key] !== value) throw new Error('Native localStorage lost saved values')
  }
  for (const database of source.indexedDB) {
    const actual = target.indexedDB.find(item => item.name === database.name)
    if (!actual || JSON.stringify(actual) !== JSON.stringify(database)) throw new Error('Native IndexedDB schema, count or saved values changed')
  }
}

async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

// Only Chromium-owned persistent data is copied, never transcripts, plugins or runtime code.
const profileEntries = ['Local Storage', 'IndexedDB', 'Session Storage', 'WebStorage']
const loginPartitions = Object.values(ECHOFLOW_LOGIN_PROFILES)
const partitionDirectory = (partition: string) => partition.slice('persist:'.length)
const cookieFamily = /^Cookies(?:-journal|-wal|-shm)?$/
// Keep these Chromium-generated files in the migration, but never load them in the reader.
const loginRuntimeEntries = new Set([
  'Cache', 'Code Cache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GPUCache', 'blob_storage',
  'DIPS', 'DIPS-journal', 'Network Persistent State', 'Preferences', 'Shared Dictionary',
  'TransportSecurity', 'Trust Tokens', 'Trust Tokens-journal',
])

async function copyProfile(source: string, target: string, login?: EchoFlowLoginEndpoint): Promise<string> {
  await assertUnlinkedDirectoryPath(source)
  async function populated(file: string): Promise<boolean> {
    const stat = await fs.lstat(file)
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(file)) if (await populated(path.join(file, name))) return true
      return false
    }
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unvalidated Chromium owner contains linked or special data')
    return stat.size > 0
  }
  for (const name of ['Service Worker', 'File System', 'Storage', 'databases']) {
    if (await exists(path.join(source, name)) && await populated(path.join(source, name))) throw new Error(`Restricted validation has no lossless ${name} persistence owner`)
  }
  await fs.mkdir(target, { mode: 0o700 })
  let profile = target
  if (login) {
    const partition = partitionDirectory(ECHOFLOW_LOGIN_PROFILES[login].partition)
    profile = path.join(target, 'Partitions', partition)
    await fs.mkdir(profile, { recursive: true, mode: 0o700 })
  } else {
    const partitions = path.join(source, 'Partitions')
    if (await exists(partitions)) {
      await assertUnlinkedDirectoryPath(partitions)
      for (const name of await fs.readdir(partitions)) {
        if (!loginPartitions.some(({ partition }) => partitionDirectory(partition) === name) && await populated(path.join(partitions, name))) {
          throw new Error('Restricted validation has no lossless Partitions persistence owner')
        }
      }
    }
  }
  async function copy(from: string, to: string): Promise<void> {
    const stat = await fs.lstat(from)
    if (stat.isDirectory()) {
      await fs.mkdir(to, { mode: 0o700 })
      for (const name of await fs.readdir(from)) await copy(path.join(from, name), path.join(to, name))
    } else {
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Native profile validation rejects linked or special files')
      await fs.copyFile(from, to)
      await fs.chmod(to, 0o600)
    }
  }
  for (const name of profileEntries) if (await exists(path.join(source, name))) await copy(path.join(source, name), path.join(profile, name))
  if (login) {
    for (const name of await fs.readdir(source)) {
      if (profileEntries.includes(name) || name === 'Network' || cookieFamily.test(name)) continue
      if (await populated(path.join(source, name)) && !loginRuntimeEntries.has(name)) {
        throw new Error('Restricted validation has no lossless login partition persistence owner for this file')
      }
    }
    for (const prefix of ['', 'Network']) {
      const directory = path.join(source, prefix)
      if (!await exists(directory)) continue
      await assertUnlinkedDirectoryPath(directory)
      const names = await fs.readdir(directory)
      if (prefix) for (const name of names) {
        if (!cookieFamily.test(name) && !loginRuntimeEntries.has(name) && await populated(path.join(directory, name))) {
          throw new Error('Restricted validation has no lossless login network persistence owner for this file')
        }
      }
      const files = names.filter(name => cookieFamily.test(name))
      if (!files.length) continue
      if (!files.includes('Cookies')) throw new Error('Incomplete login cookie database')
      // An empty placeholder in the other layout must not shadow the real database.
      const contents = await Promise.all(files.map(name => populated(path.join(directory, name))))
      if (!contents.some(Boolean)) continue
      const destination = path.join(profile, prefix)
      if (prefix) await fs.mkdir(destination, { mode: 0o700 })
      for (const name of files) await copy(path.join(directory, name), path.join(destination, name))
    }
  }
  return profile
}

async function expectedLoginCookieCount(profile: string, origin: string): Promise<number> {
  const files = [path.join(profile, 'Cookies'), path.join(profile, 'Network', 'Cookies')]
  const databases: string[] = []
  for (const file of files) if (await exists(file)) databases.push(file)
  if (!databases.length) return 0
  if (databases.length !== 1) throw new Error('Conflicting login cookie databases')
  let count = 0
  await validateDesktopSQLite(databases[0]!, copy => {
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      // Chromium cookie expiry uses microseconds since 1601-01-01.
      const now = (BigInt(Date.now()) + 11_644_473_600_000n) * 1000n
      const host = new URL(origin).hostname
      // Chromium's origin lookup includes matching parent domain cookies at '/'.
      count = Number(db.prepare(`SELECT count(*) AS count FROM cookies
        WHERE is_persistent = 1 AND expires_utc > ? AND path = '/'
        AND (host_key = ? OR (substr(host_key, 1, 1) = '.' AND substr(?, -length(host_key)) = host_key))
      `).get(now, host, `.${host}`)?.count)
    } finally { db.close() }
  })
  return count
}

function levelDBChecksum(type: number, payload: Buffer): number {
  let crc = 0xffffffff
  for (const byte of Buffer.concat([Buffer.from([type]), payload])) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0)
  }
  crc = (~crc) >>> 0
  return (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0
}

// Session namespaces cannot be restored into a new window. Prove the generated
// store has no saved values; compacted or populated stores need an explicit reader.
export async function assertEmptySessionStorage(directory: string): Promise<void> {
  const saved = new Map<string, Buffer>()
  for (const name of (await fs.readdir(directory)).sort()) {
    if (/\.(?:ldb|sst)$/.test(name)) throw new Error('Compacted sessionStorage requires a namespace-aware recovery owner')
    if (!/^\d+\.log$/.test(name)) continue
    const log = await fs.readFile(path.join(directory, name))
    let fragments: Buffer[] = []
    for (let offset = 0; offset < log.length;) {
      const remaining = 32768 - offset % 32768
      if (remaining < 7) { offset += remaining; continue }
      if (offset + 7 > log.length) throw new Error('Truncated sessionStorage log')
      const checksum = log.readUInt32LE(offset)
      const length = log.readUInt16LE(offset + 4)
      const type = log[offset + 6]!
      if (!checksum && !length && !type) {
        if (log.subarray(offset, Math.min(log.length, offset + remaining)).some(byte => byte !== 0)) throw new Error('Invalid sessionStorage log padding')
        offset += remaining
        continue
      }
      if (length > remaining - 7 || offset + 7 + length > log.length || type < 1 || type > 4) throw new Error('Invalid sessionStorage log record')
      const payload = log.subarray(offset + 7, offset + 7 + length)
      if (levelDBChecksum(type, payload) !== checksum) throw new Error('Corrupt sessionStorage log checksum')
      offset += 7 + length
      if ((type === 1 || type === 2) && fragments.length || (type === 3 || type === 4) && !fragments.length) throw new Error('Invalid sessionStorage log fragments')
      fragments.push(payload)
      if (type === 2 || type === 3) continue
      const batch = Buffer.concat(fragments)
      fragments = []
      if (batch.length < 12) throw new Error('Invalid sessionStorage write batch')
      const count = batch.readUInt32LE(8)
      let cursor = 12
      const field = () => {
        let length = 0
        let shift = 0
        let byte: number
        do {
          if (cursor >= batch.length || shift > 28) throw new Error('Invalid sessionStorage field length')
          byte = batch[cursor++]!
          length += (byte & 127) * 2 ** shift
          shift += 7
        } while (byte & 128)
        if (cursor + length > batch.length) throw new Error('Truncated sessionStorage field')
        const result = batch.subarray(cursor, cursor + length)
        cursor += length
        return result
      }
      for (let index = 0; index < count; index++) {
        const tag = batch[cursor++]
        if (tag !== 0 && tag !== 1) throw new Error('Invalid sessionStorage write operation')
        const rawKey = field()
        const key = rawKey.toString('utf8')
        if (!Buffer.from(key).equals(rawKey)) throw new Error('Unsupported sessionStorage key')
        if (tag === 0) saved.delete(key)
        else saved.set(key, field())
      }
      if (cursor !== batch.length) throw new Error('Invalid sessionStorage batch count')
    }
    if (fragments.length) throw new Error('Incomplete sessionStorage log record')
  }
  for (const key of saved.keys()) {
    if (key !== 'version' && key !== 'next-map-id' && !key.startsWith('namespace-')) throw new Error('Saved sessionStorage requires a namespace-aware recovery owner')
  }
}

// Chromium can recreate an empty Local Storage database after sign-out. Its
// complete WAL record sets only VERSION=1, with a variable batch sequence number.
const localStorageVersionEntry = Buffer.from('\x01\x07VERSION\x011')

async function isLocalStorageVersionLog(file: string, size: number): Promise<boolean> {
  if (!/^\d+\.log$/.test(path.basename(file)) || size !== 19 + localStorageVersionEntry.length) return false
  const log = await fs.readFile(file)
  if (log.length !== size || log.readUInt16LE(4) !== size - 7 || log[6] !== 1 || log.readUInt32LE(15) !== 1) return false
  return log.subarray(19).equals(localStorageVersionEntry) && log.readUInt32LE(0) === levelDBChecksum(1, log.subarray(7))
}

async function validateProfileFiles(profile: string, url: string): Promise<{ local: boolean; indexed: boolean }> {
  let local = false
  let indexed = false
  async function inspect(directory: string): Promise<void> {
    const names = await fs.readdir(directory)
    for (const name of names) {
      const file = path.join(directory, name)
      const stat = await fs.lstat(file)
      if (name === 'CURRENT') {
        if (!stat.isFile()) throw new Error('Invalid Chromium LevelDB manifest pointer')
        const manifest = (await fs.readFile(file, 'utf8')).trim()
        if (!/^MANIFEST-\d+$/.test(manifest) || !names.includes(manifest) || !(await fs.lstat(path.join(directory, manifest))).isFile()) {
          throw new Error('Invalid Chromium LevelDB manifest')
        }
      }
      if (stat.isDirectory()) { await inspect(file); continue }
      if (/\.(?:ldb|sst|log)$/.test(name) && stat.size > 0) {
        if (file.startsWith(path.join(profile, 'Local Storage') + path.sep)) {
          if (await isLocalStorageVersionLog(file, stat.size)) {
            if (!names.includes('CURRENT')) throw new Error('Missing Chromium LevelDB manifest pointer')
          } else local = true
        }
        indexed ||= file.startsWith(path.join(profile, 'IndexedDB') + path.sep)
      }
      const handle = await fs.open(file, 'r')
      const header = Buffer.alloc(16)
      try { await handle.read(header, 0, 16, 0) } finally { await handle.close() }
      if (header.equals(Buffer.from('SQLite format 3\0'))) await validateDesktopSQLite(file)
      else if (['Cookies', 'Login Data'].includes(name) && stat.size) throw new Error('Invalid Chromium SQLite database')
    }
  }
  await inspect(profile)
  const sessionStorage = path.join(profile, 'Session Storage')
  if (await exists(sessionStorage)) await assertEmptySessionStorage(sessionStorage)
  const webStorage = path.join(profile, 'WebStorage')
  if (await exists(webStorage)) {
    const files = await fs.readdir(webStorage)
    if (files.some(name => !/^QuotaManager(?:-journal|-wal|-shm)?$/.test(name))) throw new Error('Restricted validation has no lossless named-bucket storage owner')
    if (files.includes('QuotaManager')) {
      const quota = new DatabaseSync(path.join(webStorage, 'QuotaManager'), { readOnly: true })
      try {
        const version = quota.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value
        if (!/^\d+$/.test(String(version)) || Number(version) > 11) throw new Error('Unsupported Chromium quota schema')
        const origin = new URL(url).protocol === 'file:' ? 'file:///' : `${new URL(url).origin}/`
        for (const bucket of quota.prepare('SELECT storage_key, name FROM buckets').all()) {
          if (bucket.name !== '_default' || bucket.storage_key !== origin) throw new Error('Saved storage bucket or origin has no restricted persistence owner')
        }
      } finally { quota.close() }
    }
  }
  return { local, indexed }
}

async function rejectNativeCorruption(profile: string): Promise<void> {
  async function inspect(directory: string): Promise<void> {
    for (const name of await fs.readdir(directory)) {
      const file = path.join(directory, name)
      if ((await fs.lstat(file)).isDirectory()) await inspect(file)
      else if (/^LOG(?:\.old)?$/.test(name) && /corrupt|checksum mismatch|IO error|repairing|discarding/i.test(await fs.readFile(file, 'utf8'))) throw new Error('Chromium reported persistent storage corruption')
    }
  }
  await inspect(profile)
}

export async function runRestrictedStorageChild(request: StorageValidationRequest, executable: string, entry: string): Promise<NativeStorageSnapshot> {
  const requestFile = path.join(request.directory, 'request.json')
  await fs.writeFile(requestFile, JSON.stringify(request), { flag: 'wx', mode: 0o600 })
  const home = path.join(request.directory, 'home')
  await fs.mkdir(home, { mode: 0o700 })
  // Do not forward provider credentials, NODE_OPTIONS, Electron flags or launch controls.
  const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, XDG_DATA_HOME: home,
    APPDATA: home, LOCALAPPDATA: home, TMPDIR: request.directory, TMP: request.directory, TEMP: request.directory }
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG']) if (process.env[name]) env[name] = process.env[name]
  if (process.platform === 'linux' && env.DISPLAY) {
    // Xlib's default and relative authority paths must survive the isolated HOME and cwd.
    const authority = process.env.XAUTHORITY ?? path.join(homedir(), '.Xauthority')
    env.XAUTHORITY = authority && !path.isAbsolute(authority) ? path.resolve(authority) : authority
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [entry, `--echoflow-storage-validation-request=${requestFile}`, '--disable-gpu', '--disable-dev-shm-usage'], {
      cwd: request.directory, env, stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
    })
    let diagnostic = ''
    let timedOut = false
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-32_768) })
    const timeout = setTimeout(() => {
      timedOut = true
      if (process.platform !== 'win32' && child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
      else if (child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    }, 60_000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', code => {
      clearTimeout(timeout)
      if (timedOut) reject(new Error('Restricted native storage validation timed out'))
      else if (code !== 0) reject(new Error('Restricted native storage validation failed; no ordinary runtime was started'))
      else if (/corrupt|checksum mismatch|IO error|Failed to open.*(?:database|leveldb)/i.test(diagnostic)) reject(new Error('Native profile reader reported storage corruption'))
      else resolve()
    })
  })
  await rejectNativeCorruption(request.profile)
  return JSON.parse(await fs.readFile(path.join(request.directory, 'result.json'), 'utf8')) as NativeStorageSnapshot
}

/** Copies live only in the current core transaction; Chromium never opens published R. */
export async function validateRestrictedDesktopStorage(binding: StorageBinding, options: { executable?: string; childEntry?: string } = {}): Promise<void> {
  const status = await readStorageMigrationStatus(binding)
  if (status?.state !== 'validation-required' || !status.id || !/^[a-f0-9-]{36}$/.test(status.id)) throw new Error('Native validation requires the current published migration transaction')
  const transaction = path.join(binding.internalDir, 'migrations', status.id)
  await assertUnlinkedDirectoryPath(transaction)
  const work = await fs.mkdtemp(path.join(transaction, 'native-validation-'))
  await fs.chmod(work, 0o700)
  try {
    // Executed via the installed Electron binary, not a user-supplied script or renderer.
    const childEntry = options.childEntry ?? path.join(__dirname, 'storage-validation.cjs')
    if (!await exists(childEntry)) throw new Error('Packaged restricted storage validator is missing')
    const desktopRoot = path.dirname(path.dirname(childEntry))
    const entry = resolveRendererEntry({ isPackaged: desktopRoot.endsWith('.asar'), appRoot: desktopRoot, env: process.env })
    const url = /^http:/.test(entry) ? new URL(entry).toString() : pathToFileURL(entry).toString()
    const consume = async (source: string, name: string) => {
      const directory = path.join(work, name)
      await fs.mkdir(directory, { mode: 0o700 })
      const profile = path.join(directory, 'profile')
      await copyProfile(source, profile)
      const disk = await validateProfileFiles(profile, url)
      const snapshot = await runRestrictedStorageChild({ version: 1, directory, profile, url }, options.executable ?? process.execPath, childEntry)
      validateDesktopStorageSnapshot(snapshot)
      // shortcut: Chromium has no independent LevelDB count API; refuse an empty
      // recovered store with saved disk records rather than certify data loss.
      if (disk.local && !Object.keys(snapshot.localStorage).length) throw new Error('Saved LevelDB records were not consumed at the actual renderer origin')
      if (disk.indexed && !snapshot.indexedDB.length) throw new Error('Saved IndexedDB databases were not consumed at the actual renderer origin')
      return snapshot
    }
    const proofKey = randomBytes(32).toString('hex')
    const consumeLogins = async (root: string, name: string) => {
      const snapshots = new Map<EchoFlowLoginEndpoint, NonNullable<NativeStorageSnapshot['login']>>()
      for (const login of loginPartitions) {
        const source = path.join(root, 'Partitions', partitionDirectory(login.partition))
        if (!await exists(source)) continue
        const directory = path.join(work, `${name}-${login.endpoint}`)
        await fs.mkdir(directory, { mode: 0o700 })
        const profile = path.join(directory, 'profile')
        const partition = await copyProfile(source, profile, login.endpoint)
        const disk = await validateProfileFiles(partition, login.url)
        const expectedCookies = await expectedLoginCookieCount(partition, login.origin)
        const result = (await runRestrictedStorageChild({ version: 1, directory, profile, url: login.url, login: { endpoint: login.endpoint, proofKey } }, options.executable ?? process.execPath, childEntry)).login
        if (!result) throw new Error('Missing restricted login storage proof')
        if (result.cookieCount !== expectedCookies) throw new Error('Chromium could not read all saved login cookies')
        if (disk.local && !result.localCount) throw new Error('Chromium could not read saved login localStorage')
        if (disk.indexed && !result.indexedCount) throw new Error('Chromium could not read saved login IndexedDB')
        snapshots.set(login.endpoint, result)
      }
      return snapshots
    }
    const target = await consume(binding.root, 'published')
    const targetLogins = await consumeLogins(binding.root, 'published')
    const journal = JSON.parse(await fs.readFile(path.join(transaction, 'journal.json'), 'utf8')) as { sources: { directory: string; destination?: string; ownership?: string; layout?: string; archive?: boolean }[] }
    for (const [index, source] of journal.sources.entries()) {
      if (source.destination || source.ownership === 'legacy-internal' || source.layout || source.archive) continue
      const before = await consume(source.directory, `source-${index}`)
      assertDesktopStoragePreserved(before, target)
      for (const [endpoint, saved] of await consumeLogins(source.directory, `source-${index}`)) {
        const current = targetLogins.get(endpoint)
        if (!current || saved.cookieDigest !== current.cookieDigest) throw new Error('Native login cookies changed during migration')
        if (saved.storageDigest !== current.storageDigest) throw new Error('Native login localStorage or IndexedDB changed during migration')
      }
    }
  } finally { await fs.rm(work, { recursive: true, force: true }) }
}
