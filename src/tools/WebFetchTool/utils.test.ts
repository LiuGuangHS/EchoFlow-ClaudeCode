import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { shouldSkipWebFetchPreflight } from './utils.js'

describe('shouldSkipWebFetchPreflight', () => {
  const originalEchoFlowDesktopServerUrl = process.env.ECHOFLOW_DESKTOP_SERVER_URL
  const originalDesktopServerUrl = process.env.ECHOFLOW_DESKTOP_SERVER_URL

  beforeEach(() => {
    delete process.env.ECHOFLOW_DESKTOP_SERVER_URL
    delete process.env.ECHOFLOW_DESKTOP_SERVER_URL
  })

  afterEach(() => {
    if (originalEchoFlowDesktopServerUrl === undefined) {
      delete process.env.ECHOFLOW_DESKTOP_SERVER_URL
    } else {
      process.env.ECHOFLOW_DESKTOP_SERVER_URL = originalEchoFlowDesktopServerUrl
    }
    if (originalDesktopServerUrl === undefined) {
      delete process.env.ECHOFLOW_DESKTOP_SERVER_URL
    } else {
      process.env.ECHOFLOW_DESKTOP_SERVER_URL = originalDesktopServerUrl
    }
  })


  test('respects explicit true from settings', () => {
    expect(
      shouldSkipWebFetchPreflight({ skipWebFetchPreflight: true }),
    ).toBe(true)
  })

  test('respects explicit false from settings even on desktop', () => {
    process.env.ECHOFLOW_DESKTOP_SERVER_URL = 'http://127.0.0.1:3456'

    expect(
      shouldSkipWebFetchPreflight({ skipWebFetchPreflight: false }),
    ).toBe(false)
  })

  test('defaults to enabled for desktop sessions', () => {
    process.env.ECHOFLOW_DESKTOP_SERVER_URL = 'http://127.0.0.1:3456'

    expect(shouldSkipWebFetchPreflight({})).toBe(true)
  })

  test('does not enable the desktop bridge from a retired environment variable', () => {
    process.env.ECHOFLOW_DESKTOP_SERVER_URL = 'http://127.0.0.1:3456'

    expect(shouldSkipWebFetchPreflight({})).toBe(false)
  })

  test('defaults to disabled outside desktop sessions', () => {
    expect(shouldSkipWebFetchPreflight({})).toBe(false)
  })
})
