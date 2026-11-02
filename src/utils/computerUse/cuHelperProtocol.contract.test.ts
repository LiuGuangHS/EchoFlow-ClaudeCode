import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CU_HELPER_PROTOCOL_VERSION } from './cuHelperDaemon.js'

// Client and daemon each spell the version, and only a live handshake compares
// them — which needs macOS, a signed helper and GUI permissions. Read the
// helper's own source so a one-sided rename fails in CI instead of at runtime.
const DAEMON_PROTOCOL_SWIFT = join(
  import.meta.dir,
  '../../../native/cu-helper/Sources/cu-helper/DaemonProtocol.swift',
)

function swiftProtocolVersion(): string {
  const match = readFileSync(DAEMON_PROTOCOL_SWIFT, 'utf8').match(/static let version = "([^"]+)"/)
  if (!match) throw new Error('DaemonProtocol.swift no longer declares `static let version`')
  return match[1]
}

describe('cu-helper protocol version', () => {
  test('the client and the Swift daemon declare the same version', () => {
    expect(swiftProtocolVersion()).toBe(CU_HELPER_PROTOCOL_VERSION)
  })
})
