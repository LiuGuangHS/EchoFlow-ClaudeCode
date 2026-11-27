import { beforeEach, expect, test, vi } from 'vitest'
import { copyLegacyPreference, DESKTOP_PERSISTENCE_VERSION_KEY, LegacyCopyBlockedError } from './legacyPreferenceMigration'

const target = 'cc-haha-locale'
const marker = `cc-haha.persistence.legacyCopied.${target}`
const legacy = () => 'zh'

beforeEach(() => localStorage.clear())

test.each(['1', 'future-state'])('preserves an existing completion marker %s', (value) => {
  localStorage.setItem(marker, value)
  const before = { ...localStorage }
  const read = vi.fn(legacy)
  if (value === '1') expect(copyLegacyPreference(localStorage, target, read)).toBe(false)
  else expect(() => copyLegacyPreference(localStorage, target, read)).toThrow(LegacyCopyBlockedError)
  expect(read).not.toHaveBeenCalled()
  expect({ ...localStorage }).toEqual(before)
})

test('finishes a pending copy with a surviving current value without reading or replacing legacy data', () => {
  localStorage.setItem(marker, 'pending')
  localStorage.setItem(target, 'kr')
  const read = vi.fn(legacy)
  expect(copyLegacyPreference(localStorage, target, read)).toBe(false)
  expect(localStorage.getItem(target)).toBe('kr')
  expect(localStorage.getItem(marker)).toBe('1')
  expect(read).not.toHaveBeenCalled()
})

test('retains an uncertain intent if a write took effect before throwing, and never undoes a later clear', () => {
  const storage = {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: (key: string, value: string) => {
      localStorage.setItem(key, value)
      if (key === target) throw new Error('uncertain write')
    },
  }
  expect(() => copyLegacyPreference(storage, target, legacy)).toThrow('uncertain write')
  expect(localStorage.getItem(target)).toBe('zh')
  expect(localStorage.getItem(marker)).toBe('pending')
  localStorage.removeItem(target)
  expect(() => copyLegacyPreference(localStorage, target, legacy)).toThrow(LegacyCopyBlockedError)
  expect(localStorage.getItem(target)).toBeNull()
})

test('records a confirmed failed copy for retry, then completes without copying a second time', () => {
  expect(() => copyLegacyPreference({
    getItem: localStorage.getItem.bind(localStorage),
    setItem: (key, value) => {
      if (key === target) throw new Error('quota')
      localStorage.setItem(key, value)
    },
  }, target, legacy)).toThrow('quota')
  expect(localStorage.getItem(marker)).toBe('retry')
  expect(copyLegacyPreference(localStorage, target, legacy)).toBe(true)
  expect(localStorage.getItem(marker)).toBe('1')
  localStorage.removeItem(target)
  expect(copyLegacyPreference(localStorage, target, legacy)).toBe(false)
  expect(localStorage.getItem(target)).toBeNull()
})

test('future global schemas block even pending-marker recovery without any writes', () => {
  localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, ' 10\n')
  localStorage.setItem(marker, 'pending')
  localStorage.setItem(target, 'kr')
  const before = { ...localStorage }
  const read = vi.fn(legacy)
  expect(copyLegacyPreference(localStorage, target, read)).toBe(false)
  expect(read).not.toHaveBeenCalled()
  expect({ ...localStorage }).toEqual(before)
})

test('an unreadable schema causes exactly one read and no marker or data writes', () => {
  const getItem = vi.fn(() => { throw new Error('schema unavailable') })
  const setItem = vi.fn()
  const read = vi.fn(legacy)
  expect(() => copyLegacyPreference({ getItem, setItem }, target, read)).toThrow('schema unavailable')
  expect(getItem.mock.calls).toEqual([[DESKTOP_PERSISTENCE_VERSION_KEY]])
  expect(setItem).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})
