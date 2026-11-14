import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'))
const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'))
const desktopPkg = JSON.parse(readFileSync('desktop/package.json', 'utf8'))
const mobilePkg = JSON.parse(readFileSync('mobile/package.json', 'utf8'))
const mobileApp = JSON.parse(readFileSync('mobile/app.json', 'utf8'))

describe('release please configuration', () => {
  test('keeps a single desktop package so one release owns one tag', () => {
    expect(Object.keys(config.packages)).toEqual(['desktop'])
    expect(config.packages.desktop['release-type']).toBe('node')
  })

  test('produces a bare vX.Y.Z tag instead of a component-qualified one', () => {
    // The desktop package name would otherwise be injected into the tag
    // (claude-code-desktop-v0.7.3) and break the desktop release contract.
    expect(config.packages.desktop['include-component-in-tag']).toBe(false)
    expect(config.packages.desktop['include-v-in-tag']).toBe(true)
  })

  test('keeps the hand-authored release notes and does not generate a changelog', () => {
    expect(config.packages.desktop['skip-changelog']).toBe(true)
    expect(config['skip-changelog']).toBe(true)
    expect(config.packages.desktop['changelog-path']).toBeUndefined()
  })

  test('keeps the mobile user version independent of desktop releases', () => {
    // mobile/app.json and mobile/package.json are hashed into the mobile
    // delivery fingerprint. Syncing them on every desktop release changes
    // the fingerprint each time and forces a needless EAS build. The mobile
    // version moves only via scripts/release.ts --mobile.
    const extraFiles = config.packages.desktop['extra-files'] ?? []
    expect(extraFiles.some((entry: { path: string }) => entry.path.includes('/mobile/'))).toBe(false)
  })

  test('does not pin release-as to the already published manifest version', () => {
    expect(config.packages.desktop['release-as']).not.toBe(manifest.desktop)
  })

  test('uses one-time commit footers instead of persistent release-as pins', () => {
    expect(config['release-as']).toBeUndefined()
    expect(config.packages.desktop['release-as']).toBeUndefined()
  })

  test('bases the next release on the last published tag', () => {
    // The manifest records the last published version, so its value moves with every release.
    expect(Object.keys(manifest)).toEqual(['desktop'])
    expect(manifest.desktop).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('bumps the patch for features and breaking changes below 1.0.0', () => {
    // bump-minor-pre-major turns breaking changes into a minor bump and
    // bump-patch-for-minor-pre-major turns features into a patch bump.
    // Neither makes a breaking change a patch bump on its own, so the
    // patch-only policy needs its own versioning strategy.
    expect(config['bump-patch-for-minor-pre-major']).toBe(true)
    expect(config.packages.desktop['versioning']).toBe('always-bump-patch')
  })

  test('keeps the mobile package and Expo app versions synchronized', () => {
    expect(desktopPkg.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(mobilePkg.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(mobileApp.expo.version).toBe(mobilePkg.version)
  })
})
