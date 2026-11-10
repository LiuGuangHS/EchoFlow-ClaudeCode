import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  buildSocketOptions,
  connectionHeaders,
  normalizeHostUrl,
  parseConnectionInput,
} from './connection'
import { notificationPermissionResponse } from './chatActions'
import type { ChatState, Host } from './types'

/**
 * The legacy Android WebView shell (mobile/legacy-webview) has been removed.
 * Its worthwhile behaviour now lives in the native Expo app; these contracts
 * pin that behaviour so a later refactor cannot silently drop it.
 */
const app = JSON.parse(
  readFileSync(new URL('../../app.json', import.meta.url), 'utf8'),
).expo as {
  name: string
  version: string
  scheme: string
  icon: string
  ios: { bundleIdentifier: string, icon: string }
  android: { package: string }
}

const lan: Host = {
  id: 'lan',
  name: 'LAN',
  url: 'http://192.168.1.12:3456',
  auth: 'lan',
}

describe('legacy WebView shell parity', () => {
  test('desktop LAN QR codes produced by the old shell still connect, without leaving the token in the host URL', () => {
    const qr = 'http://192.168.1.12:3456/?serverUrl=' + encodeURIComponent(lan.url) + '&h5Token=fixture-token'
    const parsed = parseConnectionInput(qr)
    expect(parsed).toEqual({ url: lan.url, auth: 'lan', credential: 'fixture-token' })
    expect(parsed.url).not.toContain('fixture-token')
  })

  test('credentials travel in an Authorization header, never in the native socket query string', () => {
    expect(connectionHeaders(lan, 'fixture-token')).toEqual({
      Authorization: 'Bearer fixture-token',
    })
    const socket = buildSocketOptions(lan, 'fixture-token', 'session-1', 'native')
    expect(socket.url).not.toContain('fixture-token')
    expect(socket.headers?.Authorization).toBe('Bearer fixture-token')
  })

  test('host URLs reject paths, queries and fragments, and remote connections require HTTPS', () => {
    for (const bad of [
      lan.url + '/remote',
      lan.url + '/?serverUrl=x',
      lan.url + '/#pair=x',
    ]) {
      expect(() => normalizeHostUrl(bad, 'lan')).toThrow()
    }
    expect(() => normalizeHostUrl('http://fixture.invalid', 'remote')).toThrow(/HTTPS/)
  })

  test('tool approval keeps the same protocol and never treats a question as blanket permission', () => {
    const state = {
      permissions: [
        { requestId: 'req-1', toolName: 'Bash' },
        { requestId: 'req-2', toolName: 'AskUserQuestion' },
        { requestId: 'req-3', toolName: 'ExitPlanMode' },
      ],
    } as unknown as ChatState
    expect(notificationPermissionResponse(state, 'allow', 'req-1')).toEqual({
      type: 'permission_response',
      requestId: 'req-1',
      allowed: true,
    })
    expect(notificationPermissionResponse(state, 'deny', 'req-2')).toBeNull()
    expect(notificationPermissionResponse(state, 'allow', 'req-3')).toBeNull()
    expect(notificationPermissionResponse(state, 'allow', 'unknown')).toBeNull()
  })

  test('app identity, deep link scheme and version stay aligned with the single mobile app', () => {
    expect(app.name).toBe('EchoFlow Code')
    expect(app.scheme).toBe('codemobile')
    expect(app.android.package).toBe('com.echoflow.code.mobile')
    expect(app.ios.bundleIdentifier).toBe(app.android.package)
    expect(app.icon).toBe('./assets/icon.png')
    expect(app.ios.icon).toBe('./assets/icon-ios.png')
    expect(/^\d+\.\d+\.\d+$/.test(app.version)).toBe(true)
  })
})
