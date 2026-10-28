/**
 * Bun 1.3.14 intermittently fails Bun.serve(...) with a masked
 * {code:'EADDRINUSE', errno:0, syscall:'listen'} even when the kernel is
 * healthy: under CPU load a node:net listen(0) succeeds at the very moment
 * Bun.serve fails, sockets and fds are far from any limit, and an immediate
 * second Bun.serve succeeds (probe evidence: artifacts/local-rerun/bind-churn-probe.ts,
 * 2026-10-27). A kernel-assigned port 0 cannot be genuinely "in use", and a
 * genuine conflict fails a second attempt identically, so exactly one immediate
 * retry is safe: it recovers the transient and preserves real failures.
 */

export function isTransientBindFailure(error: unknown): boolean {
  const fields = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
  return fields.code === 'EADDRINUSE' && fields.errno === 0 && fields.syscall === 'listen'
}

export function serveWithTransientBindRetry<T>(serve: () => T): T {
  try {
    return serve()
  } catch (error) {
    if (!isTransientBindFailure(error)) throw error
    return serve()
  }
}
