import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const appConfig = JSON.parse(read('../app.json'))
const packageConfig = JSON.parse(read('../package.json'))

describe('native Android app contract', () => {
  test('keeps release version and Android identity aligned', () => {
    const gradle = read('../android/app/build.gradle')
    const manifest = read('../android/app/src/main/AndroidManifest.xml')

    expect(packageConfig.version).toBe(appConfig.version)
    expect(appConfig.android.package).toBe('com.echoflow.code.mobile')
    expect(gradle).toContain('applicationId appId')
    expect(manifest).toContain('com.echoflow.code.mobile.MainActivity')
  })

  test('keeps the minimal native shell integrations wired', () => {
    const manifest = read('../android/app/src/main/AndroidManifest.xml')
    const gradle = read('../android/app/build.gradle')
    const activity = read('../android/app/src/main/java/com/echoflow/code/mobile/MainActivity.kt')
    const credentialStore = read('../android/app/src/main/java/com/echoflow/code/mobile/CredentialStore.kt')
    const permissions = read('../android/app/src/main/java/com/echoflow/code/mobile/PermissionSession.kt')

    expect(manifest).toContain('android.permission.INTERNET')
    expect(appConfig.android.usesCleartextTraffic).toBe(true)
    expect(manifest).toContain(`android:usesCleartextTraffic="${appConfig.android.usesCleartextTraffic}"`)
    expect(manifest).not.toContain('android.permission.CAMERA')
    expect(manifest).toContain('com.google.mlkit.vision.DEPENDENCIES')
    expect(gradle).toContain('play-services-code-scanner')
    expect(gradle).toContain('com.squareup.okhttp3:okhttp')
    expect(gradle).toContain('androidx.webkit:webkit')
    expect(activity).toContain('GmsBarcodeScanning.getClient')
    expect(activity).toContain('settings.allowFileAccess = false')
    expect(activity).toContain('onShowFileChooser')
    expect(credentialStore).toContain('AndroidKeyStore')
    expect(credentialStore).toContain('AES/GCM/NoPadding')
    expect(credentialStore).toContain('MAX_RECENT_SERVERS = 5')
    expect(activity).toContain('确认 Agent 操作')
    expect(permissions).toContain('permission_request')
    expect(permissions).toContain('permission_response')
    expect(permissions).not.toContain('"control_request"')
    expect(permissions).not.toContain('"control_response"')
    expect(permissions).toContain('permission_resolved')
    expect(permissions).toContain('AskUserQuestion')
    expect(permissions).toContain('Denied by user')
    expect(permissions).toContain('connectionGeneration')
    expect(read('../android/app/src/main/java/com/echoflow/code/mobile/Connection.kt')).toContain('isSameOrigin')
  })

  test('does not retain the Expo or React Native runtime', () => {
    const dependencies = {
      ...packageConfig.dependencies,
      ...packageConfig.devDependencies,
    }

    expect(Object.keys(dependencies)).toEqual([])
    expect(read('../android/settings.gradle')).not.toContain('expo')
    expect(read('../android/settings.gradle')).not.toContain('react-native')
  })
})
