import { describe, expect, it } from 'vitest'
import { translate, type Locale } from './index'
import { en } from './locales/en'
import { jp } from './locales/jp'
import { kr } from './locales/kr'
import { zh } from './locales/zh'
import { zh as zhTW } from './locales/zh-TW'

const LOCALES = { en, jp, kr, zh, 'zh-TW': zhTW }

describe('voice vocabulary product copy', () => {
  it.each(Object.keys(LOCALES) as Locale[])('uses EchoFlow Code examples and interpolates session counts in %s', (locale) => {
    const example = translate(locale, 'voice.settings.vocabulary.bulk.placeholder')
    expect(example.split(' = ')[0]).toBe('EchoFlow Code')
    expect(example).not.toContain('cc-haha')
    const sessions = translate(locale, 'voice.settings.vocabulary.history.sessionsWithHaha', { days: 37, count: 12 })
    expect(sessions).toContain('EchoFlow Code')
    expect(sessions).toContain('37')
    expect(sessions).toContain('12')
    expect(sessions).not.toMatch(/cc-haha|\{days\}|\{count\}/)
  })
})

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
