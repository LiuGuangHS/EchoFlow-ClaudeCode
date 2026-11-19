import { describe, expect, it, mock } from 'bun:test'
import { submitImPermissionDecision, syncImPermissionState } from '../permission-sync.js'

function harness() {
  const runtime = { state: 'permission_pending' as 'idle' | 'thinking' | 'streaming' | 'tool_executing' | 'permission_pending', pendingPermissionCount: 2 }
  const pending = new Map([['chat', new Set(['first', 'second'])], ['other', new Set(['unrelated'])]])
  return { runtime, pending }
}

describe('IM approval reconciliation for restored sessions (#1286)', () => {
  it('removes approvals answered in Desktop, without decrementing twice', () => {
    const { runtime, pending } = harness()
    const resolved = { type: 'permission_resolved', permissionType: 'tool', requestId: 'first' }
    expect(syncImPermissionState('chat', resolved, runtime, pending)).toBe(true)
    expect([...pending.get('chat')!]).toEqual(['second'])
    expect(runtime).toEqual({ state: 'permission_pending', pendingPermissionCount: 1 })
    syncImPermissionState('chat', resolved, runtime, pending)
    expect(runtime.pendingPermissionCount).toBe(1)

    syncImPermissionState('chat', { ...resolved, requestId: 'second' }, runtime, pending)
    expect(runtime).toEqual({ state: 'thinking', pendingPermissionCount: 0 })
    expect(pending.has('chat')).toBe(false)
    expect([...pending.get('other')!]).toEqual(['unrelated'])
  })

  it('keeps tool approvals intact when computer-use approval IDs overlap', () => {
    const { runtime, pending } = harness()
    syncImPermissionState('chat', { type: 'permission_resolved', permissionType: 'computer_use', requestId: 'first' }, runtime, pending)
    expect([...pending.get('chat')!]).toEqual(['first', 'second'])
    expect(runtime.pendingPermissionCount).toBe(2)
  })

  it('uses the reconnect snapshot to remove stale approvals and deduplicate replay', () => {
    const { runtime, pending } = harness()
    runtime.pendingPermissionCount = 9
    syncImPermissionState('chat', { type: 'permission_requests_snapshot', toolRequestIds: ['second', 'second', 'new'], turnActive: true }, runtime, pending)
    expect([...pending.get('chat')!]).toEqual(['second', 'new'])
    expect(runtime).toEqual({ state: 'permission_pending', pendingPermissionCount: 2 })
  })

  it('unblocks switching after a disconnected approval was resolved and the turn finished', () => {
    const { runtime, pending } = harness()
    syncImPermissionState('chat', { type: 'permission_requests_snapshot', toolRequestIds: [], turnActive: false }, runtime, pending)
    expect(runtime).toEqual({ state: 'idle', pendingPermissionCount: 0 })
    expect(pending.has('chat')).toBe(false)
  })

  it('keeps a continuing turn busy after its last approval disappears', () => {
    const { runtime, pending } = harness()
    syncImPermissionState('chat', { type: 'permission_requests_snapshot', toolRequestIds: [], turnActive: true }, runtime, pending)
    expect(runtime).toEqual({ state: 'thinking', pendingPermissionCount: 0 })
    runtime.state = 'streaming'
    syncImPermissionState('chat', { type: 'permission_requests_snapshot', toolRequestIds: [], turnActive: true }, runtime, pending)
    expect(runtime.state).toBe('streaming')
  })

  it('preserves approvals when an older snapshot only reports turn activity', () => {
    const { runtime, pending } = harness()
    syncImPermissionState('chat', { type: 'permission_requests_snapshot', turnActive: true }, runtime, pending)
    expect(runtime).toEqual({ state: 'permission_pending', pendingPermissionCount: 2 })
  })

  it('never coerces an invalid authoritative array into an empty pending set', () => {
    const { runtime, pending } = harness()
    syncImPermissionState('chat', { type: 'permission_requests_snapshot', toolRequestIds: [null], turnActive: false }, runtime, pending)
    expect([...pending.get('chat')!]).toEqual(['first', 'second'])
    expect(runtime.pendingPermissionCount).toBe(2)
  })

  it('only unlocks a matching rejected tool decision; uncertain asks its owner and stays locked', () => {
    const { runtime, pending } = harness()
    const submittingPermissions = new Map([['chat', new Set(['first'])], ['other', new Set(['first'])]])
    const requestSyncState = mock(() => true)
    const options = { submittingPermissions, requestSyncState }
    const error = { type: 'error', code: 'FIXTURE', message: 'fixture', permissionType: 'tool', requestId: 'first', approvalOutcome: 'rejected' }
    for (const message of [{ ...error, requestId: 'second' }, { ...error, permissionType: 'computer_use' }, { ...error, approvalOutcome: undefined }]) {
      expect(syncImPermissionState('chat', message, runtime, pending, options)).toBe(true)
      expect(submittingPermissions.get('chat')?.has('first')).toBe(true)
    }
    syncImPermissionState('chat', { ...error, approvalOutcome: 'uncertain' }, runtime, pending, options)
    expect(requestSyncState).toHaveBeenCalledWith('chat')
    expect(submittingPermissions.get('chat')?.has('first')).toBe(true)
    syncImPermissionState('chat', error, runtime, pending, options)
    expect(submittingPermissions.has('chat')).toBe(false)
    expect(submittingPermissions.get('other')?.has('first')).toBe(true)
    expect(pending.get('chat')?.has('first')).toBe(true)
    expect(runtime.pendingPermissionCount).toBe(2)
  })

  it('settles each pending or submitting ID once, only from a valid explicit tool snapshot', () => {
    const { runtime, pending } = harness()
    const submittingPermissions = new Map([['chat', new Set(['first', 'submitting-only'])]])
    const onSettled = mock(() => {})
    const options = { submittingPermissions, requestSyncState: () => true, onSettled }
    for (const message of [
      { type: 'permission_resolved', permissionType: 'computer_use', requestId: 'first' },
      { type: 'permission_requests_snapshot', computerUseRequestIds: [], turnActive: false },
      { type: 'permission_requests_snapshot', toolRequestIds: [null], turnActive: false },
      { type: 'permission_requests_snapshot', toolRequestIds: [], computerUseRequestIds: [1], turnActive: false },
      { type: 'permission_requests_snapshot', toolRequestIds: [] },
    ]) {
      syncImPermissionState('chat', message, runtime, pending, options)
      expect(onSettled).not.toHaveBeenCalled()
      expect(submittingPermissions.get('chat')?.size).toBe(2)
      expect(runtime.pendingPermissionCount).toBe(2)
    }
    const snapshot = { type: 'permission_requests_snapshot', toolRequestIds: ['second'], turnActive: true }
    syncImPermissionState('chat', snapshot, runtime, pending, options)
    expect(onSettled.mock.calls).toEqual([['first'], ['submitting-only']])
    expect(submittingPermissions.has('chat')).toBe(false)
    syncImPermissionState('chat', snapshot, runtime, pending, options)
    syncImPermissionState('chat', { type: 'permission_resolved', permissionType: 'tool', requestId: 'first' }, runtime, pending, options)
    expect(onSettled).toHaveBeenCalledTimes(2)
    expect(runtime.pendingPermissionCount).toBe(1)
  })

  it('retains pending on send false, locks before send, and never treats throw as a retry permit', () => {
    const pending = new Set(['first'])
    const submitting = new Map<string, Set<string>>()
    const decision = { requestId: 'first', allowed: false }
    const transport = { sendPermissionResponse: mock(() => false), requestSyncState: mock(() => { throw new Error('sync disconnected') }) }
    expect(submitImPermissionDecision('chat', decision, pending, submitting, transport)).toBe('send_failed')
    expect(submitting.size).toBe(0)
    expect(pending.has('first')).toBe(true)
    transport.sendPermissionResponse.mockImplementation(() => {
      expect(submitting.get('chat')?.has('first')).toBe(true)
      throw new Error('send acceptance unknown')
    })
    expect(submitImPermissionDecision('chat', decision, pending, submitting, transport)).toBe('uncertain')
    expect(transport.requestSyncState).toHaveBeenCalledWith('chat')
    expect(submitImPermissionDecision('chat', decision, pending, submitting, transport)).toBe('submitting')
    expect(transport.sendPermissionResponse).toHaveBeenCalledTimes(2)
    expect(pending.has('first')).toBe(true)
  })

  it('leaves unrelated event routing and late duplicate resolutions unchanged', () => {
    const runtime = { state: 'idle' as const, pendingPermissionCount: 0 }
    const pending = new Map<string, Set<string>>()
    expect(syncImPermissionState('chat', { type: 'content_delta', text: 'hello' }, runtime, pending)).toBe(false)
    syncImPermissionState('chat', { type: 'permission_resolved', permissionType: 'tool', requestId: 'already-done' }, runtime, pending)
    expect(runtime).toEqual({ state: 'idle', pendingPermissionCount: 0 })
  })
})
