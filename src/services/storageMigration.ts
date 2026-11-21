import { createHash, randomUUID } from 'node:crypto'
import { homedir, hostname } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { LOCAL_INDEX_SCHEMA_VERSION, migrateLocalIndexDatabase } from '../server/services/localIndex/migrations'
import { constants, lstatSync, realpathSync } from 'node:fs'
import { buildEchoFlowOwnershipMarker, ensureEchoFlowConfigRoot, resolveStorageBinding, type StorageBinding } from '../utils/echoFlowConfigRoot'
import { relocateManagedData } from '../utils/storageMigrationMetadata'
import { relocateManagedStoragePath } from '../utils/managedStoragePath'
import { readStorageRelocations } from '../utils/storageRelocations'
import { resolveWhatsAppAuthPath, validateStoredAdapterConfig } from '../../adapters/common/config'
import { listLegacyArchiveTranscripts, migrateArchiveState, parseSessionArchiveMarker, readLegacyArchiveTranscript, sessionArchiveMarkerName, sessionArchiveStateName } from '../utils/sessionArchiveData'
import { fileSuffixForOauthConfig } from '../constants/oauth'
import { normalizeTokenFile } from './openaiAuth/tokenFile'
import { createReadStream, createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import fs from 'node:fs/promises'
import path from 'node:path'

export type MigrationFile = {
  relative: string
  source: string
  kind: 'file' | 'directory' | 'link'
  size: number
  mode: number
  mtime: number
  link?: string
  digest?: string
}

const indexes = new Set(['index-v1.sqlite', 'trace-index-v1.sqlite', 'search-index-v1.sqlite', 'scheduled-runs-v1.sqlite'])

export function skipMigrationEntry(relative: string): boolean {
  const normalized = relative.split(path.sep).join('/')
  if (normalized.startsWith('cc-haha/db/')) {
    const name = normalized.slice('cc-haha/db/'.length)
    if (indexes.has(name.replace(/-(wal|shm|journal)$/, ''))) return true
  }
  if (normalized === '.runtime/venv' || normalized.startsWith('.runtime/venv/')) return true
  if (/^\.runtime\/(?:requirements\.sha256|venv-base-interpreter\.txt)$/.test(normalized)) return true
  if (/^\.runtime\/cu-helper\.daemon\..*\.sock(?:\.pid)?$/.test(normalized)) return true
  if (/^sessions\/\d+\.json$/.test(normalized)) return true
  return normalized === '.credentials.json.lock' || normalized === '.config.json.lock' || /^\.claude(?:-.*)?\.json\.lock$/.test(normalized)
}

export function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export async function canonicalPath(input: string): Promise<string> {
  let current = path.resolve(input)
  const missing: string[] = []
  for (;;) {
    try { return path.join(await fs.realpath(current), ...missing) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

export type MigrationDirectoryIdentity = { canonical: string; dev: string; ino: string }

export async function migrationDirectoryIdentity(directory: string): Promise<MigrationDirectoryIdentity> {
  const canonical = await fs.realpath(directory)
  const stat = await fs.stat(directory, { bigint: true })
  if (!stat.isDirectory()) throw new Error('Migration directory is not a directory')
  return { canonical, dev: String(stat.dev), ino: String(stat.ino) }
}

export async function assertMigrationDirectory(directory: string, expected: MigrationDirectoryIdentity): Promise<void> {
  const actual = await migrationDirectoryIdentity(directory)
  // Some volumes do not expose an inode. Canonical paths still bind the root;
  // compare the volume and inode whenever the filesystem provides them.
  if (path.relative(actual.canonical, expected.canonical) !== '' || actual.dev !== expected.dev || (expected.ino !== '0' && actual.ino !== expected.ino)) {
    throw new Error('Migration directory was replaced; choose the directory again')
  }
}

export async function assertUnlinkedDirectoryPath(directory: string): Promise<void> {
  let current = path.resolve(directory)
  for (;;) {
    const stat = await fs.lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Migration directory path contains a link')
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

export async function scanMigrationFiles(sourceDir: string, homeDir?: string, signal?: AbortSignal): Promise<MigrationFile[]> {
  const files: MigrationFile[] = []
  async function visit(source: string, relative: string): Promise<void> {
    signal?.throwIfAborted()
    if (skipMigrationEntry(relative)) return
    const stat = await fs.lstat(source)
    if (stat.isSymbolicLink()) {
      files.push({ relative, source, kind: 'link', size: 0, mode: stat.mode, mtime: stat.mtimeMs, link: await fs.readlink(source) })
    } else if (stat.isDirectory()) {
      files.push({ relative, source, kind: 'directory', size: 0, mode: stat.mode, mtime: stat.mtimeMs })
      for (const name of (await fs.readdir(source)).sort()) await visit(path.join(source, name), path.join(relative, name))
    } else if (stat.isFile()) {
      files.push({ relative, source, kind: 'file', size: stat.size, mode: stat.mode, mtime: stat.mtimeMs })
    } else {
      throw new Error(`Unsupported data entry: ${relative}`)
    }
  }
  for (const name of (await fs.readdir(sourceDir)).sort()) await visit(path.join(sourceDir, name), name)
  if (homeDir && !files.some(file => file.relative === '.config.json')) {
    for (const suffix of ['', '-custom-oauth', '-staging-oauth', '-local-oauth']) {
      signal?.throwIfAborted()
      const name = `.claude${suffix}.json`
      const source = path.join(homeDir, name)
      try {
        const stat = await fs.lstat(source)
        if (!stat.isFile()) throw new Error(`Global configuration is not a regular file: ${name}`)
        if (files.some(file => file.relative === name)) throw new Error(`Global configuration collision: ${name}`)
        files.push({ relative: name, source, kind: 'file', size: stat.size, mode: stat.mode, mtime: stat.mtimeMs })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  return files
}

export async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk)
  return hash.digest('hex')
}

export async function copyMigrationFiles(
  files: MigrationFile[], sourceDir: string, targetDir: string, stagedDir: string,
  signal: AbortSignal, progress: (file: MigrationFile) => void,
  validateDirectories?: () => Promise<void>,
): Promise<void> {
  const sourceReal = await fs.realpath(sourceDir)
  for (const file of files) {
    signal.throwIfAborted()
    await validateDirectories?.()
    const output = path.join(stagedDir, file.relative)
    if (!isWithin(stagedDir, output)) throw new Error('Unsafe migration path')
    if (file.kind === 'directory') {
      // Keep the private copy writable until managed metadata has been updated.
      // Applying a read-only source directory mode here prevents copying its children.
      await fs.mkdir(output, { mode: 0o700 })
    } else if (file.kind === 'link') {
      const original = file.link!
      const resolved = path.resolve(path.dirname(file.source), original)
      const resolvedReal = await canonicalPath(resolved)
      const internalRoot = isWithin(sourceDir, resolved) ? sourceDir : isWithin(sourceReal, resolved) ? sourceReal : undefined
      const internal = internalRoot ? path.relative(internalRoot, resolved)
        : isWithin(sourceReal, resolvedReal) ? path.relative(sourceReal, resolvedReal) : undefined
      let link = path.isAbsolute(original) && internal !== undefined ? path.join(targetDir, internal) : original
      const targetStat = await fs.stat(file.source).catch(() => null)
      if (process.platform === 'win32' && targetStat?.isDirectory()) {
        link = internal !== undefined ? path.join(targetDir, internal) : resolved
      }
      await fs.symlink(link, output, targetStat?.isDirectory() ? 'junction' : 'file')
    } else {
      const hash = createHash('sha256')
      const hashing = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk) } })
      await pipeline(createReadStream(file.source), hashing, createWriteStream(output, { flags: 'wx', mode: file.mode, flush: true }), { signal })
      await fs.chmod(output, file.mode)
      await fs.utimes(output, new Date(file.mtime), new Date(file.mtime))
      file.digest = hash.digest('hex')
      if (await hashFile(output, signal) !== file.digest) throw new Error(`Copy verification failed: ${file.relative}`)
    }
    progress(file)
  }
}

export async function restoreMigrationPermissions(files: MigrationFile[], stagedDir: string, signal: AbortSignal): Promise<void> {
  for (const file of [...files].reverse()) {
    signal.throwIfAborted()
    if (file.kind !== 'link') await fs.chmod(path.join(stagedDir, file.relative), file.mode)
  }
}

export async function verifyMigrationSource(files: MigrationFile[], current: MigrationFile[], signal: AbortSignal): Promise<void> {
  const shape = (entries: MigrationFile[]) => JSON.stringify(entries.map(({ relative, kind, size, mtime, link }) => ({ relative, kind, size, mtime, link })))
  if (shape(files) !== shape(current)) throw new Error('Source data changed during migration; close other Claude processes and retry')
  for (const file of files) {
    signal.throwIfAborted()
    if (file.kind === 'file' && await hashFile(file.source, signal) !== file.digest) throw new Error(`Source data changed: ${file.relative}`)
  }
}

export type VerifiedMigrationFile = { relative: string; kind: MigrationFile['kind']; digest?: string; link?: string }

export async function migrationManifest(root: string, signal?: AbortSignal): Promise<VerifiedMigrationFile[]> {
  const files = await scanMigrationFiles(root, undefined, signal)
  const manifest: VerifiedMigrationFile[] = []
  for (const file of files) manifest.push({
    relative: file.relative, kind: file.kind,
    ...(file.kind === 'file' ? { digest: await hashFile(file.source, signal) } : {}),
    ...(file.kind === 'link' ? { link: file.link } : {}),
  })
  return manifest
}

export function assertMigrationManifest(manifest: unknown): asserts manifest is VerifiedMigrationFile[] {
  if (!Array.isArray(manifest)) throw new Error('Invalid migration manifest')
  const seen = new Set<string>()
  for (const file of manifest) {
    if (!file || typeof file !== 'object' || typeof file.relative !== 'string' || !file.relative || file.relative.includes('\0') ||
      path.isAbsolute(file.relative) || path.win32.isAbsolute(file.relative) || file.relative.split(/[\\/]/).some((part: string) => !part || part === '.' || part === '..') ||
      !['file', 'directory', 'link'].includes(file.kind) ||
      (file.kind === 'file' && (typeof file.digest !== 'string' || !/^[a-f0-9]{64}$/.test(file.digest))) ||
      (file.kind === 'link' && typeof file.link !== 'string')) throw new Error('Invalid migration manifest entry')
    const key = process.platform === 'win32' ? file.relative.toLowerCase() : file.relative
    if (seen.has(key)) throw new Error('Duplicate migration manifest entry')
    seen.add(key)
  }
}

export async function validateMigrationManifest(root: string, manifest: VerifiedMigrationFile[]): Promise<void> {
  assertMigrationManifest(manifest)
  // Validate each ancestor before reading a file: lstat(file) alone follows a
  // replaced parent junction and can hash data outside the copied tree.
  const checked = new Set<string>()
  for (const file of manifest) {
    const target = path.join(root, file.relative)
    if (!isWithin(root, target)) throw new Error('Invalid migration manifest path')
    let parent = path.dirname(target)
    while (isWithin(root, parent) && !checked.has(parent)) {
      const stat = await fs.lstat(parent)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Migration manifest parent was replaced')
      checked.add(parent)
      if (parent === root) break
      parent = path.dirname(parent)
    }
    const stat = await fs.lstat(target)
    if (file.kind === 'directory' && !stat.isDirectory()) throw new Error(`Migration directory missing: ${file.relative}`)
    if (file.kind === 'link' && (!stat.isSymbolicLink() || await fs.readlink(target) !== file.link)) throw new Error(`Migration link changed: ${file.relative}`)
    if (file.kind === 'file' && (!stat.isFile() || await hashFile(target) !== file.digest)) throw new Error(`Migration file changed: ${file.relative}`)
  }
}

export type StorageMigrationSource = {
  directory: string
  /** Existing, validated product marker, not a declaration of ownership. */
  markerRoot: string
  /** Legacy product subtree proven by providers, or exact index schema plus a provider-owned sibling. */
  ownership?: 'legacy-internal'
  /** For an internal-only source, e.g. R/cc-haha -> R/echoflow-code. */
  destination?: string
  /** Fixed projections never claim or retire their parent directory. */
  layout?: 'flat-indexes' | 'root-config' | 'desktop-state' | 'legacy-controls' | 'approved-external'
  /** Durable approval receipt id under I/storage-approvals. */
  approval?: string
  /** Exact files selected by that approval. */
  approvedFiles?: readonly string[]
  approvalCategory?: 'im-adapters' | 'whatsapp-auth'
  /** Inspector-validated control bytes; never installed as active launch controls. */
  controls?: Partial<Record<'data-migration-v1.json' | 'app-mode.json', { digest: string; dev: string; ino: string }>>
  /** Obsolete, independently owned v1 data is history, not an active merge input. */
  archive?: true
}
export type StorageMigrationHooks = {
  /** Must drain/stop ALL known writers, including processes not using leases.
   * Throw if an external writer cannot be ruled out. Rechecked at boundaries. */
  assertQuiescent(roots: readonly string[]): Promise<void>
  /** Must validate a stopped SQLite snapshot including its WAL, without mutating it. */
  validateSQLite?(database: string): Promise<void>
  /** Platform resources keep their receipts under transactionDir, never in old roots. */
  prepareResources?(transactionDir: string, sources: readonly StorageMigrationSource[]): Promise<void>
  validateResources?(transactionDir: string): Promise<void>
  cleanupResources?(transactionDir: string): Promise<void>
  signal?: AbortSignal
  /** Schema owner upgrades only known managed JSON; throws on future schemas. */
  upgradeJson?(relative: string, value: unknown): unknown
  /** Required on Windows; inherited ACLs are not a substitute for verification. */
  permissions?: {
    restrictStaging(directory: string, signal: AbortSignal): Promise<void>
    preflight(sources: string[], stagingDir: string, signal: AbortSignal): Promise<void>
    preserve(entries: { source: string; target: string }[], signal: AbortSignal): Promise<void>
  }
  platform?: NodeJS.Platform
}
export type StorageMigrationResult = {
  state: 'ready' | 'blocked' | 'validation-required' | 'cleanup-pending'
  id?: string
  issues: string[]
}
export type FileIdentity = { dev: string; ino: string; size: number; digest: string; mode: number }
type FilePublication = {
  destination: string
  baseline: FileIdentity | null
  published?: FileIdentity
  publicationIntent?: FileIdentity
  stagedDigest?: string
}
type ImportEntry = FilePublication & {
  source: number
  relative: string
  original: FileIdentity
  cleaned?: boolean
}
type SourceDirectory = { relative: string; identity: MigrationDirectoryIdentity; mode: number }
type SourceSnapshot = StorageMigrationSource & { identity: MigrationDirectoryIdentity; directories: SourceDirectory[]; handoff?: { relative: string; identity: FileIdentity; import?: true } }
type PublishedDirectory = { relative: string; identity: MigrationDirectoryIdentity; mode: number; source: string; created: boolean }
type LegacySelection = { directory: string; name: typeof legacyControlNames[number] }
type StorageJournal = {
  version: 2
  id: string
  root: string
  rootIdentity: MigrationDirectoryIdentity
  transactionIdentity: MigrationDirectoryIdentity
  /** Freeze the OAuth filename at planning time, including recovery under another environment. */
  globalConfigDestination?: string
  legacySelection?: LegacySelection
  attempt?: string
  directories: PublishedDirectory[]
  relocation?: { baseline: FileIdentity | null; intent: FileIdentity; published?: FileIdentity }
  /** Derived archive files with no corresponding source file to retire. */
  archiveFiles?: FilePublication[]
  state: StorageMigrationResult['state']
  phase: 'copying' | 'publishing' | 'validating' | 'accepted' | 'completed'
  sources: SourceSnapshot[]
  entries: ImportEntry[]
  issues: string[]
}
export type StorageMigrationInput = {
  binding: StorageBinding
  sources: readonly StorageMigrationSource[]
  hooks: StorageMigrationHooks
  /** A cold-inspected control that selected this root independently of launch overrides. */
  legacySelection?: LegacySelection
}
const journalName = 'journal.json'
export const legacyDesktopStateNames = ['window-state.json', 'terminal-config.json', 'appearance-state.json'] as const
export const legacyControlNames = ['data-migration-v1.json', 'app-mode.json'] as const
export const legacyStorageArchive = (directory: string): string => path.join('echoflow-code', 'migration-history', createHash('sha256').update(directory).digest('hex'))
function validControls(value: StorageMigrationSource['controls']): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 &&
    Object.entries(value).every(([name, receipt]) => legacyControlNames.includes(name as typeof legacyControlNames[number]) && !!receipt &&
      typeof receipt.digest === 'string' && /^[a-f0-9]{64}$/.test(receipt.digest) && typeof receipt.dev === 'string' && /^\d+$/.test(receipt.dev) && typeof receipt.ino === 'string' && /^\d+$/.test(receipt.ino))
}
function selectedLegacyFile(source: StorageMigrationSource, name: string): boolean {
  return source.layout === 'legacy-controls' ? !!source.controls?.[name as typeof legacyControlNames[number]] :
    source.layout === 'desktop-state' && legacyDesktopStateNames.includes(name as typeof legacyDesktopStateNames[number])
}

/** File schemas prove only these individual legacy UI files, never their parent. */
function assertLegacyDesktopState(name: string, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Unproven legacy desktop state: ${name}`)
  const state = value as Record<string, unknown>
  const valid = name === 'window-state.json'
    ? ['x', 'y', 'width', 'height'].every(key => typeof state[key] === 'number' && Number.isFinite(state[key])) && Number(state.width) > 0 && Number(state.height) > 0 && typeof state.maximized === 'boolean'
    : name === 'appearance-state.json'
      ? typeof state.isDark === 'boolean' && typeof state.followSystem === 'boolean' && [state.background, state.lightBackground].every(color => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color))
      : name === 'terminal-config.json' && Object.hasOwn(state, 'bash_path') && (state.bash_path === null || typeof state.bash_path === 'string')
  if (!valid) throw new Error(`Unproven legacy desktop state: ${name}`)
}
const isGlobalConfigName = (name: unknown): name is string => typeof name === 'string' && /^\.claude(?:-(?:custom|staging|local)-oauth)?\.json$/.test(name)
const safeRelative = (value: unknown): value is string => typeof value === 'string' && !!value && !value.includes('\0') &&
  !path.isAbsolute(value) && !path.win32.isAbsolute(value) && value.split(/[\\/]/).every(part => !!part && part !== '.' && part !== '..')
const archiveStateDestination = path.join('echoflow-code', sessionArchiveStateName)
const archiveMarkerDestination = path.join('echoflow-code', sessionArchiveMarkerName)
const archiveDestinations = [archiveStateDestination, archiveMarkerDestination]
const transactionHome = (binding: StorageBinding): string => path.join(binding.internalDir, 'migrations')
const issue = (error: unknown): string => error instanceof Error ? error.message : String(error)

const sqliteSuffixes = ['', '-wal', '-shm', '-journal'] as const
const sqliteSidecarBase = (relative: string): string => relative.replace(/-(wal|shm|journal)$/, '')
async function isSQLiteFile(file: string): Promise<boolean> {
  const handle = await fs.open(file, 'r')
  const header = Buffer.alloc(16)
  try { await handle.read(header, 0, 16, 0) } finally { await handle.close() }
  return header.equals(Buffer.from('SQLite format 3\0'))
}

async function present(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
async function durableJson(file: string, value: unknown): Promise<void> {
  await assertUnlinkedDirectoryPath(path.dirname(file))
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync() } finally { await handle.close() }
    await fs.rename(temporary, file)
    await syncDirectory(path.dirname(file))
  } finally { await fs.rm(temporary, { force: true }) }
}
export async function regularIdentity(file: string): Promise<FileIdentity> {
  await assertUnlinkedDirectoryPath(path.dirname(file))
  const stat = await fs.lstat(file, { bigint: true })
  if (!stat.isFile() || stat.nlink !== 1n) throw new Error(`Migration requires an independent regular file: ${file}`)
  const digest = await hashFile(file)
  const after = await fs.lstat(file, { bigint: true })
  if (stat.dev !== after.dev || stat.ino !== after.ino || stat.size !== after.size || stat.mtimeNs !== after.mtimeNs || stat.ctimeNs !== after.ctimeNs) throw new Error(`File changed while hashing: ${file}`)
  return { dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), digest, mode: Number(stat.mode) }
}
export async function inspectOpenAiOauthFile(file: string): Promise<FileIdentity> {
  const identity = await regularIdentity(file)
  const invalid = () => new Error('Invalid OpenAI sign-in file')
  if (identity.size > 1024 * 1024) throw invalid()

  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const handle = await fs.open(file, flags)
  try {
    const stat = await handle.stat({ bigint: true })
    if (!stat.isFile() || stat.nlink !== 1n || String(stat.dev) !== identity.dev || String(stat.ino) !== identity.ino) {
      throw new Error('OpenAI sign-in file changed; choose it again')
    }
    const chunks: Buffer[] = []
    for await (const chunk of handle.createReadStream({ end: identity.size, autoClose: false })) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    if (createHash('sha256').update(bytes).digest('hex') !== identity.digest) {
      throw new Error('OpenAI sign-in file changed; choose it again')
    }
    let value: unknown
    try { value = JSON.parse(bytes.toString('utf8')) } catch { throw invalid() }
    const tokens = normalizeTokenFile(value)
    if (!tokens?.accessToken.trim() || !tokens.refreshToken.trim()) throw invalid()
    return identity
  } finally { await handle.close() }
}

const imFileNames = ['adapters.json', 'adapter-sessions.json']
const maxImFileBytes = 16 * 1024 * 1024

export function assertImFileSelection(files: readonly string[]): void {
  if (!files.length || files.length > imFileNames.length || new Set(files).size !== files.length ||
    files.some(file => file.includes('\0') || !path.isAbsolute(file) || path.resolve(file) !== file ||
      path.dirname(file) !== path.dirname(files[0]!) || !imFileNames.includes(path.basename(file)))) {
    throw new Error('Choose adapters.json and/or adapter-sessions.json from one directory using absolute paths')
  }
}

async function inspectImFile(binding: StorageBinding, file: string, name: string, sourceDirectory: string): Promise<FileIdentity> {
  await assertUnlinkedDirectoryPath(path.dirname(file))
  const before = await fs.lstat(file, { bigint: true })
  if (!before.isFile() || before.nlink !== 1n || before.size > maxImFileBytes) throw new Error(`IM migration requires a regular file of at most 16 MiB: ${name}`)
  const handle = await fs.open(file, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK))
  const unchanged = (stat: typeof before) => stat.isFile() && stat.nlink === 1n && stat.dev === before.dev && stat.ino === before.ino &&
    stat.size === before.size && stat.mode === before.mode && stat.mtimeNs === before.mtimeNs && stat.ctimeNs === before.ctimeNs
  let bytes: Buffer
  try {
    if (!unchanged(await handle.stat({ bigint: true }))) throw new Error(`IM storage file changed: ${name}`)
    bytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw new Error(`IM storage file changed: ${name}`)
      offset += bytesRead
    }
    if (!unchanged(await fs.lstat(file, { bigint: true }))) throw new Error(`IM storage file changed: ${name}`)
  } finally { await handle.close() }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)) } catch { throw new Error(`Invalid IM JSON: ${name}`) }
  if (name === 'adapters.json') {
    const config = validateStoredAdapterConfig(value)
    await assertImAuthDependency(binding, sourceDirectory, config)
  } else if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.values(value).every(entry =>
    entry && typeof entry === 'object' && typeof entry.sessionId === 'string' && entry.sessionId.length && !entry.sessionId.includes('\0') &&
    typeof entry.workDir === 'string' && entry.workDir.length && !entry.workDir.includes('\0') && Number.isFinite(entry.updatedAt))) {
    throw new Error('Invalid IM session map')
  }
  return { dev: String(before.dev), ino: String(before.ino), size: bytes.length, mode: Number(before.mode), digest: createHash('sha256').update(bytes).digest('hex') }
}

async function assertImAuthDependency(
  binding: StorageBinding, source: string, config: ReturnType<typeof validateStoredAdapterConfig>,
): Promise<void> {
  const managedDefault = resolveWhatsAppAuthPath('', binding.root)
  const legacyDefault = resolveWhatsAppAuthPath('', source)
  const unavailable = () => new Error('IM config depends on WhatsApp sign-in data that has not been verified in the selected directory; migrate the complete account first')
  const verify = async (configured: string, accountJid: string | undefined) => {
    const configuredPath = resolveWhatsAppAuthPath(configured, binding.root)
    const origin = !configured.trim() && await present(legacyDefault) ? legacyDefault : configuredPath
    const candidate = relocateManagedStoragePath(origin, 'WhatsApp sign-in directory', binding.root)
    if (!isWithin(binding.root, candidate) || candidate === binding.root) throw unavailable()
    if (!configured.trim() && candidate !== configuredPath) throw unavailable()
    const unboundDefault = origin === managedDefault && candidate === managedDefault && !accountJid
    if (unboundDefault && !await present(candidate)) {
      let ancestor = path.dirname(candidate)
      while (!await present(ancestor)) ancestor = path.dirname(ancestor)
      await assertUnlinkedDirectoryPath(ancestor)
      return
    }
    await assertUnlinkedDirectoryPath(candidate)
    const names = await fs.readdir(candidate)
    if (unboundDefault && names.length === 0) return
    if (!names.includes('creds.json')) throw unavailable()
    if (candidate !== origin) {
      const previous = (await readJournals(binding)).find(journal => journal.phase === 'completed' && journal.sources.some(item => !item.layout && !item.archive && isWithin(item.directory, origin)) &&
        names.every(name => journal.entries.some(entry => path.join(binding.root, entry.destination) === path.join(candidate, name) &&
          path.join(journal.sources[entry.source]!.directory, entry.relative) === path.join(origin, name) && entry.published && entry.cleaned)))
      if (!previous || !names.some(name => /^(session|pre-key|app-state-sync-key|sender-key)-.+\.json$/.test(name))) throw unavailable()
    }
    for (const name of names) {
      const stat = await fs.lstat(path.join(candidate, name))
      if (!stat.isFile() || stat.nlink !== 1) throw unavailable()
    }
  }
  try {
    const savedPath = config.whatsappAuthDir || ''
    const activePath = process.env.WHATSAPP_AUTH_DIR || savedPath
    const activeAccount = process.env.WHATSAPP_ACCOUNT_JID || config.whatsappAccountJid
    await verify(savedPath, config.whatsappAccountJid)
    if (activePath !== savedPath || activeAccount !== config.whatsappAccountJid) await verify(activePath, activeAccount)
  } catch { throw unavailable() }
}

type WhatsAppApproval = {
  directory: string
  identity: MigrationDirectoryIdentity
  destination: string
  config: string
  configIdentity: FileIdentity
}

type ApprovedStorageFile = { source: string; relative: string; identity: FileIdentity }

export class WhatsAppAdoptionConfigRequiredError extends Error {
  constructor() { super('Choose the saved adapters.json that binds this WhatsApp account') }
}

async function readWhatsAppAdoptionConfig(file: string, expected?: FileIdentity, allowSelection = false) {
  await assertUnlinkedDirectoryPath(path.dirname(file))
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.size > maxImFileBytes) throw new Error('Invalid WhatsApp adapter configuration file')
  const identity = await regularIdentity(file)
  if (expected && !sameFile(expected, identity)) throw new Error('WhatsApp adapter configuration changed')
  const bytes = await fs.readFile(file)
  if (createHash('sha256').update(bytes).digest('hex') !== identity.digest) throw new Error('WhatsApp adapter configuration changed')
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('Invalid WhatsApp adapter configuration file') }
  const config = validateStoredAdapterConfig(value)
  if (!config.whatsappAccountJid?.trim()) {
    if (allowSelection) throw new WhatsAppAdoptionConfigRequiredError()
    throw new Error('No saved WhatsApp account binding; originals retained')
  }
  return { config, identity, jid: config.whatsappAccountJid }
}

function checkWhatsAppAdoptionConfig(binding: StorageBinding, account: WhatsAppApproval, config: Awaited<ReturnType<typeof readWhatsAppAdoptionConfig>>, published = false) {
  const savedPath = config.config.whatsappAuthDir || ''
  const selected = resolveWhatsAppAuthPath(savedPath, published ? binding.root : path.dirname(account.config))
  const override = process.env.WHATSAPP_AUTH_DIR
  const expected = published ? path.join(binding.root, account.destination) : account.directory
  const resolve = (candidate: string) => published ? relocateManagedStoragePath(candidate, 'WhatsApp sign-in directory', binding.root) : candidate
  if (resolve(selected) !== expected ||
    (override && resolve(resolveWhatsAppAuthPath(override, binding.root)) !== expected) ||
    (process.env.WHATSAPP_ACCOUNT_JID && process.env.WHATSAPP_ACCOUNT_JID !== config.jid)) {
    throw new Error('WhatsApp sign-in directory does not match the saved and effective account binding; originals retained')
  }
}

export async function previewWhatsAppAdoption(binding: StorageBinding, directory: string, sourceConfig?: string) {
  if (!path.isAbsolute(directory) || directory.includes('\0') || path.resolve(directory) !== directory ||
    isWithin(directory, binding.root) || isWithin(binding.root, directory)) throw new Error('Choose an absolute legacy WhatsApp directory outside the selected root')
  const config = sourceConfig ?? path.join(binding.root, 'adapters.json')
  if (path.basename(config) !== 'adapters.json' || !path.isAbsolute(config) || path.resolve(config) !== config || config.includes('\0') ||
    (sourceConfig && (isWithin(path.dirname(config), binding.root) || isWithin(binding.root, path.dirname(config)) || isWithin(directory, config)))) {
    throw new Error('Choose the original adapters.json outside the account and selected root')
  }
  await assertUnlinkedDirectoryPath(directory)
  const { isWhatsAppAuthFile } = await import('../../adapters/whatsapp/storageAdoption.js')
  if (!sourceConfig && !await present(config)) throw new WhatsAppAdoptionConfigRequiredError()
  const requested = await readWhatsAppAdoptionConfig(config, undefined, !sourceConfig)
  if (!sourceConfig && resolveWhatsAppAuthPath(requested.config.whatsappAuthDir || '', path.dirname(config)) !== directory) {
    throw new WhatsAppAdoptionConfigRequiredError()
  }
  const account: WhatsAppApproval = {
    directory, identity: await migrationDirectoryIdentity(directory), config, configIdentity: requested.identity,
    destination: path.join('whatsapp-auth', requested.config.whatsappAuthDir
      ? createHash('sha256').update(directory).digest('hex') : 'default'),
  }
  checkWhatsAppAdoptionConfig(binding, account, requested)
  const names = (await fs.readdir(directory)).sort()
  if (!names.includes('creds.json') || names.some(name => !isWhatsAppAuthFile(name))) throw new Error('Incomplete or unrecognized WhatsApp sign-in directory; originals retained')
  const files: ApprovedStorageFile[] = []
  for (const relative of names) {
    const source = path.join(directory, relative)
    const stat = await fs.lstat(source)
    if (!stat.isFile() || stat.size > maxImFileBytes) throw new Error('Invalid WhatsApp sign-in file; originals retained')
    files.push({ source, relative, identity: await regularIdentity(source) })
  }
  const target = path.join(binding.root, account.destination)
  if (await present(target)) {
    await assertUnlinkedDirectoryPath(target)
    const targetNames = (await fs.readdir(target)).sort()
    if (targetNames.length > 0 && (JSON.stringify(targetNames) !== JSON.stringify(names) ||
      !(await Promise.all(files.map(async file => (await regularIdentity(path.join(target, file.relative))).digest === file.identity.digest))).every(Boolean))) {
      throw new Error('Conflicting WhatsApp sign-in directories; originals retained')
    }
  }
  const activeConfig = path.join(binding.root, 'adapters.json')
  if (sourceConfig) {
    if (await present(activeConfig) && (await regularIdentity(activeConfig)).digest !== account.configIdentity.digest) {
      throw new Error('Conflicting IM adapter configuration; originals retained')
    }
    files.push({ source: config, relative: 'adapters.json', identity: account.configIdentity })
  }
  return { account, files }
}

export async function previewImAdoption(binding: StorageBinding, files: readonly string[]) {
  assertImFileSelection(files)
  const directory = path.dirname(files[0]!)
  if (isWithin(directory, binding.root) || isWithin(binding.root, directory)) throw new Error('Choose IM files in a separate source directory')
  let ancestor = binding.root
  while (!await present(ancestor)) ancestor = path.dirname(ancestor)
  await assertUnlinkedDirectoryPath(ancestor)
  return await Promise.all(files.map(async file => {
    const name = path.basename(file)
    const identity = await inspectImFile(binding, file, name, directory)
    const target = path.join(binding.root, name)
    if (await present(target) && (await regularIdentity(target)).digest !== identity.digest) throw new Error(`Conflicting IM storage file (originals retained): ${name}`)
    return { file, target, identity }
  }))
}

function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.digest === b.digest && a.mode === b.mode
}
async function checkFile(file: string, expected: FileIdentity): Promise<void> {
  if (!sameFile(await regularIdentity(file), expected)) throw new Error(`Migration file identity or bytes changed: ${file}`)
}
async function ownership(markerRoot: string): Promise<void> {
  await assertUnlinkedDirectoryPath(markerRoot)
  const file = path.join(markerRoot, 'app.json')
  let value: unknown
  try {
    await regularIdentity(file)
    value = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Unproven or future storage ownership: ${markerRoot}`)
    throw error
  }
  const marker = buildEchoFlowOwnershipMarker()
  if (!value || typeof value !== 'object' || !('owner' in value) || !('appId' in value) || !('schemaVersion' in value) || value.owner !== marker.owner || value.appId !== marker.appId || value.schemaVersion !== 1) throw new Error(`Unproven or future storage ownership: ${markerRoot}`)
}
const handoffDirectory = path.join('echoflow-code', 'storage-handoffs')
const handoffName = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/
export type StorageHandoffLaunch = { source: string; id: string; proof: string }
export type StorageHandoffRequest = { version: 1; id: string; source: string; target: string; sourceIdentity: MigrationDirectoryIdentity; targetIdentity: MigrationDirectoryIdentity; state: 'pending' | 'cancelled'; desktop?: true; import?: true; [key: string]: unknown }
type SourceHandoff = { relative: string; identity: FileIdentity; target: MigrationDirectoryIdentity; desktop?: true; import?: true }
const handoffProof = (identity: FileIdentity): string => `${identity.digest}:${identity.dev}:${identity.ino}`
function parseStorageHandoff(bytes: string, name: string): StorageHandoffRequest {
  const request = JSON.parse(bytes) as StorageHandoffRequest
  if (!request || !handoffName.test(name) || name !== `${request.id}.json` || request.version !== 1 ||
    !validDirectoryIdentity(request.sourceIdentity) || !validDirectoryIdentity(request.targetIdentity) ||
    request.source !== request.sourceIdentity.canonical || request.target !== request.targetIdentity.canonical ||
    path.resolve(request.source) !== request.source || path.resolve(request.target) !== request.target ||
    isWithin(request.source, request.target) || isWithin(request.target, request.source) || !['pending', 'cancelled'].includes(request.state) ||
    (request.import !== undefined && (request.import !== true || request.desktop !== undefined))) throw new Error('Invalid storage handoff request')
  return request
}

const approvalName = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const approvalDirectory = 'storage-approvals'
const approvalHome = (binding: StorageBinding): string => path.join(binding.internalDir, approvalDirectory)
type StorageApprovalReceipt = {
  version: 1
  id: string
  root: string
  destination?: string
  approvalCategory?: 'im-adapters' | 'whatsapp-auth'
  rootIdentity?: MigrationDirectoryIdentity
  state: 'pending' | 'cancelled'
  cohort?: string
  files: ApprovedStorageFile[]
  whatsapp?: WhatsAppApproval
  [key: string]: unknown
}

function whatsappApprovalSources(binding: StorageBinding, receipt: StorageApprovalReceipt): StorageMigrationSource[] {
  const account = receipt.whatsapp!
  const paths = receipt.files.map(file => file.source)
  const hasConfig = account.config !== path.join(binding.root, 'adapters.json')
  const create = (directory: string, approvedFiles: string[], destination?: string): StorageMigrationSource => ({
    directory, markerRoot: directory, layout: 'approved-external', approval: receipt.id, approvalCategory: 'whatsapp-auth', approvedFiles, destination,
  })
  return [create(account.directory, paths.filter(file => file !== account.config), account.destination),
    ...(hasConfig ? [create(path.dirname(account.config), [account.config])] : [])]
}

const whatsappDestination = /^whatsapp-auth[\\/](?:default|[a-f0-9]{64})$/

function parseStorageApproval(value: unknown, binding: StorageBinding, id: string): StorageApprovalReceipt {
  const receipt = value as StorageApprovalReceipt
  if (!receipt || receipt.version !== 1 || receipt.id !== id || !approvalName.test(id) ||
    receipt.root !== binding.root || !['pending', 'cancelled'].includes(receipt.state) ||
    (receipt.approvalCategory === 'im-adapters' || receipt.approvalCategory === 'whatsapp-auth'
      ? receipt.destination !== undefined || !validDirectoryIdentity(receipt.rootIdentity) || receipt.rootIdentity.canonical !== binding.root
      : receipt.approvalCategory !== undefined || !safeRelative(receipt.destination)) ||
    (receipt.cohort !== undefined && (typeof receipt.cohort !== 'string' || !receipt.cohort)) ||
    !Array.isArray(receipt.files) || !receipt.files.length ||
    !receipt.files.every(file => file && typeof file.source === 'string' && path.isAbsolute(file.source) && path.resolve(file.source) === file.source &&
      safeRelative(file.relative) && validIdentity(file.identity) && path.join(path.dirname(file.source), file.relative) === file.source)) throw new Error('Invalid storage approval receipt')
  if (new Set(receipt.files.map(file => file.source)).size !== receipt.files.length) throw new Error('Duplicate storage approval file')
  if (receipt.approvalCategory === 'whatsapp-auth') {
    const account = receipt.whatsapp
    if (!account || typeof account.directory !== 'string' || !validDirectoryIdentity(account.identity) ||
      account.identity.canonical !== account.directory || !whatsappDestination.test(account.destination) ||
      typeof account.config !== 'string' || path.basename(account.config) !== 'adapters.json' ||
      !path.isAbsolute(account.config) || path.resolve(account.config) !== account.config || !validIdentity(account.configIdentity) ||
      !receipt.files.some(file => file.source === path.join(account.directory, 'creds.json')) ||
      receipt.files.some(file => file.source !== account.config && path.dirname(file.source) !== account.directory)) {
      throw new Error('Invalid WhatsApp storage approval')
    }
    const storedConfig = receipt.files.find(file => file.source === account.config)
    if (account.config === path.join(binding.root, 'adapters.json') ? storedConfig : !storedConfig || !sameFile(storedConfig.identity, account.configIdentity)) {
      throw new Error('Invalid WhatsApp configuration approval')
    }
    for (const source of whatsappApprovalSources(binding, receipt)) assertSourceScope(source, binding)
  } else if (new Set(receipt.files.map(file => path.dirname(file.source))).size !== 1) {
    throw new Error('Approved files must share one directory')
  }
  return receipt
}
async function readApproval(binding: StorageBinding, id: string): Promise<StorageApprovalReceipt> {
  if (!approvalName.test(id)) throw new Error('Invalid storage approval id')
  const file = path.join(approvalHome(binding), `${id}.json`)
  await assertUnlinkedDirectoryPath(approvalHome(binding))
  const identity = await regularIdentity(file)
  const receipt = parseStorageApproval(JSON.parse(await fs.readFile(file, 'utf8')), binding, id)
  await checkFile(file, identity)
  if (receipt.approvalCategory) await assertMigrationDirectory(binding.root, receipt.rootIdentity!)
  return receipt
}
async function approvalForSource(binding: StorageBinding, source: StorageMigrationSource): Promise<StorageApprovalReceipt> {
  const receipt = await readApproval(binding, source.approval!)
  if (source.approvalCategory === 'whatsapp-auth' && receipt.approvalCategory === 'whatsapp-auth') {
    const match = whatsappApprovalSources(binding, receipt).find(item => item.directory === source.directory && item.destination === source.destination)
    if (!match || receipt.state !== 'pending' || JSON.stringify(match.approvedFiles) !== JSON.stringify(source.approvedFiles)) {
      throw new Error('WhatsApp storage source does not match its approval')
    }
    return { ...receipt, files: receipt.files.filter(file => match.approvedFiles!.includes(file.source)) }
  }
  if (receipt.state !== 'pending' || receipt.destination !== source.destination || receipt.approvalCategory !== source.approvalCategory ||
    receipt.files.length !== source.approvedFiles!.length ||
    receipt.files.some((file, index) => file.source !== source.approvedFiles![index])) throw new Error('Approved storage source is not pending or does not match its approval')
  return receipt
}
type ApprovedFileSelection = { files: readonly string[]; cohort?: string; expected?: readonly FileIdentity[] } & (
  { destination: string; approvalCategory?: undefined } | { approvalCategory: 'im-adapters'; destination?: undefined }
)

async function recordApprovedFileSource(binding: StorageBinding, id: string, options: ApprovedFileSelection): Promise<StorageMigrationSource> {
  if (!approvalName.test(id)) throw new Error('Invalid storage approval id')
  if (!options.files.length || (options.cohort !== undefined && (!options.cohort || typeof options.cohort !== 'string'))) throw new Error('Invalid approved storage source')
  const files = options.files.map(file => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || path.resolve(file) !== file) throw new Error('Invalid approved storage file')
    return file
  })
  if (new Set(files).size !== files.length) throw new Error('Duplicate storage approval file')
  if (new Set(files.map(file => path.dirname(file))).size !== 1) throw new Error('Approved files must share one directory')
  const directory = path.dirname(files[0]!)
  if (isWithin(directory, binding.root)) throw new Error('The approved source cannot contain the selected root')
  const source: StorageMigrationSource = { directory, markerRoot: directory, layout: 'approved-external', approval: id, approvedFiles: files, destination: options.destination, approvalCategory: options.approvalCategory }
  assertSourceScope(source, binding)
  const receipts = []
  for (const [index, file] of files.entries()) {
    const identity = options.approvalCategory === 'im-adapters'
      ? await inspectImFile(binding, file, path.basename(file), directory)
      : await regularIdentity(file)
    const expected = options.expected?.[index]
    if (options.expected && (!expected || !sameFile(identity, expected))) throw new Error('Approved storage file changed; choose it again')
    receipts.push({ source: file, relative: path.relative(directory, file), identity })
  }
  if (await present(path.join(approvalHome(binding), `${id}.json`))) throw new Error('Storage approval already exists')
  await assertUnlinkedDirectoryPath(binding.internalDir)
  await fs.mkdir(approvalHome(binding), { recursive: true, mode: 0o700 })
  await assertUnlinkedDirectoryPath(approvalHome(binding))
  await syncDirectory(binding.internalDir)
  await durableJson(path.join(approvalHome(binding), `${id}.json`), {
    version: 1, id, root: binding.root, state: 'pending', destination: options.destination, cohort: options.cohort,
    ...(options.approvalCategory ? { approvalCategory: options.approvalCategory, rootIdentity: await migrationDirectoryIdentity(binding.root) } : {}),
    files: receipts,
  } satisfies StorageApprovalReceipt)
  return source
}

/** Record consent under the running desktop's root; only the cold transaction may consume it. */
export async function recordColdStorageApproval(binding: StorageBinding, options: ApprovedFileSelection): Promise<StorageMigrationSource> {
  const release = await lockStorageMigration(binding, true)
  try { return await recordApprovedFileSource(binding, randomUUID(), options) } finally { await release() }
}

export type WhatsAppAdoptionPreview = Awaited<ReturnType<typeof previewWhatsAppAdoption>>

type WhatsAppAdoptionLaunch = { id: string; proof: string }

function whatsappApprovalProof(account: WhatsAppApproval, files: readonly ApprovedStorageFile[]): string {
  return createHash('sha256').update(JSON.stringify([account, files])).digest('hex')
}

export async function armWhatsAppStorageApproval(binding: StorageBinding, preview: WhatsAppAdoptionPreview, cold = false): Promise<WhatsAppAdoptionLaunch> {
  const release = await lockStorageMigration(binding, cold)
  try {
    const { account, files } = await previewWhatsAppAdoption(binding, preview.account.directory,
      preview.account.config === path.join(binding.root, 'adapters.json') ? undefined : preview.account.config)
    const proof = whatsappApprovalProof(account, files)
    if (proof !== whatsappApprovalProof(preview.account, preview.files)) throw new Error('Approved WhatsApp files changed; choose the directory again')
    const id = randomUUID()
    const receipt: StorageApprovalReceipt = {
      version: 1, id, root: binding.root, state: 'pending', approvalCategory: 'whatsapp-auth',
      rootIdentity: await migrationDirectoryIdentity(binding.root), files, whatsapp: account,
    }
    parseStorageApproval(receipt, binding, id)
    await assertUnlinkedDirectoryPath(binding.internalDir)
    await fs.mkdir(approvalHome(binding), { recursive: true, mode: 0o700 })
    await assertUnlinkedDirectoryPath(approvalHome(binding))
    await syncDirectory(binding.internalDir)
    await durableJson(path.join(approvalHome(binding), `${id}.json`), receipt)
    return { id, proof }
  } finally { await release() }
}

export async function readApprovedWhatsAppSources(binding: StorageBinding, launch: WhatsAppAdoptionLaunch): Promise<StorageMigrationSource[]> {
  const receipt = await readApproval(binding, launch.id)
  if (receipt.approvalCategory !== 'whatsapp-auth' || receipt.state !== 'pending' ||
    whatsappApprovalProof(receipt.whatsapp!, receipt.files) !== launch.proof) throw new Error('WhatsApp storage request does not match its approval')
  return whatsappApprovalSources(binding, receipt)
}

export function imStorageApprovalProof(files: readonly { file: string; identity: FileIdentity }[]): string {
  return createHash('sha256').update(JSON.stringify(files.map(({ file, identity: { digest, dev, ino, size, mode } }) =>
    [file, digest, dev, ino, size, mode]))).digest('hex')
}

export async function readApprovedFileSource(binding: StorageBinding, id: string, expected:
  { file: string; destination: string; proof: string } | { approvalCategory: 'im-adapters'; proof: string },
): Promise<StorageMigrationSource> {
  const receipt = await readApproval(binding, id)
  if (receipt.state !== 'pending') throw new Error('Storage approval is no longer pending')
  const [file] = receipt.files
  const matches = 'approvalCategory' in expected
    ? receipt.approvalCategory === expected.approvalCategory && imStorageApprovalProof(receipt.files.map(item => ({ file: item.source, identity: item.identity }))) === expected.proof
    : receipt.approvalCategory === undefined && receipt.destination === expected.destination && receipt.files.length === 1 && file?.source === expected.file &&
      `${file.identity.digest}:${file.identity.dev}:${file.identity.ino}:${file.identity.size}` === expected.proof
  if (!matches) {
    throw new Error('Cold storage request does not match its approval')
  }
  const files = receipt.files.map(file => file.source)
  const directory = path.dirname(files[0]!)
  const source: StorageMigrationSource = { directory, markerRoot: directory, layout: 'approved-external', approval: id, approvedFiles: files, destination: receipt.destination, approvalCategory: receipt.approvalCategory }
  assertSourceScope(source, binding)
  return source
}

/** Arm exact stopped files only; callers must guarantee that their writers are stopped. */
export async function armApprovedFileSource(binding: StorageBinding, id: string, options: ApprovedFileSelection): Promise<StorageMigrationSource> {
  const release = await lockStorageMigration(binding)
  try { return await recordApprovedFileSource(binding, id, options) } finally { await release() }
}
export function cancelApprovedFileSource(binding: StorageBinding, id: string): Promise<void> {
  return cancelStorageApproval(binding, id, false)
}

export function cancelColdStorageApproval(binding: StorageBinding, id: string): Promise<void> {
  return cancelStorageApproval(binding, id, true)
}

async function cancelStorageApproval(binding: StorageBinding, id: string, approvalOnly: boolean): Promise<void> {
  if (!approvalName.test(id)) throw new Error('Invalid storage approval id')
  const release = await lockStorageMigration(binding, approvalOnly)
  try {
    if ((await readJournals(binding)).some(journal => journal.sources.some(source => source.approval === id))) {
      throw new Error('Transaction-owned storage approval cannot be cancelled; recover it forward')
    }
    const receipt = await readApproval(binding, id)
    await durableJson(path.join(approvalHome(binding), `${id}.json`), { ...receipt, state: 'cancelled' })
  } finally { await release() }
}

/** The request itself is the durable barrier, not the lifetime of a launcher PID. */
async function pendingSourceHandoff(root: string): Promise<SourceHandoff | undefined> {
  const directory = path.join(root, handoffDirectory)
  if (!await present(directory)) return
  await assertUnlinkedDirectoryPath(directory)
  let pending: SourceHandoff | undefined
  for (const name of await fs.readdir(directory)) {
    if (!name.endsWith('.json')) continue
    const file = path.join(directory, name)
    const identity = await regularIdentity(file)
    const request = parseStorageHandoff(await fs.readFile(file, 'utf8'), name)
    await checkFile(file, identity)
    if (request.source !== root || request.state === 'cancelled') continue
    await assertMigrationDirectory(root, request.sourceIdentity)
    if (pending) throw new Error('Conflicting storage source handoffs')
    pending = { relative: path.join(handoffDirectory, name), identity, target: request.targetIdentity, desktop: request.desktop, import: request.import }
  }
  return pending
}
async function assertNoSourceHandoff(root: string): Promise<void> {
  if (await pendingSourceHandoff(root)) throw new Error('Storage source has a pending cold handoff; use its explicit target launch')
}
type StorageLocation = { version: 1; target: MigrationDirectoryIdentity; transaction: string }

export function storageLocationFile(home = homedir()): string {
  return path.join(realpathSync(home), '.echoflow-storage', 'active-root.sqlite')
}

function readLocation(database: DatabaseSync): StorageLocation | undefined {
  if (database.prepare('PRAGMA user_version').get()?.user_version !== 1 ||
    !database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'active_root'").get()) {
    throw new Error('Invalid active EchoFlow storage location database')
  }
  const row = database.prepare('SELECT receipt FROM active_root WHERE id = 1').get()
  if (!row) throw new Error('Missing active EchoFlow storage location receipt')
  if (row.receipt === null) return
  const record = JSON.parse(String(row.receipt)) as StorageLocation
  if (!record || record.version !== 1 || !validDirectoryIdentity(record.target) ||
    record.target.canonical !== path.resolve(record.target.canonical) || !handoffName.test(`${record.transaction}.json`)) {
    throw new Error('Invalid active EchoFlow storage location')
  }
  return record
}

function assertLocationFile(file: string): boolean {
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (!stat) return false
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(file) !== file) throw new Error('Invalid active EchoFlow storage location file')
  return true
}

function assertLocationTarget(target: MigrationDirectoryIdentity): void {
  const stat = lstatSync(target.canonical, { bigint: true, throwIfNoEntry: false })
  if (!stat?.isDirectory() || realpathSync(target.canonical) !== target.canonical ||
    String(stat.dev) !== target.dev || (target.ino !== '0' && String(stat.ino) !== target.ino)) {
    throw new Error(`Active EchoFlow storage directory is unavailable or was replaced: ${target.canonical}`)
  }
}

export function readStorageLocation(file: string): string | undefined {
  if (!lstatSync(path.dirname(file), { throwIfNoEntry: false })) return
  if (!assertLocationFile(file)) throw new Error('Invalid active EchoFlow storage location: missing database')
  const database = openStorageLocation(file)
  try {
    const record = readLocation(database)
    if (record) assertLocationTarget(record.target)
    return record?.target.canonical
  } finally { database.close() }
}

function openStorageLocation(file: string): DatabaseSync {
  assertLocationFile(`${file}-journal`)
  if (lstatSync(`${file}-wal`, { throwIfNoEntry: false }) || lstatSync(`${file}-shm`, { throwIfNoEntry: false })) {
    throw new Error('Unexpected active EchoFlow storage location sidecar')
  }
  return new DatabaseSync(file)
}

export function selectStartupStorage(binding: StorageBinding, file: string): StorageBinding {
  const root = readStorageLocation(file)
  if (root && binding.selection === 'explicit' && binding.root !== root) throw new Error('Explicit storage root conflicts with the active EchoFlow storage directory')
  return { ...(root ? resolveStorageBinding({ env: {}, roots: [root] }) : binding), location: { file } }
}

function assertSeparateLocation(file: string, root: string): void {
  const directory = path.dirname(file)
  if (isWithin(root, directory) || isWithin(directory, root)) throw new Error('Storage root overlaps the active EchoFlow storage location')
}

// SQLite releases the lock when the process exits, including during an interrupted move.
async function withStorageLocation<T>(binding: StorageBinding, action: (database?: DatabaseSync) => Promise<T>): Promise<T> {
  if (!binding.location) return await action()
  const { file } = binding.location
  assertSeparateLocation(file, binding.root)
  if (binding.location.moveSource) assertSeparateLocation(file, binding.location.moveSource)
  const directory = path.dirname(file)
  if (!await present(directory)) {
    const home = path.dirname(directory)
    await assertUnlinkedDirectoryPath(home)
    const temporary = await fs.mkdtemp(`${directory}-`)
    try {
      const fresh = new DatabaseSync(path.join(temporary, path.basename(file)))
      try {
        fresh.exec(`PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
          CREATE TABLE active_root (id INTEGER PRIMARY KEY CHECK (id = 1), receipt TEXT);
          INSERT INTO active_root VALUES (1, NULL);
          PRAGMA user_version=1; COMMIT`)
      } finally { fresh.close() }
      await syncDirectory(temporary)
      try { await fs.rename(temporary, directory) } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code!) || !assertLocationFile(file)) throw error
      }
      await syncDirectory(home)
    } finally { await fs.rm(temporary, { recursive: true, force: true }) }
  }
  await assertUnlinkedDirectoryPath(directory)
  if (!assertLocationFile(file)) throw new Error('Invalid active EchoFlow storage location: missing database')
  const database = openStorageLocation(file)
  try {
    database.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=0')
    for (let attempt = 0;; attempt++) {
      try { database.exec('BEGIN IMMEDIATE'); break } catch (error) {
        if ((error as { errcode?: number }).errcode !== 5 || attempt === 99) throw error
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    try {
      const result = await action(database)
      database.exec('COMMIT')
      return result
    } catch (error) {
      try { database.exec('ROLLBACK') } catch { /* Preserve the original error if SQLite already rolled back. */ }
      throw error
    }
  } finally { database.close() }
}

function assertLocationBinding(binding: StorageBinding, database?: DatabaseSync): void {
  if (database && !binding.location?.moveSource &&
    database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'retired_import_root'").get() &&
    database.prepare('SELECT 1 FROM retired_import_root WHERE root = ?').get(binding.root)) {
    throw new Error('Retired storage root; use the current EchoFlow storage directory')
  }
  const current = database && readLocation(database)
  if (!current) return
  assertLocationTarget(current.target)
  if (current.target.canonical !== binding.root && current.target.canonical !== binding.location?.moveSource) {
    throw new Error('Active EchoFlow storage directory changed; restart with the active directory')
  }
}

async function publishStorageLocation(binding: StorageBinding, journal: StorageJournal): Promise<void> {
  const sources = journal.sources.filter(source => source.handoff && !source.handoff.import)
  const imports = journal.sources.filter(source => source.handoff?.import)
  const [source] = sources
  const legacySelection = journal.legacySelection
  if (!source && !legacySelection && !imports.length) return
  if (!binding.location && !legacySelection) return
  if (!binding.location || sources.length > 1 || (source && legacySelection) || !['accepted', 'completed'].includes(journal.phase)) {
    throw new Error('Cannot publish this storage selection')
  }
  const file = binding.location.file
  if (source || legacySelection) assertSeparateLocation(file, source?.directory ?? legacySelection!.directory)
  await withStorageLocation(binding, async connection => {
    const database = connection!
    assertLocationBinding(binding, database)
    if (source && database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'retired_import_root'").get()) {
      // A verified explicit move can deliberately reuse a retired directory.
      database.prepare('DELETE FROM retired_import_root WHERE root = ?').run(binding.root)
    }
    if (imports.length) {
      // Retain the writer barrier after deleting the original handoff with its root.
      database.exec('CREATE TABLE IF NOT EXISTS retired_import_root (root TEXT PRIMARY KEY)')
      const record = database.prepare('INSERT OR IGNORE INTO retired_import_root (root) VALUES (?)')
      for (const imported of imports) {
        assertSeparateLocation(file, imported.directory)
        record.run(imported.directory)
      }
    }
    if (!source && !legacySelection) return
    const current = readLocation(database)
    if (current?.transaction === journal.id && current.target.canonical === binding.root) {
      assertLocationTarget(current.target)
      return
    }
    if (source) {
      if (binding.location?.moveSource !== source.directory || (current && current.target.canonical !== source.directory)) {
        throw new Error('Active EchoFlow storage location conflicts with this cold move')
      }
      if (current) {
        assertLocationTarget(current.target)
        await assertMigrationDirectory(source.directory, source.identity)
      }
    } else if (current) {
      assertLocationTarget(current.target)
      if (current.target.canonical !== binding.root) throw new Error('Active EchoFlow storage location conflicts with this legacy selection')
      return
    }
    assertLocationTarget(journal.rootIdentity)
    const control = legacySelectionEntry(journal)
    if (control) {
      const evidence = journal.sources[control.source]!
      await assertMigrationDirectory(evidence.directory, evidence.identity)
      await checkFile(path.join(evidence.directory, control.relative), control.original)
    }
    database!.prepare('INSERT OR REPLACE INTO active_root (id, receipt) VALUES (1, ?)').run(JSON.stringify({
      ...current, version: 1, target: journal.rootIdentity, transaction: journal.id,
    } satisfies StorageLocation))
  })
  await syncDirectory(path.dirname(file))
}

/** Only a verified explicit cold request can fill a missing record for a released v2 move. */
export async function recordCompletedStorageMove(binding: StorageBinding, id: string): Promise<void> {
  const journal = (await readJournals(binding)).find(item => item.id === id)
  if (!journal || journal.phase !== 'completed' || journal.state !== 'ready' || !journal.sources.some(source => source.handoff && !source.handoff.import)) {
    throw new Error('Missing completed storage move evidence')
  }
  await assertNoFork(journal)
  await publishStorageLocation(binding, journal)
}

async function ensureStorageTarget(binding: StorageBinding): Promise<void> {
  if (binding.internalDir !== path.join(binding.root, 'echoflow-code') || !path.isAbsolute(binding.root) || path.resolve(binding.root) !== binding.root) throw new Error('Invalid storage binding')
  await assertNoSourceHandoff(binding.root)
  await recoverIndexInspection(binding)
  // Reject ancestor links before mkdir, including a link to an otherwise empty root.
  let ancestor = binding.root
  while (!await present(ancestor)) ancestor = path.dirname(ancestor)
  await assertUnlinkedDirectoryPath(ancestor)
  if (await present(binding.root)) {
    await assertUnlinkedDirectoryPath(binding.root)
    if ((await fs.readdir(binding.root)).length) await ownership(binding.root)
  }
  await ensureEchoFlowConfigRoot(binding.root)
  if (await present(binding.internalDir)) await assertUnlinkedDirectoryPath(binding.internalDir)
  await fs.mkdir(transactionHome(binding), { recursive: true, mode: 0o700 })
  await assertUnlinkedDirectoryPath(transactionHome(binding))
}

type ProcessReceipt = { version: 1; host: string; pid: number; token: string }
function processAlive(receipt: ProcessReceipt): boolean {
  if (receipt.version !== 1 || receipt.host !== hostname() || !Number.isSafeInteger(receipt.pid) || receipt.pid <= 0 || typeof receipt.token !== 'string') throw new Error('Unknown storage process receipt; manual recovery required')
  try { process.kill(receipt.pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}
async function readProcessReceipt(file: string, writer: boolean): Promise<ProcessReceipt> {
  const receipt = JSON.parse(await fs.readFile(file, 'utf8')) as ProcessReceipt
  const name = path.basename(file)
  const writerName = /^([1-9]\d*)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.exec(name)
  if (!receipt || Object.keys(receipt).sort().join(',') !== 'host,pid,token,version' ||
    (writer ? !writerName || Number(writerName[1]) !== receipt.pid : name !== 'lock.json')) throw new Error('Unknown storage process receipt; manual recovery required')
  return receipt
}
async function reapStoppedReceipt(file: string, writer: boolean): Promise<boolean> {
  const identity = await regularIdentity(file)
  if (processAlive(await readProcessReceipt(file, writer))) return false
  await checkFile(file, identity)
  await fs.unlink(file)
  return true
}
async function processReceipt(file: string): Promise<() => Promise<void>> {
  const token = randomUUID()
  const handle = await fs.open(file, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify({ version: 1, host: hostname(), pid: process.pid, token })); await handle.sync() } finally { await handle.close() }
  const identity = await regularIdentity(file)
  return async () => { await checkFile(file, identity); await fs.unlink(file); await syncDirectory(path.dirname(file)) }
}
async function initializeTarget(binding: StorageBinding): Promise<void> {
  await withStorageLocation(binding, async database => {
    assertLocationBinding(binding, database)
    await ensureStorageTarget(binding)
  })
}

async function lockStorageMigration(binding: StorageBinding, approvalOnly = false): Promise<() => Promise<void>> {
  let release: (() => Promise<void>) | undefined
  return await withStorageLocation(binding, async database => {
    assertLocationBinding(binding, database)
    if (approvalOnly) await ownership(binding.root)
    await ensureStorageTarget(binding)
    release = await migrationLock(binding, approvalOnly)
    return release
  }).catch(async error => { await release?.(); throw error })
}

async function migrationLock(binding: StorageBinding, approvalOnly: boolean): Promise<() => Promise<void>> {
  await assertNoSourceHandoff(binding.root)
  const lock = path.join(transactionHome(binding), 'lock.json')
  if (await present(lock) && !await reapStoppedReceipt(lock, false)) throw new Error('Storage migration already running')
  const release = await processReceipt(lock)
  try {
    const writers = path.join(transactionHome(binding), 'writers')
    if (!approvalOnly && await present(writers)) {
      await assertUnlinkedDirectoryPath(writers)
      for (const name of await fs.readdir(writers)) {
        if (!await reapStoppedReceipt(path.join(writers, name), true)) throw new Error('Active storage writer; close it before migration')
      }
    }
    return release
  } catch (error) { await release(); throw error }
}
/** Hold this lease for the complete lifetime of a business writer, not just startup. */
export async function acquireStorageWriter(binding: StorageBinding): Promise<{ release(): Promise<void> }> {
  const lock = path.join(transactionHome(binding), 'lock.json')
  // Refuse an unowned root before creating per-user coordination files.
  if (binding.location && await present(binding.root) && !await present(inspectionDirectory(binding))) {
    await assertUnlinkedDirectoryPath(binding.root)
    if ((await fs.readdir(binding.root)).length) await ownership(binding.root)
  }
  let registered: (() => Promise<void>) | undefined
  const release = await withStorageLocation(binding, async database => {
    if (binding.location?.moveSource) throw new Error('A cold move cannot admit an ordinary storage writer')
    assertLocationBinding(binding, database)
    await ensureStorageTarget(binding)
    if (await present(lock) && (!database || !await reapStoppedReceipt(lock, false))) throw new Error('Storage migration maintenance barrier is active')
    const writers = path.join(transactionHome(binding), 'writers')
    await fs.mkdir(writers, { recursive: true, mode: 0o700 })
    await assertUnlinkedDirectoryPath(writers)
    registered = await processReceipt(path.join(writers, `${process.pid}-${randomUUID()}.json`))
    return registered
  }).catch(async error => { await registered?.(); throw error })
  try {
    // Register before reading readiness: maintenance could finish and release
    // its lock between an earlier journal read and this writer's registration.
    await assertNoSourceHandoff(binding.root)
    for (const journal of await readJournals(binding)) {
      if (journal.state !== 'ready') throw new Error(`Storage migration is ${journal.state}`)
      await assertNoFork(journal)
    }
    if (await present(lock)) throw new Error('Storage migration maintenance barrier is active')
    // A source maintenance lock can become a durable handoff during registration.
    await assertNoSourceHandoff(binding.root)
    return { release }
  } catch (error) { await release(); throw error }
}
function transactionPath(binding: StorageBinding, id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid storage transaction id')
  return path.join(transactionHome(binding), id)
}
function validIdentity(value: unknown): value is FileIdentity {
  const entry = value as FileIdentity
  return !!entry && /^\d+$/.test(entry.dev) && /^\d+$/.test(entry.ino) && Number.isSafeInteger(entry.size) && entry.size >= 0 &&
    /^[a-f0-9]{64}$/.test(entry.digest) && Number.isSafeInteger(entry.mode)
}
function validDirectoryIdentity(value: unknown): value is MigrationDirectoryIdentity {
  const entry = value as MigrationDirectoryIdentity
  return !!entry && typeof entry.canonical === 'string' && path.isAbsolute(entry.canonical) && !entry.canonical.includes('\0') &&
    typeof entry.dev === 'string' && /^\d+$/.test(entry.dev) && typeof entry.ino === 'string' && /^\d+$/.test(entry.ino)
}
function legacySelectionEntry(journal: Pick<StorageJournal, 'legacySelection' | 'sources' | 'entries'>): ImportEntry | undefined {
  if (journal.legacySelection === undefined) return
  const selection = journal.legacySelection
  if (!selection || !legacyControlNames.includes(selection.name) || journal.sources.some(source => source.handoff && !source.handoff.import)) {
    throw new Error('Invalid legacy storage selection receipt')
  }
  const entry = journal.entries.find(item => {
    const source = journal.sources[item.source]!
    return source.directory === selection.directory && !source.destination && source.controls?.[selection.name] && item.relative === selection.name
  })
  if (!entry) throw new Error('Missing legacy control for storage selection')
  return entry
}

function parseStorageJournal(value: unknown, binding: StorageBinding, id: string): StorageJournal {
  const journal = value as StorageJournal
  if (!journal || journal.version !== 2 || journal.id !== id || journal.root !== binding.root ||
    !['ready', 'blocked', 'validation-required', 'cleanup-pending'].includes(journal.state) ||
    !['copying', 'publishing', 'validating', 'accepted', 'completed'].includes(journal.phase) ||
    !Array.isArray(journal.sources) || !Array.isArray(journal.entries) || !Array.isArray(journal.issues) || !journal.issues.every(item => typeof item === 'string') ||
    !validDirectoryIdentity(journal.rootIdentity) || !validDirectoryIdentity(journal.transactionIdentity) ||
    (journal.globalConfigDestination !== undefined && !isGlobalConfigName(journal.globalConfigDestination)) ||
    (journal.attempt !== undefined && !/^[a-f0-9-]{36}$/.test(journal.attempt)) || !Array.isArray(journal.directories) ||
    !journal.directories.every(item => item && safeRelative(item.relative) && !isWithin(transactionHome(binding), path.join(binding.root, item.relative)) &&
      validDirectoryIdentity(item.identity) && Number.isInteger(item.mode) && typeof item.created === 'boolean' && typeof item.source === 'string' && path.isAbsolute(item.source)) ||
    (journal.relocation !== undefined && (!journal.relocation || !validIdentity(journal.relocation.intent) ||
      (journal.relocation.baseline !== null && !validIdentity(journal.relocation.baseline)) ||
      (journal.relocation.published !== undefined && !validIdentity(journal.relocation.published))))) throw new Error('Unsupported storage transaction journal')
  for (const source of journal.sources) {
    if (!source || !path.isAbsolute(source.directory) || path.resolve(source.directory) !== source.directory ||
      !path.isAbsolute(source.markerRoot) || !isWithin(source.markerRoot, source.directory) || !validDirectoryIdentity(source.identity) ||
      !Array.isArray(source.directories) || !source.directories.every(item => item && safeRelative(item.relative) && validDirectoryIdentity(item.identity) && Number.isInteger(item.mode)) ||
      (source.destination !== undefined && !safeRelative(source.destination)) ||
      (source.ownership !== undefined && source.ownership !== 'legacy-internal') ||
      (source.controls !== undefined && !validControls(source.controls)) || (source.archive !== undefined && source.archive !== true) ||
      (source.handoff !== undefined && (!source.handoff || !isCompleteSource(source) ||
        (source.handoff.import === undefined ? source.archive === true : source.handoff.import !== true) || !validIdentity(source.handoff.identity) ||
        path.dirname(source.handoff.relative) !== handoffDirectory || !handoffName.test(path.basename(source.handoff.relative)))) ||
      (source.approval !== undefined && (typeof source.approval !== 'string' || !approvalName.test(source.approval) ||
        !Array.isArray(source.approvedFiles) || !source.approvedFiles.length || !source.approvedFiles.every(file => typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file))) ||
      (source.layout !== undefined && !['flat-indexes', 'root-config', 'desktop-state', 'legacy-controls', 'approved-external'].includes(source.layout))) throw new Error('Invalid storage source receipt')
    assertSourceScope(source, binding)
    if (source.layout && source.directories.length) throw new Error('Invalid selective source directory receipt')
    if (source.layout === 'root-config' && !journal.globalConfigDestination) throw new Error('Missing global config destination receipt')
  }
  if (journal.archiveFiles !== undefined && (!Array.isArray(journal.archiveFiles) || journal.archiveFiles.length > 2 ||
    new Set(journal.archiveFiles.map(entry => entry?.destination)).size !== journal.archiveFiles.length ||
    !journal.archiveFiles.every(entry => entry && archiveDestinations.includes(entry.destination) &&
      (entry.baseline === null || validIdentity(entry.baseline)) &&
      (entry.published === undefined || validIdentity(entry.published)) &&
      (entry.publicationIntent === undefined || validIdentity(entry.publicationIntent)) &&
      /^[a-f0-9]{64}$/.test(entry.stagedDigest ?? '') && !journal.entries.some(source => source?.destination === entry.destination)))) {
    throw new Error('Invalid session archive publication receipt')
  }
  const seen = new Set<string>()
  for (const entry of journal.entries) {
    if (!entry || !Number.isInteger(entry.source) || !journal.sources[entry.source] || !safeRelative(entry.relative) || !safeRelative(entry.destination) ||
      entry.destination === 'echoflow-code/migrations' || entry.destination.startsWith(`echoflow-code${path.sep}migrations${path.sep}`) ||
      entry.destination === 'echoflow-code/storage-approvals' || entry.destination.startsWith(`echoflow-code${path.sep}storage-approvals${path.sep}`) ||
      !validIdentity(entry.original) || (entry.baseline !== null && !validIdentity(entry.baseline)) ||
      (entry.published !== undefined && !validIdentity(entry.published)) || (entry.publicationIntent !== undefined && !validIdentity(entry.publicationIntent)) ||
      (entry.stagedDigest !== undefined && !/^[a-f0-9]{64}$/.test(entry.stagedDigest)) || (entry.cleaned !== undefined && typeof entry.cleaned !== 'boolean')) throw new Error('Invalid storage operation receipt')
    const source = journal.sources[entry.source]!
    if (source.layout === 'flat-indexes' && (!isFlatIndexName(entry.relative) || entry.destination !== destinationFor(source, entry.relative))) throw new Error('Invalid flat index operation receipt')
    if (source.layout === 'root-config' && (entry.relative !== '.config.json' || entry.destination !== journal.globalConfigDestination)) throw new Error('Invalid root config operation receipt')
    if ((source.layout === 'desktop-state' || source.layout === 'legacy-controls' || source.archive) &&
      ((source.layout && !selectedLegacyFile(source, entry.relative)) || entry.destination !== destinationFor(source, entry.relative))) throw new Error('Invalid selective legacy operation receipt')
    const control = source.controls?.[entry.relative as typeof legacyControlNames[number]]
    if (control && (entry.original.digest !== control.digest || entry.original.dev !== control.dev || entry.original.ino !== control.ino || entry.destination !== destinationFor(source, entry.relative))) throw new Error('Invalid legacy control receipt')
    if (journal.globalConfigDestination && !source.destination && !source.archive && entry.relative === '.config.json' && entry.destination !== journal.globalConfigDestination) throw new Error('Invalid global config operation receipt')
    const key = `${entry.source}:${entry.relative}`
    if (seen.has(key)) throw new Error('Duplicate storage operation receipt')
    seen.add(key)
  }
  for (let index = 0; index < journal.sources.length; index++) {
    const entries = journal.entries.filter(entry => entry.source === index)
    const handoff = journal.sources[index]!.handoff
    if (handoff && !entries.some(entry => entry.relative === handoff.relative && sameFile(entry.original, handoff.identity))) throw new Error('Incomplete source handoff receipt')
    if (journal.sources[index]!.layout && !entries.length) throw new Error('Incomplete flat index operation receipt')
    for (const name of Object.keys(journal.sources[index]!.controls ?? {})) {
      if (!entries.some(entry => entry.relative === name)) throw new Error('Incomplete legacy control receipt')
    }
    for (const entry of entries) {
      const base = sqliteSidecarBase(entry.relative)
      if (base !== entry.relative && !historicalMaterial(entry.destination) && !entries.some(other => other.relative === base)) throw new Error('Incomplete SQLite operation receipt')
    }
  }
  legacySelectionEntry(journal)
  return journal
}
async function readJournals(binding: StorageBinding): Promise<StorageJournal[]> {
  const directory = transactionHome(binding)
  if (!await present(directory)) return []
  await assertUnlinkedDirectoryPath(directory)
  const journals: StorageJournal[] = []
  for (const id of (await fs.readdir(directory)).sort()) {
    if (id === 'writers' || id === 'lock.json') continue
    if (/^\.pending-[a-f0-9-]{36}$/.test(id)) {
      // Migration cannot change business data before publishing its journal.
      await assertUnlinkedDirectoryPath(path.join(directory, id))
      continue
    }
    const transaction = transactionPath(binding, id)
    await assertUnlinkedDirectoryPath(transaction)
    const file = path.join(transaction, journalName)
    if (!await present(file)) throw new Error(`Incomplete migration transaction requires inspection: ${id}`)
    await regularIdentity(file)
    const journal = parseStorageJournal(JSON.parse(await fs.readFile(file, 'utf8')), binding, id)
    await assertMigrationDirectory(binding.root, journal.rootIdentity)
    await assertMigrationDirectory(transaction, journal.transactionIdentity)
    for (const [index, source] of journal.sources.entries()) {
      if (source.layout !== 'approved-external') continue
      const receipt = await approvalForSource(binding, source)
      const entries = journal.entries.filter(entry => entry.source === index)
      const expected = new Map(receipt.files.map(file => [file.relative, file.identity]))
      if (entries.length !== expected.size || entries.some(entry => {
        const identity = expected.get(entry.relative)
        return !identity || !sameFile(entry.original, identity) || entry.destination !== destinationFor(source, entry.relative)
      })) throw new Error('Storage operations do not match their approval')
    }
    assertImTransactionScope(journal.sources, journal)
    await whatsappTransaction(binding, journal.sources, journal)
    journals.push(journal)
  }
  return journals
}
async function saveJournal(binding: StorageBinding, journal: StorageJournal): Promise<void> {
  await assertMigrationDirectory(binding.root, journal.rootIdentity)
  const transaction = transactionPath(binding, journal.id)
  await assertMigrationDirectory(transaction, journal.transactionIdentity)
  await durableJson(path.join(transaction, journalName), journal)
}
function resultOf(journal: StorageJournal): StorageMigrationResult { return { state: journal.state, id: journal.id, issues: [...journal.issues] } }
async function assertNoFork(journal: StorageJournal): Promise<void> {
  for (let index = 0; index < journal.sources.length; index++) {
    const source = journal.sources[index]!
    if (source.layout === 'approved-external') {
      if (source.approvalCategory && !await present(source.directory)) continue
      if (source.approvalCategory === 'whatsapp-auth' && source.destination) throw new Error('Retired WhatsApp sign-in directory was recreated')
      await assertMigrationDirectory(source.directory, source.identity)
      for (const entry of journal.entries) {
        if (entry.source !== index) continue
        if (await present(path.join(source.directory, entry.relative))) throw new Error(`Retired approved file was recreated; possible old writer: ${entry.relative}`)
      }
    } else if (source.layout) {
      await assertMigrationDirectory(source.directory, source.identity)
      if (source.layout === 'root-config') {
        if (await present(path.join(source.directory, '.config.json'))) throw new Error('Retired global config was recreated; possible old writer: .config.json')
      } else for (const name of await fs.readdir(source.directory)) {
        if (source.layout === 'flat-indexes' ? isFlatIndexName(name) : selectedLegacyFile(source, name)) throw new Error(`Retired ${source.layout === 'flat-indexes' ? 'flat index' : 'legacy file'} was recreated; possible old writer: ${name}`)
      }
    } else if (await present(source.directory)) throw new Error(`Retired storage root was recreated or not emptied; possible old writer: ${source.directory}`)
  }
}
export async function readApprovedStorageTransaction(binding: StorageBinding, approval: string): Promise<StorageMigrationResult | undefined> {
  const journals = await readJournals(binding)
  const matching = journals.filter(journal => journal.sources.some(source => source.approval === approval))
  if (matching.length > 1 || journals.some(journal => journal.state !== 'ready' && journal !== matching[0])) {
    throw new Error('Conflicting storage transaction and cold approval')
  }
  const journal = matching[0]
  if (!journal) return
  if (journal.state === 'ready') await assertNoFork(journal)
  return resultOf(journal)
}

function isFlatIndexName(name: string): boolean {
  return indexes.has(name.replace(/-(wal|shm|journal)$/, ''))
}
function assertSourceScope(source: StorageMigrationSource, binding: StorageBinding): void {
  if (source.approval !== undefined || source.approvalCategory !== undefined || source.layout === 'approved-external') {
    if (source.layout !== 'approved-external' || typeof source.approval !== 'string' || !approvalName.test(source.approval) ||
      !Array.isArray(source.approvedFiles) || !source.approvedFiles.length ||
      !source.approvedFiles.every(file => typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file) ||
      source.directory !== path.dirname(source.approvedFiles[0]!) ||
      source.approvedFiles.some(file => path.dirname(file) !== source.directory) ||
      source.directory !== source.markerRoot || source.ownership !== undefined || source.controls !== undefined || source.archive !== undefined ||
      isWithin(source.directory, binding.root) || isWithin(binding.root, source.directory)) throw new Error('Invalid approved external source scope')
    if (source.approvalCategory === 'im-adapters') {
      if (source.destination !== undefined) throw new Error('Invalid IM storage destination')
      assertImFileSelection(source.approvedFiles)
      return
    }
    if (source.approvalCategory === 'whatsapp-auth') {
      if (source.destination === undefined) {
        if (source.approvedFiles.length !== 1 || path.basename(source.approvedFiles[0]!) !== 'adapters.json') throw new Error('Invalid WhatsApp configuration scope')
      } else if (!whatsappDestination.test(source.destination) || !source.approvedFiles.includes(path.join(source.directory, 'creds.json'))) {
        throw new Error('Invalid WhatsApp sign-in scope')
      }
      return
    }
    if (source.approvalCategory !== undefined || !safeRelative(source.destination)) throw new Error('Invalid approved external destination')
    for (const file of source.approvedFiles) {
      const target = path.join(binding.root, source.destination, path.basename(file))
      if (!isWithin(binding.internalDir, target) ||
        ['migrations', approvalDirectory, 'migration-history', 'storage-handoffs', 'storage-relocations.json']
          .some(name => isWithin(path.join(binding.internalDir, name), target))) throw new Error('Invalid approved external destination')
    }
    return
  }
  if (!path.isAbsolute(source.directory) || path.resolve(source.directory) !== source.directory || !path.isAbsolute(source.markerRoot) || !isWithin(source.markerRoot, source.directory)) throw new Error('Invalid source ownership scope')
  if (source.controls !== undefined && !validControls(source.controls)) throw new Error('Invalid legacy control scope')
  if (source.archive !== undefined && (source.archive !== true || source.layout === 'root-config' || source.layout === 'flat-indexes' || source.layout === 'legacy-controls')) throw new Error('Invalid historical source scope')
  if (source.layout === 'desktop-state' || source.layout === 'legacy-controls') {
    if (source.directory !== source.markerRoot || source.destination !== undefined || source.ownership !== undefined ||
      (source.layout === 'legacy-controls' && !validControls(source.controls)) ||
      (source.layout === 'desktop-state' && (source.directory === binding.root || source.controls !== undefined))) throw new Error('Invalid selective legacy ownership scope')
    return
  }
  if (source.layout === 'root-config') {
    if (source.directory !== binding.root || source.markerRoot !== binding.root || source.destination !== undefined || source.ownership !== undefined || source.controls !== undefined) throw new Error('Invalid root config ownership scope')
    return
  }
  if (source.layout !== undefined) {
    if (source.layout !== 'flat-indexes' || source.directory !== binding.internalDir || source.markerRoot !== binding.root || source.destination !== 'echoflow-code' || source.ownership !== undefined) throw new Error('Invalid flat index ownership scope')
    return
  }
  if (isWithin(source.directory, binding.root) || (isWithin(binding.root, source.directory) && source.directory !== path.join(binding.root, 'cc-haha'))) throw new Error('Storage source overlaps active target')
  if (source.destination !== undefined && (!safeRelative(source.destination) || isWithin(source.directory, path.join(binding.root, source.destination)))) throw new Error('Invalid or self-overlapping storage destination')
}
async function assertLegacyProviders(directory: string): Promise<void> {
  const file = path.join(directory, 'providers.json')
  const identity = await regularIdentity(file)
  const providers = JSON.parse(await fs.readFile(file, 'utf8'))
  if (!providers || !Array.isArray(providers.providers) || !('activeId' in providers || 'activeProviderId' in providers) || !providers.providers.every((provider: Record<string, unknown>) => provider && typeof provider.id === 'string' && typeof provider.presetId === 'string' && typeof provider.apiKey === 'string' && provider.models && typeof provider.models === 'object' && ['main', 'haiku', 'sonnet', 'opus'].every(key => typeof (provider.models as Record<string, unknown>)[key] === 'string'))) throw new Error('Unproven legacy product subtree')
  await checkFile(file, identity)
}

const inspectionDirectory = (binding: StorageBinding): string => path.join(binding.root, '.echoflow-index-inspection')
const inspectionReceipt = 'owner.json'
async function clearIndexInspection(directory: string): Promise<void> {
  await assertUnlinkedDirectoryPath(directory)
  const names = await fs.readdir(directory)
  if (names.some(name => ![inspectionReceipt, 'index-v1.sqlite', 'index-v1.sqlite-wal', 'index-v1.sqlite-shm', 'index-v1.sqlite-journal'].includes(name))) throw new Error('Unknown ownership inspection material; manual recovery required')
  // Keep the process receipt until all private database material has gone.
  for (const name of names.filter(name => name !== inspectionReceipt)) {
    const file = path.join(directory, name)
    const identity = await regularIdentity(file)
    await checkFile(file, identity)
    await fs.unlink(file)
  }
  await syncDirectory(directory)
}
async function recoverIndexInspection(binding: StorageBinding): Promise<void> {
  const directory = inspectionDirectory(binding)
  if (!await present(directory)) return
  await assertUnlinkedDirectoryPath(directory)
  const receipt = path.join(directory, inspectionReceipt)
  if (await present(receipt)) {
    const identity = await regularIdentity(receipt)
    if (processAlive(JSON.parse(await fs.readFile(receipt, 'utf8')))) throw new Error('Storage ownership inspection already running')
    await clearIndexInspection(directory)
    await checkFile(receipt, identity)
    await fs.unlink(receipt)
  }
  // Without a receipt only an empty directory is safe, including an exit before registration.
  await fs.rmdir(directory)
  await syncDirectory(binding.root)
}

async function assertLegacyIndex(directory: string, binding: StorageBinding): Promise<void> {
  // Preview never claims R. Its only writes are a process-owned, recoverable private
  // snapshot inside R; ordinary completion restores a previously absent target.
  const created: string[] = []
  const temporary = inspectionDirectory(binding)
  let release: (() => Promise<void>) | undefined
  let acquired = false
  try {
    await withStorageLocation(binding, async database => {
      assertLocationBinding(binding, database)
      await assertNoSourceHandoff(binding.root)
      let ancestor = binding.root
      while (!await present(ancestor)) { created.push(ancestor); ancestor = path.dirname(ancestor) }
      await assertUnlinkedDirectoryPath(ancestor)
      await fs.mkdir(binding.root, { recursive: true, mode: 0o700 })
      await assertUnlinkedDirectoryPath(binding.root)
      await fs.mkdir(temporary, { mode: 0o700 })
      acquired = true
      release = await processReceipt(path.join(temporary, inspectionReceipt))
      await syncDirectory(temporary)
      await syncDirectory(binding.root)
    })
    const databasePath = path.join(directory, 'index-v1.sqlite')
    const receipts: { file: string; identity: FileIdentity | null }[] = []
    for (const suffix of ['', '-wal', '-journal']) {
      const file = databasePath + suffix
      const identity = await present(file) ? await regularIdentity(file) : null
      receipts.push({ file, identity })
      if (identity) {
        const copy = path.join(temporary, 'index-v1.sqlite' + suffix)
        await fs.copyFile(file, copy, constants.COPYFILE_EXCL)
        if (await hashFile(copy) !== identity.digest) throw new Error('Legacy database changed during ownership inspection')
      }
    }
    if (!receipts[0]!.identity) throw new Error('Unproven legacy product database')
    const database = new DatabaseSync(path.join(temporary, 'index-v1.sqlite'), { readOnly: true })
    const reference = new DatabaseSync(':memory:')
    try {
      const version = database.prepare('PRAGMA user_version').get()?.user_version
      if (typeof version !== 'number' || version < 1 || version > LOCAL_INDEX_SCHEMA_VERSION) throw new Error('Unproven legacy product database schema')
      // Build the exact historical schema through its owner, stopping at the source version.
      migrateLocalIndexDatabase({
        prepare: (sql: string) => ({ get: () => reference.prepare(sql).get(), finalize() {} }),
        exec: (sql: string) => {
          if (Number(reference.prepare('PRAGMA user_version').get()?.user_version) < version) reference.exec(sql)
        },
        transaction: (operation: () => void) => operation,
      } as unknown as Parameters<typeof migrateLocalIndexDatabase>[0])
      const schema = 'SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name'
      const actual = new Map(database.prepare(schema).all().map(row => [row.name, row]))
      if (reference.prepare(schema).all().some(row => JSON.stringify(actual.get(row.name)) !== JSON.stringify(row)) ||
        database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Unproven legacy product database schema')
    } finally { database.close(); reference.close() }
    for (const { file, identity } of receipts) {
      if (identity) await checkFile(file, identity)
      else if (await present(file)) throw new Error('Legacy database changed during ownership inspection')
    }
  } finally {
    if (acquired) {
      await clearIndexInspection(temporary)
      await release?.()
      await fs.rmdir(temporary)
      await syncDirectory(binding.root)
    }
    for (const directory of created) {
      await fs.rmdir(directory).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code!)) throw error })
    }
  }
}

function legacyInternalScope(source: StorageMigrationSource): boolean {
  return source.ownership === 'legacy-internal' && path.dirname(source.directory) === source.markerRoot &&
    ['cc-haha', 'echoflow-code'].includes(path.basename(source.directory)) && source.destination === 'echoflow-code'
}

async function knownSourceCoordination(file: string, writer: boolean): Promise<FileIdentity> {
  const identity = await regularIdentity(file)
  const receipt = await readProcessReceipt(file, writer)
  if (processAlive(receipt) && (writer || receipt.pid !== process.pid)) throw new Error('Active storage writer; close it before migration')
  await checkFile(file, identity)
  return identity
}
/** Only complete, marker-owned roots can be fenced and retired as a unit. */
function isCompleteSource(source: StorageMigrationSource): boolean {
  return !source.layout && !source.destination && source.directory === source.markerRoot
}

async function armImportSource(source: StorageMigrationSource, target: StorageBinding): Promise<void> {
  assertSourceScope(source, target)
  if (!isCompleteSource(source)) return
  const root = source.directory
  const sourceBinding = resolveStorageBinding({ env: {}, roots: [root] })
  await withStorageLocation(target, async database => {
    assertLocationBinding(target, database)
    if (target.location) assertSeparateLocation(target.location.file, root)
    await ownership(root)
    const pending = await pendingSourceHandoff(root)
    if (pending) {
      if (pending.target.canonical !== target.root) throw new Error('Storage handoff conflicts with migration target')
      await assertMigrationDirectory(target.root, pending.target)
      return
    }
    const sourceIdentity = await migrationDirectoryIdentity(root)
    const targetIdentity = await migrationDirectoryIdentity(target.root)
    const coordination = transactionHome(sourceBinding)
    await assertUnlinkedDirectoryPath(root)
    if (await present(sourceBinding.internalDir)) await assertUnlinkedDirectoryPath(sourceBinding.internalDir)
    await fs.mkdir(coordination, { recursive: true, mode: 0o700 })
    await assertUnlinkedDirectoryPath(coordination)
    const release = await migrationLock(sourceBinding, false)
    try {
      await persistStorageHandoff({ version: 1, id: randomUUID(), source: root, target: target.root, sourceIdentity, targetIdentity, state: 'pending', import: true })
    } finally { await release() }
  })
}

async function assertHandoffRetirement(source: SourceSnapshot): Promise<void> {
  const walk = async (directory: string) => {
    for (const name of await fs.readdir(directory)) {
      const file = path.join(directory, name)
      const relative = path.relative(source.directory, file)
      if (relative === source.handoff!.relative) continue
      if (relative === path.join('echoflow-code', 'migrations', 'lock.json') || path.dirname(relative) === path.join('echoflow-code', 'migrations', 'writers')) {
        await knownSourceCoordination(file, relative !== path.join('echoflow-code', 'migrations', 'lock.json'))
        continue
      }
      const receipt = source.directories.find(item => item.relative === relative)
      if (!receipt) throw new Error(`Retired storage root contains unexpected source material; possible old writer: ${relative}`)
      await assertUnlinkedDirectoryPath(file)
      await assertMigrationDirectory(file, receipt.identity)
      await walk(file)
    }
  }
  await walk(source.directory)
}
async function cleanupSourceCoordination(source: SourceSnapshot): Promise<void> {
  if (!source.handoff) return
  const directory = path.join(source.directory, 'echoflow-code', 'migrations')
  const writers = path.join(directory, 'writers')
  if (await present(writers)) {
    await assertUnlinkedDirectoryPath(writers)
    for (const name of await fs.readdir(writers)) {
      const file = path.join(writers, name)
      await checkFile(file, await knownSourceCoordination(file, true))
      await fs.unlink(file)
    }
    await syncDirectory(writers)
  }
  const lock = path.join(directory, 'lock.json')
  if (await present(lock)) {
    await checkFile(lock, await knownSourceCoordination(lock, false))
    await fs.unlink(lock)
    await syncDirectory(directory)
  }
}
async function assertWhatsAppSource(receipt: StorageApprovalReceipt, files: readonly ApprovedStorageFile[], cleanup = false): Promise<void> {
  const account = receipt.whatsapp!
  await assertUnlinkedDirectoryPath(account.directory)
  await assertMigrationDirectory(account.directory, account.identity)
  const expected = files.filter(file => path.dirname(file.source) === account.directory)
  const names = await fs.readdir(account.directory)
  if ((!cleanup && names.length !== expected.length) || names.some(name => !expected.some(file => file.relative === name))) {
    throw new Error('Approved WhatsApp directory contents changed; originals retained')
  }
  for (const name of names) {
    const file = expected.find(item => item.relative === name)!
    await checkFile(file.source, file.identity)
  }
}

async function collectSource(source: StorageMigrationSource, binding: StorageBinding, sources: readonly StorageMigrationSource[]): Promise<{ snapshot: SourceSnapshot; files: { relative: string; identity: FileIdentity }[] }> {
  assertSourceScope(source, binding)
  if (source.layout === 'approved-external') {
    const receipt = await approvalForSource(binding, source)
    if (source.approvalCategory === 'whatsapp-auth' && source.destination) {
      await assertWhatsAppSource(receipt, receipt.files)
      const account = receipt.whatsapp!
      checkWhatsAppAdoptionConfig(binding, account, await readWhatsAppAdoptionConfig(account.config, account.configIdentity))
    }
    const files: { relative: string; identity: FileIdentity }[] = []
    for (const file of receipt.files) {
      await assertUnlinkedDirectoryPath(path.dirname(file.source))
      const identity = source.approvalCategory === 'im-adapters'
        ? await inspectImFile(binding, file.source, file.relative, source.directory)
        : await regularIdentity(file.source)
      if (!sameFile(identity, file.identity)) throw new Error('Approved storage file changed; re-approve it')
      files.push({ relative: file.relative, identity })
    }
    const snapshot: SourceSnapshot = { ...source, directory: path.resolve(source.directory), markerRoot: path.resolve(source.markerRoot), identity: await migrationDirectoryIdentity(source.directory), directories: [] }
    return { snapshot, files }
  }
  if (source.layout === 'legacy-controls' || source.layout === 'desktop-state') {
    // These fixed files carry their own narrow proof; no shared-parent adoption.
    await assertUnlinkedDirectoryPath(source.directory)
  } else if (source.ownership === 'legacy-internal' && !await present(path.join(source.markerRoot, 'app.json'))) {
    if (!legacyInternalScope(source)) throw new Error('Invalid legacy product ownership scope')
    if (await present(path.join(source.directory, 'providers.json'))) await assertLegacyProviders(source.directory)
    else {
      const sibling = sources.find(candidate => candidate.directory !== source.directory && candidate.markerRoot === source.markerRoot && legacyInternalScope(candidate))
      if (!sibling) throw new Error('Unproven legacy product subtree: no provider-owned sibling')
      assertSourceScope(sibling, binding)
      await assertLegacyProviders(sibling.directory)
      await assertLegacyIndex(source.directory, binding)
    }
  } else await ownership(source.markerRoot)
  await assertUnlinkedDirectoryPath(source.directory)
  const snapshot: SourceSnapshot = { ...source, directory: path.resolve(source.directory), markerRoot: path.resolve(source.markerRoot), identity: await migrationDirectoryIdentity(source.directory), directories: [] }
  if (isCompleteSource(source)) {
    const handoff = await pendingSourceHandoff(source.directory)
    if (handoff) {
      if (handoff.target.canonical !== binding.root || (source.archive && !handoff.import)) throw new Error('Storage handoff conflicts with migration target')
      await assertMigrationDirectory(binding.root, handoff.target)
      snapshot.handoff = { relative: handoff.relative, identity: handoff.identity, ...(handoff.import ? { import: true } : {}) }
    }
  }
  const files: { relative: string; identity: FileIdentity }[] = []
  async function walk(directory: string) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const file = path.join(directory, name)
      const relative = path.relative(source.directory, file)
      if (!safeRelative(relative)) throw new Error('Unsafe migration path')
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) throw new Error(`Linked product data requires explicit resolution: ${file}`)
      if (snapshot.handoff && (relative === path.join('echoflow-code', 'migrations', 'lock.json') || path.dirname(relative) === path.join('echoflow-code', 'migrations', 'writers'))) {
        await knownSourceCoordination(file, relative !== path.join('echoflow-code', 'migrations', 'lock.json'))
        continue
      }
      if (stat.isDirectory()) { snapshot.directories.push({ relative, identity: await migrationDirectoryIdentity(file), mode: stat.mode }); await walk(file) }
      else files.push({ relative, identity: await regularIdentity(file) })
    }
  }
  if (source.layout === 'root-config') {
    const file = path.join(source.directory, '.config.json')
    if (await present(file)) files.push({ relative: '.config.json', identity: await regularIdentity(file) })
  } else if (source.layout === 'flat-indexes') {
    for (const name of (await fs.readdir(source.directory)).sort()) {
      if (isFlatIndexName(name)) files.push({ relative: name, identity: await regularIdentity(path.join(source.directory, name)) })
    }
    for (const file of files) {
      if (!indexes.has(file.relative) && !files.some(base => base.relative === file.relative.replace(/-(wal|shm|journal)$/, ''))) throw new Error(`Incomplete flat index snapshot: ${file.relative}`)
    }
  } else if (source.layout === 'desktop-state' || source.layout === 'legacy-controls') {
    for (const name of (await fs.readdir(source.directory)).sort()) {
      if (selectedLegacyFile(source, name)) files.push({ relative: name, identity: await regularIdentity(path.join(source.directory, name)) })
    }
  } else await walk(source.directory)
  if (source.controls) {
    for (const [name, expected] of Object.entries(source.controls)) {
      const actual = files.find(file => file.relative === name)?.identity
      if (!actual || actual.digest !== expected.digest || actual.dev !== expected.dev || actual.ino !== expected.ino) throw new Error(`Legacy control changed after inspection: ${name}`)
    }
  }
  for (const file of files) {
    if (source.layout === 'desktop-state') assertLegacyDesktopState(file.relative, JSON.parse(await fs.readFile(path.join(source.directory, file.relative), 'utf8')))
    if (!source.destination && legacyControlNames.includes(file.relative as typeof legacyControlNames[number]) && !source.controls?.[file.relative as typeof legacyControlNames[number]]) throw new Error(`Legacy control requires cold inspection: ${file.relative}`)
    const base = sqliteSidecarBase(file.relative)
    if (base !== file.relative && !historicalMaterial(destinationFor(source, file.relative)) && !files.some(other => other.relative === base)) {
      throw new Error(`Incomplete SQLite snapshot: ${file.relative}`)
    }
  }
  return { snapshot, files }
}
function destinationFor(source: StorageMigrationSource, relative: string, globalConfigDestination?: string): string {
  if (source.archive || (!source.destination && legacyControlNames.includes(relative as typeof legacyControlNames[number]))) return path.join(legacyStorageArchive(source.directory), relative)
  if (!source.destination && relative === '.config.json' && globalConfigDestination) return globalConfigDestination
  const parts = (source.destination ? path.join(source.destination, relative) : relative).split(path.sep)
  if (parts[0] === 'cc-haha') parts[0] = 'echoflow-code'
  if (parts[0] === 'echoflow-code' && (parts[1] === 'migrations' ||
    ((parts[1] === approvalDirectory || parts[1] === 'storage-handoffs') && !source.layout && !source.destination && source.directory === source.markerRoot))) {
    // Coordination from the previous root is history, not a barrier on the new root.
    const scope = source.destination ? '' : relative.split(path.sep)[0]!
    const archive = createHash('sha256').update(source.directory).update('\0').update(scope).digest('hex')
    return path.join('echoflow-code', 'migration-history', archive, ...parts.slice(1))
  }
  if (parts[0] === 'echoflow-code' && parts.length === 2 && indexes.has(parts[1]!.replace(/-(wal|shm|journal)$/, ''))) parts.splice(1, 0, 'db')
  return parts.join(path.sep)
}
function historicalMaterial(destination: string): boolean {
  return destination.startsWith(path.join('echoflow-code', 'migration-history') + path.sep)
}
async function assertBoundary(binding: StorageBinding, journal: StorageJournal, hooks: StorageMigrationHooks): Promise<void> {
  hooks.signal?.throwIfAborted()
  await assertMigrationDirectory(binding.root, journal.rootIdentity)
  await assertUnlinkedDirectoryPath(transactionPath(binding, journal.id))
  await assertMigrationDirectory(transactionPath(binding, journal.id), journal.transactionIdentity)
  for (const directory of journal.directories) await assertMigrationDirectory(path.join(binding.root, directory.relative), directory.identity)
  await hooks.assertQuiescent([binding.root, ...journal.sources.map(source => source.directory)])
  for (const source of journal.sources) {
    if (source.handoff && !['accepted', 'completed'].includes(journal.phase)) await checkFile(path.join(source.directory, source.handoff.relative), source.handoff.identity)
  }
}
async function copyExclusive(source: string, target: string, digest: string, transaction: string, root: string, preserveTimes = false): Promise<void> {
  const directory = path.dirname(target)
  if (!isWithin(root, directory)) throw new Error('Unsafe backup directory')
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await assertUnlinkedDirectoryPath(directory)
  // A synced leaf does not make its newly created ancestor links durable.
  for (let current = directory;; current = path.dirname(current)) {
    await syncDirectory(path.dirname(current))
    if (current === root) break
  }
  // Keep scratch names out of user filenames; the journal owns this namespace.
  const scratch = path.join(transaction, 'copying')
  await fs.mkdir(scratch, { recursive: true, mode: 0o700 })
  await assertUnlinkedDirectoryPath(scratch)
  await syncDirectory(transaction)
  const temporary = path.join(scratch, createHash('sha256').update(target).digest('hex'))
  if (await present(target) && await present(temporary)) {
    const output = await fs.lstat(target, { bigint: true })
    const pending = await fs.lstat(temporary, { bigint: true })
    if (!output.isFile() || !pending.isFile() || output.nlink !== 2n || output.dev !== pending.dev || output.ino !== pending.ino || await hashFile(temporary) !== digest) throw new Error(`Unrecognized interrupted backup: ${target}`)
    await fs.unlink(temporary)
  }
  if (!await present(target)) {
    if (await present(temporary)) {
      const pending = await regularIdentity(temporary)
      await checkFile(temporary, pending)
      await fs.unlink(temporary)
      await syncDirectory(scratch)
    }
    try {
      const times = preserveTimes ? await fs.stat(source) : undefined
      await fs.copyFile(source, temporary, constants.COPYFILE_EXCL)
      const mode = (await fs.lstat(temporary)).mode
      const readOnly = process.platform !== 'win32' && (mode & 0o200) === 0
      if (readOnly) await fs.chmod(temporary, mode | 0o200)
      const handle = await fs.open(temporary, 'r+')
      try {
        if (times) await handle.utimes(times.atime, times.mtime)
        if (readOnly) await handle.chmod(mode)
        await handle.sync()
      } finally { await handle.close() }
      if ((await regularIdentity(temporary)).digest !== digest) throw new Error(`Copy verification failed: ${target}`)
      await fs.link(temporary, target)
    } finally { await fs.rm(temporary, { force: true }) }
  }
  if ((await regularIdentity(target)).digest !== digest) throw new Error(`Copy verification failed: ${target}`)
  // A recovered single-link backup may still lack a durable link or scratch unlink.
  await syncDirectory(directory)
  await syncDirectory(scratch)
}

export type StorageMigrationPlan = {
  binding: StorageBinding
  sources: readonly StorageMigrationSource[]
  sourceIdentities: MigrationDirectoryIdentity[]
  targetIdentity?: MigrationDirectoryIdentity
  files: number
  bytes: number
}

export type StorageHandoffPreview = { plan: StorageMigrationPlan; sourceIndex: number; ancestor: MigrationDirectoryIdentity }

/** A single complete owned root; additional fixed projections keep their existing scope. */
export async function prepareStorageHandoff(plan: StorageMigrationPlan): Promise<StorageHandoffPreview> {
  const indexes = plan.sources.flatMap((source, index) => !source.layout && !source.destination && !source.archive && source.directory === source.markerRoot ? [index] : [])
  if (indexes.length !== 1 || plan.sources.some((source, index) => index !== indexes[0] && !source.layout)) throw new Error('Storage handoff requires one complete owned source root')
  let ancestor = plan.binding.root
  while (!await present(ancestor)) ancestor = path.dirname(ancestor)
  const preview = { plan, sourceIndex: indexes[0]!, ancestor: await migrationDirectoryIdentity(ancestor) }
  await assertStorageHandoffPreview(preview)
  return preview
}
export async function assertStorageHandoffPreview(preview: StorageHandoffPreview): Promise<void> {
  const { plan, sourceIndex } = preview
  const source = plan.sources[sourceIndex]!
  if (!source || source.layout || source.destination || source.archive || source.directory !== source.markerRoot) throw new Error('Invalid complete-root handoff source')
  assertSourceScope(source, plan.binding)
  for (const [index, selected] of plan.sources.entries()) {
    await assertMigrationDirectory(selected.directory, plan.sourceIdentities[index]!)
    await assertUnlinkedDirectoryPath(selected.directory)
  }
  await assertMigrationDirectory(preview.ancestor.canonical, preview.ancestor)
  await assertUnlinkedDirectoryPath(preview.ancestor.canonical)
  if (await canonicalPath(plan.binding.root) !== plan.binding.root) throw new Error('Storage handoff target was replaced')
  if (plan.targetIdentity) {
    await assertMigrationDirectory(plan.binding.root, plan.targetIdentity)
    await assertUnlinkedDirectoryPath(plan.binding.root)
  } else if (await present(plan.binding.root)) throw new Error('Target appeared after preview; choose the directory again')
}

async function verifiedHandoff(source: string, pending: SourceHandoff): Promise<StorageHandoffLaunch> {
  await assertMigrationDirectory(pending.target.canonical, pending.target)
  return { source, id: path.basename(pending.relative, '.json'), proof: handoffProof(pending.identity) }
}

/** Read an armed request after a launcher crash; callers must recover target v2 receipts first. */
export async function readStorageHandoff(source: string, target: string): Promise<StorageHandoffLaunch | undefined> {
  const pending = await pendingSourceHandoff(source)
  if (!pending) return
  if (pending.target.canonical !== target) throw new Error('Conflicting storage handoff target')
  return await verifiedHandoff(source, pending)
}

/** Only desktop requests carry enough scope for recovery without launch arguments. */
export async function readPendingDesktopStorageHandoff(source: string): Promise<{ target: string; move: StorageHandoffLaunch } | undefined> {
  const pending = await pendingSourceHandoff(source)
  if (pending?.desktop !== true) return
  await ownership(source)
  return { target: pending.target.canonical, move: await verifiedHandoff(source, pending) }
}

/** Arm only after draining owners/qualifying native validation. This never copies profile data. */
export async function armStorageHandoff(preview: StorageHandoffPreview, id: string, options?: { desktop: true }): Promise<StorageHandoffLaunch> {
  if (!handoffName.test(`${id}.json`)) throw new Error('Invalid storage handoff id')
  const { plan, sourceIndex } = preview
  const source = plan.sources[sourceIndex]!.directory
  return await withStorageLocation(plan.binding, async database => {
    assertLocationBinding(plan.binding, database)
    return await writeStorageHandoff(preview, id, source, options)
  })
}

async function writeStorageHandoff(preview: StorageHandoffPreview, id: string, source: string, options?: { desktop: true }): Promise<StorageHandoffLaunch> {
  const { plan, sourceIndex } = preview
  await assertNoSourceHandoff(source)
  await assertStorageHandoffPreview(preview)
  await ownership(source)
  if (!plan.targetIdentity) {
    await fs.mkdir(path.dirname(plan.binding.root), { recursive: true, mode: 0o700 })
    await assertUnlinkedDirectoryPath(path.dirname(plan.binding.root))
    await fs.mkdir(plan.binding.root, { mode: 0o700 })
    for (let directory = plan.binding.root; directory !== preview.ancestor.canonical; directory = path.dirname(directory)) await syncDirectory(path.dirname(directory))
  }
  await assertUnlinkedDirectoryPath(plan.binding.root)
  await assertMigrationDirectory(preview.ancestor.canonical, preview.ancestor)
  if (plan.targetIdentity) await assertMigrationDirectory(plan.binding.root, plan.targetIdentity)
  const targetIdentity = await migrationDirectoryIdentity(plan.binding.root)
  return await persistStorageHandoff({ version: 1, id, source, target: plan.binding.root, sourceIdentity: plan.sourceIdentities[sourceIndex]!, targetIdentity, state: 'pending', ...options })
}

async function persistStorageHandoff(request: StorageHandoffRequest): Promise<StorageHandoffLaunch> {
  const { source, target, sourceIdentity, targetIdentity, id } = request
  const directory = path.join(source, handoffDirectory)
  let parent = directory
  while (!await present(parent)) parent = path.dirname(parent)
  await assertUnlinkedDirectoryPath(parent)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await assertUnlinkedDirectoryPath(directory)
  await syncDirectory(path.dirname(directory))
  await syncDirectory(source)
  await assertMigrationDirectory(source, sourceIdentity)
  await assertMigrationDirectory(target, targetIdentity)
  const file = path.join(directory, `${id}.json`)
  if (await present(file)) throw new Error('Storage handoff request already exists')
  await durableJson(file, request)
  return { source, id, proof: handoffProof(await regularIdentity(file)) }
}
export async function cancelStorageHandoff(launch: StorageHandoffLaunch): Promise<void> {
  if (!handoffName.test(`${launch.id}.json`)) throw new Error('Invalid storage handoff id')
  const relative = path.join(handoffDirectory, `${launch.id}.json`)
  const file = path.join(launch.source, relative)
  const identity = await regularIdentity(file)
  if (handoffProof(identity) !== launch.proof) throw new Error('Storage handoff request changed after admission')
  const request = parseStorageHandoff(await fs.readFile(file, 'utf8'), `${launch.id}.json`)
  if (request.source !== launch.source) throw new Error('Conflicting storage handoff source')
  await assertMigrationDirectory(launch.source, request.sourceIdentity)
  await assertMigrationDirectory(request.target, request.targetIdentity)
  const binding: StorageBinding = { root: request.target, internalDir: path.join(request.target, 'echoflow-code'), selection: 'explicit' }
  for (const journal of await readJournals(binding)) {
    if (journal.entries.some(entry => journal.sources[entry.source]?.directory === launch.source && entry.relative === relative && handoffProof(entry.original) === launch.proof)) throw new Error('Transaction-owned storage handoff cannot be cancelled; recover it forward')
  }
  await checkFile(file, identity)
  await durableJson(file, { ...request, state: 'cancelled' })
}

/** Non-claiming preview: only recoverable private ownership snapshots in R may be written, never sources. */
export async function prepareStorageMigration(input: Omit<StorageMigrationInput, 'hooks'>): Promise<StorageMigrationPlan> {
  const { binding, sources } = input
  for (const source of sources) assertSourceScope(source, binding)
  assertImTransactionScope(sources)
  if (binding.internalDir !== path.join(binding.root, 'echoflow-code') || !path.isAbsolute(binding.root) || path.resolve(binding.root) !== binding.root) throw new Error('Invalid storage binding')
  await recoverIndexInspection(binding)
  let ancestor = binding.root
  while (!await present(ancestor)) ancestor = path.dirname(ancestor)
  await assertUnlinkedDirectoryPath(ancestor)
  const targetIdentity = await present(binding.root) ? await migrationDirectoryIdentity(binding.root) : undefined
  if (targetIdentity && (await fs.readdir(binding.root)).length) await ownership(binding.root)
  const plan: StorageMigrationPlan = { binding, sources, sourceIdentities: [], targetIdentity, files: 0, bytes: 0 }
  for (const source of sources) {
    const collected = await collectSource(source, binding, sources)
    plan.sourceIdentities.push(collected.snapshot.identity)
    plan.files += collected.files.length
    plan.bytes += collected.files.reduce((sum, file) => sum + file.identity.size, 0)
  }
  const disk = await fs.statfs(ancestor)
  // Originals, staged transformations and target preimages all live in R.
  if (disk.bavail * disk.bsize < plan.bytes * 3) throw new Error('Not enough free space in the target directory')
  return plan
}

/** Read only verified v2 evidence before interpreting any remaining v1 launch controls. */
export async function readConsumedStorageControls(binding: StorageBinding): Promise<{ directory: string; name: typeof legacyControlNames[number]; digest: string }[]> {
  const controls: { directory: string; name: typeof legacyControlNames[number]; digest: string }[] = []
  for (const journal of await readJournals(binding)) {
    for (const entry of journal.entries) {
      const source = journal.sources[entry.source]!
      if (source.destination || !legacyControlNames.includes(entry.relative as typeof legacyControlNames[number])) continue
      if (entry.destination !== destinationFor(source, entry.relative)) throw new Error('Invalid consumed legacy control destination')
      controls.push({ directory: source.directory, name: entry.relative as typeof legacyControlNames[number], digest: entry.original.digest })
    }
  }
  return controls
}

export async function readStorageMigrationStatus(binding: StorageBinding): Promise<(StorageMigrationResult & { sources: string[]; files: number; bytes: number; handoff: boolean; legacySelection?: true }) | null> {
  const journals = await readJournals(binding)
  const journal = journals.find(item => item.state !== 'ready') ?? journals.at(-1)
  return journal ? { ...resultOf(journal), sources: journal.sources.map(source => source.directory), files: journal.entries.length, bytes: journal.entries.reduce((sum, entry) => sum + entry.original.size, 0), handoff: journal.sources.some(source => source.handoff && !source.handoff.import), ...(journal.legacySelection ? { legacySelection: true as const } : {}) } : null
}

/** A single transaction owner for desktop and headless startup. No business writer may
 * start until completeStorageMigration returns ready. Ambiguity leaves all originals. */
export async function executeStorageMigration(input: StorageMigrationInput): Promise<StorageMigrationResult> {
  const { binding, hooks } = input
  let release: (() => Promise<void>) | undefined
  let journal: StorageJournal | undefined
  try {
    assertImTransactionScope(input.sources)
    release = await lockStorageMigration(binding)
    const whatsapp = await whatsappTransaction(binding, input.sources)
    const previous = await readJournals(binding)
    for (const existing of previous) {
      if (existing.state !== 'ready') return resultOf(existing)
      await assertNoFork(existing)
    }
    await hooks.assertQuiescent([binding.root, ...input.sources.map(source => source.directory)])
    const sources: SourceSnapshot[] = []
    const entries: ImportEntry[] = []
    const globalConfigDestination = `.claude${fileSuffixForOauthConfig()}.json`
    for (const source of input.sources) {
      await armImportSource(source, binding)
      const { snapshot, files } = await collectSource(source, binding, input.sources)
      if (source.layout && !files.length) continue
      const signature = (item: SourceSnapshot): string => `${item.identity.canonical}:${item.layout ?? 'profile'}:${item.approval ?? ''}`
      if (sources.some(existing => signature(existing) === signature(snapshot))) continue
      // Fixed projections may share a parent, but never select the same file twice.
      if (sources.some(existing => !existing.layout && !snapshot.layout &&
        (isWithin(existing.directory, snapshot.directory) || isWithin(snapshot.directory, existing.directory)))) throw new Error('Overlapping migration sources')
      if (entries.some(entry => files.some(file => path.join(sources[entry.source]!.directory, entry.relative) === path.join(snapshot.directory, file.relative)))) throw new Error('Overlapping migration files')
      const index = sources.length
      sources.push(snapshot)
      for (const file of files) {
        const destination = destinationFor(source, file.relative, globalConfigDestination)
        if (isWithin(transactionHome(binding), path.join(binding.root, destination)) || isWithin(approvalHome(binding), path.join(binding.root, destination))) throw new Error('Reserved active transaction destination')
        const target = path.join(binding.root, destination)
        const baseline = await present(target) ? await regularIdentity(target) : null
        if (source.approvalCategory && baseline && baseline.digest !== file.identity.digest) {
          throw new Error(`Conflicting IM storage file (originals retained): ${destination}`)
        }
        entries.push({ source: index, relative: file.relative, destination, original: file.identity, baseline })
      }
    }
    if (whatsapp && input.legacySelection) throw new Error('Invalid WhatsApp transaction scope')
    if (input.legacySelection && !binding.location) throw new Error('Missing location database for legacy storage selection')
    legacySelectionEntry({ legacySelection: input.legacySelection, sources, entries })
    if (!sources.length) return { state: 'ready', issues: [] }
    const id = randomUUID()
    const transaction = transactionPath(binding, id)
    const pending = path.join(transactionHome(binding), `.pending-${id}`)
    await fs.mkdir(pending, { mode: 0o700 })
    const identity = await migrationDirectoryIdentity(pending)
    const initial: StorageJournal = { version: 2, id, root: binding.root, rootIdentity: await migrationDirectoryIdentity(binding.root),
      transactionIdentity: { ...identity, canonical: path.join(path.dirname(identity.canonical), id) }, globalConfigDestination,
      ...(input.legacySelection ? { legacySelection: input.legacySelection } : {}),
      state: 'blocked', phase: 'copying', sources, entries, directories: [], issues: [] }
    await durableJson(path.join(pending, journalName), initial)
    await assertMigrationDirectory(pending, identity)
    await assertMigrationDirectory(binding.root, initial.rootIdentity)
    if (await present(transaction)) throw new Error('Storage transaction already exists')
    await fs.rename(pending, transaction)
    await syncDirectory(transactionHome(binding))
    await assertMigrationDirectory(transaction, initial.transactionIdentity)
    journal = initial
    return await advanceTransaction(binding, journal, hooks)
  } catch (error) {
    if (journal) { journal.state = 'blocked'; journal.issues = [issue(error)]; await saveJournal(binding, journal) }
    return { state: 'blocked', id: journal?.id, issues: [issue(error)] }
  } finally { await release?.() }
}

function stagedFile(binding: StorageBinding, journal: StorageJournal, entry: ImportEntry): string {
  if (!journal.attempt) throw new Error('Missing storage staging receipt')
  const relative = journal.archiveFiles && archiveDestinations.includes(entry.destination)
    ? path.join('archive-inputs', String(entry.source), entry.relative)
    : path.join(String(entry.source), entry.destination)
  return path.join(transactionPath(binding, journal.id), 'staged', journal.attempt, relative)
}

function mergeObject(a: unknown, b: unknown, label: string): unknown {
  if (JSON.stringify(a) === JSON.stringify(b)) return a
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!record(a) || !record(b)) throw new Error(`Conflicting storage entity (originals retained): ${label}`)
  const output: Record<string, unknown> = { ...a }
  for (const [key, value] of Object.entries(b)) {
    // Define own properties: legacy JSON may legally contain __proto__.
    Object.defineProperty(output, key, { value: Object.hasOwn(a, key) ? mergeObject(a[key], value, `${label}.${key}`) : value, enumerable: true, writable: true, configurable: true })
  }
  return output
}

async function assertSQLiteCohorts(binding: StorageBinding, journal: StorageJournal): Promise<void> {
  const cohorts = new Map<string, string>()
  const transaction = transactionPath(binding, journal.id)
  for (const entry of journal.entries) {
    if (historicalMaterial(entry.destination)) continue
    const backup = path.join(transaction, 'sources', String(entry.source), entry.relative)
    if ((await regularIdentity(backup)).digest !== entry.original.digest) throw new Error(`Source backup changed: ${entry.relative}`)
    if (!await isSQLiteFile(backup) && !(journal.sources[entry.source]!.layout && indexes.has(entry.relative))) continue
    const members = sqliteSuffixes.map(suffix => journal.entries.find(other => other.source === entry.source && other.relative === entry.relative + suffix))
    const shape = JSON.stringify(members.map(member => member?.original.digest ?? null))
    const key = process.platform === 'win32' ? entry.destination.toLowerCase() : entry.destination
    const conflict = () => new Error(`Conflicting storage database snapshot (originals retained): ${entry.destination}`)
    if (cohorts.has(key) && cohorts.get(key) !== shape) throw conflict()
    cohorts.set(key, shape)
    const targets = await Promise.all(sqliteSuffixes.map(suffix => present(path.join(binding.root, entry.destination + suffix))))
    for (const [index, suffix] of sqliteSuffixes.entries()) {
      const member = members[index]
      const sourceFile = path.join(journal.sources[entry.source]!.directory, entry.relative + suffix)
      if (!!member !== await present(sourceFile)) throw new Error(`Source SQLite snapshot changed: ${entry.relative}`)
      if (targets[index]) {
        if (!member) throw conflict()
        // Interrupted publication can leave staging linked to the target until recovery.
        const target = path.join(binding.root, entry.destination + suffix)
        await assertUnlinkedDirectoryPath(path.dirname(target))
        const stat = await fs.lstat(target)
        if (!stat.isFile() || await hashFile(target) !== member.stagedDigest) throw conflict()
      } else if (member && (journal.phase === 'validating' || (journal.phase === 'copying' && targets.some(Boolean)))) throw conflict()
    }
  }
}

function archiveStageFile(binding: StorageBinding, journal: StorageJournal, destination: string): string {
  if (!journal.attempt) throw new Error('Missing storage staging receipt')
  return path.join(transactionPath(binding, journal.id), 'staged', journal.attempt, path.basename(destination))
}

async function prepareMergedArchives(binding: StorageBinding, journal: StorageJournal, signal: AbortSignal): Promise<void> {
  const isTranscript = (relative: string) => {
    const parts = relative.split(path.sep)
    return parts.length === 3 && parts[0] === 'projects' && parts[2]!.endsWith('.jsonl')
  }
  const archiveEntries = journal.entries.filter(entry => archiveDestinations.includes(entry.destination))
  const transcripts = journal.entries.filter(entry => isTranscript(entry.destination))
  if (!archiveEntries.length && !transcripts.length) return

  type Input = { root: string; state?: ImportEntry; marker?: ImportEntry }
  const inputs = new Map<string, Input>()
  for (const entry of archiveEntries) {
    const source = journal.sources[entry.source]!
    const directory = path.dirname(path.join(source.directory, entry.relative))
    const input = inputs.get(directory) ?? { root: source.markerRoot }
    if (entry.destination === archiveStateDestination) input.state = entry
    else input.marker = entry
    inputs.set(directory, input)
  }

  const destinations = archiveDestinations
  const baselines = new Map<string, FileIdentity | null>()
  const readTarget = async (destination: string): Promise<unknown> => {
    const file = path.join(binding.root, destination)
    const entry = archiveEntries.find(entry => entry.destination === destination)
    const baseline = entry ? entry.baseline : await present(file) ? await regularIdentity(file) : null
    baselines.set(destination, baseline)
    if (!baseline) {
      if (await present(file)) throw new Error(`Target appeared during archive staging: ${destination}`)
      return undefined
    }
    await checkFile(file, baseline)
    const bytes = await fs.readFile(file)
    if (createHash('sha256').update(bytes).digest('hex') !== baseline.digest) throw new Error(`Archive file changed during staging: ${destination}`)
    return JSON.parse(bytes.toString('utf8'))
  }
  const readStaged = async (entry?: ImportEntry): Promise<unknown> => entry && JSON.parse(await fs.readFile(stagedFile(binding, journal, entry), 'utf8'))
  const stateInput = await readTarget(archiveStateDestination)
  const markerInput = await readTarget(archiveMarkerDestination)
  let state = stateInput === undefined ? undefined : migrateArchiveState(stateInput)
  const markedRoots = new Set<string>()
  const markers: ReturnType<typeof parseSessionArchiveMarker>[] = []
  const collectMarker = (root: string, value: unknown, hasState: boolean) => {
    if (value === undefined) return
    const marker = parseSessionArchiveMarker(value)
    if (marker.archiveStateRequired && !hasState) throw new Error('Migrated session archive state is missing; originals retained')
    markers.push(marker)
    markedRoots.add(root)
  }
  collectMarker(binding.root, markerInput, state !== undefined)
  for (const input of inputs.values()) {
    if (input.state) {
      const next = migrateArchiveState(await readStaged(input.state))
      state = state ? migrateArchiveState(mergeObject(state, next, archiveStateDestination)) : next
    }
    collectMarker(input.root, await readStaged(input.marker), !!input.state)
  }

  let imported = false
  if (markers.length) {
    const targetMarked = markedRoots.has(binding.root)
    if (!targetMarked || transcripts.some(entry => !markedRoots.has(journal.sources[entry.source]!.directory))) {
      const sessions = Object.assign(Object.create(null), state?.sessions) as ReturnType<typeof migrateArchiveState>['sessions']
      const scanned = new Set<string>()
      const legacy = new Map<string, boolean>()
      const collect = async (file: string, marked: boolean, target = false) => {
        signal.throwIfAborted()
        const id = path.basename(file, '.jsonl')
        if (Object.hasOwn(sessions, id)) return
        if (marked) { scanned.add(id); return }
        const identity = target ? await regularIdentity(file) : undefined
        const archived = await readLegacyArchiveTranscript(file)
        if (identity) await checkFile(file, identity)
        if (archived === undefined) return
        if (legacy.has(id) && legacy.get(id) !== archived) throw new Error('Conflicting legacy session archive states; originals retained')
        legacy.set(id, archived)
      }
      for (const entry of transcripts) {
        await collect(stagedFile(binding, journal, entry), markedRoots.has(journal.sources[entry.source]!.directory))
      }
      for await (const file of listLegacyArchiveTranscripts(binding.root)) await collect(file, targetMarked, true)
      for (const [id, archived] of legacy) {
        if (archived && scanned.has(id)) throw new Error('Conflicting legacy session archive states; originals retained')
        sessions[id] = { archived }
      }
      if (legacy.size) {
        state = { ...state, schemaVersion: 1, sessions }
        imported = true
      }
    }
  }
  const required = state !== undefined
  const marker = markers.reduce<unknown>((merged, value) => mergeObject(merged, { ...value, archiveStateRequired: required }, archiveMarkerDestination), {})

  for (const destination of destinations) {
    const entries = archiveEntries.filter(entry => entry.destination === destination)
    const baseline = baselines.get(destination)!
    const digests = new Set([...(baseline ? [baseline.digest] : []), ...entries.map(entry => entry.stagedDigest)])
    const isState = destination === archiveStateDestination
    const value = isState ? state : markers.length ? marker : undefined
    const changed = isState ? imported : markers.some(value => value.archiveStateRequired !== required)
    if (!value) continue
    if (!changed && digests.size <= 1) {
      if (!entries.length && baseline) journal.archiveFiles!.push({ destination, baseline, stagedDigest: baseline.digest })
      continue
    }
    if (entries.length) {
      for (const entry of entries) {
        const file = stagedFile(binding, journal, entry)
        await durableJson(file, value)
        entry.stagedDigest = (await regularIdentity(file)).digest
      }
    } else {
      const file = archiveStageFile(binding, journal, destination)
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      await durableJson(file, value)
      await fs.chmod(file, baseline?.mode ?? 0o600)
      journal.archiveFiles!.push({ destination, baseline, stagedDigest: (await regularIdentity(file)).digest })
    }
  }
}

async function prepareMergedFiles(binding: StorageBinding, journal: StorageJournal, hooks: StorageMigrationHooks, signal: AbortSignal): Promise<void> {
  await prepareMergedArchives(binding, journal, signal)
  await assertSQLiteCohorts(binding, journal)
  const groups = new Map<string, ImportEntry[]>()
  for (const entry of journal.entries) {
    const key = process.platform === 'win32' ? entry.destination.toLowerCase() : entry.destination
    groups.set(key, [...groups.get(key) ?? [], entry])
  }
  for (const entries of groups.values()) {
    const first = entries[0]!
    if ([path.join('echoflow-code', 'storage-relocations.json'), archiveStateDestination, archiveMarkerDestination].includes(first.destination)) continue
    const target = path.join(binding.root, first.destination)
    const digests = new Set([...(first.baseline ? [first.baseline.digest] : []), ...entries.map(entry => entry.stagedDigest!)])
    if (digests.size <= 1) continue
    if (first.destination !== path.join('echoflow-code', 'settings.json') && first.destination !== path.join('echoflow-code', 'providers.json') && first.destination !== 'app.json') {
      throw new Error(`Conflicting storage entity (originals retained): ${first.destination}`)
    }
    const initial: unknown = first.baseline ? JSON.parse(await fs.readFile(target, 'utf8')) : JSON.parse(await fs.readFile(stagedFile(binding, journal, first), 'utf8'))
    let merged: unknown = hooks.upgradeJson ? hooks.upgradeJson(first.destination, initial) : initial
    for (const entry of entries) {
      const value = JSON.parse(await fs.readFile(stagedFile(binding, journal, entry), 'utf8'))
      if (first.destination.endsWith('providers.json') && merged && value && typeof merged === 'object' && typeof value === 'object' && Array.isArray((merged as any).providers) && Array.isArray(value.providers)) {
        const left = merged as Record<string, unknown>
        const providers = [...left.providers as Record<string, unknown>[]]
        for (const provider of value.providers) {
          if (!provider || typeof provider.id !== 'string') throw new Error('Invalid saved provider during merge')
          const index = providers.findIndex(item => item.id === provider.id)
          if (index >= 0) providers[index] = mergeObject(providers[index], provider, `provider ${provider.id}`) as Record<string, unknown>
          else providers.push(provider)
        }
        const { providers: _left, providerOrder: leftOrder, ...leftRest } = left
        const { providers: _right, providerOrder: rightOrder, ...rightRest } = value
        merged = { ...mergeObject(leftRest, rightRest, first.destination) as Record<string, unknown>, providers,
          ...((leftOrder !== undefined || rightOrder !== undefined) ? { providerOrder: [...new Set([...(leftOrder as string[] ?? []), ...(rightOrder as string[] ?? [])])] } : {}) }
      } else merged = mergeObject(merged, value, first.destination)
    }
    for (const entry of entries) {
      await durableJson(stagedFile(binding, journal, entry), merged)
      entry.stagedDigest = (await regularIdentity(stagedFile(binding, journal, entry))).digest
    }
  }
}

async function assertOpaqueStores(binding: StorageBinding, journal: StorageJournal): Promise<void> {
  const stores = new Map<string, Set<number>>()
  for (const entry of journal.entries) {
    if (historicalMaterial(entry.destination)) continue
    const segments = entry.destination.split(path.sep)
    const index = segments[0]?.toLowerCase() === 'whatsapp-auth' && segments.length > 2 ? 1
      : segments.findIndex(part => part === 'leveldb' || part.endsWith('.leveldb'))
    if (index < 0) continue
    const store = segments.slice(0, index + 1).join(path.sep)
    stores.set(store, new Set([...(stores.get(store) ?? []), entry.source]))
  }
  // A key store belongs to one stopped snapshot; matching individual files cannot prove a safe merge.
  for (const [store, owners] of stores) {
    const whatsapp = store.split(path.sep)[0]?.toLowerCase() === 'whatsapp-auth'
    const conflict = () => new Error(`Conflicting ${whatsapp ? 'WhatsApp sign-in directories' : 'LevelDB profiles'}: ${store}`)
    const expected = journal.entries.filter(entry => entry.source === [...owners][0] && isWithin(store, entry.destination))
    const shape = (entries: ImportEntry[]) => JSON.stringify(entries.map(entry => [entry.destination, entry.stagedDigest]).sort())
    for (const owner of owners) {
      if (shape(journal.entries.filter(entry => entry.source === owner && isWithin(store, entry.destination))) !== shape(expected)) throw conflict()
    }
    const target = path.join(binding.root, store)
    if (await present(target)) {
      const actual = await migrationManifest(target)
      if (whatsapp && !actual.length) continue
      const files = actual.filter(entry => entry.kind === 'file').map(entry => [path.join(store, entry.relative), entry.digest]).sort()
      if (JSON.stringify(files) !== shape(expected)) throw conflict()
    }
  }
}

async function publishFile(binding: StorageBinding, journal: StorageJournal, entry: FilePublication, staged: string): Promise<void> {
  const target = path.join(binding.root, entry.destination)
  await assertUnlinkedDirectoryPath(path.dirname(target))
  const sibling = journal.entries.find(other => other !== entry && other.destination === entry.destination && other.published)
  if (sibling && !entry.published) {
    await checkFile(target, sibling.published!)
    entry.published = sibling.published
  }
  // A process may have died immediately after link(), before unlinking staging.
  if (entry.publicationIntent && await present(target)) {
    const stat = await fs.lstat(target, { bigint: true })
    if (String(stat.dev) === entry.publicationIntent.dev && String(stat.ino) === entry.publicationIntent.ino) {
      await syncDirectory(path.dirname(target))
      if (await present(staged)) {
        const copy = await fs.lstat(staged, { bigint: true })
        if (stat.dev === copy.dev && stat.ino === copy.ino) await fs.unlink(staged)
      }
      await syncDirectory(path.dirname(staged))
      await checkFile(target, entry.publicationIntent)
      entry.published = entry.publicationIntent
    }
  }
  if (entry.published) { await checkFile(target, entry.published); await saveJournal(binding, journal); return }
  if (entry.baseline) {
    await checkFile(target, entry.baseline)
    if (entry.baseline.digest === entry.stagedDigest) {
      entry.published = entry.baseline
      await saveJournal(binding, journal)
      return
    }
    await copyExclusive(target, path.join(transactionPath(binding, journal.id), 'target-before', entry.destination), entry.baseline.digest, transactionPath(binding, journal.id), binding.root)
  } else if (await present(target)) throw new Error(`Target appeared during publication: ${entry.destination}`)
  entry.publicationIntent = await regularIdentity(staged)
  if (entry.publicationIntent.digest !== entry.stagedDigest) throw new Error('Staged file changed')
  await saveJournal(binding, journal)
  if (entry.baseline) {
    await checkFile(target, entry.baseline)
    await fs.rename(staged, target)
  } else await fs.link(staged, target)
  await syncDirectory(path.dirname(target))
  if (!entry.baseline) await fs.unlink(staged)
  await syncDirectory(path.dirname(staged))
  await checkFile(target, entry.publicationIntent)
  entry.published = entry.publicationIntent
  await saveJournal(binding, journal)
}

async function ensurePublishedDirectory(binding: StorageBinding, journal: StorageJournal, relative: string, source: string, mode: number): Promise<void> {
  if (!relative || relative === '.') return
  const target = path.join(binding.root, relative)
  if (!isWithin(binding.root, target) || isWithin(transactionHome(binding), target)) throw new Error('Unsafe publication directory')
  await ensurePublishedDirectory(binding, journal, path.dirname(relative), path.dirname(source), 0o700)
  const receipt = journal.directories.find(item => item.relative === relative)
  if (receipt) { await assertMigrationDirectory(target, receipt.identity); await syncDirectory(path.dirname(target)); return }
  const created = !await present(target)
  if (created) await fs.mkdir(target, { mode: 0o700 })
  await assertUnlinkedDirectoryPath(target)
  await syncDirectory(path.dirname(target))
  journal.directories.push({ relative, identity: await migrationDirectoryIdentity(target), mode: created ? mode : (await fs.stat(target)).mode, source, created })
  await saveJournal(binding, journal)
}

function assertImTransactionScope(sources: readonly StorageMigrationSource[], journal?: StorageJournal): boolean {
  if (!sources.some(source => source.approvalCategory === 'im-adapters')) return false
  if (sources.length !== 1 || journal?.legacySelection || journal?.archiveFiles?.length ||
    (journal && (journal.directories.length || journal.entries.some(entry =>
      [entry.baseline, entry.published, entry.publicationIntent].some(receipt => receipt && receipt.digest !== entry.original.digest) ||
      (entry.stagedDigest !== undefined && entry.stagedDigest !== entry.original.digest))))) {
    throw new Error('Invalid IM adoption transaction scope')
  }
  return true
}

async function whatsappTransaction(binding: StorageBinding, sources: readonly StorageMigrationSource[], journal?: StorageJournal) {
  const index = sources.findIndex(source => source.approvalCategory === 'whatsapp-auth')
  if (index < 0) return
  const receipt = await readApproval(binding, sources[index]!.approval!)
  if (receipt.approvalCategory !== 'whatsapp-auth' || receipt.state !== 'pending') throw new Error('Invalid WhatsApp transaction approval')
  const expected = whatsappApprovalSources(binding, receipt)
  const account = receipt.whatsapp!
  if (sources.length !== expected.length || sources.some((source, i) => {
    const match = expected[i]!
    return source.approval !== match.approval || source.approvalCategory !== match.approvalCategory ||
      source.directory !== match.directory || source.destination !== match.destination || JSON.stringify(source.approvedFiles) !== JSON.stringify(match.approvedFiles)
  }) || journal?.legacySelection || journal?.archiveFiles?.length || journal?.directories.some(item =>
    !isWithin(item.relative, account.destination)) || journal?.entries.some(entry =>
    [entry.baseline?.digest, entry.published?.digest, entry.publicationIntent?.digest, entry.stagedDigest].some(digest => digest !== undefined && digest !== entry.original.digest))) {
    throw new Error('Invalid WhatsApp transaction scope')
  }
  return receipt
}

async function validateWhatsAppPublication(binding: StorageBinding, journal: StorageJournal, receipt: StorageApprovalReceipt, staged: boolean): Promise<void> {
  const account = receipt.whatsapp!
  const target = path.join(binding.root, account.destination)
  const configEntry = journal.entries.find(entry => entry.destination === 'adapters.json')
  const configFile = configEntry && staged ? stagedFile(binding, journal, configEntry) : path.join(binding.root, 'adapters.json')
  const config = await readWhatsAppAdoptionConfig(configFile, configEntry ? undefined : account.configIdentity)
  if (config.identity.digest !== account.configIdentity.digest) throw new Error('WhatsApp adapter configuration changed before acceptance')
  const authDirectory = staged ? path.dirname(stagedFile(binding, journal, journal.entries.find(entry => entry.source === 0)!)) : target
  await assertUnlinkedDirectoryPath(authDirectory)
  const files = receipt.files.filter(file => path.dirname(file.source) === account.directory)
  const names = await fs.readdir(authDirectory)
  if (names.length !== files.length || names.some(name => !files.some(file => file.relative === name))) throw new Error('WhatsApp sign-in copy is incomplete or contains unapproved files')
  for (const file of files) {
    if ((await regularIdentity(path.join(authDirectory, file.relative))).digest !== file.identity.digest) throw new Error('WhatsApp sign-in copy changed')
  }
  const { validateWhatsAppAuthDirectory } = await import('../../adapters/whatsapp/storageAdoption.js')
  await validateWhatsAppAuthDirectory(authDirectory, config.jid)
  if (!staged) {
    checkWhatsAppAdoptionConfig(binding, account, config, true)
    if (!readStorageRelocations(binding.root).mappings?.some(mapping => mapping.from === account.directory && mapping.to === account.destination)) {
      throw new Error('WhatsApp relocation does not match approval')
    }
  }
}

async function advanceTransaction(binding: StorageBinding, journal: StorageJournal, hooks: StorageMigrationHooks): Promise<StorageMigrationResult> {
  const transaction = transactionPath(binding, journal.id)
  const signal = hooks.signal ?? new AbortController().signal
  await assertBoundary(binding, journal, hooks)
  const im = assertImTransactionScope(journal.sources, journal)
  const whatsapp = await whatsappTransaction(binding, journal.sources, journal)
  if (journal.phase === 'copying') {
    // Each interrupted transform gets a new private attempt; verified source
    // backups are reused, never overwritten with partially transformed bytes.
    journal.attempt = randomUUID()
    journal.archiveFiles = []
    await saveJournal(binding, journal)
    const stageRoot = path.join(transaction, 'staged', journal.attempt)
    await fs.mkdir(stageRoot, { recursive: true, mode: 0o700 })
    await syncDirectory(path.dirname(stageRoot))
    await syncDirectory(transaction)
    if ((hooks.platform ?? process.platform) === 'win32') {
      if (!hooks.permissions) throw new Error('Windows migration permission hooks are required')
      await hooks.permissions.restrictStaging(transaction, signal)
      const probe = path.join(stageRoot, 'permission-probe')
      await fs.mkdir(probe, { mode: 0o700 })
      await hooks.permissions.preflight(journal.entries.map(entry => path.join(journal.sources[entry.source]!.directory, entry.relative)), probe, signal)
      await fs.rmdir(probe)
    }
    for (const entry of journal.entries) {
      signal.throwIfAborted()
      const source = journal.sources[entry.source]!
      await assertMigrationDirectory(source.directory, source.identity)
      for (const directory of source.directories) await assertMigrationDirectory(path.join(source.directory, directory.relative), directory.identity)
      const original = path.join(source.directory, entry.relative)
      await checkFile(original, entry.original)
      const backup = path.join(transaction, 'sources', String(entry.source), entry.relative)
      // IM download expiry uses mtime; moving the profile must not extend it.
      const preserveTimes = entry.destination.startsWith(`im-downloads${path.sep}`)
      await copyExclusive(original, backup, entry.original.digest, transaction, binding.root, preserveTimes)
      await copyExclusive(backup, stagedFile(binding, journal, entry), entry.original.digest, transaction, binding.root, preserveTimes)
    }
    for (let index = 0; index < journal.sources.length; index++) {
      const source = journal.sources[index]!
      if (source.layout || source.archive) continue
      const stage = path.join(stageRoot, String(index))
      await fs.mkdir(stage, { recursive: true, mode: 0o700 })
      await relocateManagedData(source.directory, binding.root, stage, { internalDirectory: 'echoflow-code', sourceInternalDirectory: source.destination ? undefined : 'cc-haha', internalOnly: !!source.destination, writeRelocations: false })
    }
    for (const entry of journal.entries) {
      const staged = stagedFile(binding, journal, entry)
      if (im && (await inspectImFile(binding, staged, entry.relative, journal.sources[0]!.directory)).digest !== entry.original.digest) {
        throw new Error('Staged IM file changed')
      }
      if (entry.relative === '.config.json' && entry.destination === journal.globalConfigDestination) {
        const value: unknown = JSON.parse(await fs.readFile(staged, 'utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy global configuration')
      }
      if (!historicalMaterial(entry.destination) && await isSQLiteFile(staged)) {
        if (!hooks.validateSQLite) throw new Error(`SQLite consistency validator required: ${entry.destination}`)
        await hooks.validateSQLite(staged)
      }
      // Validators must not checkpoint or mutate a frozen WAL snapshot.
      entry.stagedDigest = (await regularIdentity(staged)).digest
    }
    for (const entry of journal.entries) {
      if ([path.join('echoflow-code', 'providers.json'), path.join('echoflow-code', 'settings.json'), 'scheduled_tasks.json'].includes(entry.destination)) {
        const staged = stagedFile(binding, journal, entry)
        const value: unknown = JSON.parse(await fs.readFile(staged, 'utf8'))
        if (hooks.upgradeJson) await durableJson(staged, hooks.upgradeJson(entry.destination, value))
        else if (entry.destination.endsWith('providers.json') || entry.destination === 'scheduled_tasks.json' || (value && typeof value === 'object' && 'schemaVersion' in value)) throw new Error(`Schema migration hook required: ${entry.destination}`)
        entry.stagedDigest = (await regularIdentity(staged)).digest
      }
    }
    await prepareMergedFiles(binding, journal, hooks, signal)
    await assertOpaqueStores(binding, journal)
    if (whatsapp) await validateWhatsAppPublication(binding, journal, whatsapp, true)
    if ((hooks.platform ?? process.platform) === 'darwin' && !hooks.prepareResources) throw new Error('macOS credential migration hooks are required')
    await hooks.prepareResources?.(transaction, journal.sources.filter(source => !source.layout && !source.archive))
    for (const entry of journal.entries) {
      const staged = stagedFile(binding, journal, entry)
      await fs.chmod(staged, entry.original.mode)
    }
    if ((hooks.platform ?? process.platform) === 'win32') {
      const permissions = journal.entries.map(entry => ({ source: path.join(journal.sources[entry.source]!.directory, entry.relative), target: stagedFile(binding, journal, entry) }))
      for (const entry of journal.archiveFiles) {
        if (entry.baseline && entry.baseline.digest !== entry.stagedDigest) {
          permissions.push({ source: path.join(binding.root, entry.destination), target: archiveStageFile(binding, journal, entry.destination) })
        }
      }
      await hooks.permissions!.preserve(permissions, signal)
    }
    await assertBoundary(binding, journal, hooks)
    for (const entry of journal.entries) await checkFile(path.join(journal.sources[entry.source]!.directory, entry.relative), entry.original)
    journal.phase = 'publishing'
    await saveJournal(binding, journal)
  }
  if (journal.phase === 'publishing') {
    if (whatsapp) {
      await assertWhatsAppSource(whatsapp, whatsapp.files)
      const account = whatsapp.whatsapp!
      checkWhatsAppAdoptionConfig(binding, account, await readWhatsAppAdoptionConfig(account.config, account.configIdentity))
    }
    if (im || whatsapp) {
      for (const entry of journal.entries) {
        await checkFile(path.join(journal.sources[entry.source]!.directory, entry.relative), entry.original)
        const target = path.join(binding.root, entry.destination)
        const current = await fs.lstat(target, { bigint: true }).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
        // publishFile verifies an interrupted hard-link publication after unlinking staging.
        if (current && entry.publicationIntent && String(current.dev) === entry.publicationIntent.dev &&
          String(current.ino) === entry.publicationIntent.ino) continue
        const expected = entry.published ?? entry.baseline
        if (expected) await checkFile(target, expected)
        else if (current) throw new Error(`IM target appeared during publication: ${entry.destination}`)
      }
    }
    await assertSQLiteCohorts(binding, journal)
    for (const source of journal.sources) {
      for (const directory of source.directories) await ensurePublishedDirectory(binding, journal, destinationFor(source, directory.relative), path.join(source.directory, directory.relative), directory.mode)
    }
    for (const entry of journal.entries) {
      if ([path.join('echoflow-code', 'storage-relocations.json'), archiveStateDestination, archiveMarkerDestination].includes(entry.destination)) continue
      await assertBoundary(binding, journal, hooks)
      await ensurePublishedDirectory(binding, journal, path.dirname(entry.destination), path.dirname(path.join(journal.sources[entry.source]!.directory, entry.relative)), 0o700)
      await publishFile(binding, journal, entry, stagedFile(binding, journal, entry))
    }
    for (const destination of archiveDestinations) {
      for (const entry of journal.entries.filter(entry => entry.destination === destination)) {
        await assertBoundary(binding, journal, hooks)
        await publishFile(binding, journal, entry, stagedFile(binding, journal, entry))
      }
      const derived = journal.archiveFiles?.find(entry => entry.destination === destination)
      if (derived) {
        await assertBoundary(binding, journal, hooks)
        await publishFile(binding, journal, derived, archiveStageFile(binding, journal, destination))
      }
    }
    await publishRelocations(binding, journal)
    for (const directory of [...journal.directories].reverse()) {
      if (directory.created) await fs.chmod(path.join(binding.root, directory.relative), directory.mode)
    }
    if ((hooks.platform ?? process.platform) === 'win32') await hooks.permissions!.preserve(journal.directories.filter(directory => directory.created).map(directory => ({ source: directory.source, target: path.join(binding.root, directory.relative) })), signal)
    await hooks.validateResources?.(transaction)
    journal.phase = 'validating'
    journal.state = 'validation-required'
    journal.issues = []
    await saveJournal(binding, journal)
  }
  return resultOf(journal)
}

async function publishRelocations(binding: StorageBinding, journal: StorageJournal): Promise<void> {
  const file = path.join(binding.internalDir, 'storage-relocations.json')
  const transaction = transactionPath(binding, journal.id)
  const staged = path.join(transaction, 'relocations-next.json')
  const imported = journal.entries.filter(entry => entry.destination === path.join('echoflow-code', 'storage-relocations.json'))
  if (!journal.relocation) {
    const baseline = await present(file) ? await regularIdentity(file) : null
    const records: Record<string, unknown>[] = baseline ? [JSON.parse(await fs.readFile(file, 'utf8'))] : []
    for (const entry of imported) records.push(JSON.parse(await fs.readFile(path.join(transaction, 'sources', String(entry.source), entry.relative), 'utf8')))
    let unknown: unknown = {}
    const roots: string[] = []
    const mappings: { from: string; to: string }[] = []
    for (const record of records) {
      if (!record || (record.version !== 1 && record.version !== 2) || !Array.isArray(record.previousRoots) || !record.previousRoots.every(root => typeof root === 'string' && path.isAbsolute(root) && !root.includes('\0')) ||
        (record.version === 2 && (!Array.isArray(record.mappings) || !record.mappings.every(item => item && typeof item.from === 'string' && path.isAbsolute(item.from) && !item.from.includes('\0') && (item.to === '.' || safeRelative(item.to)))))) throw new Error('Unsupported storage relocation metadata')
      const { version: _version, previousRoots, mappings: previousMappings, ...rest } = record
      unknown = mergeObject(unknown, rest, 'storage relocation metadata')
      roots.push(...previousRoots as string[])
      if (record.version === 2) mappings.push(...previousMappings as { from: string; to: string }[])
      // V1 roots implied the old internal namespace; retain that interpretation
      // when upgrading, rather than mapping older images back into cc-haha.
      for (const root of previousRoots as string[]) mappings.push({ from: path.join(root, 'cc-haha'), to: 'echoflow-code' }, { from: root, to: '.' })
    }
    for (let index = 0; index < journal.sources.length; index++) {
      const source = journal.sources[index]!
      if (source.layout === 'approved-external') {
        if (source.approvalCategory === 'whatsapp-auth' && source.destination) {
          mappings.push({ from: source.directory, to: source.destination })
          continue
        }
        for (const entry of journal.entries) {
          if (entry.source === index) mappings.push({ from: path.join(source.directory, entry.relative), to: entry.destination })
        }
        continue
      }
      // Selective source directories remain active; only their fixed legacy files retire.
      if (source.layout || source.archive) continue
      mappings.push(...(source.destination ? [{ from: source.directory, to: source.destination }] : [{ from: path.join(source.directory, 'cc-haha'), to: 'echoflow-code' }, { from: source.directory, to: '.' }]))
      if (!source.destination) roots.push(source.directory)
    }
    const unique: { from: string; to: string }[] = []
    for (const mapping of mappings) {
      const same = unique.find(item => item.from === mapping.from)
      if (same && same.to !== mapping.to) throw new Error(`Conflicting storage relocation mapping: ${mapping.from}`)
      if (!same) unique.push(mapping)
    }
    if (baseline) await copyExclusive(file, path.join(transaction, 'target-before', 'echoflow-code', 'storage-relocations.json'), baseline.digest, transaction, binding.root)
    await durableJson(staged, { ...unknown as Record<string, unknown>, version: 2, previousRoots: [...new Set(roots)], mappings: unique })
    journal.relocation = { baseline, intent: await regularIdentity(staged) }
    await saveJournal(binding, journal)
  }
  const receipt = journal.relocation
  if (!receipt.published) {
    const current = await present(file) ? await regularIdentity(file) : null
    if (!current || !sameFile(current, receipt.intent)) {
      if (receipt.baseline) await checkFile(file, receipt.baseline)
      else if (current) throw new Error('Storage relocation metadata changed during publication')
      await checkFile(staged, receipt.intent)
      await fs.rename(staged, file)
    }
    await syncDirectory(path.dirname(file))
    await checkFile(file, receipt.intent)
    receipt.published = receipt.intent
    await saveJournal(binding, journal)
  }
  await checkFile(file, receipt.published)
  for (const entry of imported) entry.published = receipt.published
  await saveJournal(binding, journal)
}

async function validatePublished(binding: StorageBinding, journal: StorageJournal, hooks: StorageMigrationHooks): Promise<void> {
  await assertBoundary(binding, journal, hooks)
  await assertSQLiteCohorts(binding, journal)
  for (const entry of [...journal.entries, ...(journal.archiveFiles ?? [])]) {
    if (!entry.published) throw new Error('Missing published file receipt')
    await checkFile(path.join(binding.root, entry.destination), entry.published)
  }
  if (!journal.relocation?.published) throw new Error('Missing storage relocation receipt')
  await checkFile(path.join(binding.internalDir, 'storage-relocations.json'), journal.relocation.published)
  const whatsapp = await whatsappTransaction(binding, journal.sources, journal)
  if (whatsapp) {
    await assertWhatsAppSource(whatsapp, whatsapp.files)
    await validateWhatsAppPublication(binding, journal, whatsapp, false)
  }
  await hooks.validateResources?.(transactionPath(binding, journal.id))
}

/** Recovery is roll-forward under the same barrier; never replay a completed import. */
export async function recoverStorageMigration(binding: StorageBinding, hooks: StorageMigrationHooks, expectedId?: string): Promise<StorageMigrationResult> {
  let release: (() => Promise<void>) | undefined
  try {
    await initializeTarget(binding)
    const journals = await readJournals(binding)
    if (!expectedId && journals.every(journal => journal.phase === 'completed' && journal.state === 'ready')) {
      for (const journal of journals) await assertNoFork(journal)
      // Startup is observational, not maintenance. The writer lease's final
      // barrier check closes the race with a migration starting after this read.
      const lock = path.join(transactionHome(binding), 'lock.json')
      if (!await present(lock)) return { state: 'ready', issues: [] }
      if (binding.location) {
        const ready = await withStorageLocation(binding, async database => {
          assertLocationBinding(binding, database)
          await assertNoSourceHandoff(binding.root)
          for (const journal of await readJournals(binding)) {
            if (journal.phase !== 'completed' || journal.state !== 'ready') return false
            await assertNoFork(journal)
          }
          if (await present(lock) && !await reapStoppedReceipt(lock, false)) throw new Error('Storage migration already running')
          return true
        })
        if (ready) return { state: 'ready', issues: [] }
      }
    }
    release = await lockStorageMigration(binding)
    const current = await readJournals(binding)
    if (expectedId && (!current.some(journal => journal.id === expectedId) || current.some(journal => journal.state !== 'ready' && journal.id !== expectedId))) {
      throw new Error('Conflicting storage transaction and cold approval')
    }
    for (const journal of current) {
      if (journal.phase === 'completed') {
        if (journal.state !== 'ready') return resultOf(journal)
        await assertNoFork(journal)
        if (journal.id === expectedId) return resultOf(journal)
        continue
      }
      if (journal.phase === 'accepted') return await cleanupTransaction(binding, journal, hooks)
      if (journal.phase === 'validating') {
        await validatePublished(binding, journal, hooks)
        return resultOf(journal)
      }
      try { return await advanceTransaction(binding, journal, hooks) } catch (error) {
        journal.state = 'blocked'; journal.issues = [issue(error)]; await saveJournal(binding, journal); return resultOf(journal)
      }
    }
    return { state: 'ready', issues: [] }
  } catch (error) { return { state: 'blocked', issues: [issue(error)] } } finally { await release?.() }
}

/** Invoke after restricted startup validation, BEFORE admitting business writes.
 * Acceptance is durable before cleanup. There is deliberately no rollback API. */
export async function completeStorageMigration(
  binding: StorageBinding, id: string, hooks: StorageMigrationHooks,
  validateStartup?: (binding: StorageBinding) => Promise<void>,
): Promise<StorageMigrationResult> {
  // Restricted full-profile startup may check writer admission itself.
  let startupValidated = false
  if (validateStartup) {
    const journal = (await readJournals(binding)).find(entry => entry.id === id)
    if (journal?.phase === 'validating' && !assertImTransactionScope(journal.sources, journal) &&
      !journal.sources.some(source => source.approvalCategory === 'whatsapp-auth')) {
      await validateStartup(binding)
      startupValidated = true
    }
  }
  let release: (() => Promise<void>) | undefined
  try {
    release = await lockStorageMigration(binding)
    const journal = (await readJournals(binding)).find(entry => entry.id === id)
    if (!journal) throw new Error('Storage transaction not found')
    if (journal.phase === 'completed') { await assertNoFork(journal); return resultOf(journal) }
    if (journal.phase !== 'validating' && journal.phase !== 'accepted') throw new Error('Storage transaction is not ready for validation')
    await assertBoundary(binding, journal, hooks)
    if (journal.phase === 'validating') {
      await validatePublished(binding, journal, hooks)
      if (assertImTransactionScope(journal.sources, journal)) {
        const relocations = readStorageRelocations(binding.root)
        for (const entry of journal.entries) {
          const source = path.join(journal.sources[0]!.directory, entry.relative)
          const published = await inspectImFile(binding, path.join(binding.root, entry.destination), entry.relative, path.dirname(source))
          if (!sameFile(published, entry.published!) || !relocations.mappings?.some(mapping => mapping.from === source && mapping.to === entry.destination)) {
            throw new Error('IM migration publication does not match its approval')
          }
        }
      } else if (validateStartup && !startupValidated && !journal.sources.some(source => source.approvalCategory === 'whatsapp-auth')) {
        throw new Error('Storage transaction changed before restricted startup validation')
      }
      journal.phase = 'accepted'
      journal.state = 'cleanup-pending'
      await saveJournal(binding, journal)
    }
    return await cleanupTransaction(binding, journal, hooks)
  } catch (error) { return { state: 'blocked', id, issues: [issue(error)] } } finally { await release?.() }
}
async function cleanupTransaction(binding: StorageBinding, journal: StorageJournal, hooks: StorageMigrationHooks): Promise<StorageMigrationResult> {
  const transaction = transactionPath(binding, journal.id)
  const issues: string[] = []
  await assertBoundary(binding, journal, hooks)
  if (journal.archiveFiles) {
    for (const entry of [...journal.archiveFiles, ...journal.entries.filter(entry => archiveDestinations.includes(entry.destination))]) {
      if (!entry.published) throw new Error('Missing published session archive receipt')
      await checkFile(path.join(binding.root, entry.destination), entry.published)
    }
  }
  const im = assertImTransactionScope(journal.sources, journal)
  const whatsapp = await whatsappTransaction(binding, journal.sources, journal)
  if (whatsapp) {
    const source = journal.sources[0]!
    if (await present(source.directory) || journal.entries.some(entry => entry.source === 0 && !entry.cleaned)) {
      await assertWhatsAppSource(whatsapp, whatsapp.files, true)
    }
    await validateWhatsAppPublication(binding, journal, whatsapp, false)
  }
  if (im || whatsapp) {
    for (const [index, source] of journal.sources.entries()) {
      if (journal.entries.some(entry => entry.source === index && !entry.cleaned) || await present(source.directory)) {
        await assertMigrationDirectory(source.directory, source.identity)
      }
    }
    for (const entry of journal.entries) {
      const original = path.join(journal.sources[entry.source]!.directory, entry.relative)
      const backup = path.join(transaction, 'sources', String(entry.source), entry.relative)
      if (!entry.published || (await regularIdentity(backup)).digest !== entry.original.digest) throw new Error('Missing verified IM migration copy')
      await checkFile(path.join(binding.root, entry.destination), entry.published)
      if (await present(original)) {
        if (entry.cleaned) throw new Error('A retired IM file was recreated')
        await checkFile(original, entry.original)
      }
    }
  }
  await publishStorageLocation(binding, journal)
  const cleanEntry = async (entry: ImportEntry) => {
    if (entry.cleaned) return
    const source = journal.sources[entry.source]!
    const file = path.join(source.directory, entry.relative)
    try {
      await assertBoundary(binding, journal, hooks)
      const backup = path.join(transaction, 'sources', String(entry.source), entry.relative)
      if ((await regularIdentity(backup)).digest !== entry.original.digest) throw new Error(`Source backup changed: ${entry.relative}`)
      if (await present(file)) {
        await assertMigrationDirectory(source.directory, source.identity)
        for (const directory of source.directories.filter(directory => isWithin(directory.relative, entry.relative))) await assertMigrationDirectory(path.join(source.directory, directory.relative), directory.identity)
        await checkFile(file, entry.original)
        await checkFile(path.join(binding.root, entry.destination), entry.published!)
        await fs.unlink(file)
        await syncDirectory(path.dirname(file))
      }
      entry.cleaned = true
      await saveJournal(binding, journal)
    } catch (error) { issues.push(issue(error)) }
  }
  const hasHandoff = journal.sources.some(source => source.handoff)
  for (const entry of journal.entries) {
    if (entry.relative !== journal.sources[entry.source]!.handoff?.relative) await cleanEntry(entry)
    if ((im || whatsapp) && issues.length) break
  }
  if (whatsapp && !issues.length && await present(whatsapp.whatsapp!.directory)) {
    try {
      const { directory, identity } = whatsapp.whatsapp!
      await assertBoundary(binding, journal, hooks)
      await assertUnlinkedDirectoryPath(directory)
      await assertMigrationDirectory(directory, identity)
      await fs.rmdir(directory)
      await syncDirectory(path.dirname(directory))
    } catch (error) { issues.push(issue(error)) }
  }
  // Keep the durable source barrier through data/resource cleanup, even if the cold PID dies.
  if (hasHandoff && !issues.length) {
    try { await hooks.cleanupResources?.(transaction) } catch (error) { issues.push(issue(error)) }
  }
  for (const source of journal.sources) {
    if (source.layout) continue
    try {
      if (!await present(source.directory)) continue
      await assertMigrationDirectory(source.directory, source.identity)
      if (source.handoff) {
        if (issues.length) continue
        await assertHandoffRetirement(source)
        const entry = journal.entries.find(entry => journal.sources[entry.source] === source && entry.relative === source.handoff!.relative)!
        await cleanEntry(entry)
        if (issues.length) continue
        await cleanupSourceCoordination(source)
      }
      // Never recursively delete a source, and never traverse a replacement link.
      for (const receipt of [...source.directories].reverse()) {
        const directory = path.join(source.directory, receipt.relative)
        if (!await present(directory)) continue
        await assertUnlinkedDirectoryPath(directory)
        await assertMigrationDirectory(directory, receipt.identity)
        await fs.rmdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error })
      }
      await fs.rmdir(source.directory)
    } catch (error) { issues.push(issue(error)) }
  }
  if (!hasHandoff && !issues.length) {
    try { await hooks.cleanupResources?.(transaction) } catch (error) { issues.push(issue(error)) }
  }
  journal.issues = issues
  journal.state = issues.length ? 'cleanup-pending' : 'ready'
  if (!issues.length) journal.phase = 'completed'
  await saveJournal(binding, journal)
  return resultOf(journal)
}
