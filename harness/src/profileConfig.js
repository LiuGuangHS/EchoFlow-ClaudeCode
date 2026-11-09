import {
  composeEntries,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfileDirectory,
} from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const harnessRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULT_PROFILE_DIR = join(harnessRoot, 'profile')
export const DEFAULT_INSTALL_ANCHOR = join(
  harnessRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh-acp-app',
  'package.json',
)

export function readEgressBlocklist(root = harnessRoot) {
  return JSON.parse(readFileSync(join(root, 'egress-blocklist.json'), 'utf8'))
}

/**
 * The last patch layer: every blocklisted plugin is disabled no matter what an
 * earlier layer said. A user home patch or a command-line overlay can name the
 * same row, but cannot win against this layer.
 */
export function hardDisablePatch(blocklist) {
  return blocklist.plugins.map(({ id }) => ({ id, disabled: true }))
}

/**
 * Compose the effective configuration tree in the same order dsh boots it:
 * bundle layers, the profile's own patch, the home patch, command-line
 * overlays, then the EchoFlow hard-disable layer.
 *
 * `includeHardDisable: false` exists for diagnostics and for tests that need to
 * prove the profile patch stands on its own. Production launchers keep the
 * default.
 */
export function composeEffectiveProfile(options = {}) {
  const root = options.harnessRoot ?? harnessRoot
  const blocklist = options.blocklist ?? readEgressBlocklist(root)
  const warnings = []

  const profile = loadProfileDirectory(
    'dsh',
    options.profileDir ?? join(root, 'profile'),
    options.installAnchor ?? DEFAULT_INSTALL_ANCHOR,
  )

  const layers = [...profile.layers.map(layer => layer.patches), profile.patches]

  if (options.homePatchPath) {
    const homePatches = loadOptionalPatches('dsh', options.homePatchPath)
    if (homePatches) layers.push(homePatches)
  }

  for (const overlayPath of options.overlayPaths ?? []) {
    layers.push(loadOverlayPatches('dsh', overlayPath))
  }

  if (options.includeHardDisable !== false) {
    layers.push(hardDisablePatch(blocklist))
  }

  if (options.hardDisablePlugins?.length) {
    layers.push(options.hardDisablePlugins.map(id => ({ id, disabled: true })))
  }

  const entries = composeEntries(layers, message => warnings.push(message))
  return { profile, entries, warnings, layers }
}
