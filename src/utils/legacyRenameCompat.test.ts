import { afterEach, describe, expect, test } from 'bun:test'
import { isGoalPromptHookCommand } from '../goals/goalState.js'
import { shouldForceOpenAICodexProvider } from '../services/api/client.js'
import { isOpenAIResponsesModel } from '../services/openaiAuth/models.js'
import { parseOpenAIReasoningEnvelope } from './openAIReasoningEnvelope.js'
import { shouldSendExplicitDisabledThinking } from './thinking.js'

const env = process.env
const envKeys = [
  'ECHOFLOW_SEND_DISABLED_THINKING',
  'CC_HAHA_SEND_DISABLED_THINKING',
  'ECHOFLOW_OPENAI_OAUTH_PROVIDER',
  'CC_HAHA_OPENAI_OAUTH_PROVIDER',
] as const
const savedEnv = Object.fromEntries(envKeys.map(key => [key, env[key]]))

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete env[key]
    else env[key] = savedEnv[key]
  }
})

describe('EchoFlow and integrated runtime identifier compatibility', () => {
  test('accepts both disabled-thinking switches with EchoFlow precedence', () => {
    delete env.CC_HAHA_SEND_DISABLED_THINKING
    env.ECHOFLOW_SEND_DISABLED_THINKING = '1'
    expect(shouldSendExplicitDisabledThinking()).toBe(true)

    delete env.ECHOFLOW_SEND_DISABLED_THINKING
    env.CC_HAHA_SEND_DISABLED_THINKING = '1'
    expect(shouldSendExplicitDisabledThinking()).toBe(true)

    for (const value of ['0', '']) {
      env.ECHOFLOW_SEND_DISABLED_THINKING = value
      expect(shouldSendExplicitDisabledThinking()).toBe(false)
    }
  })

  test('accepts both OpenAI OAuth provider switches with EchoFlow precedence', () => {
    expect(shouldForceOpenAICodexProvider({ ECHOFLOW_OPENAI_OAUTH_PROVIDER: '1' })).toBe(true)
    expect(shouldForceOpenAICodexProvider({ CC_HAHA_OPENAI_OAUTH_PROVIDER: '1' })).toBe(true)
    expect(shouldForceOpenAICodexProvider({})).toBe(false)
    for (const value of ['0', '']) {
      expect(shouldForceOpenAICodexProvider({
        ECHOFLOW_OPENAI_OAUTH_PROVIDER: value,
        CC_HAHA_OPENAI_OAUTH_PROVIDER: '1',
      })).toBe(false)
    }
  })

  test('uses the same OAuth switch precedence for model capabilities', () => {
    delete env.CC_HAHA_OPENAI_OAUTH_PROVIDER
    env.ECHOFLOW_OPENAI_OAUTH_PROVIDER = '1'
    expect(isOpenAIResponsesModel('new-model-id')).toBe(true)
    delete env.ECHOFLOW_OPENAI_OAUTH_PROVIDER
    env.CC_HAHA_OPENAI_OAUTH_PROVIDER = '1'
    expect(isOpenAIResponsesModel('new-model-id')).toBe(true)
    env.ECHOFLOW_OPENAI_OAUTH_PROVIDER = '0'
    expect(isOpenAIResponsesModel('new-model-id')).toBe(false)
  })

  test('reads reasoning envelopes from both persisted prefixes', () => {
    const payload = JSON.stringify({ encrypted_content: 'blob', summary: [] })
    for (const prefix of ['echoflow-code', 'cc-haha']) {
      expect(parseOpenAIReasoningEnvelope(`${prefix}:openai-reasoning:v1:${payload}`)).toMatchObject({
        encryptedContent: 'blob',
      })
      expect(parseOpenAIReasoningEnvelope(`${prefix}:openai-reasoning:v1:{}`)).toBeNull()
      expect(parseOpenAIReasoningEnvelope(`${prefix}:openai-reasoning:v1:invalid`)).toBeNull()
    }
    expect(parseOpenAIReasoningEnvelope(`other:openai-reasoning:v1:${payload}`)).toBeNull()
  })

  test('recognises installed goal hooks with either product marker', () => {
    expect(isGoalPromptHookCommand('echo "<echoflow-code-goal-hook>"')).toBe(true)
    expect(isGoalPromptHookCommand('echo "<cc-haha-goal-hook>"')).toBe(true)
    expect(isGoalPromptHookCommand('echo "<other-goal-hook>"')).toBe(false)
    expect(isGoalPromptHookCommand(undefined)).toBe(false)
  })
})
