import * as pako from 'pako'
import type { ShareableConfig, ShareableProvider } from '../types/configShare'
import type { SavedProvider } from '../types/provider'

export type { ShareableConfig, ShareableProvider } from '../types/configShare'

const MAX_LINK_AGE = 30 * 86400 * 1000
const ALLOWED_API_FORMATS = new Set(['anthropic', 'openai_chat', 'openai_responses'])
const ALLOWED_AUTH_STRATEGIES = new Set([
  'api_key',
  'auth_token',
  'auth_token_empty_api_key',
  'dual_same_token',
  'dual_dummy',
])
const SENSITIVE_KEYS = /^(api.?key|auth.?token|access.?token|refresh.?token|credential|secret|keyPreview)$/i
const CONFIG_FIELDS = new Set(['providers'])
const PROVIDER_FIELDS = new Set([
  'presetId', 'name', 'baseUrl', 'apiFormat', 'authStrategy', 'runtimeKind', 'models',
  'model1mSupport', 'autoCompactWindow', 'modelContextWindows', 'toolSearchEnabled',
  'disableExperimentalBetas', 'supportsNestedToolResultMedia', 'requestCompatibility',
  'imageGeneration', 'notes',
])

export function encodeConfigPayload(config: ShareableConfig): string {
  const compressed = pako.deflate(JSON.stringify(config))
  const base64 = btoa(String.fromCharCode(...compressed))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function decodeConfigPayload(data: string): ShareableConfig {
  let base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='
  const compressed = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(pako.inflate(compressed))) as ShareableConfig
}

export function validateConfigPayload(payload: unknown): {
  valid: boolean
  error?: string
  message?: string
} {
  if (!isRecord(payload) || payload.version !== 1) {
    return { valid: false, error: 'unsupported_version', message: 'Unsupported config version' }
  }
  if (typeof payload.source !== 'string' || !isRecord(payload.config)
    || Object.keys(payload.config).some(key => !CONFIG_FIELDS.has(key))
    || !Array.isArray(payload.config.providers)) {
    return { valid: false, error: 'invalid_payload', message: 'Invalid provider configuration' }
  }
  if (typeof payload.timestamp !== 'number' || !Number.isFinite(payload.timestamp)) {
    return { valid: false, error: 'invalid_payload', message: 'Invalid config timestamp' }
  }
  const age = Date.now() - payload.timestamp
  if (age > MAX_LINK_AGE || age < -5 * 60 * 1000) {
    return { valid: false, error: 'expired', message: 'Config link has expired or has an invalid date' }
  }
  if (containsSensitiveData(payload)) {
    return { valid: false, error: 'contains_secrets', message: 'Config contains sensitive data' }
  }
  if (payload.config.providers.length === 0 || payload.config.providers.length > 50) {
    return { valid: false, error: 'invalid_payload', message: 'Config must contain 1–50 providers' }
  }
  if (!payload.config.providers.every(isShareableProvider)) {
    return { valid: false, error: 'invalid_payload', message: 'Invalid provider configuration' }
  }
  return { valid: true }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isShareableProvider(value: unknown): value is ShareableProvider {
  if (!isRecord(value) || Object.keys(value).some(key => !PROVIDER_FIELDS.has(key))) return false
  return typeof value.name === 'string' && value.name.trim().length > 0
    && typeof value.presetId === 'string'
    && typeof value.baseUrl === 'string'
    && isHttpUrl(value.baseUrl)
    && typeof value.apiFormat === 'string' && ALLOWED_API_FORMATS.has(value.apiFormat)
    && (value.authStrategy === undefined || (typeof value.authStrategy === 'string' && ALLOWED_AUTH_STRATEGIES.has(value.authStrategy)))
    && isRecord(value.models)
    && ['main', 'haiku', 'sonnet', 'opus'].every(key => typeof value.models[key] === 'string')
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function containsSensitiveData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveData)
  if (!isRecord(value)) return false
  return Object.entries(value).some(([key, nested]) => SENSITIVE_KEYS.test(key) || containsSensitiveData(nested))
}

/** Builds a strict import DTO instead of copying local IDs or credential metadata. */
export function sanitizeProviderForSharing(provider: SavedProvider): ShareableProvider {
  return {
    presetId: provider.presetId,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiFormat: provider.apiFormat,
    ...(provider.authStrategy && { authStrategy: provider.authStrategy }),
    ...(provider.runtimeKind && { runtimeKind: provider.runtimeKind }),
    models: { ...provider.models },
    ...(provider.model1mSupport && { model1mSupport: { ...provider.model1mSupport } }),
    ...(provider.autoCompactWindow !== undefined && { autoCompactWindow: provider.autoCompactWindow }),
    ...(provider.modelContextWindows && { modelContextWindows: { ...provider.modelContextWindows } }),
    ...(provider.toolSearchEnabled !== undefined && { toolSearchEnabled: provider.toolSearchEnabled }),
    ...(provider.disableExperimentalBetas !== undefined && { disableExperimentalBetas: provider.disableExperimentalBetas }),
    ...(provider.supportsNestedToolResultMedia !== undefined && { supportsNestedToolResultMedia: provider.supportsNestedToolResultMedia }),
    ...(provider.requestCompatibility && { requestCompatibility: pickRequestCompatibility(provider.requestCompatibility) }),
    ...(provider.imageGeneration && {
      imageGeneration: {
        model: provider.imageGeneration.model,
        ...(provider.imageGeneration.baseUrl && { baseUrl: provider.imageGeneration.baseUrl }),
      },
    }),
    ...(provider.notes && { notes: provider.notes }),
  }
}

function pickRequestCompatibility(value: NonNullable<SavedProvider['requestCompatibility']>) {
  const fields = [
    'maxOutputTokens', 'outputTokenLimit', 'outputTokenField', 'sampling', 'reasoning',
    'parallelTools', 'structuredOutput',
  ] as const
  return Object.fromEntries(fields.flatMap(key => value[key] === undefined ? [] : [[key, value[key]]]))
}

export const providerToShareable = sanitizeProviderForSharing

export function generateDeepLinkUrl(config: ShareableConfig): string {
  return `echoflowcode://config/import?v=1&data=${encodeConfigPayload(config)}`
}

/** Compatibility alias for provider-oriented deep-link templates. */
export function generateProviderDeepLinkUrl(config: ShareableConfig): string {
  return `echoflowcode://provider/add?v=1&data=${encodeConfigPayload(config)}`
}

export function parseDeepLinkUrl(url: string): { action: string; params: URLSearchParams } | null {
  try {
    if (!url.startsWith('echoflowcode://')) return null
    const urlObj = new URL(url)
    return { action: urlObj.hostname + urlObj.pathname, params: urlObj.searchParams }
  } catch {
    return null
  }
}
