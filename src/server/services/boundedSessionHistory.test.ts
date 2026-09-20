import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, appendFile, open, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoundedHistoryPage, streamBoundedHistory, withHistoryReadBudget, HISTORY_SCAN_BYTES, HISTORY_RECORD_BYTES, HISTORY_PAGE_BYTES, HISTORY_PAGE_ROWS } from './boundedSessionHistory.js'

let directory: string
let file: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'history-budget-test-')); file = join(directory, 'session.jsonl') })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const row = (id: string, text = id) => JSON.stringify({ type: 'assistant', uuid: id, message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n'

describe('bounded history pages', () => {
  test('reads a bounded tail and pages every ordinary large record without loss', async () => {
    const handle = await open(file, 'w')
    for (let index = 0; index < 60; index++) await handle.write(row(String(index), 'x'.repeat(256 * 1024)))
    await handle.close()
    let cursor: string | undefined
    const ids: string[] = []
    do {
      const result = await readBoundedHistoryPage(file, { cursor })
      expect(result.page.scannedBytes).toBeLessThanOrEqual(HISTORY_SCAN_BYTES)
      expect(result.page.omittedOversizedEntries).toBe(0)
      expect(result.entries.length).toBeGreaterThan(0)
      ids.unshift(...result.entries.map(item => item.entry.uuid as string))
      cursor = result.page.nextCursor ?? undefined
    } while (cursor)
    expect(ids).toEqual(Array.from({ length: 60 }, (_, index) => String(index)))
  })

  test('skips giant lines across bounded windows and preserves both neighboring messages', async () => {
    await writeFile(file, row('before'))
    const handle = await open(file, 'a')
    await handle.write('{"message":"')
    for (let index = 0; index < 36; index++) await handle.write('x'.repeat(1024 * 1024))
    await handle.write('"}\n' + row('after'))
    await handle.close()
    let cursor: string | undefined
    const ids: string[] = []
    let omissions = 0
    let requests = 0
    do {
      const result = await readBoundedHistoryPage(file, { cursor })
      expect(result.page.scannedBytes).toBeLessThanOrEqual(HISTORY_SCAN_BYTES)
      omissions += result.page.omittedOversizedEntries
      ids.unshift(...result.entries.map(item => item.entry.uuid as string))
      cursor = result.page.nextCursor ?? undefined
      requests++
      expect(requests).toBeLessThan(8)
    } while (cursor)
    expect(ids).toEqual(['before', 'after'])
    expect(omissions).toBe(1)
  })

  test('moves to the immediately newer window without reading appended records outside the snapshot', async () => {
    await writeFile(file, Array.from({ length: 10 }, (_, index) => row(String(index))).join(''))
    const latest = await readBoundedHistoryPage(file, { limit: 3 })
    expect(latest.entries.map(item => item.entry.uuid)).toEqual(['7', '8', '9'])
    expect(latest.page.previousCursor).toBeNull()
    const older = await readBoundedHistoryPage(file, { limit: 3, cursor: latest.page.nextCursor! })
    expect(older.entries.map(item => item.entry.uuid)).toEqual(['4', '5', '6'])
    await appendFile(file, row('10'))
    const newer = await readBoundedHistoryPage(file, { limit: 3, cursor: older.page.previousCursor! })
    expect(newer.entries.map(item => item.entry.uuid)).toEqual(['7', '8', '9'])
    expect(newer.page.previousCursor).toBeNull()
    expect(newer.page.sourceVersion).toBe(latest.page.sourceVersion)
    const earlier = await readBoundedHistoryPage(file, { cursor: older.page.nextCursor! })
    expect(earlier.entries.map(item => item.entry.uuid)).toEqual(['0', '1', '2', '3'])
    expect(earlier.page.historyComplete).toBe(false)
  })

  test('reads small pages on demand and preserves a large tool result as a bounded identified preview', async () => {
    const huge = JSON.stringify({ type: 'user', uuid: 'large-result', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bash-1', is_error: false, content: 'x'.repeat(4 * 1024 * 1024) }] } }) + '\n'
    await writeFile(file, huge + Array.from({ length: 158 }, (_, index) => row(String(index))).join(''))
    const tiny = await readBoundedHistoryPage(file, { limit: 3 })
    expect(tiny.page.scannedBytes).toBeLessThanOrEqual(96 * 1024)
    const all = await readBoundedHistoryPage(file)
    expect(all.entries).toHaveLength(159)
    expect(all.page.nextCursor).toBeNull()
    expect(all.page.omittedOversizedEntries).toBe(0)
    expect(all.page.contentTruncated).toBe(true)
    expect(all.page.historyComplete).toBe(false)
    expect(all.entries[0]!.entry).toMatchObject({ uuid: 'large-result', bodyTruncated: true, message: { content: [{ type: 'tool_result', tool_use_id: 'bash-1', is_error: false }] } })
    expect(Buffer.byteLength(JSON.stringify(all.entries.map(item => item.entry)))).toBeLessThan(HISTORY_PAGE_BYTES)
  })

  test('forward continuation crosses giant records and 64KiB boundaries without losing adjacent messages', async () => {
    await writeFile(file, row('before'))
    const handle = await open(file, 'a')
    await handle.write('{"message":"')
    for (let index = 0; index < 36; index++) await handle.write('x'.repeat(1024 * 1024))
    await handle.write('"}\n' + row('after', 'z'.repeat(70 * 1024)) + row('last'))
    await handle.close()
    let backward = await readBoundedHistoryPage(file, { limit: 1 })
    while (backward.page.nextCursor) backward = await readBoundedHistoryPage(file, { cursor: backward.page.nextCursor!, limit: 1 })
    expect(backward.entries.map(item => item.entry.uuid)).toEqual(['before'])
    const ids: unknown[] = []
    let cursor = backward.page.previousCursor
    let count = 0
    while (cursor) {
      const page = await readBoundedHistoryPage(file, { cursor, limit: 1 })
      ids.push(...page.entries.map(item => item.entry.uuid))
      expect(page.page.scannedBytes).toBeLessThanOrEqual(HISTORY_SCAN_BYTES)
      cursor = page.page.previousCursor
      expect(++count).toBeLessThan(8)
    }
    expect(ids).toEqual(['after', 'last'])
  })

  test('preserves tool identities after earlier content exhausts the display text budget', async () => {
    await writeFile(file, JSON.stringify({ type: 'assistant', uuid: 'many-tools', message: { role: 'assistant', content: [
      ...Array.from({ length: 4 }, () => ({ type: 'text', text: 'x'.repeat(32 * 1024) })),
      { type: 'tool_use', id: 'last-tool', name: 'Bash', input: { command: 'echo okay' } },
    ] } }) + '\n')
    const result = await readBoundedHistoryPage(file)
    const content = (result.entries[0]!.entry.message as { content: unknown[] }).content
    expect(content.at(-1)).toMatchObject({ type: 'tool_use', id: 'last-tool', name: 'Bash' })
    expect(result.page.contentTruncated).toBe(true)
  })

  test('rejects an in-place rewrite that grows instead of mixing replacement records into the old snapshot', async () => {
    await writeFile(file, Array.from({ length: 10 }, (_, index) => row(`old-${index}`)).join(''))
    const first = await readBoundedHistoryPage(file, { limit: 3 })
    await writeFile(file, Array.from({ length: 20 }, (_, index) => row(`replacement-${index}`)).join(''))
    await expect(readBoundedHistoryPage(file, { cursor: first.page.nextCursor!, limit: 3 })).rejects.toMatchObject({ statusCode: 409, code: 'HISTORY_CHANGED' })
  })

  test('checks the continuation boundary even when a growing rewrite preserves source prefix and old EOF', async () => {
    await writeFile(file, Array.from({ length: 500 }, (_, index) => row(String(index), 'x'.repeat(100))).join(''))
    const first = await readBoundedHistoryPage(file)
    const decoded = JSON.parse(Buffer.from(first.page.nextCursor!, 'base64url').toString('utf8'))
    const handle = await open(file, 'r+')
    await handle.write(Buffer.from('Y'), 0, 1, decoded.offset - 10)
    await handle.close()
    await appendFile(file, row('new'))
    await expect(readBoundedHistoryPage(file, { cursor: first.page.nextCursor! })).rejects.toMatchObject({ statusCode: 409 })
  })

  test('keeps multi-block records intact while bounding every page to 500 renderable rows', async () => {
    await writeFile(file, Array.from({ length: 200 }, (_, index) => JSON.stringify({ type: 'assistant', uuid: String(index), message: { role: 'assistant', content: Array.from({ length: 3 }, (_, block) => ({ type: 'tool_use', id: `${index}-${block}`, name: 'Bash', input: {} })) } }) + '\n').join(''))
    const first = await readBoundedHistoryPage(file)
    expect(first.entries).toHaveLength(166)
    expect(first.entries.reduce((sum, item) => sum + (item.entry.message as { content: unknown[] }).content.length, 0)).toBeLessThanOrEqual(HISTORY_PAGE_ROWS)
    const older = await readBoundedHistoryPage(file, { cursor: first.page.nextCursor! })
    expect(older.entries).toHaveLength(34)
    expect([...older.entries, ...first.entries].map(item => item.entry.uuid)).toEqual(Array.from({ length: 200 }, (_, index) => String(index)))
    const newer = await readBoundedHistoryPage(file, { cursor: older.page.previousCursor! })
    expect(newer.entries.map(item => item.entry.uuid)).toEqual(first.entries.map(item => item.entry.uuid))
  })

  test('snapshot cursors tolerate appends but reject replacement and malformed cursors', async () => {
    await writeFile(file, row('a') + row('b'))
    const first = await readBoundedHistoryPage(file, { limit: 1 })
    await appendFile(file, row('c'))
    const second = await readBoundedHistoryPage(file, { cursor: first.page.nextCursor! })
    expect(second.entries.map(item => item.entry.uuid)).toEqual(['a'])
    await writeFile(`${file}.new`, row('replacement'))
    await rename(`${file}.new`, file)
    await expect(readBoundedHistoryPage(file, { cursor: first.page.nextCursor! })).rejects.toMatchObject({ statusCode: 409 })
    await expect(readBoundedHistoryPage(file, { cursor: 'garbage' })).rejects.toThrow('Invalid history cursor')
  })

  test('forward recovery bounds single records, parses surrounding evidence, and aborts promptly', async () => {
    await writeFile(file, row('a') + row('too-large', 'x'.repeat(HISTORY_RECORD_BYTES + 100)) + row('b'))
    const ids: unknown[] = []
    const result = await streamBoundedHistory(file, entry => ids.push(entry.uuid))
    expect(ids).toEqual(['a', 'b'])
    expect(result.omittedRecords).toBe(1)
    const controller = new AbortController()
    let visits = 0
    await expect(streamBoundedHistory(file, () => { visits++; controller.abort() }, controller.signal)).rejects.toThrow()
    expect(visits).toBe(1)
  })

  test('rejects queue overflow and removes aborted waiters without starving later reads', async () => {
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const active = [withHistoryReadBudget(undefined, () => hold), withHistoryReadBudget(undefined, () => hold)]
    const controller = new AbortController()
    const cancelled = withHistoryReadBudget(controller.signal, async () => 'unreachable').catch(error => error)
    const queued = Array.from({ length: 7 }, () => withHistoryReadBudget(undefined, async () => 'ok'))
    await expect(withHistoryReadBudget(undefined, async () => 'overflow')).rejects.toMatchObject({ statusCode: 429 })
    controller.abort()
    await cancelled
    const replacement = withHistoryReadBudget(undefined, async () => 'replacement')
    release()
    await Promise.all(active)
    expect(await Promise.all(queued)).toEqual(Array(7).fill('ok'))
    expect(await replacement).toBe('replacement')
  })
})
