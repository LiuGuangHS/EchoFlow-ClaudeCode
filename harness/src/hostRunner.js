import { startDshHost } from './hostProcess.js'

// Runs the real Host under Node (dsh's boot cannot load under Bun) and hands the
// one-time origin and token to the parent on stdout; closing stdin stops it.
const host = await startDshHost({ cwd: process.env.ECHOFLOW_HOST_CWD, env: process.env })
process.stdout.write(`${JSON.stringify({ origin: host.origin, token: host.token })}\n`)
process.stdin.resume()
process.stdin.on('end', () => {
  void host.close().finally(() => process.exit(0))
})
