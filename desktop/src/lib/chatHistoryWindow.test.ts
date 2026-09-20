import { describe, expect, it } from 'vitest'
import { boundHistoryWindow, historyWindowBoundary, historyWindowMessages, type HistoryWindowPage } from './chatHistoryWindow'

function page(index: number, content = 'short message'): HistoryWindowPage {
  return {
    cursor: `page-${index}`,
    page: { nextCursor: `older-${index}`, previousCursor: `newer-${index}`, hasMore: true, historyComplete: false, sourceVersion: 'v1', scannedBytes: 100, omittedOversizedEntries: 0 },
    messages: [{ id: String(index), type: 'assistant_text', timestamp: index, content }],
  }
}

describe('continuous history window', () => {
  it('keeps adjacent pages and a return cursor when the opposite edge is evicted', () => {
    const pages = [0, 1, 2, 3].map(index => page(index))
    const older = boundHistoryWindow(pages, 1024 * 1024, 'older')
    expect(historyWindowMessages(older).map(message => message.id)).toEqual(['0', '1', '2'])
    expect(historyWindowBoundary(older)).toMatchObject({ nextCursor: 'older-0', previousCursor: 'newer-2' })
    const newer = boundHistoryWindow(pages, 1024 * 1024, 'newer')
    expect(historyWindowMessages(newer).map(message => message.id)).toEqual(['1', '2', '3'])
    expect(historyWindowBoundary(newer)).toMatchObject({ nextCursor: 'older-1', previousCursor: 'newer-3' })
    expect(boundHistoryWindow(newer, 1024 * 1024, 'newer')).toBe(newer)
  })

  it('preserves every row identity when large bodies exhaust the display budget', () => {
    const pages = [page(0), page(1), page(2)]
    for (const [index, entry] of pages.entries()) entry.messages = Array.from({ length: 200 }, (_, row) => ({
      id: `${index}-${row}`, type: 'assistant_text', timestamp: row, content: 'x'.repeat(32_000),
    }))
    const bounded = boundHistoryWindow(pages, 256 * 1024, 'older')
    const messages = historyWindowMessages(bounded)
    expect(messages).toHaveLength(600)
    expect(messages.map(message => message.id)).toEqual(pages.flatMap(entry => entry.messages.map(message => message.id)))
    expect(JSON.stringify(messages).length * 2).toBeLessThan(256 * 1024)
    expect(pages[0]!.messages[0]).toMatchObject({ content: 'x'.repeat(32_000) })
    expect(historyWindowMessages(bounded)).toBe(messages)
  })

  it('deduplicates overlapping page boundaries without reordering history', () => {
    const first = page(0)
    const second = page(1)
    second.messages.unshift(first.messages[0]!)
    expect(historyWindowMessages([first, second]).map(message => message.id)).toEqual(['0', '1'])
    expect(historyWindowBoundary([first, second]).historyComplete).toBe(false)
  })
})
