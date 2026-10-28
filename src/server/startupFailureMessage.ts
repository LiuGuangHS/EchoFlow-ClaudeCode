/**
 * Bun 1.3.14 reports every listen() failure as EADDRINUSE with errno 0, no
 * cause, and a message blaming a port conflict — even when the port was
 * kernel-assigned (0), where "in use" cannot be true. The message we build
 * keeps the familiar hint for requested ports (diagnostics anchor on it) but
 * never repeats that claim for port 0, and always carries the raw bind fields
 * so the next incident can identify its own trigger.
 */

const BIND_HINT = /^Failed to start server\. Is port \d+ in use\?$/

export function buildStartupFailureMessage(error: unknown, host: string, port: number): string {
  const fields = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = typeof fields.code === 'string' ? fields.code : 'none'
  const errno = typeof fields.errno === 'number' ? String(fields.errno) : 'none'
  const syscall = typeof fields.syscall === 'string' ? fields.syscall : 'none'
  const asError = error instanceof Error ? error : undefined
  const rawMessage = asError?.message ?? (typeof error === 'string' ? error : '')
  // The bind hint is a fixed template emitted for every bind failure and adds
  // nothing beyond the raw fields; quoting it at port 0 would restate the
  // false conflict claim. Every other message is real evidence and survives.
  const cause = rawMessage
    ? (port === 0 && BIND_HINT.test(rawMessage) ? 'the generic bind-failure hint from the runtime' : rawMessage)
    : asError?.name ?? 'no message'
  const details = `code=${code}; errno=${errno}; syscall=${syscall}`
  if (port === 0) return `Failed to start server on ${host}:0 (kernel-assigned port): cause=${cause}; ${details}`
  const head = rawMessage || `Failed to start server. Is port ${port} in use?`
  return `${head} (requested ${host}:${port}; ${rawMessage ? '' : `cause=${cause}; `}${details})`
}
