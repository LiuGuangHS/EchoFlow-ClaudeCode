import { afterEach, describe, expect, test } from 'bun:test'
import { isGoalPromptHookCommand } from '../goals/goalState.js'
import { shouldForceOpenAICodexProvider } from '../services/api/client.js'
import { parseOpenAIReasoningEnvelope } from './openAIReasoningEnvelope.js'
import { normalizeLegacyImageGenerationEnv } from './providerManagedEnvCompat.js'
import { shouldSendExplicitDisabledThinking } from './thinking.js'

// Users upgrade with state written under the old names: settings.json env
// entries, goal hooks, image-provider config, persisted reasoning envelopes.
// Every legacy reader therefore keeps its own literal. When a rename rewrites
// that literal into the new name, the reader silently stops matching and the
// compatibility it existed for is gone with no test noticing.

const env = process.env
const savedDisabledThinking = env.CC_HAHA_SEND_DISABLED_THINKING
const savedSendDisabledThinking = env.ECHOFLOW_SEND_DISABLED_THINKING

afterEach(() => {
  for (const [key, value] of [
    ['CC_HAHA_SEND_DISABLED_THINKING', savedDisabledThinking],
    ['ECHOFLOW_SEND_DISABLED_THINKING', savedSendDisabledThinking],
  ] as const) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
})

describe('legacy identifier compatibility', () => {
  test('an image-provider config saved under the old names is carried over', () => {
    const { env: migrated, changed } = normalizeLegacyImageGenerationEnv({
      CC_HAHA_IMAGE_PROVIDER_KIND: 'openai',
      CC_HAHA_IMAGE_MODEL: 'gpt-image-1',
    })

    expect(changed).toBe(true)
    expect(migrated.ECHOFLOW_IMAGE_PROVIDER_KIND).toBe('openai')
    expect(migrated.ECHOFLOW_IMAGE_MODEL).toBe('gpt-image-1')
    expect(migrated.CC_HAHA_IMAGE_PROVIDER_KIND).toBeUndefined()
  })

  test('the old disabled-thinking switch still applies', () => {
    delete env.ECHOFLOW_SEND_DISABLED_THINKING
    env.CC_HAHA_SEND_DISABLED_THINKING = '1'

    expect(shouldSendExplicitDisabledThinking()).toBe(true)
  })

  test('the old OpenAI OAuth provider switch still applies', () => {
    expect(shouldForceOpenAICodexProvider({ CC_HAHA_OPENAI_OAUTH_PROVIDER: '1' })).toBe(true)
  })

  test('a reasoning envelope written under the old prefix still parses', () => {
    const payload = JSON.stringify({ encrypted_content: 'blob', summary: [] })

    expect(parseOpenAIReasoningEnvelope(`cc-haha:openai-reasoning:v1:${payload}`)).toMatchObject({
      encryptedContent: 'blob',
    })
  })

  test('a goal hook installed under the old marker is still recognised', () => {
    expect(isGoalPromptHookCommand('echo "<cc-haha-goal-hook>"')).toBe(true)
  })
})
