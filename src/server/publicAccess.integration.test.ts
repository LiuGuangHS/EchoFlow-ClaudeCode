import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'

test('real server remote listener serves bootstrap, sessions and approval replay without providers or user state', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'public-access-integration-'))
  try {
    const child = Bun.spawn([process.execPath, '--no-env-file', path.join(import.meta.dir, '__fixtures__/publicAccessSmoke.ts')], {
      env: createSandboxedTestEnvironment(home, { ECHOFLOW_LOCAL_ACCESS_TOKEN: 'fixture-process-credential' }),
      stdout: 'pipe', stderr: 'pipe',
    })
    // Hang guard, not a performance budget: the smoke runs a real server
    // through pairing, streaming and reconnect, which a loaded machine can
    // stretch well past 15s; keep the guard below the per-test timeout so a
    // slow run can never be killed first.
    const timeout = setTimeout(() => child.kill('SIGKILL'), 45_000)
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect({ exitCode, output: exitCode === 0 ? '' : `${stdout}\n${stderr}` }).toEqual({ exitCode: 0, output: '' })
      expect(stdout).toContain('REMOTE_INTEGRATION_PASSED')
    } finally { clearTimeout(timeout); child.kill() }
  } finally { rmSync(home, { recursive: true, force: true }) }
}, 60_000)
