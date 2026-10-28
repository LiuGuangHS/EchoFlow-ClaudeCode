/**
 * Test-only hardening for Bun 1.3.14's transient bind failure: Bun.serve
 * intermittently throws a masked {code:'EADDRINUSE', errno:0, syscall:'listen'}
 * under CPU load even though the kernel is healthy and an immediate retry
 * succeeds (probe evidence in src/server/serveWithTransientBindRetry.ts).
 * Test suites bind their own servers per test, so without this the transient
 * surfaces as flaky "Is port 0 in use?" failures in any file with a server.
 * One bounded retry at the runtime seam; genuine conflicts fail the retry and
 * propagate unchanged.
 */
import { serveWithTransientBindRetry } from './src/server/serveWithTransientBindRetry.js'

const bunGlobal = Bun as unknown as { serve: typeof Bun.serve }
const originalServe = bunGlobal.serve.bind(Bun)
bunGlobal.serve = ((...args: Parameters<typeof Bun.serve>) =>
  serveWithTransientBindRetry(() => originalServe(...args))) as typeof Bun.serve
