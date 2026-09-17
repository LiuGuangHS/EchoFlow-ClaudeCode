const DEEPSEEK_THINKING_CAPABILITIES =
  'thinking,effort,adaptive_thinking,xhigh_effort,max_effort'

const DEEPSEEK_CAPABILITY_ENV_KEYS = [
  'ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
] as const

const LEGACY_IMAGE_ENV_KEY_MAP = {
  ECHOFLOW_IMAGE_PROVIDER_KIND: 'ECHOFLOW_IMAGE_PROVIDER_KIND',
  ECHOFLOW_IMAGE_PROVIDER_ID: 'ECHOFLOW_IMAGE_PROVIDER_ID',
  ECHOFLOW_IMAGE_BASE_URL: 'ECHOFLOW_IMAGE_BASE_URL',
  ECHOFLOW_IMAGE_API_KEY: 'ECHOFLOW_IMAGE_API_KEY',
  ECHOFLOW_IMAGE_MODEL: 'ECHOFLOW_IMAGE_MODEL',
} as const

function looksLikeDeepSeekManagedEnv(env: Record<string, string>): boolean {
  const baseUrl = env.ANTHROPIC_BASE_URL ?? ''
  const modelIds = [
    env.ANTHROPIC_MODEL,
    env.ANTHROPIC_DEFAULT_FABLE_MODEL,
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    env.ANTHROPIC_DEFAULT_OPUS_MODEL,
  ].filter(Boolean)

  return (
    baseUrl.includes('api.deepseek.com') ||
    modelIds.some((model) => /^deepseek[-_]/i.test(model ?? ''))
  )
}

export function normalizeLegacyDeepSeekManagedEnv(
  env: Record<string, string>,
): { env: Record<string, string>; changed: boolean } {
  if (!env.ECHOFLOW_SEND_DISABLED_THINKING || !looksLikeDeepSeekManagedEnv(env)) {
    return { env, changed: false }
  }

  const next = { ...env }
  delete next.ECHOFLOW_SEND_DISABLED_THINKING

  for (const key of DEEPSEEK_CAPABILITY_ENV_KEYS) {
    next[key] = DEEPSEEK_THINKING_CAPABILITIES
  }

  return { env: next, changed: true }
}

export function normalizeLegacyImageGenerationEnv(
  env: Record<string, unknown>,
): { env: Record<string, unknown>; changed: boolean } {
  const next = { ...env }
  let changed = false

  for (const [legacyKey, nextKey] of Object.entries(LEGACY_IMAGE_ENV_KEY_MAP)) {
    if (!(legacyKey in next)) continue
    if (next[nextKey] === undefined && typeof next[legacyKey] === 'string') {
      next[nextKey] = next[legacyKey]
    }
    delete next[legacyKey]
    changed = true
  }

  return { env: next, changed }
}
