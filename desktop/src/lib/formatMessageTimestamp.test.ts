import { describe, expect, it } from 'vitest'
import { translate, type Locale } from '../i18n'
import { formatMessageTimestamp } from './formatMessageTimestamp'

const t = (locale: Locale) => (
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
) => translate(locale, key, params)

describe('formatMessageTimestamp', () => {
  const now = new Date(2026, 4, 29, 16, 0).getTime()

  it('uses relative labels for recent messages', () => {
    expect(formatMessageTimestamp(now - 5 * 60_000, t('zh'), 'zh', now)).toBe('5分钟前')
    expect(formatMessageTimestamp(now - 2 * 60 * 60_000, t('en'), 'en', now)).toBe('2h ago')
  })

  it('uses weekday and clock time for recent history', () => {
    const value = new Date(2026, 4, 24, 15, 50).getTime()

    expect(formatMessageTimestamp(value, t('zh'), 'zh', now)).toBe('星期日15:50')
  })

  it('includes the calendar date for older messages', () => {
    const value = new Date(2026, 3, 20, 9, 30).getTime()

    expect(formatMessageTimestamp(value, t('zh'), 'zh', now)).toBe('4月20日 09:30')
  })
})
