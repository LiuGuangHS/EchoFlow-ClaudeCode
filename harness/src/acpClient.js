/**
 * The client half of the ACP seam.
 *
 * `connectAcp` starts EchoFlow's own launcher (`dshProcess.js`) as a child
 * process and speaks Agent Client Protocol over its stdio. It knows nothing
 * about dsh internals: everything here is the published ACP client surface.
 */
import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const defaultLauncher = join(dirname(fileURLToPath(import.meta.url)), 'dshProcess.js')
const CLOSE_TIMEOUT_MS = 10_000

export function registerPermissionHandler(app, onPermission) {
  app.onRequest('session/request_permission', (request) =>
    onPermission?.(request.params) ?? { outcome: { outcome: 'cancelled' } })
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function textOf(update) {
  if (update?.sessionUpdate !== 'agent_message_chunk') return ''
  return update.content?.type === 'text' ? update.content.text : ''
}

export async function connectAcp(options = {}) {
  const child = spawn(
    options.command ?? process.execPath,
    [options.launcherPath ?? defaultLauncher, ...(options.args ?? [])],
    {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const exited = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }))
  })

  const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
  const app = client({ name: 'echoflow-harness' })
  registerPermissionHandler(app, options.onPermission)
  const agent = app.connect(stream).agent

  let active
  let closeResult

  async function shutdown() {
    child.stdin.end()
    const settled = await Promise.race([exited, delay(CLOSE_TIMEOUT_MS).then(() => undefined)])
    if (settled === undefined) {
      child.kill('SIGTERM')
      const killed = await Promise.race([exited, delay(CLOSE_TIMEOUT_MS).then(() => undefined)])
      return killed ?? { code: null, signal: 'SIGKILL', stderr }
    }
    return { ...settled, stderr }
  }

  return {
    async requestPermissionForTest(params) {
      const testAgent = agent()
      return testAgent.connectWith(app, context => context.requestPermission(params))
    },

    async initialize() {
      return agent.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
    },

    async newSession(request) {
      active = await agent.buildSession(request).start()
      return {
        sessionId: active.sessionId,
        modes: active.modes,
        meta: active.meta,
        configOptions: active.newSessionResponse.configOptions,
      }
    },

    /**
     * Send one prompt and read to the end of the turn.
     * `onUpdate` sees every session update as it arrives.
     */
    async prompt(text, { onUpdate } = {}) {
      if (active === undefined) throw new Error('acp: call newSession() before prompt()')
      const responsePromise = active.prompt(text)
      let collected = ''
      for (;;) {
        const message = await active.nextUpdate()
        if (message.kind === 'stop') break
        onUpdate?.(message.update)
        collected += textOf(message.update)
      }
      const response = await responsePromise
      return { text: collected, stopReason: response.stopReason, response }
    },

    /**
     * Close stdin and wait for the launcher to dispose and exit.
     * The process owns its own shutdown; the client only observes it.
     * Repeated calls observe the same shutdown instead of racing it.
     */
    close() {
      closeResult ??= shutdown()
      return closeResult
    },

    /** The launcher's exit, for callers that do not call close(). */
    get exit() {
      return exited
    },
  }
}
