export type LocalRedactionSettings = {
  enabled: boolean
  personalInfo: boolean
  customWords: string[]
}

export const DEFAULT_LOCAL_REDACTION_SETTINGS: LocalRedactionSettings = {
  enabled: false,
  personalInfo: false,
  customWords: [],
}

export function normalizeLocalRedactionSettings(value: unknown): LocalRedactionSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_LOCAL_REDACTION_SETTINGS }
  const record = value as Record<string, unknown>
  return {
    enabled: record.enabled === true,
    personalInfo: record.personalInfo === true,
    customWords: Array.isArray(record.customWords)
      ? [...new Set(record.customWords.filter((word): word is string => typeof word === 'string').map(word => word.trim()).filter(Boolean))].slice(0, 100)
      : [],
  }
}
