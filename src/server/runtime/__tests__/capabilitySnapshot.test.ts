import { describe, expect, test } from 'bun:test'
import type { Capability } from '../contract.js'
import { dshBaselineCapabilities } from '../capabilitySnapshot.js'

/** Every source a capability may cite; a leaf naming one outside this list is a bug. */
const SOURCES: Capability['source'][] = ['handshake', 'protocol-baseline', 'version-assumption', 'extension']

describe('dshBaselineCapabilities', () => {
  test('declares only what this driver exercises as native', () => {
    const caps = dshBaselineCapabilities()
    expect(caps.prompt.text).toEqual({ state: 'native', source: 'protocol-baseline' })
    expect(caps.approval.tool).toEqual({ state: 'native', source: 'protocol-baseline' })
    expect(caps.session.list.state).toBe('unsupported')
    expect(caps.session.resume.state).toBe('unsupported')
    expect(caps.session.fork.state).toBe('unsupported')
  })

  test('an unexercised capability is unsupported, never "try it"', () => {
    const caps = dshBaselineCapabilities()
    expect(caps.prompt.image.state).toBe('unsupported')
    expect(caps.approval.network.state).toBe('unsupported')
    expect(caps.extensions.hooks.state).toBe('unsupported')
    expect(caps.extensions.mcpHttp.state).toBe('unsupported')
    expect(caps.observability.diffs.state).toBe('unsupported')
  })

  test('exposes the addon and extension capability groups as unsupported by default', () => {
    const caps = dshBaselineCapabilities()
    expect(caps.config.permissionMode.state).toBe('unsupported')
    expect(caps.commands.catalog.state).toBe('unsupported')
    expect(caps.jobs.list.state).toBe('unsupported')
    expect(caps.subagent.delegate.state).toBe('unsupported')
    expect(caps.checkpoints.files.state).toBe('unsupported')
    expect(caps.prompt.queue.state).toBe('unsupported')
  })

  test('claims session config only for the ids the driver actually sets', () => {
    const caps = dshBaselineCapabilities()
    expect(caps.config.model).toMatchObject({ state: 'native', source: 'protocol-baseline' })
    expect(caps.config.reasoningEffort).toMatchObject({ state: 'native', source: 'protocol-baseline' })
  })

  test('claims session close and context pressure, which the driver now exercises', () => {
    const caps = dshBaselineCapabilities()
    expect(caps.session.close).toMatchObject({ state: 'native', source: 'protocol-baseline' })
    expect(caps.observability.contextPressure).toMatchObject({ state: 'native', source: 'protocol-baseline' })
  })

  test('every leaf carries a state and a source', () => {
    for (const leaf of Object.values(dshBaselineCapabilities()).flatMap(group => Object.values(group))) {
      expect(['native', 'unsupported']).toContain(leaf.state)
      expect(SOURCES).toContain(leaf.source)
    }
  })

  test('a capability sourced from an extension is a valid leaf', () => {
    // No driver emits this source yet; the contract has to allow it before one can.
    const leaf: Capability = { state: 'native', source: 'extension' }
    expect(['native', 'unsupported']).toContain(leaf.state)
    expect(SOURCES).toContain(leaf.source)
    expect(leaf.source).toBe('extension')
  })

  test('returns a fresh snapshot each call', () => {
    const first = dshBaselineCapabilities()
    first.prompt.text.state = 'unsupported'
    expect(dshBaselineCapabilities().prompt.text.state).toBe('native')
  })
})
