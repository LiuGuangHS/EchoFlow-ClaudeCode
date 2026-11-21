import { execFile } from 'node:child_process'
import { readdir, readFile, readlink, stat } from 'node:fs/promises'
import path, { join } from 'node:path'
import { promisify } from 'node:util'
import { hostname } from 'node:os'
import { canonicalPath, isWithin } from '../services/storageMigration.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { assertWindowsMigrationInventory, createWindowsInventoryRunner, type WindowsInventoryRunner } from './migrationInventoryWindows.js'

/** Never sweeps PID files or assumes an inaccessible process is dead. */
export async function countExternalMigrationProcesses(
  ownedPids: readonly number[],
  configDir = getClaudeConfigHomeDir(),
  isAlive: (pid: number) => boolean = pid => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  },
): Promise<number> {
  const owned = new Set([process.pid, ...ownedPids])
  let files: string[]
  try { files = await readdir(join(configDir, 'sessions')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let count = 0
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = Number(file.slice(0, -5))
    if (!Number.isSafeInteger(pid) || pid <= 0 || owned.has(pid) || !isAlive(pid)) continue
    // An unreadable/malformed live registration cannot safely be ignored.
    try {
      const entry = JSON.parse(await readFile(join(configDir, 'sessions', file), 'utf8'))
      if (entry.pid !== pid) throw new Error('Invalid session process registration')
    } catch {
      count += 1
      continue
    }
    count += 1
  }
  return count
}

const execute = promisify(execFile)
type CommandResult = { stdout: string; stderr: string; pid?: number }
/** OS transport seam for isolated fixtures; never supply untrusted evidence. */
export type MigrationInventoryTransport = {
  platform: NodeJS.Platform
  uid?: number
  procDirectory?: string
  run(command: string, args: string[]): Promise<CommandResult>
  runWindows?: WindowsInventoryRunner
}
const systemTransport: MigrationInventoryTransport = {
  platform: process.platform,
  uid: process.getuid?.(),
  runWindows: createWindowsInventoryRunner(),
  run: async (command, args) => {
    const running = execute(command, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true })
    return { ...await running, pid: running.child.pid }
  },
}
const blocked = (reason: string): Error => new Error(`Storage migration blocked: ${reason}`)
const validPid = (pid: number): boolean => Number.isSafeInteger(pid) && pid > 0
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw blocked(`cannot inspect process ${pid}`)
  }
}
function matchesRoot(roots: readonly string[], candidate: string): boolean {
  // Linux and lsof retain this suffix for an unlinked but still-open inode.
  const name = candidate.replace(/ \(deleted\)$/, '')
  return path.isAbsolute(name) && roots.some(root => isWithin(root, name))
}
// Match product executables/source entrypoints, not every Electron/Node/Python app.
const applicationOwnerPatterns = [
  /(?:^|[\s\0/\\"'])(?:echoflow(?:[- ]code)?(?: helper(?: \([^)]+\))?)?|cc-haha(?:-computer-use)?|claude(?:-haha|-sidecar[^\s\0/\\"']*)?|cu-helper|agent-desktop[^\s\0/\\"']*)(?:\.exe)?(?=$|[\s\0"'])/i,
  /(?:^|[/\\])(?:EchoFlow Code|EchoFlow Code Helper(?: \([^)]+\))?|cc-haha(?:-computer-use)?)\.app[/\\]/i,
  /(?:^|[\s\0/\\"'])(?:src[/\\](?:entrypoints[/\\]cli\.tsx|server[/\\]index\.ts|localRecoveryCli\.ts)|desktop[/\\]electron[/\\]main\.ts|claude-sidecar\.ts|chromeNativeHost\.[jt]s|win_helper\.py|adapters[/\\](?:telegram|feishu|wechat|dingtalk|whatsapp|wecom|qq|slack)[/\\]index\.ts)(?=$|[\s\0"'])/i,
]
function applicationOwner(command: string): boolean {
  return applicationOwnerPatterns.some(pattern => pattern.test(command))
}
function commandUsesRoot(roots: readonly string[], command: string): boolean {
  return roots.some(root => {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[=\\s\\0"'])${escaped}(?=$|[/\\\\\\s\\0"'])`, process.platform === 'win32' ? 'i' : '').test(command)
  })
}
async function command(transport: MigrationInventoryTransport, program: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await transport.run(program, args)
    if (result.stderr.trim()) throw blocked(`${program} could not provide complete process evidence`)
    return result
  } catch {
    // OS error messages can contain command lines. Never forward them to the UI.
    throw blocked(`${program} evidence unavailable; install/authorize the OS inspection tool before retrying`)
  }
}
async function assertRegistrations(roots: readonly string[], owned: Set<number>): Promise<void> {
  for (const root of roots) {
    if (await countExternalMigrationProcesses([...owned], root)) throw blocked('another registered session is alive')
    const writers = join(root, 'echoflow-code', 'migrations', 'writers')
    let names: string[]
    try { names = await readdir(writers) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw blocked('writer registrations are unreadable')
    }
    for (const name of names) {
      let receipt: { version: number; host: string; pid: number; token: string }
      try { receipt = JSON.parse(await readFile(join(writers, name), 'utf8')) } catch { throw blocked('unknown writer registration') }
      if (!receipt || receipt.version !== 1 || receipt.host !== hostname() || !validPid(receipt.pid) || typeof receipt.token !== 'string') throw blocked('unknown writer registration')
      if (!owned.has(receipt.pid) && alive(receipt.pid)) throw blocked(`registered writer ${receipt.pid} is alive`)
    }
  }
}

// A foreign-user process cannot newly traverse a private ancestor through
// ordinary DAC. Privileged processes that bypass OS access controls are outside
// this application-owner inventory; an inaccessible same-user process blocks.
async function hasPrivateRoots(roots: readonly string[], uid: number): Promise<boolean> {
  let privateRoots = true
  for (const root of roots) {
    let current = root
    let privateAncestor = false
    for (;;) {
      try {
        const info = await stat(current)
        if (info.uid === uid && (info.mode & 0o077) === 0) { privateAncestor = true; break }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw blocked('data-root access boundary unreadable') }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    privateRoots &&= privateAncestor
  }
  return privateRoots
}

async function inspectLinux(roots: readonly string[], owned: Set<number>, transport: MigrationInventoryTransport): Promise<void> {
  if (transport.uid === undefined) throw blocked('current OS user identity unavailable')
  const proc = transport.procDirectory ?? '/proc'
  let processes: string[]
  try { processes = (await readdir(proc)).filter(name => /^\d+$/.test(name)) } catch { throw blocked('/proc process enumeration unavailable') }
  if (!processes.length) throw blocked('/proc did not enumerate processes')
  const privateRoots = await hasPrivateRoots(roots, transport.uid)
  for (const name of processes) {
    const pid = Number(name)
    if (owned.has(pid)) continue
    const directory = join(proc, name)
    try {
      const status = await readFile(join(directory, 'status'), 'utf8')
      const uid = /^Uid:\s+(\d+)/m.exec(status)
      if (!uid) throw blocked(`process ${pid} identity unreadable`)
      // Defunct processes cannot subsequently write and have no address space.
      if (/^State:\s+Z\b/m.test(status)) continue
      const ownUser = Number(uid[1]) === transport.uid
      const cmd = await readFile(join(directory, 'cmdline'), 'utf8')
      const parent = /^PPid:\s+(\d+)/m.exec(status)
      if (!parent) throw blocked(`process ${pid} parent identity unreadable`)
      if (owned.has(Number(parent[1])) || applicationOwner(cmd) || commandUsesRoot(roots, cmd)) throw blocked(`application process ${pid} must exit before migration`)
      if (!ownUser && privateRoots) continue
      const references = [await readlink(join(directory, 'cwd')), await readlink(join(directory, 'exe'))]
      for (const descriptor of await readdir(join(directory, 'fd'))) {
        try { references.push(await readlink(join(directory, 'fd', descriptor))) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      const mappings = await readFile(join(directory, 'maps'), 'utf8')
      for (const line of mappings.split('\n')) {
        const mapped = /^\S+\s+\S+\s+\S+\s+\S+\s+\d+\s+(\/.*)$/.exec(line)
        if (mapped) references.push(mapped[1]!.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8))))
      }
      if (applicationOwner(references[1]!) || references.some(file => matchesRoot(roots, file))) throw blocked(`process ${pid} holds selected storage`)
    } catch (error) {
      // A vanished fd is normal; a vanished process is the only reason to skip
      // an incomplete process inspection. Permission failures are not absence.
      try { await stat(directory) } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code === 'ENOENT') continue
      }
      if (error instanceof Error && error.message.startsWith('Storage migration blocked:')) throw error
      throw blocked(`/proc evidence unreadable for process ${pid}`)
    }
  }
}

async function inspectDarwin(roots: readonly string[], owned: Set<number>, transport: MigrationInventoryTransport): Promise<void> {
  if (transport.uid === undefined) throw blocked('current OS user identity unavailable')
  const listing = await command(transport, '/bin/ps', ['-ww', '-axo', 'uid=,pid=,ppid=,command='])
  const privateRoots = await hasPrivateRoots(roots, transport.uid)
  const pids: number[] = []
  for (const line of listing.stdout.split('\n').filter(line => line.trim())) {
    const row = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    if (!row) throw blocked('ps process evidence incomplete')
    const pid = Number(row[2])
    if (owned.has(pid) || pid === listing.pid) continue
    if (owned.has(Number(row[3])) || applicationOwner(row[4]!) || commandUsesRoot(roots, row[4]!)) throw blocked(`application process ${pid} must exit before migration`)
    if (Number(row[1]) === transport.uid || !privateRoots) pids.push(pid)
  }
  if (!listing.stdout.trim()) throw blocked('ps did not enumerate processes')
  if (!pids.length) return
  // Per-PID lsof includes cwd, text/mapped images and all descriptors, not just
  // files that happen to be registered as sessions. Never silence its warnings.
  const output = await command(transport, '/usr/sbin/lsof', ['-nP', '-F0pfn', '-p', pids.join(',')])
  const seen = new Set<number>()
  const cwd = new Set<number>()
  const text = new Set<number>()
  let current: number | undefined
  for (const field of output.stdout.split('\0')) {
    const token = field.replace(/^\n+/, '')
    if (!token) continue
    if (token[0] === 'p') {
      current = Number(token.slice(1))
      if (!pids.includes(current)) throw blocked('lsof returned an unexpected process')
      seen.add(current)
    } else if (token[0] === 'n') {
      if (current === undefined) throw blocked('lsof process association missing')
      if (/permission denied|operation not permitted|readlink:|stat:/i.test(token)) throw blocked(`lsof evidence unreadable for process ${current}`)
      if (matchesRoot(roots, token.slice(1))) throw blocked(`process ${current} holds selected storage`)
    } else if (token[0] === 'f') {
      if (current === undefined || /NOFD|unknown/i.test(token)) throw blocked('lsof descriptor evidence unavailable')
      if (token === 'fcwd') cwd.add(current)
      if (token === 'ftxt') text.add(current)
    } else throw blocked('unknown lsof evidence')
  }
  for (const pid of pids) {
    if (!seen.has(pid)) {
      if (alive(pid)) throw blocked(`lsof evidence incomplete for process ${pid}`)
    } else if (!cwd.has(pid) || !text.has(pid)) throw blocked(`lsof evidence incomplete for process ${pid}`)
  }
}

async function inspectWindows(roots: readonly string[], owned: Set<number>, transport: MigrationInventoryTransport): Promise<void> {
  // CIM, Restart Manager and handle.exe cannot replace per-PID completeness.
  await assertWindowsMigrationInventory({ version: 1, roots, ownedPids: [...owned], ownerPatterns: applicationOwnerPatterns.map(pattern => pattern.source) }, transport.runWindows)
}

/** After draining owned hosts, call at every migration boundary. This never
 * stops processes, reads environ, deletes receipts, or treats empty roots/PIDs
 * as proof. Owned PIDs are exact exceptions, NOT permission to ignore children.
 * OS inspection is a snapshot; retain the core maintenance/writer barriers. */
export async function assertMigrationQuiescent(
  roots: readonly string[],
  ownedPids: readonly number[],
  transport: MigrationInventoryTransport = systemTransport,
): Promise<void> {
  if (!roots.length || roots.some(root => !path.isAbsolute(root) || root.includes('\0'))) throw blocked('explicit absolute data roots are required')
  if (!ownedPids.length || ownedPids.some(pid => !validPid(pid)) || !ownedPids.includes(process.pid)) throw blocked('explicit drained owner PIDs must include the calling host')
  const selected = [...new Set(await Promise.all(roots.map(root => canonicalPath(root))))]
  const owned = new Set(ownedPids)
  await assertRegistrations(selected, owned)
  if (transport.platform === 'linux') await inspectLinux(selected, owned, transport)
  else if (transport.platform === 'darwin') await inspectDarwin(selected, owned, transport)
  else if (transport.platform === 'win32') await inspectWindows(selected, owned, transport)
  else throw blocked('OS process/open-file inspection is unsupported')
}
