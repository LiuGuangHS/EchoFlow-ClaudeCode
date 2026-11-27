import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { execFile } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { assertWindowsMigrationInventory, createWindowsInventoryRunner, validateWindowsInventory, type WindowsInventoryRequest } from './migrationInventoryWindows.js'

const inspectorPid = 7001
const currentSid = 'S-1-5-21-100-200-300-1001'
const request: WindowsInventoryRequest = { version: 1, roots: ['C:\\Selected Data\\alias'], ownedPids: [process.pid], ownerPatterns: ['echoflow'] }
function fixture() {
  const identities = [process.pid, inspectorPid, 123].map(pid => ({ pid, created: `${100000 + pid}`, sid: currentSid }))
  return {
    version: 1,
    architecture: 'x64',
    currentSid,
    inspectorPid,
    roots: [{ index: 0, requested: request.roots[0], before: '\\Device\\HarddiskVolume3\\physical\\data', after: '\\Device\\HarddiskVolume3\\physical\\data', complete: true, error: null as string | null }],
    before: identities.map(row => ({ ...row })),
    after: identities.map(row => ({ ...row })),
    processes: identities.map(identity => {
      const skip = identity.pid === process.pid ? 'owned' : identity.pid === inspectorPid ? 'inspector' : null
      return { ...identity, applicationOwner: false, handles: { complete: !skip, error: skip, roots: [] as number[] }, maps: { complete: !skip, error: skip, roots: [] as number[] } }
    }),
    owners: [] as { pid: number; kind: string; root: number }[],
    error: null as string | null,
  }
}
const validate = (evidence: unknown, pid: number | undefined = inspectorPid) => validateWindowsInventory(JSON.stringify(evidence), request, pid)

// These are parser fixtures, NOT evidence that the Windows APIs run correctly.
test('a nonempty stable snapshot with exact inspector/caller exceptions and complete per-PID receipts validates offline', () => {
  validate(fixture())
})

test('even a complete offline receipt cannot qualify the native Windows inspector or open the migration barrier', async () => {
  await expect(assertWindowsMigrationInventory(request, async () => ({ stdout: JSON.stringify(fixture()), stderr: '', pid: inspectorPid }))).rejects.toThrow('not platform-qualified')
})

test('CIM-only, empty, malformed, unknown-version and unknown-state evidence cannot authorize migration', () => {
  for (const output of ['', '[]', '{', '{"owners":[]}', JSON.stringify([{ ProcessId: 123 }]), JSON.stringify({ version: 1, error: 'fake-secret C:\\private' })]) {
    expect(() => validateWindowsInventory(output, request, inspectorPid)).toThrow('per-PID completeness')
  }
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.version = 2 },
    (f: ReturnType<typeof fixture>) => { f.architecture = 'arm64' },
    (f: ReturnType<typeof fixture>) => { f.error = 'fake-secret' },
    (f: ReturnType<typeof fixture>) => { f.before = []; f.after = []; f.processes = [] },
    (f: ReturnType<typeof fixture>) => { f.processes[2]!.handles.complete = false },
    (f: ReturnType<typeof fixture>) => { f.processes[2]!.maps.error = 'unknown' },
  ]) {
    const f = fixture(); mutate(f)
    expect(() => validate(f)).toThrow('per-PID completeness')
  }
})

test('omitted, duplicated, malformed, new and reused process identities fail closed', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.processes.pop() },
    (f: ReturnType<typeof fixture>) => { f.before.pop() },
    (f: ReturnType<typeof fixture>) => { f.after.pop() },
    (f: ReturnType<typeof fixture>) => { f.after.push({ pid: 456, created: '123456', sid: currentSid }) },
    (f: ReturnType<typeof fixture>) => { f.processes.push(f.processes[2]!) },
    (f: ReturnType<typeof fixture>) => { f.before.push(f.before[2]!) },
    (f: ReturnType<typeof fixture>) => { f.before[2]!.pid = 0 },
    (f: ReturnType<typeof fixture>) => { f.before[2]!.pid = 1.5 },
    (f: ReturnType<typeof fixture>) => { f.before[2]!.created = '' },
    (f: ReturnType<typeof fixture>) => { f.after[2]!.created = '999999' },
    (f: ReturnType<typeof fixture>) => { f.after[2]!.sid = 'S-1-5-21-9999' },
    (f: ReturnType<typeof fixture>) => { f.processes[2]!.created = '999999' },
    (f: ReturnType<typeof fixture>) => { delete (f.processes[2] as Partial<typeof f.processes[number]>).pid },
    (f: ReturnType<typeof fixture>) => { delete (f.processes[2] as Partial<typeof f.processes[number]>).applicationOwner },
  ]) {
    const f = fixture(); mutate(f)
    expect(() => validate(f)).toThrow('per-PID completeness')
  }
})

test('handles AND maps are mandatory for every non-exempt PID, even with no reported owners', () => {
  for (const kind of ['handles', 'maps'] as const) {
    for (const error of [null, 'access-denied', 'unknown', 'foreign-user', 'owned', 'inspector']) {
      const f = fixture(); f.processes[2]![kind] = { complete: false, error, roots: [] }
      expect(() => validate(f)).toThrow('per-PID completeness')
    }
    const f = fixture(); delete (f.processes[2] as Partial<typeof f.processes[number]>)[kind]
    expect(() => validate(f)).toThrow('per-PID completeness')
  }
})

test('foreign exclusion requires a readable stable noncurrent SID; an inaccessible identity is not foreign proof', () => {
  const f = fixture()
  for (const rows of [f.before, f.after, f.processes]) rows[2]!.sid = 'S-1-5-21-9999'
  f.processes[2]!.handles = { complete: false, error: 'foreign-user', roots: [] }
  f.processes[2]!.maps = { complete: false, error: 'foreign-user', roots: [] }
  validate(f)
  for (const identity of [null, '', 'unknown', 'fake-secret-account']) {
    const unknown = structuredClone(f)
    for (const rows of [unknown.before, unknown.after, unknown.processes]) (rows[2] as { sid: unknown }).sid = identity
    expect(() => validate(unknown)).toThrow('per-PID completeness')
  }
  const guessed = fixture()
  guessed.processes[2]!.handles.error = 'foreign-user'
  guessed.processes[2]!.maps.error = 'foreign-user'
  expect(() => validate(guessed)).toThrow('per-PID completeness')
})

test('only the actual fixed inspector and explicit owned PIDs can skip inspection; parents/children are not implicit exceptions', () => {
  expect(() => validate(fixture(), inspectorPid + 1)).toThrow('per-PID completeness')
  expect(() => validateWindowsInventory(JSON.stringify(fixture()), request, undefined)).toThrow('per-PID completeness')
  const f = fixture()
  f.processes[2]!.maps = { complete: false, error: 'inspector', roots: [] }
  expect(() => validate(f)).toThrow('per-PID completeness')
  const caller = fixture()
  caller.after[0]!.sid = 'S-1-5-21-9999'
  expect(() => validate(caller)).toThrow('per-PID completeness')
})

test('root index binding, native canonical aliases and root stability must be explicit', () => {
  validate(fixture()) // DOS selected alias resolves to a different, stable NT path.
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.roots = [] },
    (f: ReturnType<typeof fixture>) => { f.roots[0]!.index = 1 },
    (f: ReturnType<typeof fixture>) => { f.roots[0]!.requested = 'C:\\Other Data' },
    (f: ReturnType<typeof fixture>) => { f.roots[0]!.before = 'C:\\Selected Data\\alias' },
    (f: ReturnType<typeof fixture>) => { f.roots[0]!.after += '-reparse-replaced' },
    (f: ReturnType<typeof fixture>) => { f.roots[0]!.complete = false; f.roots[0]!.error = 'root-alias-incomplete' },
  ]) {
    const f = fixture(); mutate(f)
    expect(() => validate(f)).toThrow('per-PID completeness')
  }
})

for (const kind of ['handles', 'maps'] as const) test(`an unregistered ${kind}-only root owner blocks, including an aliased mapped file`, () => {
  const f = fixture()
  f.processes[2]![kind].roots = [0]
  f.owners.push({ pid: 123, kind, root: 0 })
  expect(() => validate(f)).toThrow('holds selected storage')
  f.owners = []
  expect(() => validate(f)).toThrow('per-PID completeness')
})

test('an unregistered idle application owner blocks even without open files', () => {
  const f = fixture(); f.processes[2]!.applicationOwner = true
  expect(() => validate(f)).toThrow('application process 123')
})

test('unexpected, duplicate or unassociated owner/root references block rather than count as complete', () => {
  for (const owners of [[{ pid: 999, kind: 'maps', root: 0 }], [{ pid: 123, kind: 'unknown', root: 0 }], [{ pid: 123, kind: 'maps', root: 1 }]]) {
    const f = fixture(); f.owners = owners
    expect(() => validate(f)).toThrow('per-PID completeness')
  }
  const f = fixture(); f.processes[2]!.maps.roots = [0]
  f.owners = [{ pid: 123, kind: 'maps', root: 0 }, { pid: 123, kind: 'maps', root: 0 }]
  expect(() => validate(f)).toThrow('per-PID completeness')
  f.processes[2]!.maps.roots = [-1]
  expect(() => validate(f)).toThrow('per-PID completeness')
})

test('unavailable APIs, timeout/transport errors and stderr are redacted and never retried with weaker tools', async () => {
  for (const run of [
    async () => { throw new Error('timeout fake-secret C:\\private') },
    async () => ({ stdout: JSON.stringify(fixture()), stderr: 'access denied fake-secret C:\\private', pid: inspectorPid }),
    async () => ({ stdout: '{"version":1,"error":"API-unavailable fake-secret"}', stderr: '', pid: inspectorPid }),
  ]) {
    let calls = 0
    let error = ''
    try { await assertWindowsMigrationInventory(request, async input => { calls++; expect(JSON.parse(input)).toEqual(request); return run() }) } catch (caught) { error = (caught as Error).message }
    expect(calls).toBe(1)
    expect(error).toContain('Storage migration blocked: Windows native')
    expect(error).not.toContain('fake-secret')
    expect(error).not.toContain('C:\\private')
  }
})

test('request and response bounds fail closed before accepting evidence', async () => {
  let calls = 0
  const run = async () => { calls++; return { stdout: '', stderr: '', pid: inspectorPid } }
  for (const invalid of [{ ...request, roots: [] }, { ...request, roots: ['bad\0root'] }, { ...request, roots: Array(65).fill('C:\\data') }, { ...request, ownedPids: [] }, { ...request, ownedPids: [0] }]) {
    await expect(assertWindowsMigrationInventory(invalid, run)).rejects.toThrow('per-PID completeness')
  }
  expect(calls).toBe(0)
  expect(() => validateWindowsInventory(' '.repeat(8 * 1024 * 1024 + 1), request, inspectorPid)).toThrow('per-PID completeness')
})

test('the fixed bounded PowerShell transport sends shell metacharacters and roots only as structured stdin', async () => {
  let input = ''
  const child = Object.assign(new EventEmitter(), { pid: inspectorPid, stdin: new PassThrough() })
  child.stdin.on('data', chunk => { input += String(chunk) })
  const execute = ((program: string, args: string[], options: Record<string, unknown>, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    expect(program).toBe('powershell.exe')
    expect(args.slice(0, -1)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(args.join(' ').length).toBeLessThan(32_000)
    expect(options).toMatchObject({ windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' })
    const bootstrap = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
    const compressed = /FromBase64String\('([^']+)'\)/.exec(bootstrap)![1]!
    const script = gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8')
    expect(script).toContain('[Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false, $true)')
    expect(script).not.toContain('sentinel-root')
    expect(bootstrap).not.toContain('sentinel-root')
    queueMicrotask(() => callback(null, JSON.stringify(fixture()), ''))
    return child
  }) as unknown as typeof execFile
  const selected = { ...request, roots: ['C:\\sentinel-root\\a\'; $(Write-Output untrusted) & %VAR%'] }
  const result = await createWindowsInventoryRunner(execute)(JSON.stringify(selected))
  expect(JSON.parse(input)).toEqual(selected)
  expect(result.pid).toBe(inspectorPid)
})

const nativeWindowsX64 = process.arch === 'x64' && !process.env.PROCESSOR_ARCHITEW6432 && Boolean(Bun.which('powershell.exe'))
test.skipIf(!nativeWindowsX64)('native transport preserves non-ASCII root paths on redirected stdin', async () => {
  // The invalid path returns a root receipt before any process inspection.
  const root = 'C:\\?\\迁移-😀-é'
  const { stdout } = await createWindowsInventoryRunner()(JSON.stringify({ ...request, roots: [root] }))
  expect(JSON.parse(stdout).roots?.[0]).toMatchObject({ requested: root, complete: false })
}, 35_000)

test('native transport errors never expose execFile command arguments, paths, or exception messages', async () => {
  for (const failure of ['ENOENT', 'timeout', 'maxBuffer']) {
    const execute = ((_program: string, _args: string[], _options: unknown, callback: (error: Error) => void) => {
      queueMicrotask(() => callback(new Error(`${failure} fake-secret C:\\private`)))
      return Object.assign(new EventEmitter(), { pid: inspectorPid, stdin: new PassThrough() })
    }) as unknown as typeof execFile
    await expect(createWindowsInventoryRunner(execute)(JSON.stringify(request))).rejects.toThrow('Windows native inventory unavailable')
  }
})
