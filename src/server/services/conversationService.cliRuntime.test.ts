import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appendFile, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import type { SessionStartOptions } from './conversationService.js'

type RuntimeId = 'bundled' | 'installed'
type Launch = { command: string[]; env: Record<string, string> }
type ChildCapture = { kind: string; command: string; args: string[]; env: Record<string, string> }
type ProbeResult = {
  error?: string
  launches: Launch[]
  active: boolean
  cliRuntimeId?: RuntimeId
  restoredCliRuntimeId?: RuntimeId
}

const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const mockCli = new URL('../__tests__/fixtures/mock-sdk-cli.ts', import.meta.url).href
// Each probe is a fresh server process, not a new object sharing warmed metadata.
const probeSource = `
import { ConversationService } from ${JSON.stringify(new URL('./conversationService.ts', import.meta.url).href)}
import { SessionService } from ${JSON.stringify(new URL('./sessionService.ts', import.meta.url).href)}
import { getRuntimeSettings } from ${JSON.stringify(new URL('../ws/handler.ts', import.meta.url).href)}
const input = JSON.parse(process.argv[1])
// Emulate the packaged server/CLI sibling layout; both CLIs remain real executables.
Object.defineProperty(process, 'execPath', { value: input.serverPath, configurable: true })
const runtime = new ConversationService()
const launches = []
const spawn = Bun.spawn.bind(Bun)
Bun.spawn = (command, options) => {
  if (Array.isArray(command) && command.includes('--sdk-url')) {
    launches.push({ command: [...command], env: { ...options.env } })
  }
  return spawn(command, options)
}
const bridge = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch(request, server) {
    const url = new URL(request.url)
    if (!runtime.authorizeSdkConnection(input.sessionId, url.searchParams.get('token'))) return new Response('denied', { status: 401 })
    return server.upgrade(request) ? undefined : new Response('upgrade failed', { status: 400 })
  },
  websocket: {
    open(ws) { runtime.attachSdkConnection(input.sessionId, ws) },
    message(ws, message) { runtime.handleSdkPayload(input.sessionId, String(message)) },
    close(ws) { runtime.detachSdkConnection(input.sessionId, ws) },
  },
})
process.on('SIGTERM', async () => {
  await runtime.stopAllSessionsAndWait(1_000)
  bridge.stop(true)
  process.exit(1)
})
let error
let restoredCliRuntimeId
let active = false
try {
  const options = input.restore ? await getRuntimeSettings(input.sessionId) : input.options
  restoredCliRuntimeId = options?.cliRuntimeId
  await runtime.startSession(input.sessionId, input.workDir, 'ws://127.0.0.1:' + bridge.port + '/sdk/' + input.sessionId + '?token=runtime-fixture', options)
  active = runtime.hasSession(input.sessionId)
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause)
} finally {
  await runtime.stopAllSessionsAndWait(1_000)
  bridge.stop(true)
}
const info = await new SessionService().getSessionLaunchInfo(input.sessionId)
console.log('CLI_RUNTIME_PROBE ' + JSON.stringify({ error, launches, active, cliRuntimeId: info?.cliRuntimeId, restoredCliRuntimeId }))
process.exit(0)
`

// shortcut: executable script fixtures exercise POSIX X_OK, use native .exe fixtures for Windows coverage.
describe.skipIf(process.platform === 'win32')('CLI runtime selection through real spawn and restart', () => {
  let root: string
  let workDir: string
  let configPath: string
  let transcriptPath: string
  let capturePath: string
  let bundledPath: string
  let installedPath: string
  let env: Record<string, string>
  const probes = new Set<ReturnType<typeof Bun.spawn>>()

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'conversation-cli-runtime-')))
    workDir = join(root, 'workspace')
    configPath = join(root, 'claude-code-runtime.json')
    capturePath = join(root, 'launches.jsonl')
    bundledPath = join(root, 'claude-cli')
    installedPath = join(root, 'installed-claude')
    env = createSandboxedTestEnvironment(root, {
      CLAUDE_APP_ROOT: root,
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: configPath,
      DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1',
    })
    await mkdir(workDir)
    const projectDir = join(env.CLAUDE_CONFIG_DIR!, 'projects', sanitizePath(workDir))
    await mkdir(projectDir, { recursive: true })
    transcriptPath = join(projectDir, `${sessionId}.jsonl`)
    await writeFile(transcriptPath, [
      { type: 'session-meta', workDir },
      { type: 'user', uuid: crypto.randomUUID(), sessionId, cwd: workDir, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Existing runtime fixture' } },
    ].map(record => JSON.stringify(record)).join('\n') + '\n')
    for (const [kind, executable] of [['bundled', bundledPath], ['installed', installedPath], ['legacy', join(root, 'legacy-cli.ts')]]) {
      await writeFile(executable!, `#!${process.execPath}
import { appendFile } from 'node:fs/promises'
const env = Object.fromEntries(['HOME', 'CLAUDE_CONFIG_DIR', 'CALLER_DIR', 'PWD', 'CLAUDE_APP_ROOT', 'ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG'].map(key => [key, process.env[key]]))
await appendFile(${JSON.stringify(capturePath)}, JSON.stringify({ kind: ${JSON.stringify(kind)}, command: process.argv[1], args: process.argv.slice(2), env }) + '\\n')
await import(${JSON.stringify(mockCli)})
`)
      await chmod(executable!, 0o755)
    }
    // A pinned choice must ignore this legacy script override, not mistake it for installed.
    env.CLAUDE_CLI_PATH = join(root, 'legacy-cli.ts')
  })

  afterEach(async () => {
    for (const child of probes) {
      child.kill('SIGTERM')
      await child.exited
    }
    probes.clear()
    await rm(root, { recursive: true, force: true })
  })

  async function configure(defaultRuntimeId: RuntimeId, executable = installedPath) {
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, defaultRuntimeId, installedPath: executable }))
  }

  async function probe(options?: SessionStartOptions, restore = false): Promise<ProbeResult> {
    const child = Bun.spawn([process.execPath, '--no-env-file', '-e', probeSource, JSON.stringify({
      sessionId, workDir, serverPath: join(root, 'claude-server'), options, restore,
    })], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
    probes.add(child)
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    probes.delete(child)
    expect(exitCode, stderr + stdout).toBe(0)
    const result = stdout.split('\n').find(line => line.startsWith('CLI_RUNTIME_PROBE '))
    expect(result, stderr + stdout).toBeDefined()
    return JSON.parse(result!.slice('CLI_RUNTIME_PROBE '.length))
  }

  async function expectLaunch(result: ProbeResult, kind: RuntimeId | 'legacy') {
    expect(result.error).toBeUndefined()
    expect(result.active).toBe(true)
    expect(result.launches).toHaveLength(1)
    const executable = kind === 'installed' ? installedPath : kind === 'bundled' ? bundledPath : env.CLAUDE_CLI_PATH!
    const launch = result.launches[0]!
    expect(launch.command.slice(0, kind === 'legacy' ? 2 : 1)).toEqual(kind === 'legacy' ? ['bun', executable] : [executable])
    expect(launch.command).toContain('--resume')
    expect(launch.command).toContain(sessionId)
    const capture: ChildCapture = JSON.parse((await readFile(capturePath, 'utf8')).trim().split('\n').at(-1)!)
    expect(capture.kind).toBe(kind)
    expect(capture.command).toBe(executable)
    expect(capture.args).toEqual(launch.command.slice(kind === 'legacy' ? 2 : 1))
    const expectedEnv = {
      HOME: root, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR!, CALLER_DIR: workDir, PWD: workDir,
      CLAUDE_APP_ROOT: root, ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: configPath,
    }
    expect(launch.env).toMatchObject(expectedEnv)
    expect(capture.env).toEqual(expectedEnv)
  }

  test('without a trusted runtime selection the published legacy script launcher still works', async () => {
    delete env.ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG
    const result = await probe()
    expect(result.error).toBeUndefined()
    expect(result.active).toBe(true)
    expect(result.launches[0]?.command.slice(0, 2)).toEqual(['bun', env.CLAUDE_CLI_PATH!])
    const capture: ChildCapture = JSON.parse((await readFile(capturePath, 'utf8')).trim())
    expect(capture.kind).toBe('legacy')
  }, 20_000)

  test('a configured but missing runtime settings file preserves the legacy CLI override', async () => {
    await expect(readFile(configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const result = await probe()
    await expectLaunch(result, 'legacy')
    expect(result.cliRuntimeId).toBeUndefined()
  }, 20_000)

  test('explicit bundled ignores the legacy CLI override even with a missing runtime settings file', async () => {
    await expectLaunch(await probe({ cliRuntimeId: 'bundled' }), 'bundled')
  }, 20_000)

  test.each(['bundled', 'installed'] as const)('global %s default selects the real command without pinning the session', async defaultRuntimeId => {
    await configure(defaultRuntimeId)
    const result = await probe()
    await expectLaunch(result, defaultRuntimeId)
    expect(result.cliRuntimeId).toBeUndefined()
    expect(await readFile(transcriptPath, 'utf8')).not.toContain('cliRuntimeId')
  }, 20_000)

  test.each(['bundled', 'installed'] as const)('explicit %s session choice overrides the opposite global default', async cliRuntimeId => {
    await configure(cliRuntimeId === 'bundled' ? 'installed' : 'bundled')
    const result = await probe({ cliRuntimeId })
    await expectLaunch(result, cliRuntimeId)
    expect(result.cliRuntimeId).toBeUndefined()
  }, 20_000)

  test('a temporary override does not replace a published session pin and restart restores that pin', async () => {
    await configure('installed')
    await appendFile(transcriptPath, JSON.stringify({ type: 'session-meta', workDir, cliRuntimeId: 'bundled' }) + '\n')
    const original = await readFile(transcriptPath, 'utf8')
    const temporary = await probe({ cliRuntimeId: 'installed', persistCliRuntimeId: false })
    await expectLaunch(temporary, 'installed')
    expect(temporary.cliRuntimeId).toBe('bundled')
    expect(await readFile(transcriptPath, 'utf8')).toBe(original)
    const restored = await probe(undefined, true)
    expect(restored.restoredCliRuntimeId).toBe('bundled')
    await expectLaunch(restored, 'bundled')
  }, 20_000)

  test('persistCliRuntimeId saves the choice and a fresh server restores it despite a changed global default', async () => {
    await configure('installed')
    const persisted = await probe({ cliRuntimeId: 'installed', persistCliRuntimeId: true })
    await expectLaunch(persisted, 'installed')
    expect(persisted.cliRuntimeId).toBe('installed')
    const records = (await readFile(transcriptPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(records.filter(record => record.type === 'session-meta').at(-1)).toMatchObject({ cliRuntimeId: 'installed' })
    await configure('bundled')
    const restored = await probe(undefined, true)
    expect(restored.restoredCliRuntimeId).toBe('installed')
    await expectLaunch(restored, 'installed')
    expect(restored.cliRuntimeId).toBe('installed')
  }, 20_000)

  test('the first CLI launch preserves the last legacy archive decision when replacing a placeholder', async () => {
    await writeFile(transcriptPath, [
      { type: 'session-meta', workDir, archived: false },
      { type: 'session-archive', archived: true },
    ].map(record => JSON.stringify(record)).join('\n') + '\n')
    const result = await probe({ cliRuntimeId: 'bundled' })
    expect(result.error).toBeUndefined()
    expect(result.active).toBe(true)
    expect(result.launches[0]!.command).toContain('--session-id')
    const records = (await readFile(transcriptPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(records.find(record => record.type === 'file-history-snapshot')).toBeDefined()
    expect(records.filter(record => Object.hasOwn(record, 'archived')).at(-1)).toMatchObject({ archived: true })
  }, 20_000)

  test('a worker inherits the saved CLI pin of a stopped lead at process launch', async () => {
    await configure('bundled')
    const parentSessionId = crypto.randomUUID()
    await writeFile(join(dirname(transcriptPath), `${parentSessionId}.jsonl`), JSON.stringify({ type: 'session-meta', workDir, cliRuntimeId: 'installed' }) + '\n')
    const result = await probe({ teamWorker: { parentSessionId, teamName: 'fixture', memberId: 'reader', name: 'reader', systemPrompt: 'fixture' } })
    expect(result.error).toBeUndefined()
    expect(result.active).toBe(true)
    const capture: ChildCapture = JSON.parse((await readFile(capturePath, 'utf8')).trim())
    expect(capture.command).toBe(installedPath)
    expect(capture.args).toEqual(result.launches[0]!.command.slice(1))
    expect(capture.args[capture.args.indexOf('--agent-name') + 1]).toBe('reader')
  }, 20_000)

  test('an invalid installed choice leaves placeholder history intact before launch preparation', async () => {
    await configure('installed', join(root, 'missing-cli'))
    const original = JSON.stringify({ type: 'session-meta', workDir, unknownRuntimeField: { keep: true } }) + '\n'
    await writeFile(transcriptPath, original)

    const result = await probe({ cliRuntimeId: 'installed', persistCliRuntimeId: true })

    expect(await readFile(transcriptPath, 'utf8')).toBe(original)
    expect(result.error).toMatch(/ENOENT|no such file/i)
    expect(result.launches).toEqual([])
    expect(result.active).toBe(false)
    await expect(readFile(capturePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  }, 20_000)

  test.each(['unset', 'missing', 'malformed', 'future', 'unconfigured'] as const)('an explicit installed choice rejects %s trusted configuration without falling back', async invalid => {
    if (invalid === 'unset') delete env.ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG
    if (invalid === 'malformed') await writeFile(configPath, '{ broken')
    if (invalid === 'future') await writeFile(configPath, JSON.stringify({ schemaVersion: 2, defaultRuntimeId: 'installed', installedPath }))
    if (invalid === 'unconfigured') await writeFile(configPath, JSON.stringify({ schemaVersion: 1, defaultRuntimeId: 'installed', installedPath: null }))
    const original = await readFile(transcriptPath, 'utf8')
    const result = await probe({ cliRuntimeId: 'installed', persistCliRuntimeId: true })
    expect(result.error).toMatch(/runtime (config|path) is (unavailable|invalid)/)
    expect(result.launches).toEqual([])
    expect(result.active).toBe(false)
    expect(await readFile(transcriptPath, 'utf8')).toBe(original)
    await expect(readFile(capturePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  }, 20_000)

  test.each(['relative', 'missing', 'directory', 'non-executable'] as const)('trusted resolver rejects a %s installed path before any spawn or metadata write', async invalid => {
    const executable = invalid === 'relative' ? 'installed-claude' : invalid === 'missing' ? join(root, 'missing-cli') : invalid === 'directory' ? workDir : installedPath
    if (invalid === 'non-executable') await chmod(installedPath, 0o644)
    await configure('installed', executable)
    const original = await readFile(transcriptPath, 'utf8')
    const result = await probe({ cliRuntimeId: 'installed', persistCliRuntimeId: true })
    const expectedError = {
      relative: /must be absolute/,
      missing: /ENOENT|no such file/i,
      directory: /must be a file/,
      'non-executable': /EACCES|permission denied/i,
    }
    expect(result.error).toMatch(expectedError[invalid])
    expect(result.launches).toEqual([])
    expect(result.active).toBe(false)
    expect(await readFile(transcriptPath, 'utf8')).toBe(original)
    await expect(readFile(capturePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  }, 20_000)
})
