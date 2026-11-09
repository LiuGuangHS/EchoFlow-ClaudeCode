/**
 * Boot sequence for the EchoFlow agent.
 *
 * Kept separate from the CLI wrapper so tests (and future hosts) can boot the
 * same tree without owning process lifetime. The egress gates live here
 * because this is the only place that sees both the composed profile and the
 * settled Loader tree.
 */
import {
  boot,
  createRuntimeResolution,
  PluginPackages,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertNoEgress, snapshotLoaderTree } from '../bundles/egress-guard/src/verify.js'
import { composeEffectiveProfile, readEgressBlocklist } from './profileConfig.js'

export const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const INSTALL_ANCHOR = join(
  HARNESS_ROOT, 'node_modules', '@deepseek-ai', 'dsh-acp-app', 'package.json',
)
const NATIVE_DISABLED_PLUGIN_IDS = [
  'plugin-manager', 'remote-access', 'typert-gateway', 'hmr', 'goal-round-driver', 'commands',
  'command-feedback', 'command-goal', 'command-compact', 'plan-mode', 'web',
  'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'mcp-resources',
  'tool-working-directory', 'tool-plugin-manager', 'tool-bash', 'tool-pwsh', 'tool-jobs',
  'tool-fs', 'tool-fs-search', 'tool-skill', 'tool-subagent-control',
  'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork', 'tool-workflow',
  'tool-todo', 'tool-goal', 'tool-web', 'tool-result-pruner',
]

function assertPluginsDisabled(entries, pluginIds) {
  const required = new Set(pluginIds)
  const enabled = entries.filter(entry => required.has(entry.id) && entry.disabled !== true)
  if (enabled.length > 0) {
    throw new Error(`echoflow-agent: required plugins are enabled: ${enabled.map(entry => entry.id).join(', ')}`)
  }
}

function assertPluginsAbsent(entries, pluginIds) {
  const forbidden = new Set(pluginIds)
  const present = entries.filter(entry => forbidden.has(entry.id))
  if (present.length > 0) {
    throw new Error(`echoflow-agent: forbidden plugins are configured: ${present.map(entry => entry.id).join(', ')}`)
  }
}

/**
 * Boot the EchoFlow profile.
 *
 * Order matters: the composed patch list is verified before any entry mounts,
 * and the settled Loader tree is verified again before the caller is allowed
 * to serve. Both checks throw `EgressViolationError`.
 * @param {object} [options]
 * @param {string} [options.harnessRoot]
 * @param {string} [options.installAnchor]
 * @param {string} [options.home] - defaults to the resolved `DSH_HOME`.
 * @param {string} [options.profileDir]
 * @param {string | null} [options.homePatchPath] - null skips the home patch.
 * @param {string[]} [options.overlayPaths]
 * @param {object} [options.blocklist]
 * @param {string[]} [options.hardDisablePlugins] - final, non-overridable disable layer.
 * @param {string[]} [options.forbiddenPlugins] - reject these rows before and after boot.
 * @param {(ctx: import('@deepseek-ai/cordis').Context) => Promise<void> | void} [options.prepare]
 *   - runs after Loader installation and before any entry mounts.
 * @returns {Promise<{ ctx: import('@deepseek-ai/cordis').Context, profile: object, layers: unknown[][], blocklist: object, home: string }>}
 */
export async function bootEchoFlowAgent(options = {}) {
  const harnessRoot = options.harnessRoot ?? HARNESS_ROOT
  const installAnchor = options.installAnchor ?? INSTALL_ANCHOR
  const home = options.home ?? resolveDshHome()
  const profileDir = options.profileDir
    ?? process.env.ECHOFLOW_DSH_PROFILE_DIR
    ?? join(harnessRoot, 'profile')
  const blocklist = options.blocklist ?? readEgressBlocklist(harnessRoot)
  const runDir = join(home, 'run')
  const rootConfigPath = join(runDir, 'cordis.yml')

  mkdirSync(runDir, { recursive: true })
  // The profile patches carry every row; the include root only has to exist.
  writeFileSync(rootConfigPath, '[]\n')

  const { profile, layers, entries } = composeEffectiveProfile({
    harnessRoot,
    profileDir,
    installAnchor,
    blocklist,
    homePatchPath: options.homePatchPath === undefined
      ? join(home, 'cordis.patch.yml')
      : options.homePatchPath,
    overlayPaths: options.overlayPaths,
    hardDisablePlugins: options.hardDisablePlugins,
  })

  if (profile.skippedBundles.length > 0) {
    throw new Error([
      'echoflow-agent: the profile could not load every bundle',
      ...profile.skippedBundles.map(skipped => `  - ${skipped.packageName}: ${skipped.reason}`),
    ].join('\n'))
  }

  // Gate 1: nothing has mounted yet, so a bad composition never reaches a
  // plugin that could open a connection.
  assertNoEgress(entries, blocklist)
  assertPluginsDisabled(entries, options.hardDisablePlugins ?? [])
  assertPluginsAbsent(entries, options.forbiddenPlugins ?? [])

  const ctx = await boot(
    'echoflow-agent',
    rootConfigPath,
    layers.flat(),
    async (hostCtx) => {
      const resolution = await createRuntimeResolution({ installAnchor, profile, home })
      await hostCtx.plugin(PluginPackages, { resolution })
      hostCtx.provide('profileContext', {
        name: profile.name,
        dir: profile.dir,
        patchPath: profile.patchPath,
        installAnchor,
        cwd: process.cwd(),
        home,
        startedBundles: profile.layers.map(layer => layer.packageName),
        overlays: [],
        telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
      })
      await options.prepare?.(hostCtx)
    },
    pathToFileURL(join(harnessRoot, 'package.json')).href,
  )

  // Gate 2: the tree that actually mounted, with every `!!js` expression
  // evaluated and every parent group accounted for.
  try {
    const mountedEntries = snapshotLoaderTree(ctx)
    assertNoEgress(mountedEntries, blocklist)
    assertPluginsDisabled(mountedEntries, options.hardDisablePlugins ?? [])
    assertPluginsAbsent(mountedEntries, options.forbiddenPlugins ?? [])
  } catch (error) {
    // Ownership transfers to the caller only after the mounted tree is safe.
    try {
      await ctx.fiber.dispose()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'echoflow-agent: startup validation and cleanup failed')
    }
    throw error
  }

  return { ctx, profile, layers, blocklist, home }
}

/**
 * Boot the native module profile without ACP, launcher, or callable tools.
 * Home patches and overlays may configure providers, but cannot re-enable the
 * disabled product surfaces.
 * @param {object} [options]
 * @param {string} [options.harnessRoot]
 * @param {string} [options.home]
 * @param {string | null} [options.homePatchPath]
 * @param {string[]} [options.overlayPaths]
 * @param {object} [options.blocklist]
 */
export async function bootEchoFlowNativeAgent(options = {}) {
  const harnessRoot = options.harnessRoot ?? HARNESS_ROOT
  const home = options.home ?? resolveDshHome()
  const booted = await bootEchoFlowAgent({
    ...options,
    home,
    profileDir: join(harnessRoot, 'profile', 'native'),
    installAnchor: join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'),
    homePatchPath: options.homePatchPath,
    hardDisablePlugins: NATIVE_DISABLED_PLUGIN_IDS,
    forbiddenPlugins: ['acp'],
    prepare: undefined,
  })

  try {
    if (booted.ctx.get('webServer') || booted.ctx.get('sessionController')) {
      throw new Error('echoflow-agent: the native profile must not mount Host services')
    }
    if (booted.ctx.tools.schemas().length > 0) {
      throw new Error('echoflow-agent: native profile tools are not wired to product controls')
    }
  } catch (error) {
    try {
      await booted.ctx.fiber.dispose()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'echoflow-agent: native validation and cleanup failed')
    }
    throw error
  }

  return booted
}
