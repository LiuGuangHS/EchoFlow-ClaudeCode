import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readdir, rm, symlink, readFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertMigrationQuiescent, countExternalMigrationProcesses, type MigrationInventoryTransport } from './migrationInventory.js'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const temporary: string[] = []
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { force: true, recursive: true }) })
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'migration-inventory-'))
  temporary.push(home)
  const root = join(home, 'data')
  const proc = join(home, 'proc')
  await mkdir(root)
  await mkdir(proc)
  await mkdir(join(proc, String(process.pid)))
  const transport: MigrationInventoryTransport = { platform: 'linux', uid: process.getuid?.() ?? 1000, procDirectory: proc, run: async () => { throw new Error('unexpected command') } }
  async function entry(pid: number, command = '/usr/bin/sleep\0infinity\0', files: string[] = []) {
    const directory = join(proc, String(pid))
    await mkdir(join(directory, 'fd'), { recursive: true })
    await writeFile(join(directory, 'status'), `State:\tS (sleeping)\nUid:\t${transport.uid}\nPPid:\t1\n`)
    await writeFile(join(directory, 'cmdline'), command)
    await symlink('/usr/bin/sleep', join(directory, 'exe'))
    await symlink('/', join(directory, 'cwd'))
    await writeFile(join(directory, 'maps'), '')
    for (let index = 0; index < files.length; index++) await symlink(files[index]!, join(directory, 'fd', String(index)))
    return directory
  }
  return { home, root, proc, transport, entry }
}

test('migration inventory preserves stale and unknown registrations and excludes owned processes', async () => {
  const f = await fixture()
  await mkdir(join(f.root, 'sessions'))
  for (const pid of [123, 456, 789]) await writeFile(join(f.root, 'sessions', `${pid}.json`), JSON.stringify({ pid }))
  await writeFile(join(f.root, 'sessions', 'notes.json'), '{}')
  expect(await countExternalMigrationProcesses([123], f.root, pid => pid !== 456)).toBe(1)
  expect((await readdir(join(f.root, 'sessions'))).sort()).toEqual(['123.json', '456.json', '789.json', 'notes.json'])
})

test('empty/missing roots still inspect idle legacy owners, without creating data or accepting empty PID exceptions', async () => {
  const f = await fixture()
  const missing = join(f.home, 'not-created')
  await assertMigrationQuiescent([f.root, missing], [process.pid], f.transport)
  await expect(readFile(join(missing, 'app.json'))).rejects.toThrow()
  expect(await readdir(f.root)).toEqual([])
  await expect(assertMigrationQuiescent([f.root], [], f.transport)).rejects.toThrow('explicit drained owner PIDs')
  await expect(assertMigrationQuiescent([], [process.pid], f.transport)).rejects.toThrow('explicit absolute data roots')
  await f.entry(123, '/opt/EchoFlow Code/echoflow-code\0')
  await expect(assertMigrationQuiescent([missing], [process.pid], f.transport)).rejects.toThrow('application process 123')
})

test('unregistered descriptors, cwd, deleted files and mapped files in exactly the selected roots block', async () => {
  const f = await fixture()
  const external = await f.entry(123, undefined, [join(f.root, 'opaque.bin (deleted)')])
  await expect(assertMigrationQuiescent([f.root], [process.pid], f.transport)).rejects.toThrow('process 123 holds selected storage')
  await rm(join(external, 'fd', '0'))
  await writeFile(join(external, 'maps'), `7f000-7f100 rw-s 00000000 00:01 10 ${join(f.root, 'mapped bytes').replace(/ /g, '\\040')}\n`)
  await expect(assertMigrationQuiescent([f.root], [process.pid], f.transport)).rejects.toThrow('holds selected storage')
  await writeFile(join(external, 'maps'), '')
  await rm(join(external, 'cwd'))
  await symlink(f.root, join(external, 'cwd'))
  await expect(assertMigrationQuiescent([f.root], [process.pid], f.transport)).rejects.toThrow('holds selected storage')
  await rm(join(external, 'cwd'))
  await symlink(`${f.root}-unrelated`, join(external, 'cwd'))
  await writeFile(join(external, 'cmdline'), `/usr/bin/sleep\0${f.root}-unrelated\0/repo/EchoFlow-Code/unrelated-tool.js\0`)
  await assertMigrationQuiescent([f.root], [process.pid], f.transport)
})

for (const launch of [
  '/app/EchoFlow Code Helper (Renderer)\0--type=renderer\0',
  '/app/claude-sidecar-x86_64-pc-windows-msvc.exe\0server\0',
  '/usr/bin/bun\0/repo/adapters/slack/index.ts\0',
  '/usr/bin/bun\0/repo/src/entrypoints/cli.tsx\0',
  '/usr/bin/node\0/repo/src/server/index.ts\0',
  '/private/cu-helper\0daemon\0',
  '/app/agent-desktop-macos-helper\0',
  '/usr/bin/python\0/repo/win_helper.py\0',
]) test(`idle owner is blocked without file/session registration: ${launch.split('\0')[0]}`, async () => {
  const f = await fixture()
  await f.entry(123, launch)
  await expect(assertMigrationQuiescent([f.root], [process.pid], f.transport)).rejects.toThrow('application process 123')
})

test('owned PIDs are exact exceptions, not an exception for their unregistered Chromium children', async () => {
  const f = await fixture()
  const child = await f.entry(123, '/opt/electron\0--type=utility\0')
  await writeFile(join(child, 'status'), `State:\tS\nUid:\t${f.transport.uid}\nPPid:\t${process.pid}\n`)
  await expect(assertMigrationQuiescent([f.root], [process.pid], f.transport)).rejects.toThrow('application process 123')
  await assertMigrationQuiescent([f.root], [process.pid, 123], f.transport)
})

test('unknown/unreadable evidence blocks without leaking command lines or mutating files', async () => {
  const f = await fixture()
  const external = await f.entry(123, '/usr/bin/sleep\0fake-secret-never-log\0')
  await rm(join(external, 'maps'))
  let message = ''
  try { await assertMigrationQuiescent([f.root], [process.pid], f.transport) } catch (error) { message = (error as Error).message }
  expect(message).toContain('/proc evidence unreadable for process 123')
  expect(message).not.toContain('fake-secret')
  expect(await readFile(join(external, 'cmdline'), 'utf8')).toContain('fake-secret-never-log')
  const writers = join(f.root, 'echoflow-code/migrations/writers')
  await mkdir(writers, { recursive: true })
  await writeFile(join(writers, 'unknown.json'), '{')
  await expect(assertMigrationQuiescent([f.root], [process.pid], f.transport)).rejects.toThrow('unknown writer registration')
  expect(await readFile(join(writers, 'unknown.json'), 'utf8')).toBe('{')
})

test('real live writer receipts and malformed live sessions block; explicit drained owners are preserved', async () => {
  const f = await fixture()
  const writers = join(f.root, 'echoflow-code/migrations/writers')
  await mkdir(writers, { recursive: true })
  const receipt = JSON.stringify({ version: 1, host: hostname(), pid: process.ppid, token: 'fixture-only' })
  await writeFile(join(writers, 'external.json'), receipt)
  await expect(assertMigrationQuiescent([f.root], [process.pid], f.transport)).rejects.toThrow('registered writer')
  await assertMigrationQuiescent([f.root], [process.pid, process.ppid], f.transport)
  expect(await readFile(join(writers, 'external.json'), 'utf8')).toBe(receipt)
  await rm(join(writers, 'external.json'))
  await mkdir(join(f.root, 'sessions'))
  await writeFile(join(f.root, 'sessions', `${process.ppid}.json`), '{')
  await expect(assertMigrationQuiescent([f.root], [process.pid], f.transport)).rejects.toThrow('registered session')
})

test.skipIf(process.platform !== 'linux')('a private real child holding a selected-root file without a session blocks until exit', async () => {
  const f = await fixture()
  const holder = `
    import { open } from 'node:fs/promises'
    const name = await new Promise(resolve => process.stdin.once('data', chunk => resolve(String(chunk))))
    const file = await open(name, 'w')
    console.log('held')
    await new Promise(resolve => process.stdin.once('data', resolve))
    await file.close()
  `
  const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
    import { spawn } from 'node:child_process'
    const holder = spawn(process.execPath, ['--no-env-file', '--eval', ${JSON.stringify(holder)}], { stdio: 'inherit' })
    console.log('pid=' + holder.pid)
    holder.once('exit', code => process.exit(code ?? 1))
  `], { env: createSandboxedTestEnvironment(join(f.home, 'child')), stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  try {
    child.stdin.write(join(f.root, 'private-fixture.bin'))
    const reader = child.stdout.getReader()
    let announcement = ''
    while (!announcement.includes('held')) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error('Private holder exited before opening its fixture')
      announcement += new TextDecoder().decode(chunk.value)
    }
    const holderPid = Number(/pid=(\d+)/.exec(announcement)?.[1])
    expect(Number.isSafeInteger(holderPid)).toBe(true)
    // Enumerate only this private fixture process, but inspect its real OS status,
    // descriptors and mappings. Its parent is NOT an owned host, so only actual
    // open-file evidence can reject this unregistered, generically named holder.
    await symlink(`/proc/${holderPid}`, join(f.proc, String(holderPid)))
    await expect(assertMigrationQuiescent([f.root], [process.pid], f.transport)).rejects.toThrow(`process ${holderPid} holds selected storage`)
    expect(await readdir(f.root)).toEqual(['private-fixture.bin'])
  } finally {
    child.stdin.write('release')
    child.stdin.end()
    const errors = await new Response(child.stderr).text()
    expect(await child.exited, errors).toBe(0)
  }
  await assertMigrationQuiescent([f.root], [process.pid], f.transport)
})

test('macOS ps/lsof transport detects idle owners and null-delimited open paths with spaces', async () => {
  const f = await fixture()
  let listing = `${f.transport.uid} 123 1 /usr/bin/sleep 60\n`
  let output = `p123\0\nf3\0n${join(f.root, 'profile with spaces', 'LOG')}\0\n`
  const calls: string[] = []
  const transport: MigrationInventoryTransport = { platform: 'darwin', uid: f.transport.uid, run: async (program, args) => {
    calls.push(`${program} ${args.join(' ')}`)
    return { stdout: program === '/bin/ps' ? listing : output, stderr: '' }
  } }
  await expect(assertMigrationQuiescent([f.root], [process.pid], transport)).rejects.toThrow('holds selected storage')
  output = 'p123\0\nfcwd\0n/tmp\0\nftxt\0n/usr/bin/sleep\0\nf3\0n/tmp/unrelated\0\n'
  await assertMigrationQuiescent([f.root], [process.pid], transport)
  listing = `${f.transport.uid} 123 1 /Applications/EchoFlow Code.app/Contents/MacOS/EchoFlow Code\n`
  await expect(assertMigrationQuiescent([f.root], [process.pid], transport)).rejects.toThrow('application process 123')
  expect(calls).toContain('/usr/sbin/lsof -nP -F0pfn -p 123')
})

test('macOS missing tools, truncated evidence, inaccessible descriptors and live unreported PIDs block', async () => {
  const f = await fixture()
  for (const output of ['', `p${process.ppid}\0\n`, `p${process.ppid}\0\nf3\0nunknown (readlink: Permission denied)\0`]) {
    const transport: MigrationInventoryTransport = { platform: 'darwin', uid: f.transport.uid, run: async program => ({
      stdout: program === '/bin/ps' ? `${f.transport.uid} ${process.ppid} 1 /usr/bin/sleep\n` : output, stderr: '',
    }) }
    await expect(assertMigrationQuiescent([f.root], [process.pid], transport)).rejects.toThrow(/lsof evidence/)
  }
  for (const run of [async () => { throw new Error('missing command fake-secret') }, async () => ({ stdout: '', stderr: 'permission denied fake-secret' })]) {
    await expect(assertMigrationQuiescent([f.root], [process.pid], { platform: 'darwin', uid: f.transport.uid, run })).rejects.toThrow('/bin/ps evidence unavailable')
  }
})

test('Windows requires the native stdin transport, not a CIM/empty owner fallback, and redacts failures', async () => {
  const f = await fixture()
  const transport: MigrationInventoryTransport = {
    platform: 'win32',
    run: async () => ({ stdout: '[]', stderr: '' }),
    runWindows: async () => { throw new Error('fake-secret C:\\private\\account') },
  }
  await expect(assertMigrationQuiescent([f.root], [process.pid], transport)).rejects.toThrow('Windows native inventory unavailable')
  await expect(assertMigrationQuiescent([f.root], [process.pid], { ...transport, runWindows: undefined })).rejects.toThrow('native per-PID completeness evidence is required')
  await expect(assertMigrationQuiescent([f.root], [process.pid], { ...transport, platform: 'freebsd' })).rejects.toThrow('unsupported')
  let called = false
  await expect(assertMigrationQuiescent([f.root], [process.pid], { ...transport, runWindows: async input => {
    called = true
    const request = JSON.parse(input)
    expect(request.version).toBe(1)
    expect(request.roots).toEqual([f.root])
    expect(request.ownedPids).toEqual([process.pid])
    expect(request.ownerPatterns.some((pattern: string) => new RegExp(pattern, 'i').test('C:\\app\\claude-sidecar.exe'))).toBe(true)
    // No generic OS command fallback may replace an incomplete native receipt.
    return { stdout: '{"version":1,"owners":[]}', stderr: '', pid: 7001 }
  }, run: async () => { throw new Error('unexpected CIM fallback') } })).rejects.toThrow('per-PID completeness')
  expect(called).toBe(true)
})
