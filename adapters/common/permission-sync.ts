import type { PermissionDecision } from './permission.js'
import type { ServerMessage } from './ws-bridge.js'

type PermissionRuntimeState = {
  state: 'idle' | 'thinking' | 'streaming' | 'tool_executing' | 'permission_pending'
  pendingPermissionCount: number
}

type PermissionTransport = {
  sendPermissionResponse: (chatId: string, requestId: string, allowed: boolean, rule?: string) => boolean
  requestSyncState?: (chatId: string) => boolean
}

export type ImPermissionSubmissionResult = 'sent' | 'submitting' | 'not_pending' | 'send_failed' | 'uncertain'

function requestOwnerSync(chatId: string, transport: Pick<PermissionTransport, 'requestSyncState'>): void {
  try { transport.requestSyncState?.(chatId) } catch { /* Keep the lock until an authoritative owner update. */ }
}

/** Transport acceptance is not owner resolution; text and callbacks share this lock. */
export function submitImPermissionDecision(
  chatId: string,
  decision: PermissionDecision,
  pendingRequestIds: Set<string> | undefined,
  submittingPermissions: Map<string, Set<string>>,
  transport: PermissionTransport,
): ImPermissionSubmissionResult {
  if (!pendingRequestIds?.has(decision.requestId)) return 'not_pending'
  if (submittingPermissions.get(chatId)?.has(decision.requestId)) return 'submitting'
  const submitting = submittingPermissions.get(chatId) ?? new Set<string>()
  submitting.add(decision.requestId)
  submittingPermissions.set(chatId, submitting)
  try {
    if (transport.sendPermissionResponse(chatId, decision.requestId, decision.allowed, decision.rule)) return 'sent'
    submitting.delete(decision.requestId)
    if (!submitting.size) submittingPermissions.delete(chatId)
    return 'send_failed'
  } catch {
    // A throwing transport may already have delivered the decision. Never replay it.
    requestOwnerSync(chatId, transport)
    return 'uncertain'
  }
}

export function formatImPermissionSubmissionNotice(result: ImPermissionSubmissionResult, requestId: string): string {
  if (result === 'not_pending') return `未找到待确认的权限请求：${requestId}`
  if (result === 'send_failed') return '权限响应发送失败，请检查会话状态。'
  if (result === 'uncertain') return '权限响应接收状态不确定，等待服务端确认。'
  if (result === 'submitting') return '权限响应正在等待服务端确认，请勿重复提交。'
  return '权限响应已发送，等待服务端确认。'
}

type PermissionSyncOptions = {
  submittingPermissions: Map<string, Set<string>>
  requestSyncState: (chatId: string) => boolean
  onSettled?: (requestId: string) => void
}

/** Reconcile approvals handled by another client or while this IM was offline. */
export function syncImPermissionState(
  chatId: string,
  message: ServerMessage,
  runtime: PermissionRuntimeState,
  pendingPermissions: Map<string, Set<string>>,
  options?: PermissionSyncOptions,
): boolean {
  const submitting = options?.submittingPermissions.get(chatId)
  const settle = (requestId: string) => {
    const wasPending = pendingPermissions.get(chatId)?.delete(requestId)
    const wasSubmitting = submitting?.delete(requestId)
    if (wasPending || wasSubmitting) options?.onSettled?.(requestId)
    if (!submitting?.size) options?.submittingPermissions.delete(chatId)
  }

  if (options && message.type === 'error' && typeof message.requestId === 'string' &&
    (message.permissionType === 'tool' || message.permissionType === 'computer_use')) {
    if (message.permissionType === 'tool' &&
      (pendingPermissions.get(chatId)?.has(message.requestId) || submitting?.has(message.requestId))) {
      if (message.approvalOutcome === 'rejected') {
        submitting?.delete(message.requestId)
        if (!submitting?.size) options.submittingPermissions.delete(chatId)
      } else if (message.approvalOutcome === 'uncertain') {
        const locked = submitting ?? new Set<string>()
        locked.add(message.requestId)
        options.submittingPermissions.set(chatId, locked)
        requestOwnerSync(chatId, options)
      }
    }
    return true
  }

  if (message.type === 'permission_resolved') {
    if (message.permissionType !== 'tool' || typeof message.requestId !== 'string' || !message.requestId) return true
    settle(message.requestId)
    runtime.pendingPermissionCount = pendingPermissions.get(chatId)?.size ?? 0
    if (!runtime.pendingPermissionCount) {
      pendingPermissions.delete(chatId)
      if (runtime.state === 'permission_pending') runtime.state = 'thinking'
    }
    return true
  }

  if (message.type !== 'permission_requests_snapshot') return false
  // Partial snapshots carry turn activity, but only valid explicit tool IDs can settle tools.
  if (typeof message.turnActive !== 'boolean' || !['toolRequestIds', 'computerUseRequestIds'].every(key =>
    message[key] === undefined || (Array.isArray(message[key]) &&
      message[key].every((id: unknown) => typeof id === 'string' && id.length > 0)),
  )) return true
  if (Array.isArray(message.toolRequestIds)) {
    const pending = new Set<string>(message.toolRequestIds)
    for (const id of new Set([...(pendingPermissions.get(chatId) ?? []), ...(submitting ?? [])])) {
      if (!pending.has(id)) settle(id)
    }
    if (pending.size) pendingPermissions.set(chatId, pending)
    else pendingPermissions.delete(chatId)
  }
  runtime.pendingPermissionCount = pendingPermissions.get(chatId)?.size ?? 0
  if (runtime.pendingPermissionCount) {
    runtime.state = 'permission_pending'
  } else if (!message.turnActive) {
    runtime.state = 'idle'
  } else if (runtime.state === 'idle' || runtime.state === 'permission_pending') {
    runtime.state = 'thinking'
  }
  return true
}
