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

  test('synchronizes the Android version files through JSON extra-files', () => {
    // The paths are root-relative: the desktop package resolves relative
    // paths against its own directory.
    expect(config.packages.desktop['extra-files']).toEqual([
      { type: 'json', path: '/mobile/package.json', jsonpath: '$.version' },
      { type: 'json', path: '/mobile/app.json', jsonpath: '$.version' },
    ])
  })

  test('bases the next release on the last published tag', () => {
    expect(manifest).toEqual({ desktop: '0.7.2' })
  })

  test('bumps the patch for features and breaking changes below 1.0.0', () => {
    // bump-minor-pre-major turns breaking changes into a minor bump and
    // bump-patch-for-minor-pre-major turns features into a patch bump.
    // Neither makes a breaking change a patch bump on its own, so the
    // patch-only policy needs its own versioning strategy.
    expect(config['bump-patch-for-minor-pre-major']).toBe(true)
    expect(config.packages.desktop['versioning']).toBe('always-bump-patch')
  })

  test('keeps the three version fields on the same product version', () => {
    expect(desktopPkg.version).toBe('0.7.3')
    expect(mobilePkg.version).toBe(desktopPkg.version)
    expect(mobileApp.version).toBe(desktopPkg.version)
  })
})
