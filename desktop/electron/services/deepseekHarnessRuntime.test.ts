import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import * as fs from 'node:fs/promises'
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

type RuntimeDepsOverrides = NonNullable<ConstructorParameters<typeof DeepSeekHarnessRuntime>[0]['deps']>

function createRuntime(overrides: RuntimeDepsOverrides = {}) {
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
      ...overrides,
    },
  })
}

async function seedInstalledRuntime(version = '0.1.1-rc.2'): Promise<string> {
  const runtimeRoot = path.join(root, 'deepseek-harness', 'runtime', 'dsh', version)
  const launcher = path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  await fs.mkdir(path.dirname(launcher), { recursive: true })
  await fs.writeFile(launcher, 'old launcher')
  await fs.mkdir(path.join(root, 'deepseek-harness', 'data'), { recursive: true })
  await fs.writeFile(path.join(root, 'deepseek-harness', 'state.json'), `${JSON.stringify({ version })}\n`)
  return runtimeRoot
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
      path.join(root, 'deepseek-harness', 'runtime', 'dsh', '0.1.1-rc.2', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      'web',
      '--no-open',
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

  it('cleans up the managed process when readiness fails', async () => {
    waitForUrl.mockRejectedValueOnce(new Error('readiness failed'))
    const runtime = createRuntime()
    await runtime.install()

    await expect(runtime.start()).rejects.toThrow('readiness failed')

    expect(children[0]?.kill).toHaveBeenCalledTimes(1)
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'error', error: 'readiness failed' })
  })

  it('does not replace a running Harness during an update', async () => {
    const runtime = createRuntime()
    await runtime.install()
    await runtime.start()

    await expect(runtime.install()).rejects.toThrow('Stop DeepSeek Harness before installing updates')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('does not start while an update is in progress', async () => {
    await seedInstalledRuntime()
    let completeInstall: (() => void) | undefined
    const installationReady = new Promise<void>(resolve => {
      completeInstall = resolve
    })
    const runtime = createRuntime({
      exists: existsSync,
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      rename: fs.rename,
      rm: fs.rm,
      installPackage: async (_nodePath, directory) => {
        await installationReady
        const launcher = path.join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        await fs.mkdir(path.dirname(launcher), { recursive: true })
        await fs.writeFile(launcher, 'new launcher')
      },
    })

    const installation = runtime.install()
    await expect(runtime.start()).rejects.toThrow('Wait for the DeepSeek Harness update to finish before starting it')
    completeInstall?.()
    await installation
  })

  it('keeps the existing runtime when package installation fails', async () => {
    const runtimeRoot = await seedInstalledRuntime()
    const runtime = createRuntime({
      exists: existsSync,
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      rename: fs.rename,
      rm: fs.rm,
      installPackage: async () => {
        throw new Error('npm failed')
      },
    })

    await expect(runtime.install()).rejects.toThrow('npm failed')
    expect(existsSync(path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))).toBe(true)
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'installed', version: '0.1.1-rc.2', error: 'npm failed' })
  })

  it('restores the existing runtime when promotion fails', async () => {
    const runtimeRoot = await seedInstalledRuntime()
    const originalRename = fs.rename
    let promotionAttempted = false
    const runtime = createRuntime({
      exists: existsSync,
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      rm: fs.rm,
      installPackage: async (_nodePath, directory) => {
        const launcher = path.join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        await fs.mkdir(path.dirname(launcher), { recursive: true })
        await fs.writeFile(launcher, 'new launcher')
      },
      rename: async (source, destination) => {
        if (String(source).includes('.installing-') && destination === runtimeRoot && !promotionAttempted) {
          promotionAttempted = true
          throw new Error('promotion failed')
        }
        return originalRename(source, destination)
      },
    })

    await expect(runtime.install()).rejects.toThrow('promotion failed')
    expect(await fs.readFile(path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'utf8')).toBe('old launcher')
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'installed', version: '0.1.1-rc.2', error: 'promotion failed' })
  })

  it('restores the existing runtime when state persistence fails', async () => {
    const runtimeRoot = await seedInstalledRuntime()
    const originalWriteFile = fs.writeFile
    const runtime = createRuntime({
      exists: existsSync,
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      rename: fs.rename,
      rm: fs.rm,
      installPackage: async (_nodePath, directory) => {
        const launcher = path.join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        await fs.mkdir(path.dirname(launcher), { recursive: true })
        await fs.writeFile(launcher, 'new launcher')
      },
      writeFile: async (file, data, encoding) => {
        if (String(file).endsWith('.tmp')) throw new Error('state failed')
        return originalWriteFile(file, data, encoding)
      },
    })

    await expect(runtime.install()).rejects.toThrow('state failed')
    expect(await fs.readFile(path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'utf8')).toBe('old launcher')
    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'installed', version: '0.1.1-rc.2', error: 'state failed' })
  })

  it('returns to stopped when the running Harness exits', async () => {
    const runtime = createRuntime()
    await runtime.install()
    await runtime.start()

    children[0]?.emit('exit', 0, null)

    await expect(runtime.getStatus()).resolves.toMatchObject({ state: 'stopped' })
  })
})
