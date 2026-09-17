export const OPENAI_REASONING_ENVELOPE_PREFIX =
  'echoflow-code:openai-reasoning:v1:'
const LEGACY_OPENAI_REASONING_ENVELOPE_PREFIX =
  'echoflow-code:openai-reasoning:v1:'

export type OpenAIReasoningEnvelopeData = {
  id?: string
  summary: Array<{ type: string; text: string }>
  encryptedContent: string
}
export function parseOpenAIReasoningEnvelope(
  data: string,
): OpenAIReasoningEnvelopeData | null {
  const prefix = [OPENAI_REASONING_ENVELOPE_PREFIX, LEGACY_OPENAI_REASONING_ENVELOPE_PREFIX]
    .find((candidate) => data.startsWith(candidate))
  if (!prefix) return null

  try {
    const value = JSON.parse(data.slice(prefix.length)) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null

    const envelope = value as Record<string, unknown>
    if (
      typeof envelope.encrypted_content !== 'string' ||
      !envelope.encrypted_content
    ) {
      return null
    }
    if (envelope.id !== undefined && typeof envelope.id !== 'string') {
      return null
    }
    if (!Array.isArray(envelope.summary)) return null

    const summary = envelope.summary.filter(
      (entry): entry is { type: string; text: string } =>
        !!entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).type === 'string' &&
        typeof (entry as Record<string, unknown>).text === 'string',
    )
    if (summary.length !== envelope.summary.length) return null

    return {
      ...(typeof envelope.id === 'string' ? { id: envelope.id } : {}),
      summary,
      encryptedContent: envelope.encrypted_content,
    }
  } catch {
    return null
  }
}
