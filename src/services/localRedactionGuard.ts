import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getEchoFlowConfigDir } from '../utils/echoFlowConfigRoot.js'
import { normalizeLocalRedactionSettings } from '../shared/localRedactionSettings.js'

const SETTINGS_FILE = 'settings.json'
const LOCAL_REDACTION_ERROR = 'Local redaction settings could not be loaded'

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasValidLocalRedactionShape(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false
  if (value.personalInfo !== undefined && typeof value.personalInfo !== 'boolean') return false
  return value.customWords === undefined || (
    Array.isArray(value.customWords) && value.customWords.every(word => typeof word === 'string')
  )
}

/** Direct OAuth transports must not bypass local redaction or its restore protocol. */
export async function assertDirectTransportAllowed(): Promise<void> {
  let raw: string
  try {
    raw = await readFile(path.join(getEchoFlowConfigDir(), SETTINGS_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new Error(LOCAL_REDACTION_ERROR)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(LOCAL_REDACTION_ERROR)
  }
  if (!isRecord(parsed)) throw new Error(LOCAL_REDACTION_ERROR)

  const localRedaction = parsed.localRedaction
  if (localRedaction !== undefined && !hasValidLocalRedactionShape(localRedaction)) {
    throw new Error(LOCAL_REDACTION_ERROR)
  }
  if (normalizeLocalRedactionSettings(localRedaction).enabled) {
    throw new Error('Local redaction is enabled; direct OAuth transport is unavailable')
  }
}
