import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionListItem } from '../types/session'
import { useSessionRuntimeStore } from './sessionRuntimeStore'

const EXPECTED_GROK_SELECTION = {
  providerId: 'grok-official',
  modelId: 'grok-4.5',
  effortLevel: 'high',
}

describe('sessionRuntimeStore Grok runtime cleanup', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionRuntimeStore.setState({
      selections: {},
      runtimeRequestStatusBySessionId: {},
    })
  })

  it('discards retired Grok selections before persisting them', () => {
    useSessionRuntimeStore.getState().setSelection('session-grok', {
      providerId: 'grok-official',
      modelId: 'grok-build',
      effortLevel: 'max',
    })

    expect(useSessionRuntimeStore.getState().selections['session-grok']).toEqual(
      EXPECTED_GROK_SELECTION,
    )
    expect(JSON.parse(localStorage.getItem('echoflow-code-session-runtime')!)).toEqual({
      'session-grok': EXPECTED_GROK_SELECTION,
    })
  })

  it('does not let retired Grok session metadata restore the removed model', () => {
    useSessionRuntimeStore.getState().syncFromSessions([{
      id: 'session-restored-grok',
      runtimeProviderId: 'grok-official',
      runtimeModelId: 'grok-build',
      effortLevel: 'max',
    } as SessionListItem])

    expect(useSessionRuntimeStore.getState().selections['session-restored-grok']).toEqual(
      EXPECTED_GROK_SELECTION,
    )
  })

  it('cleans a retired Grok selection loaded from localStorage', async () => {
    localStorage.setItem('echoflow-code-session-runtime', JSON.stringify({
      'session-loaded-grok': {
        providerId: 'grok-official',
        modelId: 'grok-build',
        effortLevel: 'max',
      },
    }))
    vi.resetModules()

    const { useSessionRuntimeStore: loadedStore } = await import('./sessionRuntimeStore')

    expect(loadedStore.getState().selections['session-loaded-grok']).toEqual(
      EXPECTED_GROK_SELECTION,
    )
    expect(JSON.parse(localStorage.getItem('echoflow-code-session-runtime')!)).toEqual({
      'session-loaded-grok': EXPECTED_GROK_SELECTION,
    })
  })

  it('does not transfer request status when moving a selection to a new session', () => {
    const store = useSessionRuntimeStore.getState()
    store.setSelection('old-session', {
      providerId: 'provider-a',
      modelId: 'model-a',
    })
    store.markRequestPending('old-session')

    store.moveSelection('old-session', 'new-session')

    expect(useSessionRuntimeStore.getState().selections).toEqual({
      'new-session': { providerId: 'provider-a', modelId: 'model-a' },
    })
    expect(useSessionRuntimeStore.getState().runtimeRequestStatusBySessionId).toEqual({})
  })

  it('clears request status when moving a session without a persisted selection', () => {
    const store = useSessionRuntimeStore.getState()
    store.markRequestPending('old-session')

    store.moveSelection('old-session', 'new-session')

    expect(useSessionRuntimeStore.getState().selections).toEqual({})
    expect(useSessionRuntimeStore.getState().runtimeRequestStatusBySessionId).toEqual({})
  })

  it('keeps runtime request state when session metadata reconciles configured selection', () => {
    const store = useSessionRuntimeStore.getState()
    store.markRequestPending('session-pending')
    store.markRequestPending('session-failed')
    store.markRequestFailed('session-failed')

    store.syncFromSessions([
      {
        id: 'session-pending',
        runtimeProviderId: 'provider-b',
        runtimeModelId: 'model-b',
      } as SessionListItem,
      {
        id: 'session-failed',
        runtimeProviderId: null,
        runtimeModelId: 'model-a',
      } as SessionListItem,
    ])

    expect(useSessionRuntimeStore.getState().selections).toMatchObject({
      'session-pending': { providerId: 'provider-b', modelId: 'model-b' },
      'session-failed': { providerId: null, modelId: 'model-a' },
    })
    expect(useSessionRuntimeStore.getState().runtimeRequestStatusBySessionId).toEqual({
      'session-pending': 'pending',
      'session-failed': 'failed',
    })
  })
})
