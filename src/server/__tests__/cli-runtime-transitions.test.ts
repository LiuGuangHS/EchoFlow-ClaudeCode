import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { conversationService } from '../services/conversationService.js'
import { ProviderService } from '../services/providerService.js'
import { sessionService } from '../services/sessionService.js'
import { SettingsService } from '../services/settingsService.js'
import {
  __enqueueRuntimeTransitionForTests,
  __resetWebSocketHandlerStateForTests,
  getRuntimeSettings,
  getSessionTurnState,
  handleWebSocket,
  type SessionConnection,
} from '../ws/handler.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function flushMicrotasks() {
  for (let index = 0; index < 30; index++) await Promise.resolve()
}

const providers = ['provider-a', 'provider-b'].map((id, index) => ({
  id,
  presetId: 'deepseek',
  name: id,
  apiKey: 'fixture-key',
  baseUrl: 'http://127.0.0.1:1/anthropic',
  apiFormat: 'anthropic' as const,
  runtimeKind: 'anthropic_compatible' as const,
  models: {
    main: index === 0 ? 'deepseek-v4-pro' : 'deepseek-v4-flash',
    haiku: 'deepseek-v4-flash',
    sonnet: 'deepseek-v4-pro',
    opus: 'deepseek-v4-pro',
  },
}))

type LaunchInfo = NonNullable<Awaited<ReturnType<typeof sessionService.getSessionLaunchInfo>>> & {
  cliRuntimeId?: 'bundled' | 'installed'
}

// shortcut: the trusted executable fixture uses POSIX X_OK, add a native .exe fixture for Windows coverage.
describe.skipIf(process.platform === 'win32')('WebSocket CLI runtime transitions', () => {
  let root: string
  let previousEnv: NodeJS.ProcessEnv
  let sessionId: string
  let launchInfo: LaunchInfo
  let running: boolean
  let sent: Record<string, any>[]
  let ws: SessionConnection
  let outputCallbacks: Set<(message: any) => void>
  let lifecycle: string[]

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ws-cli-runtime-')))
    previousEnv = { ...process.env }
    const installedPath = join(root, 'installed-claude')
    const configPath = join(root, 'claude-code-runtime.json')
    await writeFile(installedPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, defaultRuntimeId: 'bundled', installedPath }))
    const env = createSandboxedTestEnvironment(root, {
      CLAUDE_APP_ROOT: root,
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: configPath,
    })
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, env)
    resetSettingsCache()
    __resetWebSocketHandlerStateForTests()

    sessionId = crypto.randomUUID()
    launchInfo = {
      filePath: join(root, `${sessionId}.jsonl`), projectDir: root, workDir: root,
      transcriptMessageCount: 1, customTitle: 'Fixture conversation', permissionMode: 'default',
    }
    running = true
    sent = []
    lifecycle = []
    outputCallbacks = new Set()
    ws = {
      data: { sessionId, connectedAt: Date.now(), channel: 'client', sdkToken: null, serverPort: 0, serverHost: '127.0.0.1' },
      send: mock(payload => { sent.push(JSON.parse(String(payload))); return 1 }),
      close: mock(() => {}),
    }
    spyOn(sessionService, 'getSessionLaunchInfo').mockImplementation(async () => launchInfo)
    spyOn(sessionService, 'getSessionWorkDir').mockResolvedValue(root)
    spyOn(sessionService, 'getCustomTitle').mockResolvedValue('Fixture conversation')
    spyOn(sessionService, 'shouldPersistSession').mockReturnValue(false)
    spyOn(sessionService, 'appendSessionMetadata').mockImplementation(async (_id, metadata) => { Object.assign(launchInfo, metadata) })
    spyOn(SettingsService.prototype, 'getUserSettings').mockResolvedValue({})
    spyOn(SettingsService.prototype, 'getPermissionMode').mockResolvedValue('default')
    spyOn(ProviderService.prototype, 'listProviders').mockResolvedValue({ providers, activeId: 'provider-a', providerOrder: providers.map(provider => provider.id) })
    spyOn(ProviderService.prototype, 'getManagedSettings').mockResolvedValue({ model: 'deepseek-v4-pro' })
    spyOn(ProviderService.prototype, 'getProvider').mockImplementation(async id => {
      const provider = providers.find(entry => entry.id === id)
      if (!provider) throw new Error(`Unknown fixture provider: ${id}`)
      return provider
    })
    spyOn(conversationService, 'hasSession').mockImplementation(() => running)
    spyOn(conversationService, 'getSessionWorkDir').mockReturnValue(root)
    spyOn(conversationService, 'getPendingPermissionRequests').mockReturnValue([])
    spyOn(conversationService, 'onOutput').mockImplementation((_id, callback) => { outputCallbacks.add(callback) })
    spyOn(conversationService, 'removeOutputCallback').mockImplementation((_id, callback) => { outputCallbacks.delete(callback) })
    spyOn(conversationService, 'clearOutputCallbacks').mockImplementation(() => { outputCallbacks.clear() })
    spyOn(conversationService, 'startSession').mockImplementation(async () => { lifecycle.push('start'); running = true })
    spyOn(conversationService, 'stopSession').mockImplementation(() => { lifecycle.push('stop'); running = false; outputCallbacks.clear() })
    spyOn(conversationService, 'sendInterrupt').mockImplementation(() => { lifecycle.push('interrupt'); return true })
  })

  afterEach(async () => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, previousEnv)
    resetSettingsCache()
    await rm(root, { recursive: true, force: true })
  })

  function emit(message: Record<string, unknown>) {
    for (const callback of [...outputCallbacks]) callback(message)
  }

  async function drainTransitions() {
    await __enqueueRuntimeTransitionForTests(sessionId, Promise.resolve())
  }

  it('defers an installed CLI selection during an active turn and uses it after Stop without replaying cancelled input', async () => {
    const firstSend = deferred()
    const nextSend = deferred()
    const stopFallbacks: Array<() => void> = []
    const realSetTimeout = globalThis.setTimeout
    spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (delay === 3_000) {
        stopFallbacks.push(() => callback(...args))
        return 1 as any
      }
      return realSetTimeout(callback, delay, ...args)
    })
    const sendMessage = spyOn(conversationService, 'sendMessage').mockImplementation(async (_id, content, _attachments, options) => {
      expect(options?.canSend?.()).toBe(true)
      options?.onCommitted?.()
      lifecycle.push(`send:${content}`)
      if (content === 'Cancelled input') firstSend.resolve()
      else nextSend.resolve()
      return true
    })

    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Cancelled input' }))
    await firstSend.promise
    await flushMicrotasks()
    expect(getSessionTurnState(sessionId)).toBe('running')

    handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'installed' }))
    await drainTransitions()
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'error' }))
    expect(conversationService.stopSession).not.toHaveBeenCalled()
    expect(conversationService.startSession).not.toHaveBeenCalled()
    expect(conversationService.sendInterrupt).not.toHaveBeenCalled()
    expect(getSessionTurnState(sessionId)).toBe('running')

    handleWebSocket.message(ws, JSON.stringify({ type: 'stop_generation' }))
    expect(conversationService.sendInterrupt).toHaveBeenCalledWith(sessionId)
    emit({ type: 'result', subtype: 'error', is_error: true, result: 'Interrupted' })
    await drainTransitions()
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Fresh input' }))
    await nextSend.promise
    await flushMicrotasks()

    expect(conversationService.startSession).toHaveBeenLastCalledWith(
      sessionId, root, expect.stringContaining(`/sdk/${sessionId}`),
      expect.objectContaining({ cliRuntimeId: 'installed', providerId: 'provider-a', model: 'deepseek-v4-pro', resumeInterruptedTurn: false }),
    )
    expect(launchInfo.cliRuntimeId).toBe('installed')
    expect(sendMessage.mock.calls.map(call => call[1])).toEqual(['Cancelled input', 'Fresh input'])
    expect(lifecycle).toEqual(['send:Cancelled input', 'interrupt', 'stop', 'start', 'send:Fresh input'])
    const stopCount = lifecycle.filter(event => event === 'stop').length
    for (const fallback of stopFallbacks) fallback()
    expect(conversationService.stopSession).toHaveBeenCalledTimes(stopCount)
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'error' }))
  })

  it('retains the installed CLI pin and later provider/model across overlapping selections', async () => {
    launchInfo.runtimeProviderId = 'provider-a'
    launchInfo.runtimeModelId = 'deepseek-v4-pro'
    launchInfo.cliRuntimeId = 'bundled'
    const barrier = deferred()
    const delivered = deferred()
    const setModel = spyOn(conversationService, 'setModel').mockResolvedValue(true)
    const sendMessage = spyOn(conversationService, 'sendMessage').mockImplementation(async (_id, _content, _attachments, options) => {
      expect(options?.canSend?.()).toBe(true)
      options?.onCommitted?.()
      delivered.resolve()
      return true
    })
    handleWebSocket.open(ws)
    void __enqueueRuntimeTransitionForTests(sessionId, barrier.promise)
    handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'installed' }))
    handleWebSocket.message(ws, JSON.stringify({ type: 'set_runtime_config', providerId: 'provider-b', modelId: 'deepseek-v4-flash' }))
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Use both selections' }))
    barrier.resolve()
    await drainTransitions()
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'error' }))
    await delivered.promise
    await flushMicrotasks()

    expect(conversationService.startSession).toHaveBeenLastCalledWith(
      sessionId, root, expect.stringContaining(`/sdk/${sessionId}`),
      expect.objectContaining({ cliRuntimeId: 'installed', providerId: 'provider-b', model: 'deepseek-v4-flash' }),
    )
    expect(await getRuntimeSettings(sessionId)).toMatchObject({ cliRuntimeId: 'installed', providerId: 'provider-b', model: 'deepseek-v4-flash' })
    expect(launchInfo).toMatchObject({ cliRuntimeId: 'installed', runtimeProviderId: 'provider-b', runtimeModelId: 'deepseek-v4-flash' })
    expect(setModel).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['default provider', undefined, undefined, 'provider-a', 'deepseek-v4-pro'],
    ['restored override', 'provider-b', 'deepseek-v4-flash', 'provider-b', 'deepseek-v4-flash'],
    ['stale provider fallback', 'deleted-provider', 'obsolete-model', 'provider-a', 'deepseek-v4-pro'],
  ] as const)('restores the CLI pin through the %s settings path', async (_path, providerId, modelId, expectedProvider, expectedModel) => {
    launchInfo.cliRuntimeId = 'installed'
    if (modelId !== undefined) {
      launchInfo.runtimeProviderId = providerId
      launchInfo.runtimeModelId = modelId
    }
    expect(await getRuntimeSettings(sessionId)).toMatchObject({
      cliRuntimeId: 'installed', providerId: expectedProvider, model: expectedModel, permissionMode: 'default',
    })
    expect(sessionService.appendSessionMetadata).not.toHaveBeenCalled()
    expect(conversationService.startSession).not.toHaveBeenCalled()
  })

  it('blocks input after an accepted installed CLI restart fails and recovers only with fresh input after a valid selection', async () => {
    launchInfo.cliRuntimeId = 'bundled'
    const accepted = deferred()
    const finishSend = deferred()
    const freshSend = deferred()
    const sendMessage = spyOn(conversationService, 'sendMessage').mockImplementation(async (_id, content, _attachments, options) => {
      expect(options?.canSend?.()).toBe(true)
      options?.onCommitted?.()
      lifecycle.push(`send:${content}`)
      if (content === 'Accepted work') {
        accepted.resolve()
        await finishSend.promise
      } else freshSend.resolve()
      return true
    })
    const startSession = spyOn(conversationService, 'startSession').mockImplementation(async (_id, _workDir, _sdkUrl, options) => {
      lifecycle.push('start')
      if (options?.cliRuntimeId === 'installed') throw new Error('Fixture installed CLI startup failed')
      running = true
    })

    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Accepted work' }))
    await accepted.promise
    handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'installed' }))
    await drainTransitions()
    expect(getSessionTurnState(sessionId)).toBe('running')
    expect(startSession).not.toHaveBeenCalled()
    expect(conversationService.stopSession).not.toHaveBeenCalled()
    expect(await getRuntimeSettings(sessionId)).toMatchObject({ cliRuntimeId: 'installed' })

    finishSend.resolve()
    await flushMicrotasks()
    emit({ type: 'result', subtype: 'success', is_error: false, result: 'Accepted work completed' })
    await drainTransitions()
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenLastCalledWith(
      sessionId, root, expect.stringContaining(`/sdk/${sessionId}`),
      expect.objectContaining({ cliRuntimeId: 'installed', providerId: 'provider-a', model: 'deepseek-v4-pro' }),
    )
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', code: 'CLI_RESTART_FAILED' }))
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'error', code: 'CLI_RUNTIME_INVALID' }))
    expect(launchInfo.cliRuntimeId).toBe('bundled')
    expect(await getRuntimeSettings(sessionId)).toMatchObject({ cliRuntimeId: 'installed' })

    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Blocked input' }))
    await flushMicrotasks()
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'error', code: 'USER_TURN_FAILED', retryable: true,
      message: expect.stringContaining('Select a valid CLI runtime'),
    }))
    expect(sendMessage.mock.calls.map(call => call[1])).toEqual(['Accepted work'])
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(getSessionTurnState(sessionId)).toBe('idle')

    handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'bundled' }))
    await drainTransitions()
    expect(await getRuntimeSettings(sessionId)).toMatchObject({ cliRuntimeId: 'bundled' })
    expect(sendMessage.mock.calls.map(call => call[1])).toEqual(['Accepted work'])
    sent.length = 0
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Fresh input' }))
    await freshSend.promise
    await flushMicrotasks()
    expect(startSession).toHaveBeenCalledTimes(2)
    expect(startSession).toHaveBeenLastCalledWith(
      sessionId, root, expect.stringContaining(`/sdk/${sessionId}`),
      expect.objectContaining({ cliRuntimeId: 'bundled', providerId: 'provider-a', model: 'deepseek-v4-pro' }),
    )
    expect(sendMessage.mock.calls.map(call => call[1])).toEqual(['Accepted work', 'Fresh input'])
    expect(lifecycle).toEqual(['send:Accepted work', 'stop', 'start', 'start', 'send:Fresh input'])
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'error' }))
  })

  it('blocks input after an unavailable CLI selection until a valid selection and fresh input', async () => {
    launchInfo.cliRuntimeId = 'bundled'
    await rm(join(root, 'installed-claude'))
    const delivered = deferred()
    const sendMessage = spyOn(conversationService, 'sendMessage').mockImplementation(async (_id, _content, _attachments, options) => {
      options?.onCommitted?.()
      delivered.resolve()
      return true
    })
    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'installed' }))
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Must not use the old CLI' }))
    await drainTransitions()
    await flushMicrotasks()

    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', code: 'CLI_RUNTIME_INVALID' }))
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', code: 'USER_TURN_FAILED', retryable: true }))
    expect(sendMessage).not.toHaveBeenCalled()
    expect(conversationService.stopSession).not.toHaveBeenCalled()
    expect(conversationService.startSession).not.toHaveBeenCalled()
    expect(sessionService.appendSessionMetadata).not.toHaveBeenCalled()
    expect(launchInfo.cliRuntimeId).toBe('bundled')

    handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'bundled' }))
    await drainTransitions()
    expect(sendMessage).not.toHaveBeenCalled()
    sent.length = 0
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Fresh input' }))
    await delivered.promise
    await flushMicrotasks()
    expect(sendMessage.mock.calls.map(call => call[1])).toEqual(['Fresh input'])
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'error' }))
  })

  it('does not apply a deferred CLI choice superseded by an unavailable selection', async () => {
    launchInfo.cliRuntimeId = 'bundled'
    const delivered = deferred()
    const sendMessage = spyOn(conversationService, 'sendMessage').mockImplementation(async (_id, _content, _attachments, options) => {
      options?.onCommitted?.()
      delivered.resolve()
      return true
    })
    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Accepted input' }))
    await delivered.promise
    await flushMicrotasks()
    expect(getSessionTurnState(sessionId)).toBe('running')

    handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'installed' }))
    await drainTransitions()
    expect(await getRuntimeSettings(sessionId)).toMatchObject({ cliRuntimeId: 'installed' })
    handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'unavailable' }))
    await drainTransitions()
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', code: 'CLI_RUNTIME_INVALID' }))

    emit({ type: 'result', subtype: 'success', is_error: false, result: 'Done' })
    await drainTransitions()
    expect(conversationService.stopSession).not.toHaveBeenCalled()
    expect(sessionService.appendSessionMetadata).not.toHaveBeenCalled()
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'cli_runtime_applied' }))

    sent.length = 0
    handleWebSocket.message(ws, JSON.stringify({ type: 'set_runtime_config', providerId: 'provider-b', modelId: 'deepseek-v4-flash' }))
    await drainTransitions()
    expect(conversationService.startSession).toHaveBeenCalledWith(
      sessionId, root, expect.any(String),
      expect.objectContaining({ cliRuntimeId: 'bundled', providerId: 'provider-b' }),
    )
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Wait for a valid choice' }))
    await flushMicrotasks()
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', code: 'USER_TURN_FAILED', retryable: true }))
    expect(sendMessage.mock.calls.map(call => call[1])).toEqual(['Accepted input'])
    expect(launchInfo.cliRuntimeId).toBe('bundled')
  })

  it('preserves a rejected provider/model admission gate after a valid CLI selection', async () => {
    launchInfo.cliRuntimeId = 'bundled'
    const sendMessage = spyOn(conversationService, 'sendMessage').mockImplementation(async (_id, _content, _attachments, options) => {
      options?.onCommitted?.()
      return true
    })
    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({ type: 'set_runtime_config', providerId: 'provider-b', modelId: ' ' }))
    await drainTransitions()
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', code: 'RUNTIME_CONFIG_INVALID' }))
    expect(conversationService.startSession).not.toHaveBeenCalled()

    handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'installed' }))
    await drainTransitions()
    expect(conversationService.startSession).toHaveBeenCalledTimes(1)
    expect(conversationService.startSession).toHaveBeenLastCalledWith(
      sessionId, root, expect.stringContaining(`/sdk/${sessionId}`),
      expect.objectContaining({ cliRuntimeId: 'installed', providerId: 'provider-a', model: 'deepseek-v4-pro' }),
    )
    expect(launchInfo.cliRuntimeId).toBe('installed')
    expect(await getRuntimeSettings(sessionId)).toMatchObject({ cliRuntimeId: 'installed', providerId: 'provider-a', model: 'deepseek-v4-pro' })
    sent.length = 0
    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Must choose a valid model first' }))
    await flushMicrotasks()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(conversationService.startSession).toHaveBeenCalledTimes(1)
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'error', code: 'USER_TURN_FAILED', retryable: true,
      message: expect.stringContaining('Select a valid model and reasoning effort'),
    }))
    expect(getSessionTurnState(sessionId)).toBe('idle')
  })

  it('defers a CLI switch while sendMessage is preparing input before commit and never replays that input', async () => {
    launchInfo.cliRuntimeId = 'bundled'
    const preparing = deferred()
    const allowCommit = deferred()
    const firstCommitted = deferred()
    const freshCommitted = deferred()
    const committedInputs: string[] = []
    const sendMessage = spyOn(conversationService, 'sendMessage').mockImplementation(async (_id, content, _attachments, options) => {
      if (content === 'Preparing input') {
        preparing.resolve()
        // Production awaits content/credential preparation before its final ownership check and synchronous commit.
        await allowCommit.promise
      }
      if ((options?.canSend && !options.canSend()) || !running) return false
      committedInputs.push(content)
      lifecycle.push(`send:${content}`)
      options?.onCommitted?.()
      if (content === 'Preparing input') firstCommitted.resolve()
      else freshCommitted.resolve()
      return true
    })

    try {
      handleWebSocket.open(ws)
      handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Preparing input' }))
      await preparing.promise
      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(committedInputs).toEqual([])
      expect(sendMessage.mock.calls[0]?.[3]?.canSend?.()).toBe(true)
      expect(getSessionTurnState(sessionId)).toBe('running')

      handleWebSocket.message(ws, JSON.stringify({ type: 'set_cli_runtime', cliRuntimeId: 'installed' }))
      await drainTransitions()
      expect(conversationService.stopSession).not.toHaveBeenCalled()
      expect(conversationService.startSession).not.toHaveBeenCalled()
      expect(conversationService.sendInterrupt).not.toHaveBeenCalled()
      expect(committedInputs).toEqual([])
      expect(getSessionTurnState(sessionId)).toBe('running')
      expect(await getRuntimeSettings(sessionId)).toMatchObject({ cliRuntimeId: 'installed' })
      expect(launchInfo.cliRuntimeId).toBe('bundled')

      allowCommit.resolve()
      await firstCommitted.promise
      await flushMicrotasks()
      expect(committedInputs).toEqual(['Preparing input'])
      expect(getSessionTurnState(sessionId)).toBe('running')
      expect(conversationService.stopSession).not.toHaveBeenCalled()
      expect(conversationService.startSession).not.toHaveBeenCalled()

      emit({ type: 'result', subtype: 'success', is_error: false, result: 'Preparing input completed' })
      await drainTransitions()
      expect(getSessionTurnState(sessionId)).toBe('idle')
      expect(conversationService.stopSession).toHaveBeenCalledTimes(1)
      expect(conversationService.startSession).toHaveBeenCalledTimes(1)
      expect(conversationService.startSession).toHaveBeenLastCalledWith(
        sessionId, root, expect.stringContaining(`/sdk/${sessionId}`),
        expect.objectContaining({ cliRuntimeId: 'installed', providerId: 'provider-a', model: 'deepseek-v4-pro' }),
      )
      expect(launchInfo.cliRuntimeId).toBe('installed')
      expect(committedInputs).toEqual(['Preparing input'])

      handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: 'Fresh input' }))
      await freshCommitted.promise
      await flushMicrotasks()
      expect(sendMessage.mock.calls.map(call => call[1])).toEqual(['Preparing input', 'Fresh input'])
      expect(committedInputs).toEqual(['Preparing input', 'Fresh input'])
      expect(conversationService.startSession).toHaveBeenCalledTimes(1)
      expect(conversationService.sendInterrupt).not.toHaveBeenCalled()
      expect(lifecycle).toEqual(['send:Preparing input', 'stop', 'start', 'send:Fresh input'])
      expect(sent).not.toContainEqual(expect.objectContaining({ type: 'error' }))
    } finally {
      allowCommit.resolve()
      await flushMicrotasks()
    }
  })
})
