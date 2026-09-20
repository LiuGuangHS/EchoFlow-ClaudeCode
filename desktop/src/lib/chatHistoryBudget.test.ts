import { describe, expect, it } from 'vitest'
import { boundActivityText, boundChatHistory, previewHistoryPage, CHAT_HISTORY_MAX_ROWS } from './chatHistoryBudget'
import type { UIMessage } from '../types/chat'

function text(id: number, content = 'message'): UIMessage {
  return { id: String(id), type: 'assistant_text', timestamp: id, content }
}

describe('chat history retention', () => {
  it('uses spare page space for ordinary replies while bounding an oversized tool body', () => {
    const normal = Array.from({ length: 100 }, (_, index) => text(index, 'A complete readable response. '.repeat(20)))
    const huge = text(100, 'x'.repeat(2_000_000))
    const result = previewHistoryPage([...normal, huge], 256 * 1024)
    expect(result).toHaveLength(101)
    for (let index = 0; index < normal.length; index++) expect(result[index]).toBe(normal[index])
    expect(result.at(-1)).toMatchObject({ id: '100' })
    expect(JSON.stringify(result).length * 2).toBeLessThan(256 * 1024)
  })

  it('bounds many small rows and keeps the recent window', () => {
    const result = boundChatHistory(Array.from({ length: 2000 }, (_, index) => text(index)))
    expect(result.messages).toHaveLength(CHAT_HISTORY_MAX_ROWS)
    expect(result.messages[0]?.id).toBe('1500')
    expect(result.dropped).toBe(1500)
  })

  it('caps a huge structured tool payload without losing row identity or mutating input', () => {
    const message: UIMessage = { id: 'tool', type: 'tool_use', toolName: 'Bash', toolUseId: 'id', timestamp: 123, input: { command: 'x'.repeat(2_000_000) } }
    const result = boundChatHistory([message])
    expect(result.clipped).toBe(true)
    expect(result.messages[0]).toMatchObject({ id: 'tool', toolUseId: 'id', timestamp: 123 })
    expect(JSON.stringify(result.messages).length).toBeLessThan(34_000)
    expect((message.input as { command: string }).command).toHaveLength(2_000_000)
    expect(boundChatHistory(result.messages).messages).toBe(result.messages)
  })

  it('enforces the byte budget for large rows and preserves unchanged references', () => {
    const small = [text(0)]
    expect(boundChatHistory(small).messages).toBe(small)
    const result = boundChatHistory(Array.from({ length: 100 }, (_, index) => text(index, 'x'.repeat(30_000))), 128 * 1024)
    expect(result.bytes).toBeLessThanOrEqual(128 * 1024)
    expect(result.messages.at(-1)?.id).toBe('99')
  })
  it('retains recent terminal records and every active lifecycle, including active-to-terminal transitions', () => {
    const records = Object.fromEntries(Array.from({ length: 700 }, (_, index) => [String(index), {
      taskId: String(index), status: 'completed', updatedAt: index,
    }]))
    records.active = { taskId: 'active', status: 'running', updatedAt: 0 }
    const bounded = boundActivityText(records, 1024 * 1024)!
    expect(Object.keys(bounded)).toHaveLength(501)
    expect(bounded['199']).toBeUndefined()
    expect(bounded['200']).toBe(records['200'])
    expect(bounded.active).toBe(records.active)
    const completed = boundActivityText({ ...bounded, active: { ...bounded.active!, status: 'completed', updatedAt: 999 } }, 1024 * 1024)!
    expect(Object.keys(completed)).toHaveLength(500)
    expect(completed.active).toMatchObject({ taskId: 'active', status: 'completed', updatedAt: 999 })
    expect(completed['200']).toBeUndefined()
    const allRunning = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [String(index), { taskId: String(index), status: 'running' }]))
    expect(boundActivityText(allRunning, 1024, 2)).toBe(allRunning)
  })

  it('memoizes unchanged activity records by identity and budgets instead of scanning on each delta', () => {
    let enumerations = 0
    const records = new Proxy({ task: { status: 'completed', result: 'result' } }, {
      ownKeys(target) { enumerations++; return Reflect.ownKeys(target) },
    })
    const first = boundActivityText(records, 1024, 500)
    for (let index = 0; index < 100; index++) expect(boundActivityText(records, 1024, 500)).toBe(first)
    expect(enumerations).toBe(1)
    boundActivityText(records, 512, 500)
    expect(enumerations).toBe(2)
    boundActivityText(records, 512, 100)
    expect(enumerations).toBe(3)
  })

})
