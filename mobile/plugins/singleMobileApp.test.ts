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

test('Duty notification links use the registered scheme and stay scoped to this package', () => {
  const { scheme } = JSON.parse(read('mobile/app.json')).expo
  const duty = read('mobile/modules/cchaha-duty/android/src/main/java/app/cchaha/duty/DutyService.kt')
  expect(duty.match(/"([^":]+):\/\/\/chat\//)?.[1]).toBe(scheme)
  expect(duty).toContain(`val base = sessionId?.let { "${scheme}:///chat/\${enc(it)}?host=\${enc(host.hostId)}"`)
  expect(duty).toContain('requestId?.let { id -> "&requestId=${enc(id)}" }')
  expect(duty).toContain('URLEncoder.encode(value, "UTF-8").replace("+", "%20")')
  expect(duty).toContain('Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(packageName)')
  expect(duty).toContain('else packageManager.getLaunchIntentForPackage(packageName) ?: Intent().setPackage(packageName)')
  expect(duty).toContain('.setContentIntent(launchIntent(base))')
  expect(duty).toContain('.setContentIntent(launchIntent(null))')
  expect(duty).toContain('base != null && requestId != null')
  expect(duty).toContain('launchIntent("$base&notificationAction=allow")')
  expect(duty).toContain('launchIntent("$base&notificationAction=deny")')
})
