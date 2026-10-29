#!/usr/bin/env node
/**
 * EchoFlow's minimal dsh launcher.
 *
 * This is not a general dsh CLI: it boots one profile (the EchoFlow profile),
 * hands the ACP app an empty command line, and binds process lifetime to the
 * ACP session. Everything it imports is a published dsh library API; there is
 * no `dsh` executable and no `npx` resolution.
 */
import { installFailLoud } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { bootEchoFlowAgent } from './boot.js'

async function main() {
  const readyListeners = []
  let startupCommitted = false
  let ctxRef
  let exiting = false
  const exit = (code) => {
    if (exiting) return
    exiting = true
    Promise.resolve(ctxRef?.fiber?.dispose())
      .catch(() => {})
      .finally(() => process.exit(code))
  }
  const ready = {
    // A listener registered after startup was committed still has to run:
    // stdin can reach EOF before the tree settles, and that listener is the
    // shutdown request it queued.
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

  installFailLoud('echoflow-agent', process, () => ctxRef?.fiber?.dispose())

  const { ctx } = await bootEchoFlowAgent({
    prepare: (hostCtx) => {
      ctxRef = hostCtx
      provideCmdline(hostCtx, { args: [], exit, ready })
    },
  })

  ctxRef = ctx
  startupCommitted = true
  for (const listener of readyListeners.splice(0)) listener()
}

main().catch((error) => {
  console.error('echoflow-agent: startup failed')
  console.error(error)
  process.exit(1)
})
