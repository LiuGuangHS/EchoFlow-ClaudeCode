import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DeepSeekHarnessRuntime,
  deepSeekHarnessRoot,
  type DeepSeekHarnessChild,
} from './deepseekHarnessRuntime'

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

function createRuntime() {
  return new DeepSeekHarnessRuntime({
    userDataPath: root,
    deps: {
      exists: (target) => target.endsWith(path.join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')),
      mkdir: async () => undefined,
      readFile: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      writeFile: async () => undefined,
      rename: async () => undefined,
      rm: async () => undefined,
      spawn,
      reservePort,
      waitForUrl,
      resolveNode: () => '/usr/local/bin/node',
      nodeVersion: async () => [22, 19, 0],
      installPackage: async () => undefined,
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
    waitForUrl = vi.fn(async () => undefined)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps Harness data in an app-owned sibling directory', () => {
    expect(deepSeekHarnessRoot(root)).toBe(path.join(root, 'deepseek-harness'))
  })

  it('reports an uninstalled Harness without reading EchoFlow configuration', async () => {
    const runtime = createRuntime()

    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'not-installed' })
    await expect(runtime.start()).rejects.toThrow('Install DeepSeek Harness before starting it')
  })

  it('reports unavailable when no compatible system Node.js runtime exists', async () => {
    const runtime = new DeepSeekHarnessRuntime({
      userDataPath: root,
      deps: {
        resolveNode: () => null,
      },
    })

    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'unavailable' })
    await expect(runtime.install()).rejects.toThrow('Node.js 22.19.0 or later is required')
  })

  it('reports unavailable when the system Node.js runtime is too old', async () => {
    const runtime = new DeepSeekHarnessRuntime({
      userDataPath: root,
      deps: {
        resolveNode: () => '/usr/local/bin/node',
        nodeVersion: async () => [22, 18, 9],
      },
    })

    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'unavailable' })
  })

  it('starts only the managed Harness package on loopback with an isolated home', async () => {
    const runtime = createRuntime()
    await runtime.install()

    const status = await runtime.start()

    expect(status).toMatchObject({ state: 'running', url: 'http://127.0.0.1:31415' })
    const [command, args, options] = spawn.mock.calls.at(-1)!
    expect(command).toBe('/usr/local/bin/node')
    expect(args).toEqual([
      path.join(root, 'deepseek-harness', 'runtime', 'dsh', '0.1.0-rc.7', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      'web',
      '--host',
      '127.0.0.1',
      '--port',
      '31415',
    ])
    expect(options?.env?.DSH_HOME).toBe(path.join(root, 'deepseek-harness', 'data'))
    expect(options?.env?.PATH).toBe(process.env.PATH)
    expect(options?.env?.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(options?.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(waitForUrl).toHaveBeenCalledWith('http://127.0.0.1:31415')
  })

  it('coalesces concurrent starts and stops the managed process', async () => {
    const runtime = createRuntime()
    await runtime.install()

    const [first, second] = await Promise.all([runtime.start(), runtime.start()])
    await runtime.stop()

    expect(first.url).toBe(second.url)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(children[0]?.kill).toHaveBeenCalled()
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'stopped' })
  })

  it('returns to stopped when the running Harness exits', async () => {
    const runtime = createRuntime()
    await runtime.install()
    await runtime.start()

    children[0]?.emit('exit', 0, null)

    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'stopped' })
  })
})
