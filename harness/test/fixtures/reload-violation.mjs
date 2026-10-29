/**
 * Reload-rejection fixture.
 *
 * Boots the real EchoFlow profile, then reconciles a patch list whose last
 * layer re-enables a blocklisted plugin — the shape a bad home patch or a
 * future reloader could produce. The guard must refuse the resulting tree.
 */
import { reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { bootEchoFlowAgent } from '../../src/boot.js'

function fail(message, code) {
  console.error(`reload-fixture: ${message}`)
  process.exit(code)
}

const booted = await bootEchoFlowAgent({
  prepare: (hostCtx) => {
    provideCmdline(hostCtx, {
      args: [],
      exit: code => process.exit(code),
      ready: { onReady: () => () => {} },
    })
  },
})

const badPatches = [
  ...booted.layers.flat(),
  { id: 'session-log-deepseek', disabled: false },
]

try {
  await reconcileProfilePatches(booted.ctx, badPatches, 'reload-fixture')
} catch (error) {
  // The reload must reject. The guard also escalates to a fatal exit, so this
  // branch is a second, independent signal rather than the only one.
  fail(`reload rejected as expected: ${error?.message}`, 4)
}

fail('reload was accepted while a blocklisted plugin was enabled', 3)
