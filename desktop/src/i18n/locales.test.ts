import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { jp } from './locales/jp'
import { kr } from './locales/kr'
import { zh } from './locales/zh'
import { zh as zhTW } from './locales/zh-TW'

const LOCALES = { en, jp, kr, zh, 'zh-TW': zhTW }

describe('EchoFlow SiHub copy', () => {
  it('presents the API business as recommended access, never as official or region-locked', () => {
    for (const [name, locale] of Object.entries(LOCALES)) {
      const text = `${locale['settings.providers.echoflowAPIOfficialName']} ${locale['settings.providers.echoflowAPIOfficialDesc']}`

      expect(text, name).toContain('EchoFlow SiHub')
      expect(text, name).not.toMatch(/官方|official|공식|公式|清雲|청운|国内|中国|china/i)
    }
  })

  it('states the legal-region limit in every locale', () => {
    for (const [name, locale] of Object.entries(LOCALES)) {
      expect(locale['settings.providers.echoflowAPIOfficialDisclaimer'], name)
        .toMatch(/法律|law|법률|法令/)
    }
  })
})
