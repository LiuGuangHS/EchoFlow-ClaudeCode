import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

/** Repo root, two levels above mobile/plugins/. */
const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const exists = (path: string) => existsSync(new URL(path, root))

test('mobile ships exactly one Expo app and one EAS delivery workflow', () => {
  expect(exists('mobile/legacy-webview/')).toBe(false)
  expect(exists('.github/workflows/release-mobile-apk.yml')).toBe(false)
  for (const required of [
    'mobile/app.json',
    'mobile/app.config.ts',
    'mobile/eas.json',
    'mobile/RELEASING.md',
    'scripts/mobile-release.ts',
    '.github/workflows/release-mobile.yml',
  ]) {
    expect(exists(required)).toBe(true)
  }
})

test('no legacy WebView references remain in the build and release inputs', () => {
  expect(read('.easignore')).not.toContain('legacy-webview')
  expect(read('.github/workflows/release-mobile.yml')).not.toContain('legacy-webview')
  expect(read('scripts/mobile-release.ts')).not.toContain('legacy-webview')
  expect(read('mobile/package.json')).not.toContain('legacy-webview')
})

test('the single app keeps one Android/iOS identity and one user version', () => {
  const expo = JSON.parse(read('mobile/app.json')).expo
  const pkg = JSON.parse(read('mobile/package.json'))
  expect(pkg.version).toBe(expo.version)
  expect(expo.android.package).toBe('com.echoflow.code.mobile')
  expect(expo.ios.bundleIdentifier).toBe(expo.android.package)
  expect(expo.scheme).toBe('codemobile')
})
