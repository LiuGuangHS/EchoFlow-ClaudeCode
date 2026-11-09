import { mkdirSync } from 'node:fs'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { bootEchoFlowAgent } from './boot.js'

const HOST_ENV_KEYS = [
  'HOME', 'CLAUDE_CONFIG_DIR', 'DSH_HOME', 'DSH_AGENTS_HOME',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
]

async function withProcessContext({ cwd, env }, operation) {
  const previousCwd = process.cwd()
  const previousEnv = Object.fromEntries(HOST_ENV_KEYS.map(key => [key, process.env[key]]))
  try {
    if (cwd) {
      mkdirSync(cwd, { recursive: true })
      process.chdir(cwd)
    }
    for (const key of HOST_ENV_KEYS) {
      if (env?.[key] === undefined) delete process.env[key]
      else process.env[key] = env[key]
    }
    return await operation()
  } finally {
    process.chdir(previousCwd)
    for (const key of HOST_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[key]
    }
  }
}

/**
 * Boot the real loopback Host and expose only its one-time API token.
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 */
export async function startDshHost(options = {}) {
  let host
  await withProcessContext(options, async () => {
    const readyListeners = []
    let startupCommitted = false
    // The gateway registers its /api/remote.mux upgrade route from an onReady
    // listener, so the listeners must really run once startup is committed.
    const ready = {
      onReady(listener) {
        if (startupCommitted) {
          queueMicrotask(listener)
          return () => {}
        }
        readyListeners.push(listener)
        return () => {
          const index = readyListeners.indexOf(listener)
          if (index >= 0) readyListeners.splice(index, 1)
        }
      },
    }
    const booted = await bootEchoFlowAgent({
      prepare: (ctx) => {
        provideCmdline(ctx, { args: [], exit: () => {}, ready })
      },
    })
    const { ctx } = booted
    if (!ctx.webServer || !ctx.connection || !ctx.sessionController || !ctx.fileUploads) {
      await ctx.fiber.dispose()
      throw new Error('dsh Host did not compose its required control-plane services')
    }
    startupCommitted = true
    for (const listener of readyListeners.splice(0)) listener()
    host = {
      origin: ctx.webServer.getOrigin(),
      token: new URL(ctx.connection.authenticatedUrl(ctx.webServer.getOrigin())).searchParams.get('token'),
      ctx,
      close: async () => ctx.fiber.dispose(),
    }
  })
  return host
}
