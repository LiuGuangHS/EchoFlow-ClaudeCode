/**
 * Egress rules for the EchoFlow profile.
 *
 * Everything here reads *structured, effective* loader state: ids, configs,
 * and the Loader's evaluated `disabled` getter. Nothing parses YAML text or
 * guesses row boundaries, so a nested group, a `!!js` expression, or a later
 * patch layer is judged by what the tree actually runs.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The harness-level policy file, three levels above this bundle's `src/`. */
export const DEFAULT_BLOCKLIST_PATH = fileURLToPath(
  new URL('../../../egress-blocklist.json', import.meta.url),
)

/**
 * @typedef {object} EffectiveEntry
 * @property {string} id - the id inside the entry's own tree.
 * @property {unknown} [config] - the entry's effective config, if any.
 * @property {unknown} [disabled] - the Loader's *evaluated* disabled state.
 * @property {true} [container] - a loader container whose config is a child
 *   entry list, not plugin configuration.
 */

/** A refused configuration: the process must not keep running with this tree. */
export class EgressViolationError extends Error {
  /** @param {string[]} violations - one human-readable line per violation. */
  constructor(violations) {
    super([
      'egress-guard: refusing to run with an unguarded configuration',
      ...violations.map(violation => `  - ${violation}`),
    ].join('\n'))
    this.name = 'EgressViolationError'
    this.violations = violations
  }
}

/** @param {string} [path] - blocklist file; defaults to the harness policy. */
export function readBlocklist(path = DEFAULT_BLOCKLIST_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Walk a config value and collect its strings.
 *
 * Used instead of serializing the whole value: an expression node or a
 * function is not a network destination, and stringifying it would either
 * throw or invent text that was never configured.
 * @param {unknown} value
 * @param {string[]} [found]
 * @returns {string[]}
 */
function collectStrings(value, found = []) {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, found)
  else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, found)
  }
  return found
}

/**
 * Collapse entries by id, keeping the enabled row when an id appears twice.
 * A duplicate must never hide an enabled row behind a disabled one.
 * @param {EffectiveEntry[]} entries
 * @returns {Map<string, EffectiveEntry>}
 */
function indexById(entries) {
  const byId = new Map()
  for (const entry of entries) {
    const previous = byId.get(entry.id)
    if (previous === undefined || entry.disabled !== true) byId.set(entry.id, entry)
  }
  return byId
}

/**
 * Check a fully composed entry list against the policy.
 *
 * A blocklisted id must be present and effectively disabled: a missing id
 * means the row was renamed upstream and the audit no longer covers it, which
 * is a violation rather than a pass. `requiredPlugins` must be present and
 * enabled. Every enabled row's config is scanned for blocked hosts and routes.
 * @param {EffectiveEntry[]} entries - final entries with evaluated state.
 * @param {{ plugins: { id: string }[], hosts: string[], routes: string[], requiredPlugins?: string[] }} blocklist
 * @returns {string[]} violations; an empty array means the tree is guarded.
 */
export function verifyEffectiveConfig(entries, blocklist) {
  const violations = []
  const byId = indexById(entries)

  for (const plugin of blocklist.plugins) {
    const entry = byId.get(plugin.id)
    if (entry === undefined) {
      violations.push(`${plugin.id} is missing from the tree (it must exist and be disabled)`)
    } else if (entry.disabled !== true) {
      violations.push(`${plugin.id} must be disabled, but it is enabled`)
    }
  }

  for (const id of blocklist.requiredPlugins ?? []) {
    const entry = byId.get(id)
    if (entry === undefined) violations.push(`${id} is required but missing from the tree`)
    else if (entry.disabled === true) violations.push(`${id} is required but disabled`)
  }

  for (const entry of byId.values()) {
    // A container's config is the child entry list (the raw patch text), not a
    // plugin configuration: scanning it would flag the blocklist itself.
    if (entry.disabled === true || entry.container === true) continue
    const strings = collectStrings(entry.config).join('\n')
    for (const host of blocklist.hosts) {
      if (strings.includes(host)) violations.push(`${entry.id} references blocked host ${host}`)
    }
    for (const route of blocklist.routes) {
      if (strings.includes(route)) violations.push(`${entry.id} references blocked route ${route}`)
    }
  }

  return violations
}

/**
 * Snapshot the live Loader tree as effective entries.
 *
 * Two details decide the shape:
 * - `Entry.disabled` is the Loader's own effective getter: it evaluates `!!js`
 *   expressions and accounts for a disabled parent group, which the raw
 *   `entry.options.disabled` does not.
 * - `entry.id` carries the owning tree's path (`include:llm-deepseek`), while
 *   the policy names rows by their own id, which is `entry.options.id`.
 * @param {{ loader: { entries(): Iterable<{ options: { id: string, name?: string, config?: unknown }, disabled: boolean }> } }} ctx
 * @returns {EffectiveEntry[]}
 */
export function snapshotLoaderTree(ctx) {
  return [...ctx.loader.entries()].map(entry => ({
    id: entry.options.id,
    config: entry.options.config,
    disabled: entry.disabled,
    // `cordis:include` and `cordis:group` hold a child entry list.
    container: typeof entry.options.name === 'string' && entry.options.name.startsWith('cordis:')
      ? true
      : undefined,
  }))
}

/**
 * Throw unless the given entries satisfy the policy.
 * @param {EffectiveEntry[]} entries
 * @param {Parameters<typeof verifyEffectiveConfig>[1]} blocklist
 * @throws {EgressViolationError}
 */
export function assertNoEgress(entries, blocklist) {
  const violations = verifyEffectiveConfig(entries, blocklist)
  if (violations.length > 0) throw new EgressViolationError(violations)
}
