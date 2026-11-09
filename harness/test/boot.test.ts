import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  boot: vi.fn(),
  composeEffectiveProfile: vi.fn(),
  resolveDshHome: vi.fn(),
}))

vi.mock('@deepseek-ai/dsh-app-boot', () => ({
  boot: mocks.boot,
  createRuntimeResolution: vi.fn(),
  PluginPackages: {},
}))
vi.mock('@deepseek-ai/dsh-home-paths', () => ({ resolveDshHome: mocks.resolveDshHome }))
vi.mock('../src/profileConfig.js', () => ({
  composeEffectiveProfile: mocks.composeEffectiveProfile,
  readEgressBlocklist: vi.fn(),
}))

import { bootEchoFlowAgent, bootEchoFlowNativeAgent } from '../src/boot.js'
import { EgressViolationError } from '../bundles/egress-guard/src/verify.js'

const blocklist = { plugins: [], hosts: ['blocked.example'], routes: [] }
let root: string
let dispose: ReturnType<typeof vi.fn>
let ctx: {
  fiber: { dispose: typeof dispose }
  loader: { entries: ReturnType<typeof vi.fn> }
  get: ReturnType<typeof vi.fn>
  tools: { schemas: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  root = mkdtempSync(join(tmpdir(), 'echoflow-boot-'))
  dispose = vi.fn().mockResolvedValue(undefined)
  ctx = {
    fiber: { dispose },
    loader: { entries: vi.fn().mockReturnValue([]) },
    get: vi.fn().mockReturnValue(undefined),
    tools: { schemas: vi.fn().mockReturnValue([]) },
  }
  mocks.boot.mockResolvedValue(ctx)
  mocks.composeEffectiveProfile.mockReturnValue({
    profile: { skippedBundles: [], layers: [] },
    layers: [],
    entries: [],
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function boot() {
  return bootEchoFlowAgent({ home: join(root, 'dsh'), blocklist })
}

function mountBlockedEntry() {
  ctx.loader.entries.mockReturnValue([{
    options: { id: 'unexpected-plugin', config: { url: 'https://blocked.example' } },
    disabled: false,
  }])
}

test('returns the guarded context without disposing resources owned by its caller', async () => {
  expect((await boot()).ctx).toBe(ctx)
  expect(dispose).not.toHaveBeenCalled()
  expect(mocks.resolveDshHome).not.toHaveBeenCalled()
})

test('passes an explicit null home patch through to composition', async () => {
  await bootEchoFlowAgent({ home: join(root, 'dsh'), homePatchPath: null, blocklist })
  expect(mocks.composeEffectiveProfile).toHaveBeenCalledWith(expect.objectContaining({ homePatchPath: null }))
})

test('native boot uses the home patch and fixes the native profile', async () => {
  await bootEchoFlowNativeAgent({ home: join(root, 'dsh'), blocklist })
  expect(mocks.composeEffectiveProfile).toHaveBeenCalledWith(expect.objectContaining({
    homePatchPath: join(root, 'dsh', 'cordis.patch.yml'),
    profileDir: expect.stringContaining(join('profile', 'native')),
    hardDisablePlugins: expect.arrayContaining(['tool-bash', 'tool-subagent']),
  }))
  expect(dispose).not.toHaveBeenCalled()
})

test('refuses a native ACP entry before starting the runtime', async () => {
  mocks.composeEffectiveProfile.mockReturnValue({
    profile: { skippedBundles: [], layers: [] },
    layers: [],
    entries: [{ id: 'acp', disabled: false }],
  })

  await expect(bootEchoFlowNativeAgent({ home: join(root, 'dsh'), blocklist }))
    .rejects.toThrow('forbidden plugins are configured: acp')
  expect(mocks.boot).not.toHaveBeenCalled()
})

test('refuses an unsafe composition before starting the runtime', async () => {
  mocks.composeEffectiveProfile.mockReturnValue({
    profile: { skippedBundles: [], layers: [] },
    layers: [],
    entries: [{ id: 'unsafe', config: { url: 'https://blocked.example' } }],
  })

  await expect(boot()).rejects.toBeInstanceOf(EgressViolationError)
  expect(mocks.boot).not.toHaveBeenCalled()
  expect(dispose).not.toHaveBeenCalled()
})

test('awaits context disposal when the mounted tree fails the second safety gate', async () => {
  mountBlockedEntry()
  let finishDisposal!: () => void
  dispose.mockImplementation(() => new Promise<void>(resolve => { finishDisposal = resolve }))
  let settled = false
  const result = boot().catch(error => { settled = true; return error })

  await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1))
  expect(settled).toBe(false)
  finishDisposal()
  expect(await result).toBeInstanceOf(EgressViolationError)
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('disposes the context if inspecting the mounted loader tree throws', async () => {
  const failure = new Error('loader snapshot failed')
  ctx.loader.entries.mockImplementation(() => { throw failure })

  await expect(boot()).rejects.toBe(failure)
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('retains both the safety failure and a disposal failure for diagnostics', async () => {
  mountBlockedEntry()
  const cleanupFailure = new Error('plugin disposal failed')
  dispose.mockRejectedValue(cleanupFailure)

  const failure = await boot().catch(error => error)
  expect(failure).toBeInstanceOf(AggregateError)
  expect(failure.errors[0]).toBeInstanceOf(EgressViolationError)
  expect(failure.errors[1]).toBe(cleanupFailure)
  expect(dispose).toHaveBeenCalledTimes(1)
})
