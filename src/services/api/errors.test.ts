import { describe, expect, test } from 'bun:test'
import {
  getAssistantMessageFromError,
  getImageUnsupportedErrorMessage,
  isUnsupportedImageInputErrorMessage,
} from './errors.js'

describe('image unsupported API errors', () => {
  test('detects provider-specific text-only model image rejections', () => {
    expect(
      isUnsupportedImageInputErrorMessage(
        'This model does not support image blocks',
      ),
    ).toBe(true)
    expect(
      isUnsupportedImageInputErrorMessage(
        'unsupported modality: image input is not available',
      ),
    ).toBe(true)
    expect(isUnsupportedImageInputErrorMessage('image exceeds maximum')).toBe(false)
  })

  test('maps unsupported image rejections to a recoverable synthetic error', () => {
    const msg = getAssistantMessageFromError(
      new Error('This model does not support image blocks'),
      'mimo-v2.5-pro',
    )

    expect(msg.isApiErrorMessage).toBe(true)
    expect(msg.errorDetails).toBe('This model does not support image blocks')
    expect(msg.message.content[0]).toMatchObject({
      type: 'text',
      text: getImageUnsupportedErrorMessage(),
    })
  })
})
