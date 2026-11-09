import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getEchoFlowConfigDir } from '../utils/echoFlowConfigRoot.js'
import { normalizeLocalRedactionSettings, type LocalRedactionSettings } from '../shared/localRedactionSettings.js'

const SETTINGS_FILE = 'settings.json'
const LOCAL_REDACTION_ERROR = 'Local redaction settings could not be loaded'

type RecordValue = Record<string, unknown>

export type LocalRedactionState = {
  enabled: boolean
  settings: LocalRedactionSettings
}

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

/** Parse an already-read settings file. Any malformed or ambiguous state is an
 *  error so callers can refuse plaintext transport instead of guessing that
 *  redaction is off. */
function parseLocalRedactionState(raw: string): LocalRedactionState {
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
  const settings = normalizeLocalRedactionSettings(localRedaction)
  return { enabled: settings.enabled, settings }
}

/** Synchronous, fail-closed read for the proxy and managed-env builders.
 *  A missing settings file means redaction was never configured. */
export function readLocalRedactionState(): LocalRedactionState {
  let raw: string
  try {
    raw = readFileSync(path.join(getEchoFlowConfigDir(), SETTINGS_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { enabled: false, settings: normalizeLocalRedactionSettings(undefined) }
    }
    throw new Error(LOCAL_REDACTION_ERROR)
  }
  return parseLocalRedactionState(raw)
}

/** True when redaction is on OR the settings cannot be trusted. An unknown
 *  state must never downgrade a request into plaintext direct transport. */
export function shouldForceProxyForRedaction(): boolean {
  try {
    return readLocalRedactionState().enabled
  } catch {
    return true
  }
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
  const { enabled } = parseLocalRedactionState(raw)
  if (enabled) {
    throw new Error('Local redaction is enabled; direct OAuth transport is unavailable')
  }
}
