import { describe, expect, test } from 'bun:test'
import { dshBaselineCapabilities } from '../capabilitySnapshot.js'

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
    expect(caps.extensions.mcpStdio.state).toBe('unsupported')
    expect(caps.observability.diffs.state).toBe('unsupported')
  })

  test('every leaf carries a state and a source', () => {
    for (const leaf of Object.values(dshBaselineCapabilities()).flatMap(group => Object.values(group))) {
      expect(['native', 'unsupported']).toContain(leaf.state)
      expect(['handshake', 'protocol-baseline', 'version-assumption']).toContain(leaf.source)
    }
  })

  test('returns a fresh snapshot each call', () => {
    const first = dshBaselineCapabilities()
    first.prompt.text.state = 'unsupported'
    expect(dshBaselineCapabilities().prompt.text.state).toBe('native')
  })
})
