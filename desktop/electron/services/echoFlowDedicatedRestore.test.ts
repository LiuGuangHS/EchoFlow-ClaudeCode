import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readStoredDedicatedCredentialWith, type DedicatedContents } from './echoFlowDedicatedRestore'

const ORIGIN = 'https://expapi.echoflowai.cc'
const SNAPSHOT = {
  token: 'dedicated-access-token',
  user: JSON.stringify({ id: 7, username: 'gateway-user' }),
  expiresAt: null,
}
const CREDENTIAL = {
  kind: 'bearer',
  userId: '7',
  username: 'gateway-user',
  accessToken: 'dedicated-access-token',
}

function makeContents() {
  const contents = Object.assign(new EventEmitter(), {
    loadURL: vi.fn(async () => {}),
    getURL: vi.fn(() => `${ORIGIN}/`),
    executeJavaScript: vi.fn<() => Promise<unknown>>(async () => SNAPSHOT),
    isDestroyed: () => false,
    close: vi.fn(),
  })
  return contents satisfies DedicatedContents
}

function expectCleanup(contents: ReturnType<typeof makeContents>) {
  expect(contents.close).toHaveBeenCalledOnce()
  expect(contents.eventNames()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
}

describe('dedicated credential restoration', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reads persisted storage when loadURL reports readiness', async () => {
    const contents = makeContents()
    await expect(readStoredDedicatedCredentialWith(contents, ORIGIN)).resolves.toEqual(CREDENTIAL)
    expect(contents.loadURL).toHaveBeenCalledWith(ORIGIN)
    expectCleanup(contents)
  })

  it('accepts did-finish-load and ignores a subframe load failure', async () => {
    const contents = makeContents()
    contents.loadURL.mockImplementation(() => new Promise(() => {}))
    const restore = readStoredDedicatedCredentialWith(contents, ORIGIN)

    contents.emit('did-fail-load', {}, -2, 'ERR_FAILED', `${ORIGIN}/iframe`, false)
    contents.emit('did-finish-load')

    await expect(restore).resolves.toEqual(CREDENTIAL)
    expectCleanup(contents)
  })

  it('returns no credential when the partition is signed out', async () => {
    const contents = makeContents()
    contents.executeJavaScript.mockResolvedValue({ token: null, user: null, expiresAt: null })
    const restore = readStoredDedicatedCredentialWith(contents, ORIGIN)
    contents.emit('did-finish-load')

    await expect(restore).resolves.toBeNull()
    expectCleanup(contents)
  })

  it('cleans up on main-frame navigation failure', async () => {
    const contents = makeContents()
    contents.loadURL.mockImplementation(() => new Promise(() => {}))
    const restore = readStoredDedicatedCredentialWith(contents, ORIGIN)

    contents.emit('did-fail-load', {}, -2, 'ERR_FAILED', ORIGIN, true)

    await expect(restore).resolves.toBeNull()
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
    expectCleanup(contents)
  })

  it('times out hung navigation and ignores late completion', async () => {
    const contents = makeContents()
    let finishNavigation!: () => void
    contents.loadURL.mockImplementation(() => new Promise(resolve => { finishNavigation = resolve }))
    const restore = readStoredDedicatedCredentialWith(contents, ORIGIN)

    vi.advanceTimersByTime(15_000)

    await expect(restore).resolves.toBeNull()
    expectCleanup(contents)
    finishNavigation()
    contents.emit('did-finish-load')
    await Promise.resolve()
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('gives a hung credential read only the time remaining after navigation', async () => {
    const contents = makeContents()
    let finishRead!: (value: unknown) => void
    contents.loadURL.mockImplementation(() => new Promise(resolve => setTimeout(() => {
      contents.emit('did-finish-load')
      resolve()
    }, 10_000)))
    const reading = new Promise<void>(started => {
      contents.executeJavaScript.mockImplementation(() => new Promise(resolve => {
        finishRead = resolve
        started()
      }))
    })
    const restore = readStoredDedicatedCredentialWith(contents, ORIGIN)

    vi.advanceTimersByTime(10_000)
    await reading
    expect(contents.close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5_000)

    await expect(restore).resolves.toBeNull()
    expectCleanup(contents)
    finishRead(SNAPSHOT)
    await Promise.resolve()
    expectCleanup(contents)
  })

  it('closes without navigating when cancellation has already happened', async () => {
    const contents = makeContents()

    await expect(readStoredDedicatedCredentialWith(contents, ORIGIN, AbortSignal.abort())).resolves.toBeNull()
    expect(contents.loadURL).not.toHaveBeenCalled()
    expectCleanup(contents)
  })

  it('closes a running restore on cancellation and removes the abort listener', async () => {
    const contents = makeContents()
    contents.loadURL.mockImplementation(() => new Promise(() => {}))
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')
    const restore = readStoredDedicatedCredentialWith(contents, ORIGIN, controller.signal)

    controller.abort()

    await expect(restore).resolves.toBeNull()
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
    expectCleanup(contents)
  })
})
