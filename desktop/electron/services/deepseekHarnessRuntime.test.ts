import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekHarnessRuntime, deepSeekHarnessRoot, type DeepSeekHarnessChild } from './deepseekHarnessRuntime'

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn()
}

let root = ''
let children: FakeChild[] = []
let spawn: ReturnType<typeof vi.fn>
let reservePort: ReturnType<typeof vi.fn>
let waitForUrl: ReturnType<typeof vi.fn>

type RuntimeDepsOverrides = NonNullable<ConstructorParameters<typeof DeepSeekHarnessRuntime>[0]['deps']>

function createRuntime(overrides: RuntimeDepsOverrides = {}) {
  return new DeepSeekHarnessRuntime({
    userDataPath: root,
    deps: {
      mkdir: fs.mkdir,
      spawn,
      reservePort,
      waitForUrl,
      resolveNode: () => '/usr/local/bin/node',
      resolveManagedNode: async () => null,
      installNode: async () => '/app/node/current/bin/node',
      nodeVersion: async () => [22, 19, 0],
      resolveNpxCli: () => '/usr/local/lib/node_modules/npm/bin/npx-cli.js',
      ...overrides,
    },
  })
}

describe('DeepSeekHarnessRuntime', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'echoflow-deepseek-harness-'))
    children = []
    spawn = vi.fn(() => {
      const child = new FakeChild()
      children.push(child)
      return child as unknown as DeepSeekHarnessChild
    })
    reservePort = vi.fn(async () => 31415)
    waitForUrl = vi.fn(async () => {
      children.at(-1)?.stdout.write('DeepSeek Harness v1.2.3\nOpen http://127.0.0.1:31415/?token=secret-token\n')
    })
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('keeps Harness data in an app-owned sibling directory', () => {
    expect(deepSeekHarnessRoot(root)).toBe(path.join(root, 'deepseek-harness'))
  })

  it('reports a compatible system Node runtime and its source', async () => {
    await expect(createRuntime().getStatus()).resolves.toMatchObject({
      state: 'stopped', nodeVersion: 'v22.19.0', nodeSource: 'system',
    })
  })

  it('reports unavailable when no compatible Node.js runtime exists', async () => {
    const runtime = createRuntime({
      resolveNode: () => null,
      resolveManagedNode: async () => null,
    })
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'unavailable' })
  })

  it('does not start DSH if the user stops while managed Node is downloading', async () => {
    let finishInstall: ((path: string) => void) | undefined
    let markInstallStarted: (() => void) | undefined
    const started = new Promise<void>(resolve => { markInstallStarted = resolve })
    const installation = new Promise<string>(resolve => { finishInstall = resolve })
    const runtime = createRuntime({
      resolveNode: () => null,
      installNode: () => {
        markInstallStarted?.()
        return installation
      },
    })
    const starting = runtime.start()
    await started
    await runtime.stop()
    finishInstall?.('/app/node/current/bin/node')

    await expect(starting).rejects.toThrow('DeepSeek Harness startup stopped')
    expect(spawn).not.toHaveBeenCalled()
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'unavailable' })
  })

  it('installs managed Node on demand and launches the official unpinned npx package', async () => {
    const installNode = vi.fn(async () => '/app/node/current/bin/node')
    const runtime = createRuntime({ resolveNode: () => null, installNode })

    const result = await runtime.start()

    expect(result).toMatchObject({ state: 'running', version: '1.2.3', nodeSource: 'managed' })
    expect(installNode).toHaveBeenCalledWith(root)
    const [command, args, options] = spawn.mock.calls[0]!
    expect(command).toBe('/app/node/current/bin/node')
    expect(args).toEqual([
      '/usr/local/lib/node_modules/npm/bin/npx-cli.js', '--yes', '--package', '@deepseek-ai/dsh', '--',
      'dsh', 'web', '--no-open', '--host', '127.0.0.1', '--port', '31415',
    ])
    expect(options.cwd).toBe(path.join(root, 'deepseek-harness', 'data'))
    expect(options.env.DSH_HOME).toBe(options.cwd)
    expect(options.env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(runtime.getOpenUrl()).toBe('http://127.0.0.1:31415/?token=secret-token')
  })

  it('coalesces concurrent starts and stops the child process', async () => {
    const runtime = createRuntime()
    const [first, second] = await Promise.all([runtime.start(), runtime.start()])
    await runtime.stop()

    expect(first.url).toBe(second.url)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(children[0]?.kill).toHaveBeenCalled()
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'stopped' })
  })

  it('requires DSH to print an authenticated launch URL before reporting running', async () => {
    waitForUrl.mockResolvedValueOnce(undefined)
    const runtime = createRuntime()

    await expect(runtime.start()).rejects.toThrow('without printing its authenticated launch URL')
    expect(children[0]?.kill).toHaveBeenCalled()
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'error' })
  })

  it('uses npm prefer-online only for an explicit update and restarts the child', async () => {
    const runtime = createRuntime()
    await runtime.start()
    await runtime.update()

    expect(children[0]?.kill).toHaveBeenCalled()
    expect(spawn.mock.calls[1]?.[1]).toContain('--prefer-online')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('returns to stopped when the running Harness exits', async () => {
    const runtime = createRuntime()
    await runtime.start()
    children[0]?.emit('exit', 0, null)
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'stopped' })
  })
})
