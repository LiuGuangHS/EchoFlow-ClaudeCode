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
    const booted = await bootEchoFlowAgent({
      prepare: (ctx) => {
        provideCmdline(ctx, { args: [], exit: () => {}, ready: { onReady: () => () => {} } })
      },
    })
    const { ctx } = booted
    if (!ctx.webServer || !ctx.connection || !ctx.sessionController || !ctx.fileUploads) {
      await ctx.dispose()
      throw new Error('dsh Host did not compose its required control-plane services')
    }
    host = {
      origin: ctx.webServer.getOrigin(),
      token: new URL(ctx.connection.authenticatedUrl(ctx.webServer.getOrigin())).searchParams.get('token'),
      ctx,
      close: async () => ctx.fiber.dispose(),
    }
  })
  return host
}
