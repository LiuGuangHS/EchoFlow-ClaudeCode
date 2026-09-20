import type { SessionHistoryPage } from '../api/sessions'
import type { UIMessage } from '../types/chat'
import { previewHistoryPage } from './chatHistoryBudget'

export type HistoryDirection = 'older' | 'newer'
export type HistoryWindowPage = {
  cursor: string | null
  page: NonNullable<SessionHistoryPage['page']>
  messages: UIMessage[]
}

const MAX_WINDOW_PAGES = 3
const cache = new WeakMap<HistoryWindowPage[], { budget: number; direction: HistoryDirection; pages: HistoryWindowPage[] }>()

export function boundHistoryWindow(pages: HistoryWindowPage[], budget: number, direction: HistoryDirection): HistoryWindowPage[] {
  const cached = cache.get(pages)
  if (cached?.budget === budget && cached.direction === direction) return cached.pages
  const selected = pages.length <= MAX_WINDOW_PAGES ? pages
    : direction === 'older' ? pages.slice(0, MAX_WINDOW_PAGES) : pages.slice(-MAX_WINDOW_PAGES)
  const perPage = Math.floor(budget / Math.max(1, selected.length))
  const result = selected.map(page => {
    const messages = previewHistoryPage(page.messages, perPage)
    return messages === page.messages ? page : { ...page, messages }
  })
  const bounded = selected === pages && result.every((page, index) => page === pages[index]) ? pages : result
  const memo = { budget, direction, pages: bounded }
  cache.set(pages, memo)
  cache.set(bounded, memo)
  return bounded
}

const flattened = new WeakMap<HistoryWindowPage[], UIMessage[]>()
export function historyWindowMessages(pages: HistoryWindowPage[]): UIMessage[] {
  const cached = flattened.get(pages)
  if (cached) return cached
  const seen = new Set<string>()
  const messages: UIMessage[] = []
  for (const page of pages) for (const message of page.messages) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    messages.push(message)
  }
  flattened.set(pages, messages)
  return messages
}

export function historyWindowBoundary(pages: HistoryWindowPage[]): NonNullable<SessionHistoryPage['page']> {
  const oldest = pages[0]!.page
  const newest = pages[pages.length - 1]!.page
  return {
    ...oldest,
    previousCursor: newest.previousCursor ?? null,
    // A collection of display pages must never become authoritative recovery.
    historyComplete: pages.length === 1 && oldest.historyComplete,
  }
}
