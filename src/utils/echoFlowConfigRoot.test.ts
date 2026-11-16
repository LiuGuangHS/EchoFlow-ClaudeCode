import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { PRODUCT_IDENTITY } from './productIdentity.generated'
import { buildEchoFlowOwnershipMarker, getDefaultEchoFlowConfigDir, getEchoFlowConfigDir, getEchoFlowInternalDir } from './echoFlowConfigRoot'

describe('central product storage identity', () => {
  test('derives default platform roots without changing external overrides', () => {
    const homeDir = path.resolve('fixture-home')
    const env = { LOCALAPPDATA: path.join(homeDir, 'Local'), XDG_DATA_HOME: path.join(homeDir, 'data') }
    expect(getDefaultEchoFlowConfigDir({ env, homeDir, platform: 'win32' })).toBe(path.join(env.LOCALAPPDATA, PRODUCT_IDENTITY.name))
    expect(getDefaultEchoFlowConfigDir({ env, homeDir, platform: 'darwin' })).toBe(path.join(homeDir, 'Library', 'Application Support', PRODUCT_IDENTITY.name))
    expect(getDefaultEchoFlowConfigDir({ env, homeDir, platform: 'linux' })).toBe(path.join(env.XDG_DATA_HOME, PRODUCT_IDENTITY.configDir))
    expect(getEchoFlowConfigDir({ env: { CLAUDE_CONFIG_DIR: 'explicit-root' } })).toBe('explicit-root')
    expect(getEchoFlowInternalDir('fixture-root')).toBe(path.join('fixture-root', PRODUCT_IDENTITY.configDir))
  })

  test('preserves the existing ownership marker schema and central identity', () => {
    expect(buildEchoFlowOwnershipMarker()).toEqual({
      owner: PRODUCT_IDENTITY.name,
      appId: PRODUCT_IDENTITY.appId,
      schemaVersion: 1,
    })
  })
})
