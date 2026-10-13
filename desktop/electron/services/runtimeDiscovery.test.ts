import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverRuntimes, parseWslDistributions, probeRuntimePath, type RuntimeDiscoveryDeps } from './runtimeDiscovery'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  kill() { this.killed = true; return true }
}

function makeDeps(overrides: Partial<RuntimeDiscoveryDeps> = {}) {
  const children: FakeChild[] = []
  const spawn = vi.fn(() => {
    const child = new FakeChild()
    children.push(child)
    return child
  })
  return {
    children,
    deps: {
      platform: 'linux',
      env: { PATH: '/tools' },
      exists: (target: string) => ['/tools/claude', '/tools/codex'].includes(target),
      realpath: (target: string) => target,
      isFile: () => true,
      isExecutable: () => true,
      spawn,
      timeoutMs: 20,
      ...overrides,
      wslTimeoutMs: overrides.wslTimeoutMs ?? 10_000,
    } satisfies RuntimeDiscoveryDeps,
  }
}

async function finish(child: FakeChild, output: string, code = 0) {
  child.stdout.write(output)
  child.stdout.end()
  child.stderr.end()
  child.emit('close', code, null)
}

afterEach(() => vi.restoreAllMocks())

describe('runtime discovery', () => {
  it('reports EchoFlow bundled separately and discovers known native CLIs with versions', async () => {
    const { deps, children } = makeDeps()
    const pending = discoverRuntimes({}, deps)
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.spawn).toHaveBeenCalledTimes(2)
    await Promise.all(children.map((child, index) => finish(child, index ? 'codex 1.2.3\n' : 'Claude Code 2.0.1\n')))
    await expect(pending).resolves.toMatchObject({ installations: [
      { productId: 'echoflow-agent', source: 'bundled', status: 'available' },
      { productId: 'claude-code', source: 'current-system', path: '/tools/claude', version: '2.0.1', status: 'available' },
      { productId: 'codex', source: 'current-system', path: '/tools/codex', version: '1.2.3', status: 'available' },
    ] })
  })

  it('uses Windows PATH separators and executable paths when probing Windows installs', async () => {
    const { deps, children } = makeDeps({
      platform: 'win32',
      env: { Path: 'C:\\Tools;D:\\Agents' },
      exists: target => target === 'C:\\Tools\\claude.exe' || target === 'D:\\Agents\\codex.exe',
      realpath: target => target,
    })
    const pending = discoverRuntimes({}, deps)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(deps.spawn).toHaveBeenCalledWith('C:\\Tools\\claude.exe', ['--version'], expect.any(Object))
    expect(deps.spawn).toHaveBeenCalledWith('D:\\Agents\\codex.exe', ['--version'], expect.any(Object))
    await Promise.all(children.map((child, index) => finish(child, index ? 'codex 1.2.3' : 'Claude Code 2.0.1')))
    await expect(pending).resolves.toMatchObject({ installations: [
      {},
      { productId: 'claude-code', status: 'available', path: 'C:\\Tools\\claude.exe' },
      { productId: 'codex', status: 'available', path: 'D:\\Agents\\codex.exe' },
    ] })
  })

  it('keeps one failed executable probe from rejecting other discoveries', async () => {
    const { deps, children } = makeDeps()
    const pending = discoverRuntimes({}, deps)
    await Promise.resolve()
    await Promise.resolve()
    await finish(children[0]!, '', 2)
    await finish(children[1]!, 'codex 1.2.3\n')
    await expect(pending).resolves.toMatchObject({ installations: [
      { productId: 'echoflow-agent', status: 'available' },
      { productId: 'claude-code', status: 'error' },
      { productId: 'codex', status: 'available', version: '1.2.3' },
    ] })
  })

  it('kills a version probe that exceeds its timeout', async () => {
    const { deps, children } = makeDeps({ exists: () => true })
    const pending = discoverRuntimes({}, deps)
    await Promise.resolve()
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(children.every(child => child.killed)).toBe(true)
    await expect(pending).resolves.toMatchObject({ installations: [
      { productId: 'echoflow-agent', status: 'available' },
      { productId: 'claude-code', status: 'error' },
      { productId: 'codex', status: 'error' },
    ] })
  })

  it('rejects a relative selected path before starting a process', async () => {
    const { deps } = makeDeps()
    await expect(probeRuntimePath('codex', deps)).rejects.toThrow(/absolute/)
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('validates the selected executable and uses only a fixed product version argument', async () => {
    const { deps, children } = makeDeps({ exists: () => true })
    const pending = probeRuntimePath('/custom/codex-cli', deps)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(deps.spawn).toHaveBeenCalledWith('/custom/codex-cli', ['--version'], expect.objectContaining({ shell: false }))
    await finish(children[0]!, 'codex 9.8.7\n')
    await expect(pending).resolves.toMatchObject({ productId: 'codex', source: 'custom-path', version: '9.8.7', status: 'available' })
  })

  it('rejects an unknown executable name without running it', async () => {
    const { deps } = makeDeps({ exists: () => true })
    await expect(probeRuntimePath('/custom/agent-tool', deps)).rejects.toThrow(/Claude Code or Codex/)
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('rejects a selected directory and never executes it', async () => {
    const { deps } = makeDeps({ isFile: () => false })
    await expect(probeRuntimePath('/custom/directory', deps)).rejects.toThrow(/file/)
    expect(deps.spawn).not.toHaveBeenCalled()
  })
})

it('reports malformed version output without exposing command output', async () => {
  const { deps, children } = makeDeps()
  const pending = discoverRuntimes({}, deps)
  await new Promise(resolve => setTimeout(resolve, 0))
  for (const child of children) await finish(child, 'provider-token=secret-value')
  const result = await pending
  expect(result.installations[1]).toMatchObject({ status: 'error', error: 'invalid-version' })
  expect(JSON.stringify(result)).not.toContain('secret-value')
})

it('kills a probe that emits more than the bounded output limit', async () => {
  const { deps, children } = makeDeps({ exists: () => true })
  const pending = discoverRuntimes({}, deps)
  await new Promise(resolve => setTimeout(resolve, 0))
  children[0]!.stdout.write('x'.repeat(20_000))
  expect(children[0]!.killed).toBe(true)
  children[0]!.emit('close', null, 'SIGTERM')
  children[1]!.kill()
  children[1]!.emit('close', null, 'SIGTERM')
  await expect(pending).resolves.toMatchObject({ installations: [
    { productId: 'echoflow-agent', status: 'available' },
    { productId: 'claude-code', status: 'error', error: 'probe-failed' },
    { productId: 'codex', status: 'error', error: 'probe-failed' },
  ] })
})

it('rejects control characters and non-executable selected paths before spawning', async () => {
  const { deps } = makeDeps()
  await expect(probeRuntimePath(`/tmp/codex\n`, deps)).rejects.toThrow(/invalid/)
  const nonExecutable = makeDeps({ isExecutable: () => false })
  await expect(probeRuntimePath('/tmp/codex', nonExecutable.deps)).rejects.toThrow(/executable/)
  expect(nonExecutable.deps.spawn).not.toHaveBeenCalled()
})

describe('WSL runtime discovery', () => {
  it('does not run WSL commands outside Windows', async () => {
    const { deps } = makeDeps({ platform: 'linux', exists: () => false })
    await expect(discoverRuntimes({ includeWsl: true }, deps)).resolves.toMatchObject({
      installations: expect.arrayContaining([{ productId: 'wsl', source: 'wsl', status: 'not-applicable' }]),
    })
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('decodes WSL UTF-16 output and probes each distro with fixed argv', async () => {
    const children: FakeChild[] = []
    const spawn = vi.fn((_command: string, _args: string[]) => {
      const child = new FakeChild()
      children.push(child)
      return child
    })
    const deps = makeDeps({ platform: 'win32', env: { PATH: 'C:\\Windows\\System32' }, exists: () => false, spawn }).deps
    const pending = discoverRuntimes({ includeWsl: true }, deps)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(spawn.mock.calls[0]?.[0]).toBe('wsl.exe')
    children[0]!.stdout.write(Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le'))
    children[0]!.stdout.end()
    children[0]!.stderr.end()
    children[0]!.emit('close', 0, null)
    await new Promise(resolve => setTimeout(resolve, 0))
    const distroCalls = spawn.mock.calls.slice(1)
    expect(distroCalls.length).toBe(2)
    expect(distroCalls).toEqual(expect.arrayContaining([
      ['wsl.exe', ['-d', 'Ubuntu', '--exec', 'sh', '-c', expect.any(String)], expect.any(Object)],
      ['wsl.exe', ['-d', 'Debian', '--exec', 'sh', '-c', expect.any(String)], expect.any(Object)],
    ]))
    expect(JSON.stringify(distroCalls)).not.toContain('Ubuntu;')
    expect(distroCalls.every(call => call[1]?.includes('--exec'))).toBe(true)
    for (const child of children.slice(1)) {
      child.stdout.write('')
      child.stdout.end()
      child.stderr.end()
      child.emit('close', 0, null)
    }
    await expect(pending).resolves.toMatchObject({ installations: expect.arrayContaining([
      { productId: 'claude-code', source: 'wsl', distribution: 'Ubuntu', status: 'not-found' },
      { productId: 'codex', source: 'wsl', distribution: 'Ubuntu', status: 'not-found' },
      { productId: 'claude-code', source: 'wsl', distribution: 'Debian', status: 'not-found' },
      { productId: 'codex', source: 'wsl', distribution: 'Debian', status: 'not-found' },
    ]) })
  })

  it('decodes UTF-16 WSL distro lists, including BOMs and empty output', () => {
    expect(parseWslDistributions(Buffer.from('\uFEFFUbuntu\r\nDebian\r\n', 'utf16le'))).toEqual(['Ubuntu', 'Debian'])
    expect(parseWslDistributions(Buffer.alloc(0))).toEqual([])
  })

  it('rejects distro names that could be interpreted as command options or shell syntax', () => {
    expect(parseWslDistributions(Buffer.from('-e\nUbuntu; touch /tmp/pwned\nUbuntu\n', 'utf16le'))).toEqual(['Ubuntu'])
  })
})

it('reports WSL unavailable or empty without suppressing native discoveries', async () => {
  for (const mode of ['missing', 'empty'] as const) {
    const children: FakeChild[] = []
    const spawn = vi.fn(() => {
      const child = new FakeChild()
      children.push(child)
      if (mode === 'missing') queueMicrotask(() => child.emit('error', new Error('not found')))
      else if (children.length === 1) queueMicrotask(() => {
        child.stdout.end()
        child.stderr.end()
        child.emit('close', 0, null)
      })
      return child
    })
    const { deps } = makeDeps({ platform: 'win32', env: { PATH: 'C:\\Windows\\System32' }, exists: () => false, spawn })
    await expect(discoverRuntimes({ includeWsl: true }, deps)).resolves.toMatchObject({
      installations: [
        { productId: 'echoflow-agent', status: 'available' },
        { productId: 'claude-code', status: 'not-found' },
        { productId: 'codex', status: 'not-found' },
        { productId: 'wsl', status: mode === 'missing' ? 'error' : 'not-found' },
      ],
    })
  }
})
