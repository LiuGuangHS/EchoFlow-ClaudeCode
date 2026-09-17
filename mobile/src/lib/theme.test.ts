import { describe, expect, mock, test } from 'bun:test'

mock.module('react-native', () => ({
  useColorScheme: () => 'light',
}))

const { darkColors, lightColors } = await import('./theme')

describe('theme', () => {
  test('light and dark themes have the same keys', () => {
    const lightKeys = Object.keys(lightColors).sort()
    const darkKeys = Object.keys(darkColors).sort()
    expect(lightKeys).toEqual(darkKeys)
  })

  test('light theme uses light background', () => {
    expect(lightColors.background).toBe('#f8fafc')
    expect(lightColors.surface).toBe('#ffffff')
  })

  test('dark theme uses dark background', () => {
    expect(darkColors.background).toBe('#0f172a')
    expect(darkColors.surface).toBe('#1e293b')
  })

  test('themes have all required color keys', () => {
    const required = ['background', 'surface', 'text', 'primary', 'inputBg', 'inputBorder']
    for (const key of required) {
      expect(lightColors).toHaveProperty(key)
      expect(darkColors).toHaveProperty(key)
    }
  })
})
