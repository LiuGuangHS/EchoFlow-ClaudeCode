import { describe, expect, test } from 'bun:test'
import { buildStartupFailureMessage } from './startupFailureMessage.js'

// Bun 1.3.14 reports every listen() failure with this exact shape: errno is
// always 0, there is no `cause`, and the message blames a port conflict even
// when the port was kernel-assigned (0). The raw fields are the only evidence
// that distinguishes the real triggers.
function bunBindFailure(port: number): Error {
  return Object.assign(new Error(`Failed to start server. Is port ${port} in use?`), {
    code: 'EADDRINUSE',
    errno: 0,
    syscall: 'listen',
  })
}

describe('buildStartupFailureMessage', () => {
  test('a kernel-assigned port never claims a port conflict', () => {
    const message = buildStartupFailureMessage(bunBindFailure(0), '127.0.0.1', 0)
    expect(message).not.toContain('in use')
    expect(message).toContain('127.0.0.1:0')
    expect(message).toContain('code=EADDRINUSE')
    expect(message).toContain('errno=0')
    expect(message).toContain('syscall=listen')
  })

  test('a requested port keeps the familiar hint and appends the raw bind fields', () => {
    const message = buildStartupFailureMessage(bunBindFailure(3456), '127.0.0.1', 3456)
    expect(message.startsWith('Failed to start server. Is port 3456 in use?')).toBe(true)
    expect(message).toContain('requested 127.0.0.1:3456')
    expect(message).toContain('code=EADDRINUSE')
    expect(message).toContain('errno=0')
    expect(message).toContain('syscall=listen')
  })

  test('a genuine failure message survives even at a kernel-assigned port', () => {
    const message = buildStartupFailureMessage(new TypeError('x is not a function'), '127.0.0.1', 0)
    expect(message).toContain('x is not a function')
  })

  test('an error without a message keeps the port claim for a requested port', () => {
    const message = buildStartupFailureMessage(new Error(''), '127.0.0.1', 3456)
    expect(message.startsWith('Failed to start server. Is port 3456 in use?')).toBe(true)
    expect(message).toContain('requested 127.0.0.1:3456')
  })

  test('an error without a message still reports the endpoint and missing fields', () => {
    const message = buildStartupFailureMessage(new Error(''), '127.0.0.1', 0)
    expect(message).not.toContain('in use')
    expect(message).toContain('127.0.0.1:0')
    expect(message).toContain('code=none')
    expect(message).toContain('errno=none')
    expect(message).toContain('syscall=none')
  })

  test('a non-Error throwable never breaks the message builder', () => {
    expect(buildStartupFailureMessage({ code: 'EADDRINUSE', errno: 0, syscall: 'listen' }, '127.0.0.1', 0))
      .toContain('errno=0')
    expect(buildStartupFailureMessage('listen failed', '127.0.0.1', 3456))
      .toContain('listen failed')
    expect(() => buildStartupFailureMessage(undefined, '127.0.0.1', 0)).not.toThrow()
  })
})
