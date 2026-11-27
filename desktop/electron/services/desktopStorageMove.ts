import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { assertMigrationDirectory, assertUnlinkedDirectoryPath, isWithin, readStorageMigrationStatus, type MigrationDirectoryIdentity, type StorageHandoffLaunch, type StorageHandoffPreview, type StorageHandoffRequest } from '../../../src/services/storageMigration'
export { prepareStorageHandoff as desktopMovePreview, assertStorageHandoffPreview as assertDesktopMovePreview, armStorageHandoff as armDesktopMove, cancelStorageHandoff as cancelDesktopMove } from '../../../src/services/storageMigration'
import { resolveStorageBinding } from '../../../src/utils/echoFlowConfigRoot'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const proofPattern = /^[a-f0-9]{64}:\d+:\d+$/
const names = ['echoflow-move-source', 'echoflow-move-request', 'echoflow-move-proof'] as const
const ownedSourceLocks = new Map<string, string>()
const relativeRequest = (id: string) => path.join('echoflow-code', 'storage-handoffs', `${id}.json`)
export type DesktopMoveLaunch = StorageHandoffLaunch
type Request = StorageHandoffRequest
export type DesktopMovePreview = StorageHandoffPreview
type IndependentFile = { bytes: string; proof: string }

async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
async function read(file: string): Promise<IndependentFile> {
  await assertUnlinkedDirectoryPath(path.dirname(file))
  const before = await fs.lstat(file, { bigint: true })
  if (!before.isFile() || before.nlink !== 1n) throw new Error('Desktop move requires an independent request or receipt')
  const bytes = await fs.readFile(file, 'utf8')
  const after = await fs.lstat(file, { bigint: true })
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('Desktop move evidence changed while reading')
  return { bytes, proof: `${createHash('sha256').update(bytes).digest('hex')}:${before.dev}:${before.ino}` }
}
const absolute = (value: unknown): value is string => typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && !value.includes('\0')
function identity(value: unknown): value is MigrationDirectoryIdentity {
  const item = value as MigrationDirectoryIdentity
  return !!item && absolute(item.canonical) && typeof item.dev === 'string' && /^\d+$/.test(item.dev) && typeof item.ino === 'string' && /^\d+$/.test(item.ino)
}
function parse(bytes: string): Request {
  const request = JSON.parse(bytes) as Request
  if (!request || request.version !== 1 || !uuid.test(request.id) || !absolute(request.source) || !absolute(request.target) ||
    !identity(request.sourceIdentity) || !identity(request.targetIdentity) || request.sourceIdentity.canonical !== request.source || request.targetIdentity.canonical !== request.target ||
    !['pending', 'cancelled'].includes(request.state) || isWithin(request.source, request.target) || isWithin(request.target, request.source)) throw new Error('Invalid desktop move request')
  return request
}

export function desktopMoveLaunch(commandLine: { hasSwitch(name: string): boolean; getSwitchValue(name: string): string }): DesktopMoveLaunch | undefined {
  if (!names.some(name => commandLine.hasSwitch(name))) return undefined
  const [source, id, proof] = names.map(name => commandLine.getSwitchValue(name))
  if (!source || !absolute(source) || !id || !uuid.test(id) || !proof || !proofPattern.test(proof)) throw new Error('Incomplete or invalid desktop move launch')
  return { source, id, proof }
}
export function desktopMoveRelaunchArgs(argv: readonly string[], target: string, request: DesktopMoveLaunch): string[] {
  const result: string[] = []
  const replaced = [...names, 'user-data-dir', 'disk-cache-dir', 'media-cache-dir']
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]!.replace(/^--/, '').split('=')[0]!
    if (argv[index]!.startsWith('--') && replaced.includes(name)) { if (!argv[index]!.includes('=')) index++; continue }
    result.push(argv[index]!)
  }
  return [...result, `--user-data-dir=${target}`, `--${names[0]}=${request.source}`, `--${names[1]}=${request.id}`, `--${names[2]}=${request.proof}`]
}

/** Ordinary startup must not turn an armed handoff back into an old-root writer. */
export async function assertNoPendingDesktopMove(root: string, allowedId?: string): Promise<void> {
  const directory = path.join(root, 'echoflow-code', 'storage-handoffs')
  if (!await exists(directory)) return
  await assertUnlinkedDirectoryPath(directory)
  for (const name of await fs.readdir(directory)) {
    if (!name.endsWith('.json')) continue
    const request = parse((await read(path.join(directory, name))).bytes)
    if (name !== `${request.id}.json`) throw new Error('Invalid desktop move request filename')
    if (request.source === root && request.state === 'pending' && request.id !== allowedId) throw new Error('Pending desktop move requires its explicit cold request launch')
  }
}

/** Bind an explicit launch to immutable source evidence or its validated v2 backup. */
export async function inspectDesktopMove(launch: DesktopMoveLaunch, target: string): Promise<{ request: Request; transaction?: { id: string; phase: string }; assertOriginal(): Promise<void> }> {
  if (!absolute(target) || !absolute(launch.source) || !uuid.test(launch.id) || !proofPattern.test(launch.proof)) throw new Error('Invalid desktop move launch')
  const binding = resolveStorageBinding({ env: {}, roots: [target] })
  const status = await readStorageMigrationStatus(binding) // Validate active receipts before interpreting local evidence.
  const home = path.join(binding.internalDir, 'migrations')
  let transaction: { id: string; phase: string } | undefined
  let evidence: IndependentFile | undefined
  if (await exists(home)) for (const id of await fs.readdir(home)) {
    if (!uuid.test(id)) continue
    const journalFile = await read(path.join(home, id, 'journal.json'))
    const journal = JSON.parse(journalFile.bytes) as { sources: { directory: string; layout?: string; destination?: string; archive?: boolean; handoff?: { relative: string } }[]; entries: { source: number; relative: string; destination: string; original: { digest: string; dev: string; ino: string } }[]; phase: string }
    const entry = journal.entries.find(item => {
      const source = journal.sources[item.source]
      return item.relative === relativeRequest(launch.id) && source?.directory === launch.source &&
        !source.layout && !source.destination && !source.archive &&
        (source.handoff?.relative === item.relative || item.destination === item.relative)
    })
    if (!entry) continue
    if (`${entry.original.digest}:${entry.original.dev}:${entry.original.ino}` !== launch.proof || transaction) throw new Error('Conflicting desktop move transaction evidence')
    transaction = { id, phase: journal.phase }
    const backup = path.join(home, id, 'sources', String(entry.source), entry.relative)
    if (await exists(backup)) evidence = await read(backup)
  }
  if (status && status.state !== 'ready' && status.id !== transaction?.id) throw new Error('Conflicting active storage transaction and desktop move request')
  const original = path.join(launch.source, relativeRequest(launch.id))
  if (!evidence) evidence = await read(original)
  if (evidence.proof.split(':')[0] !== launch.proof.split(':')[0]) throw new Error('Desktop move request bytes changed')
  const request = parse(evidence.bytes)
  if (request.id !== launch.id || request.source !== launch.source || request.target !== target || request.state !== 'pending') throw new Error('Desktop move launch conflicts with its request')
  await assertMigrationDirectory(target, request.targetIdentity)
  const assertOriginal = async () => {
    await assertMigrationDirectory(target, request.targetIdentity)
    if (!transaction || !['accepted', 'completed'].includes(transaction.phase)) {
      await assertMigrationDirectory(request.source, request.sourceIdentity)
      if ((await read(original)).proof !== launch.proof) throw new Error('Desktop move request was replaced or changed')
    }
  }
  await assertOriginal()
  return { request, transaction, assertOriginal }
}

/** Use the shared lock/receipt protocol without releasing the old host's lifetime lease. */
export async function lockDesktopMoveSource(source: string): Promise<() => Promise<void>> {
  const directory = path.join(source, 'echoflow-code', 'migrations')
  await assertUnlinkedDirectoryPath(path.dirname(directory))
  // A concurrent cold launch may already have retired the source.
  await fs.mkdir(directory, { mode: 0o700 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  await assertUnlinkedDirectoryPath(directory)
  const stopped = async (file: string) => {
    const evidence = await read(file)
    const receipt = JSON.parse(evidence.bytes) as { version: number; host: string; pid: number; token: string }
    if (!receipt || Object.keys(receipt).sort().join(',') !== 'host,pid,token,version' || receipt.version !== 1 || receipt.host !== hostname() || !Number.isSafeInteger(receipt.pid) || receipt.pid <= 0 || typeof receipt.token !== 'string') throw new Error('Unknown storage process receipt; manual recovery required')
    if (ownedSourceLocks.get(file) === evidence.proof) return evidence
    try { process.kill(receipt.pid, 0); throw new Error('Active storage writer; close it before the cold move') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    return evidence
  }
  const lock = path.join(directory, 'lock.json')
  if (await exists(lock)) {
    const prior = await stopped(lock)
    if ((await read(lock)).proof !== prior.proof) throw new Error('Storage source lock was replaced')
    // The durable handoff blocks headless admission; only known coordination is renewable.
    await fs.unlink(lock)
  }
  if (!await exists(lock)) {
    const handle = await fs.open(lock, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify({ version: 1, host: hostname(), pid: process.pid, token: randomUUID() })); await handle.sync() } finally { await handle.close() }
    await syncDirectory(directory)
    ownedSourceLocks.set(lock, (await read(lock)).proof)
  }
  const writers = path.join(directory, 'writers')
  if (await exists(writers)) {
    await assertUnlinkedDirectoryPath(writers)
    for (const name of await fs.readdir(writers)) await stopped(path.join(writers, name))
  }
  const proof = (await read(lock)).proof
  // Kept until core cleanup retires the source, or reaped after this process exits.
  return async () => { if ((await read(lock)).proof !== proof) throw new Error('Storage source lock was replaced') }
}
