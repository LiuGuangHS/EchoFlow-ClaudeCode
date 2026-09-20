import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionListItem } from '../types/session'
import { useSessionRuntimeStore } from './sessionRuntimeStore'

const EXPECTED_GROK_SELECTION = {
  providerId: 'grok-official',
  modelId: 'grok-4.6',
  effortLevel: 'high',
}

describe('sessionRuntimeStore runtime cleanup', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionRuntimeStore.setState({
      selections: {},
      runtimeRequestStatusBySessionId: {},
    })
  })

  it('keeps an explicit model choice through stale, matching, then stale metadata refreshes', () => {
    const store = useSessionRuntimeStore.getState()
    const oldSession = {
      id: 'switch-session', runtimeProviderId: 'kimi', runtimeModelId: 'k3[1m]',
    } as SessionListItem
    store.syncFromSessions([oldSession])
    const next = { providerId: 'deepseek', modelId: 'deepseek-v4-flash' }
    store.setSelection(oldSession.id, next)
    const startedWith = useSessionRuntimeStore.getState().selections

    for (const metadata of [oldSession, {
      ...oldSession, runtimeProviderId: next.providerId, runtimeModelId: next.modelId,
    }, oldSession]) {
      store.syncFromSessions([metadata], startedWith)
      expect(useSessionRuntimeStore.getState().selections[oldSession.id]).toEqual(next)
      expect(JSON.parse(localStorage.getItem('echoflow-code-session-runtime')!)[oldSession.id]).toEqual(next)
    }
  })

  it('accepts later remote changes after confirmation but ignores pre-confirmation requests', () => {
    const store = useSessionRuntimeStore.getState()
    const next = { providerId: 'deepseek', modelId: 'deepseek-v4-flash' }
    store.setSelection('confirmed', next)
    const oldRequest = useSessionRuntimeStore.getState().selections
    store.settleSelection('confirmed')
    const remote = { id: 'confirmed', runtimeProviderId: 'kimi', runtimeModelId: 'k3' } as SessionListItem
    store.syncFromSessions([remote], oldRequest)
    expect(useSessionRuntimeStore.getState().selections.confirmed).toEqual(next)
    store.syncFromSessions([remote], useSessionRuntimeStore.getState().selections)
    expect(useSessionRuntimeStore.getState().selections.confirmed).toEqual({ providerId: 'kimi', modelId: 'k3' })
  })

  it('preserves a moved draft choice and releases local ownership when cleared', () => {
    const store = useSessionRuntimeStore.getState()
    const next = { providerId: 'deepseek', modelId: 'deepseek-v4-flash' }
    const metadata = {
      id: 'new-session', runtimeProviderId: 'kimi', runtimeModelId: 'k3',
    } as SessionListItem
    store.setSelection('__draft__', next)
    store.moveSelection('__draft__', metadata.id)
    store.syncFromSessions([metadata])
    expect(useSessionRuntimeStore.getState().selections[metadata.id]).toEqual(next)
    store.clearSelection(metadata.id)
    store.syncFromSessions([metadata])
    expect(useSessionRuntimeStore.getState().selections[metadata.id]).toEqual({ providerId: 'kimi', modelId: 'k3' })
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

  it('preserves a custom-provider xhigh selection loaded from localStorage', async () => {
    const expectedSelection = {
      providerId: 'kimi-provider',
      modelId: 'k3',
      effortLevel: 'xhigh',
    }
    localStorage.setItem('echoflow-code-session-runtime', JSON.stringify({
      'session-loaded-kimi': expectedSelection,
    }))
    vi.resetModules()

    const { useSessionRuntimeStore: loadedStore } = await import('./sessionRuntimeStore')

    expect(loadedStore.getState().selections['session-loaded-kimi']).toEqual(
      expectedSelection,
    )
    expect(JSON.parse(localStorage.getItem('echoflow-code-session-runtime')!)).toEqual({
      'session-loaded-kimi': expectedSelection,
    })
  })

  it('drops only the legacy Claude Official opus[1m] default and preserves the same suffix for third-party providers', async () => {
    localStorage.setItem('echoflow-code-session-runtime', JSON.stringify({
      'session-loaded-claude': {
        providerId: null,
        modelId: 'opus[1m]',
        effortLevel: 'max',
      },
      'session-loaded-minimax': {
        providerId: 'provider-minimax',
        modelId: 'MiniMax-M3[1m]',
        effortLevel: 'max',
      },
    }))
    vi.resetModules()

    const { useSessionRuntimeStore: loadedStore } = await import('./sessionRuntimeStore')

    expect(loadedStore.getState().selections['session-loaded-claude']).toBeUndefined()
    expect(loadedStore.getState().selections['session-loaded-minimax']).toEqual({
      providerId: 'provider-minimax',
      modelId: 'MiniMax-M3[1m]',
      effortLevel: 'max',
    })
    expect(JSON.parse(localStorage.getItem('echoflow-code-session-runtime')!)).toEqual({
      'session-loaded-minimax': {
        providerId: 'provider-minimax',
        modelId: 'MiniMax-M3[1m]',
        effortLevel: 'max',
      },
    })
  })

  it('does not restore a legacy Claude Official default from old session metadata', () => {
    useSessionRuntimeStore.getState().syncFromSessions([{
      id: 'legacy-claude-session',
      runtimeProviderId: null,
      runtimeModelId: 'opus[1m]',
      effortLevel: 'max',
    } as SessionListItem])

    expect(useSessionRuntimeStore.getState().selections['legacy-claude-session']).toBeUndefined()
  })
})
