/**
 * The dsh packages require Node 24.9.0. EchoFlow's own tools still run on
 * older Node, so the floor is checked where the runtime is selected rather
 * than assumed everywhere.
 */

/**
 * Compare a Node version against a floor.
 *
 * @param {string} current - `process.versions.node`, or `process.version` with its `v`.
 * @param {[number, number, number]} floor
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function checkNodeFloor(current, floor) {
  const reason = `Node.js ${floor.join('.')} or later is required for the dsh runtime`
  const parsed = parseVersion(current)
  if (parsed === null) return { ok: false, reason }
  const ok =
    parsed[0] > floor[0] ||
    (parsed[0] === floor[0] && parsed[1] > floor[1]) ||
    (parsed[0] === floor[0] && parsed[1] === floor[1] && parsed[2] >= floor[2])
  return { ok, reason: ok ? null : reason }
}

/** Three plain numbers only: a prerelease or a partial version is not comparable. */
function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}
