import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionCliRuntimeStore } from './sessionCliRuntimeStore'

describe('session CLI runtime store', () => {
  beforeEach(() => {
    useSessionCliRuntimeStore.setState({
      effectiveBySessionId: {},
      requestedBySessionId: {},
      statusBySessionId: {},
    })
  })

  it('keeps requested and effective runtime separate until applied', () => {
    const store = useSessionCliRuntimeStore.getState()
    store.apply('session-1', 'bundled')
    store.request('session-1', 'installed')

    expect(useSessionCliRuntimeStore.getState()).toMatchObject({
      effectiveBySessionId: { 'session-1': 'bundled' },
      requestedBySessionId: { 'session-1': 'installed' },
      statusBySessionId: { 'session-1': 'pending' },
    })
  })

  it('accepts only the matching applied runtime as confirmation', () => {
    const store = useSessionCliRuntimeStore.getState()
    store.apply('session-1', 'bundled')
    store.request('session-1', 'installed')
    store.apply('session-1', 'bundled')

    expect(useSessionCliRuntimeStore.getState().statusBySessionId['session-1']).toBe('pending')
    store.apply('session-1', 'installed')
    expect(useSessionCliRuntimeStore.getState()).toMatchObject({
      effectiveBySessionId: { 'session-1': 'installed' },
      requestedBySessionId: { 'session-1': 'installed' },
      statusBySessionId: { 'session-1': 'applied' },
    })
  })

  it('marks runtime requests failed without changing effective state', () => {
    const store = useSessionCliRuntimeStore.getState()
    store.apply('session-1', 'bundled')
    store.request('session-1', 'installed')
    store.fail('session-1')

    expect(useSessionCliRuntimeStore.getState()).toMatchObject({
      effectiveBySessionId: { 'session-1': 'bundled' },
      requestedBySessionId: { 'session-1': 'installed' },
      statusBySessionId: { 'session-1': 'failed' },
    })
  })
})
