import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeEffectiveProfile, readEgressBlocklist } from '../src/profileConfig.js'

const blocklist = readEgressBlocklist()
let tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

function writePatchFile(name: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'echoflow-profile-'))
  tempDirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}

function findEntry(entries: Array<{ id: string }>, id: string) {
  return entries.find(entry => entry.id === id)
}

/**
 * Only enabled rows can reach the network. A disabled row keeps its config for
 * diagnostics, so an outbound host may still appear in the raw composition.
 */
function activeEntries<T extends { disabled?: unknown }>(entries: T[]): T[] {
  return entries.filter(entry => entry.disabled !== true)
}

function collectStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, found)
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, found)
  }
  return found
}

describe('the echoflow profile blocks every outbound path', () => {
  test('loads every bundle layer without skipping any of them', () => {
    const { profile, entries } = composeEffectiveProfile()
    expect(profile.skippedBundles).toEqual([])
    expect(profile.layers.map(layer => layer.packageName)).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-acp-app',
      '@echoflow/egress-guard',
    ])
    expect(entries.length).toBeGreaterThan(0)
  })

  test.each(blocklist.plugins.map(plugin => plugin.id))(
    'disables the %s plugin in the final composition',
    (id) => {
      const { entries } = composeEffectiveProfile()
      const entry = findEntry(entries, id)
      // A missing id means an upstream rename escaped the audit. Presence plus
      // `disabled: true` is the only acceptable outcome.
      expect(entry, `${id} must be present in the composition`).toBeDefined()
      expect(entry?.disabled, `${id} must be disabled`).toBe(true)
    },
  )

  test.each(blocklist.plugins.map(plugin => plugin.id))(
    'the profile patch alone disables %s',
    (id) => {
      const { entries } = composeEffectiveProfile({ includeHardDisable: false })
      expect(findEntry(entries, id)?.disabled, `${id} must be disabled by the profile patch`).toBe(true)
    },
  )

  test('the composition reports no unmatched patch', () => {
    const { warnings } = composeEffectiveProfile()
    expect(warnings).toEqual([])
  })

  test('reports a patch that names an unknown plugin instead of ignoring it', () => {
    const overlay = writePatchFile(
      'unknown.yml',
      '- id: no-such-plugin\n  disabled: true\n',
    )
    const { warnings } = composeEffectiveProfile({ overlayPaths: [overlay] })
    expect(warnings.join('\n')).toContain('no-such-plugin')
  })

  test('the active configuration names no blocked host', () => {
    const { entries } = composeEffectiveProfile()
    const serialized = JSON.stringify(activeEntries(entries))
    for (const host of blocklist.hosts) {
      expect(serialized, `active configuration must not reference ${host}`).not.toContain(host)
    }
  })

  test('no active row selects a blocked provider route', () => {
    const { entries } = composeEffectiveProfile()
    const active = activeEntries(entries)
    const configStrings = active.flatMap(entry =>
      collectStrings((entry as { config?: unknown }).config ?? {}),
    )
    for (const route of blocklist.routes) {
      expect(
        configStrings.some(value => value.includes(route)),
        `active configuration must not select or declare ${route}`,
      ).toBe(false)
    }
    expect((findEntry(entries, 'agent-default-model') as { config?: unknown })?.config)
      .toMatchObject({ provider: 'echoflow' })
    expect((findEntry(entries, 'acp') as { config?: unknown })?.config)
      .toMatchObject({ provider: 'echoflow' })
  })

  test('keeps the runtime plugins the agent needs', () => {
    const { entries } = composeEffectiveProfile()
    for (const id of ['agent-loop', 'acp', 'tools', 'session', 'llm-pi-ai']) {
      const entry = findEntry(entries, id)
      expect(entry, `${id} must remain in the composition`).toBeDefined()
      expect(entry?.disabled, `${id} must remain enabled`).not.toBe(true)
    }
  })

  // The first addon set rides the same rc as the core, so mounting it is also
  // the proof that the profile patch can add a row the bundles never mounted.
  test.each([
    ['hooks-claude-code', '@deepseek-ai/dsh-hooks-claude-code'],
    ['workspace-changes', '@deepseek-ai/dsh-workspace-changes'],
    ['session-reference', '@deepseek-ai/dsh-session-reference'],
    ['session-stats', '@deepseek-ai/dsh-session-stats'],
  ])('the echoflow profile mounts %s', (id, name) => {
    const { entries } = composeEffectiveProfile()
    const entry = findEntry(entries, id) as { name?: string; disabled?: unknown } | undefined
    expect(entry, `${id} must be mounted by the profile patch`).toBeDefined()
    expect(entry?.name).toBe(name)
    expect(entry?.disabled).not.toBe(true)
  })

  // Scheduling waits for the Host Session controller, which this headless
  // composition does not mount. The rows stay in the config so the wait is
  // written down instead of silently absent.
  test.each([
    ['schedule', '@deepseek-ai/dsh-schedule'],
    ['tool-schedule', '@deepseek-ai/dsh-tool-schedule'],
  ])('keeps %s off until the session-controller path exists', (id, name) => {
    const { entries } = composeEffectiveProfile()
    const entry = findEntry(entries, id) as { name?: string; disabled?: unknown } | undefined
    expect(entry, `${id} must stay in the profile for the later enable`).toBeDefined()
    expect(entry?.name).toBe(name)
    expect(entry?.disabled).toBe(true)
  })

  test('a later overlay cannot re-enable a blocklisted plugin', () => {
    const overlay = writePatchFile(
      're-enable.yml',
      '- id: llm-deepseek\n  disabled: false\n',
    )
    const { entries } = composeEffectiveProfile({ overlayPaths: [overlay] })
    expect(findEntry(entries, 'llm-deepseek')?.disabled).toBe(true)
  })

  test('the control composition proves that overlay would otherwise win', () => {
    const overlay = writePatchFile(
      're-enable-control.yml',
      '- id: llm-deepseek\n  disabled: false\n',
    )
    const { entries } = composeEffectiveProfile({
      overlayPaths: [overlay],
      includeHardDisable: false,
    })
    // Without the hard-disable layer the overlay re-opens the row. This keeps
    // the previous test from passing on a no-op.
    expect(findEntry(entries, 'llm-deepseek')?.disabled).not.toBe(true)
  })

  test('the blocklist records a reason for every plugin it names', () => {
    for (const plugin of blocklist.plugins) {
      expect(plugin.reason.length).toBeGreaterThan(0)
    }
  })

  test('the blocklist names the plugins that would otherwise reach DeepSeek', () => {
    const ids = blocklist.plugins.map(plugin => plugin.id)
    for (const required of [
      'session-log-deepseek',
      'plugin-package-inventory-deepseek',
      'session-telemetry-otel',
    ]) {
      expect(ids).toContain(required)
    }
  })
})
