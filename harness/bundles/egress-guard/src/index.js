/**
 * The `egress-guard` loader plugin.
 *
 * The launcher checks the composed profile before boot and the live tree
 * after boot. This plugin owns the third moment: a profile reload can put the
 * running tree back into an unguarded shape, and no later start-up check will
 * ever see it.
 */
import {
  EgressViolationError,
  readBlocklist,
  snapshotLoaderTree,
  verifyEffectiveConfig,
} from './verify.js'

/** Stable Cordis plugin name. */
export const name = 'echoflow-egress-guard'

/** The guard reads the live tree; it cannot run before the Loader exists. */
export const inject = ['loader']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ blocklist?: object, blocklistPath?: string }} [config]
 */
export function apply(ctx, config = {}) {
  const blocklist = config.blocklist ?? readBlocklist(config.blocklistPath)

  // Only reload is checked here. A check at mount time would see a tree that is
  // still growing, and `loader.await()` can settle before the include tree has
  // populated — both produce false violations. Boot itself is covered by the
  // launcher's pre-boot and post-boot checks.
  ctx.on('app-boot/config-reload', () => {
    const error = refusal(ctx, blocklist)
    if (error === undefined) return
    // The reload call itself must fail, and a caller that swallows that
    // rejection must still not keep running with the unguarded tree. The
    // queued throw reaches the fail-loud handler; whichever path wins, the
    // process ends non-zero.
    queueMicrotask(() => { throw error })
    throw error
  })
}

/**
 * @returns {EgressViolationError | undefined}
 */
function refusal(ctx, blocklist) {
  const violations = verifyEffectiveConfig(snapshotLoaderTree(ctx), blocklist)
  return violations.length === 0 ? undefined : new EgressViolationError(violations)
}
