import { afterEach, describe, expect, test } from 'bun:test'
import { isGoalPromptHookCommand } from '../goals/goalState.js'
import { shouldForceOpenAICodexProvider } from '../services/api/client.js'
import { parseOpenAIReasoningEnvelope } from './openAIReasoningEnvelope.js'
import { shouldSendExplicitDisabledThinking } from './thinking.js'

const env = process.env
const savedSendDisabledThinking = env.ECHOFLOW_SEND_DISABLED_THINKING
const savedLegacySendDisabledThinking = env.CC_HAHA_SEND_DISABLED_THINKING

afterEach(() => {
  if (savedSendDisabledThinking === undefined) delete env.ECHOFLOW_SEND_DISABLED_THINKING
  else env.ECHOFLOW_SEND_DISABLED_THINKING = savedSendDisabledThinking
  if (savedLegacySendDisabledThinking === undefined) delete env.CC_HAHA_SEND_DISABLED_THINKING
  else env.CC_HAHA_SEND_DISABLED_THINKING = savedLegacySendDisabledThinking
})

describe('current EchoFlow identifiers', () => {
  test('uses only the current disabled-thinking switch', () => {
    env.ECHOFLOW_SEND_DISABLED_THINKING = '1'
    expect(shouldSendExplicitDisabledThinking()).toBe(true)

    delete env.ECHOFLOW_SEND_DISABLED_THINKING
    env.CC_HAHA_SEND_DISABLED_THINKING = '1'
    expect(shouldSendExplicitDisabledThinking()).toBe(false)
  })

  test('uses only the current OpenAI OAuth provider switch', () => {
    expect(shouldForceOpenAICodexProvider({ ECHOFLOW_OPENAI_OAUTH_PROVIDER: '1' })).toBe(true)
    expect(shouldForceOpenAICodexProvider({ CC_HAHA_OPENAI_OAUTH_PROVIDER: '1' })).toBe(false)
  })

  test('parses reasoning envelopes with the current prefix only', () => {
    const payload = JSON.stringify({ encrypted_content: 'blob', summary: [] })

    expect(parseOpenAIReasoningEnvelope(`echoflow-code:openai-reasoning:v1:${payload}`)).toMatchObject({
      encryptedContent: 'blob',
    })
    expect(parseOpenAIReasoningEnvelope(`cc-haha:openai-reasoning:v1:${payload}`)).toBeNull()
  })

  test('recognises goal hooks with the current marker only', () => {
    expect(isGoalPromptHookCommand('echo "<echoflow-code-goal-hook>"')).toBe(true)
    expect(isGoalPromptHookCommand('echo "<cc-haha-goal-hook>"')).toBe(false)
  })
})
