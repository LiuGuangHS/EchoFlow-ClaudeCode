import { useColorScheme } from 'react-native'

export type ThemeColors = {
  background: string
  surface: string
  surfaceBorder: string
  text: string
  textSecondary: string
  textMuted: string
  primary: string
  primaryPressed: string
  inputBg: string
  inputBorder: string
  inputText: string
  warningBg: string
  warningBorder: string
  warningText: string
  dangerBg: string
  dangerBorder: string
  dangerText: string
  scanButtonBg: string
  scanButtonBorder: string
  chipBg: string
  chipBorder: string
  chipText: string
  clipboardBg: string
  clipboardBorder: string
  clipboardText: string
  shadowColor: string
}

export const lightColors: ThemeColors = {
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceBorder: 'transparent',
  text: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#334155',
  primary: '#2563eb',
  primaryPressed: '#1d4ed8',
  inputBg: '#ffffff',
  inputBorder: '#cbd5e1',
  inputText: '#0f172a',
  warningBg: '#fff7ed',
  warningBorder: '#fed7aa',
  warningText: '#9a3412',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  dangerText: '#b91c1c',
  scanButtonBg: '#eff6ff',
  scanButtonBorder: '#bfdbfe',
  chipBg: '#f1f5f9',
  chipBorder: '#e2e8f0',
  chipText: '#334155',
  clipboardBg: '#f0fdf4',
  clipboardBorder: '#bbf7d0',
  clipboardText: '#166534',
  shadowColor: '#0f172a',
}

export const darkColors: ThemeColors = {
  background: '#0f172a',
  surface: '#1e293b',
  surfaceBorder: '#334155',
  text: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#cbd5e1',
  primary: '#3b82f6',
  primaryPressed: '#2563eb',
  inputBg: '#0f172a',
  inputBorder: '#475569',
  inputText: '#f1f5f9',
  warningBg: '#422006',
  warningBorder: '#78340f',
  warningText: '#fdba74',
  dangerBg: '#450a0a',
  dangerBorder: '#7f1d1d',
  dangerText: '#fca5a5',
  scanButtonBg: '#1e293b',
  scanButtonBorder: '#334155',
  chipBg: '#1e293b',
  chipBorder: '#334155',
  chipText: '#cbd5e1',
  clipboardBg: '#052e16',
  clipboardBorder: '#14532d',
  clipboardText: '#86efac',
  shadowColor: '#000000',
}

export function useTheme(): ThemeColors {
  const colorScheme = useColorScheme()
  return colorScheme === 'dark' ? darkColors : lightColors
}
