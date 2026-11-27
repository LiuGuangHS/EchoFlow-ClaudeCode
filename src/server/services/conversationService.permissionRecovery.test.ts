import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as questionDecision from './autoQuestionDecisionService.js'
import { ConversationService } from './conversationService.js'
import { sessionService } from './sessionService.js'
import { SettingsService } from './settingsService.js'

let home: string
let originalEnv: NodeJS.ProcessEnv
beforeEach(async () => {
  originalEnv = { ...process.env }
  home = await mkdtemp(join(tmpdir(), 'permission-recovery-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.CLAUDE_CONFIG_DIR = home
})
afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  await rm(home, { recursive: true, force: true })
})

function createPendingService(send?: (line: string) => void) {
  const service = new ConversationService()
  const request = { toolName: 'Read', input: { file_path: '/fixture' } }
  const session = {
    sdkSocket: send ? { send } : null,
    pendingOutbound: [] as string[],
    pendingPermissionRequests: new Map([['req-1', request]]),
    sdkMessages: [],
    outputCallbacks: [],
  }
  ;(service as any).sessions.set('session-1', session)
  return { service, session, request }
}

const permissionPayload = JSON.stringify({
  type: 'control_request', request_id: 'req-1',
  request: { subtype: 'can_use_tool', tool_name: 'Read', input: { file_path: '/fixture' } },
})

for (const received of [false, true]) {
  test(`retains owner evidence when send throws ${received ? 'after receipt' : 'before receipt'} and never resubmits`, () => {
    let sends = 0
    const consumed: unknown[] = []
    const { service, session, request } = createPendingService(line => {
      sends++
      if (received) consumed.push(JSON.parse(line))
      throw new Error('fixture socket send failed')
    })
    expect(() => service.respondToPermission('session-1', 'req-1', true)).toThrow('fixture socket send failed')
    expect(session.pendingPermissionRequests.get('req-1')).toBe(request)
    expect(service.getPendingPermissionRequests('session-1')).toEqual([
      { requestId: 'req-1', toolName: 'Read', input: { file_path: '/fixture' } },
    ])
    expect(() => service.respondToPermission('session-1', 'req-1', false)).toThrow('outcome is uncertain')
    expect(sends).toBe(1)
    expect(consumed).toHaveLength(received ? 1 : 0)
    expect(session.pendingOutbound).toEqual([])
  })
}

test('SDK request replay cannot replace unresolved evidence or unlock resubmission', () => {
  let sends = 0
  const { service, session, request } = createPendingService(() => {
    sends++
    throw new Error('fixture send failed')
  })
  expect(() => service.respondToPermission('session-1', 'req-1', true)).toThrow()
  service.handleSdkPayload('session-1', permissionPayload)
  expect(session.pendingPermissionRequests.get('req-1')).toBe(request)
  expect(() => service.respondToPermission('session-1', 'req-1', true)).toThrow('outcome is uncertain')
  expect(sends).toBe(1)
})

test('worker parent and direct responses share the same uncertain owner', () => {
  let sends = 0
  let parentSends = 0
  const { service, session } = createPendingService(() => { parentSends++ })
  const child = {
    ...session,
    teamWorker: { parentSessionId: 'session-1', teamName: 'fixture', name: 'reader' },
    sdkSocket: { send() { sends++; throw new Error('worker send failed') } },
  }
  session.pendingPermissionRequests = new Map()
  ;(service as any).sessions.set('worker', child)
  expect(() => service.respondToPermission('session-1', 'req-1', true)).toThrow('worker send failed')
  expect(service.getPendingPermissionRequests('session-1')).toHaveLength(1)
  expect(() => service.respondToPermission('worker', 'req-1', true)).toThrow('outcome is uncertain')
  expect(() => service.respondToPermission('session-1', 'req-1', false)).toThrow('outcome is uncertain')
  expect(sends).toBe(1)
  expect(parentSends).toBe(0)
})

test('claims the owner before abort listeners or socket callbacks can submit again', () => {
  let sends = 0
  const { service, request } = createPendingService(() => {
    sends++
    expect(() => service.respondToPermission('session-1', 'req-1', false)).toThrow('outcome is uncertain')
  })
  const controller = new AbortController()
  let abortResult: unknown
  controller.signal.addEventListener('abort', () => {
    try { abortResult = service.respondToPermission('session-1', 'req-1', false) }
    catch (error) { abortResult = error }
  })
  Object.assign(request, { autoAnswerAbortController: controller })
  expect(service.respondToPermission('session-1', 'req-1', true)).toBe(true)
  expect(abortResult).toBeInstanceOf(Error)
  expect(sends).toBe(1)
})

test('successful responses clear pending and cannot be replayed or submitted again', () => {
  const sent: unknown[] = []
  const { service } = createPendingService(line => sent.push(JSON.parse(line)))
  expect(service.respondToPermission('session-1', 'req-1', true)).toBe(true)
  expect(service.getPendingPermissionRequests('session-1')).toEqual([])
  service.handleSdkPayload('session-1', permissionPayload)
  expect(service.getPendingPermissionRequests('session-1')).toEqual([])
  expect(service.respondToPermission('session-1', 'req-1', false)).toBe(false)
  expect(sent).toHaveLength(1)
})

test('queued acceptance clears pending and delivers only once when the socket attaches', () => {
  const { service, session } = createPendingService()
  expect(service.respondToPermission('session-1', 'req-1', true)).toBe(true)
  expect(service.getPendingPermissionRequests('session-1')).toEqual([])
  expect(session.pendingOutbound).toHaveLength(1)
  expect(service.respondToPermission('session-1', 'req-1', false)).toBe(false)
  const sent: string[] = []
  expect(service.attachSdkConnection('session-1', { send: line => { sent.push(line) } })).toBe(true)
  expect(sent).toHaveLength(1)
  expect(JSON.parse(sent[0]!).response.response.behavior).toBe('allow')
  expect(session.pendingOutbound).toEqual([])
})

test('completed worker responses do not fall through to the parent on duplicates', () => {
  let sends = 0
  const { service, session } = createPendingService(() => { sends++ })
  ;(service as any).sessions.set('worker', {
    ...session,
    teamWorker: { parentSessionId: 'session-1', teamName: 'fixture', name: 'reader' },
  })
  session.pendingPermissionRequests = new Map()
  expect(service.respondToPermission('session-1', 'req-1', true)).toBe(true)
  expect(service.respondToPermission('session-1', 'req-1', false)).toBe(false)
  expect(sends).toBe(1)
})

for (const terminal of [
  { type: 'control_cancel_request', request_id: 'req-1' },
  { type: 'control_response', request_id: 'req-1' },
  { type: 'control_response', response: { request_id: 'req-1' } },
]) {
  test(`authoritative ${JSON.stringify(terminal)} clears pending without unlocking sends`, () => {
    let sends = 0
    const { service } = createPendingService(() => { sends++; throw new Error('fixture send failed') })
    expect(() => service.respondToPermission('session-1', 'req-1', true)).toThrow()
    service.handleSdkPayload('session-1', JSON.stringify(terminal))
    expect(service.getPendingPermissionRequests('session-1')).toEqual([])
    service.handleSdkPayload('session-1', permissionPayload)
    expect(service.getPendingPermissionRequests('session-1')).toEqual([])
    expect(service.respondToPermission('session-1', 'req-1', true)).toBe(false)
    expect(sends).toBe(1)
  })
}

test('Stop rejects an unregistered request once without creating replayable pending state', () => {
  const sent: any[] = []
  const { service, session } = createPendingService(line => { sent.push(JSON.parse(line)) })
  session.pendingPermissionRequests.clear()
  for (let i = 0; i < 2; i++) {
    service.handleSdkPayload('session-1', permissionPayload, { canAcceptPermissionRequest: () => false })
  }
  expect(sent).toHaveLength(1)
  expect(sent[0].response.response.behavior).toBe('deny')
  expect(service.getPendingPermissionRequests('session-1')).toEqual([])
  expect(session.sdkMessages).toEqual([])
})

test('missing sessions still return false', () => {
  expect(new ConversationService().respondToPermission('missing', 'req-1', true)).toBe(false)
})

test('uncertain automatic answers retain pending without repeating model decisions or losing their marker', async () => {
  const settings = spyOn(SettingsService.prototype, 'getUserSettings').mockResolvedValue({ autoQuestion: { enabled: true, timeoutMinutes: 1 } } as never)
  const history = spyOn(sessionService, 'getSessionHistoryPage').mockResolvedValue({ messages: [{ type: 'user', content: 'Choose local scope.' }] } as never)
  const launch = spyOn(sessionService, 'getSessionLaunchInfo').mockResolvedValue(null)
  const decision = spyOn(questionDecision, 'decideAutoQuestionAnswers').mockResolvedValue({ Scope: 'Local' })
  const warning = spyOn(console, 'warn').mockImplementation(() => {})
  const sent: any[] = []
  const { service, session, request } = createPendingService(line => {
    sent.push(JSON.parse(line))
    throw new Error('fixture send failed after receipt')
  })
  Object.assign(request, {
    toolName: 'AskUserQuestion',
    input: { questions: [{ question: 'Scope', options: [{ label: 'Local', description: 'Local scope' }, { label: 'Global', description: 'Global scope' }] }], metadata: { source: 'fixture' } },
  })
  try {
    await (service as any).autoAnswerQuestion('session-1', session, 'req-1', request)
    expect(service.getPendingPermissionRequests('session-1')).toHaveLength(1)
    expect(sent[0].response.response.updatedInput.metadata).toEqual({ source: 'fixture', autoAnswered: true })
    service.refreshAutoQuestionSettings()
    await (service as any).scheduleAutoQuestionAnswer('session-1', session, 'req-1', request)
    await (service as any).autoAnswerQuestion('session-1', session, 'req-1', request)
    expect((request as any).autoAnswerTimer).toBeUndefined()
    expect(decision).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(1)
  } finally {
    ;(service as any).clearAutoAnswerWait(request)
    settings.mockRestore()
    history.mockRestore()
    launch.mockRestore()
    decision.mockRestore()
    warning.mockRestore()
  }
})
