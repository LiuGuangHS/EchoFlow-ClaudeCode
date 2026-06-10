import { beforeEach, describe, expect, test } from 'vitest'
import { runLegacyLocalStorageMigration } from './legacyLocalStorageMigration'

describe('legacy localStorage migration', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('copies legacy cc-haha keys into missing EchoFlow keys without deleting sources', () => {
    window.localStorage.setItem('cc-haha-open-tabs', '{"openTabs":[]}')
    window.localStorage.setItem('cc-haha-session-runtime', '{"session-1":{"providerId":null,"modelId":"claude"}}')
    window.localStorage.setItem('cc-haha-theme', 'dark')
    window.localStorage.setItem('cc-haha-locale', 'en')
    window.localStorage.setItem('cc-haha-ui-zoom', '1.25')
    window.localStorage.setItem('cc-haha-dismissed-update-version', '0.3.2')

    const report = runLegacyLocalStorageMigration()

    expect(report.copiedKeys).toEqual(expect.arrayContaining([
      'echoflow-code-open-tabs',
      'echoflow-code-session-runtime',
      'echoflow-code-theme',
      'echoflow-code-locale',
      'echoflow-code-app-zoom',
      'echoflow-code-dismissed-update-version',
    ]))
    expect(window.localStorage.getItem('echoflow-code-open-tabs')).toBe('{"openTabs":[]}')
    expect(window.localStorage.getItem('echoflow-code-app-zoom')).toBe('1.25')
    expect(window.localStorage.getItem('cc-haha-ui-zoom')).toBe('1.25')
  })

  test('does not overwrite existing EchoFlow keys', () => {
    window.localStorage.setItem('cc-haha-theme', 'dark')
    window.localStorage.setItem('echoflow-code-theme', 'white')
    window.localStorage.setItem('cc-haha-app-zoom', '1.4')
    window.localStorage.setItem('cc-haha-ui-zoom', '1.25')
    window.localStorage.setItem('echoflow-code-app-zoom', '1')

    const report = runLegacyLocalStorageMigration()

    expect(report.skippedKeys).toEqual(expect.arrayContaining([
      'echoflow-code-theme',
      'echoflow-code-app-zoom',
    ]))
    expect(window.localStorage.getItem('echoflow-code-theme')).toBe('white')
    expect(window.localStorage.getItem('echoflow-code-app-zoom')).toBe('1')
  })
})
