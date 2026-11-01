import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionService } from './sessionService.js'
import { diagnosticsService } from './diagnosticsService.js'
import { openLocalIndexDatabase, type LocalIndexDatabase } from './localIndex/database.js'
import { withHistoryReadBudget } from './boundedSessionHistory.js'
import { createSessionIndex, type LocalIndexGateway } from './localIndex/sessionIndex.js'
import { createSessionProjector } from './localIndex/sessionProjector.js'
import type { LocalIndexStatus } from './localIndex/types.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'

describe('indexed session list empty-page performance', () => {
  let configDir: string
  let previousHome: string | undefined
  let previousConfigDir: string | undefined
  let database: LocalIndexDatabase | undefined

  beforeEach(async () => {
    previousHome = process.env.HOME
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa004-session-list-'))
    process.env.HOME = configDir
    process.env.CLAUDE_CONFIG_DIR = configDir
  })

  afterEach(async () => {
    database?.close()
    database = undefined
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    await fs.rm(configDir, { recursive: true, force: true })
  })

  async function fixture(teamWorkers = false) {
    const workDir = path.join(configDir, 'workspace')
    const projectPath = sanitizePath(workDir)
    await fs.mkdir(workDir)
    await fs.mkdir(path.join(configDir, 'projects', projectPath), { recursive: true })
    database = openLocalIndexDatabase({ path: path.join(configDir, 'index.sqlite') })
    const index = createSessionIndex(database)
    const projector = createSessionProjector({ database, index, scope: configDir })
    const ids = []
    for (let n = 0; n < 6; n += 1) {
      const sessionId = `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`
      ids.push(sessionId)
      const filePath = path.join(configDir, 'projects', projectPath, `${sessionId}.jsonl`)
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString()
      // Synthetic history: enough body data to prove an empty-page fallback
      // parses real transcripts, without a CPU/wall-clock threshold.
      await fs.writeFile(filePath, [
        { type: 'session-meta', workDir, ...(teamWorkers ? { entrypoint: 'claude-desktop-team-worker' } : {}) },
        { type: 'user', timestamp, message: { role: 'user', content: `Session ${n}` } },
        { type: 'assistant', timestamp, message: { role: 'assistant', content: 'x'.repeat(256 * 1024) } },
      ].map(entry => JSON.stringify(entry)).join('\n') + '\n')
      const stat = await fs.stat(filePath)
      await projector.projectSource({
        path: filePath, sessionId, projectPath, modifiedAtMs: stat.mtimeMs,
        fallbackCreatedAt: stat.birthtime.toISOString(), fallbackModifiedAt: stat.mtime.toISOString(),
        fallbackWorkDir: workDir,
      })
    }
    const status: LocalIndexStatus = {
      mode: 'on', state: 'ready', discovered: 6, indexed: 6, degradedSources: 0,
      databaseBytes: 0, walBytes: 0, lastUpdatedAt: '2026-01-01T00:10:00.000Z', lastErrorCode: null,
    }
    const gateway: LocalIndexGateway = {
      ...index, getMode: () => 'on', getPublicStatus: () => status, isSessionScopeReady: () => true,
      start: async () => {}, stop: async () => {}, rebuild: async () => status,
    }
    return { gateway, ids, workDir }
  }

  it.each(['past-end', 'zero-limit', 'unmatched-project', 'workers-only'] as const)(
    'does not discover or parse historical transcripts for a ready %s page',
    async (scenario) => {
      const { gateway } = await fixture(scenario === 'workers-only')
      let now = 1_000
      const service = new SessionService(gateway, { now: () => now })
      const internals = service as unknown as {
        discoverSessionFiles: (...args: unknown[]) => Promise<unknown>
        scanSessionListSummary: (...args: unknown[]) => Promise<unknown>
      }
      const discover = spyOn(internals, 'discoverSessionFiles')
      const scan = spyOn(internals, 'scanSessionListSummary')
      const options = scenario === 'past-end' ? { limit: 20, offset: 6 }
        : scenario === 'zero-limit' ? { limit: 0 }
          : scenario === 'unmatched-project' ? { project: path.join(configDir, 'missing-workspace') }
            : { limit: 20 }
      try {
        const result = await service.listSessions(options)
        expect(result).toEqual({ sessions: [], total: scenario === 'past-end' || scenario === 'zero-limit' ? 6 : 0 })
        // Expire the legacy page cache and make concurrent requests. A ready
        // empty page remains authoritative regardless of fallback cache warmth.
        now += 6_000
        expect(await Promise.all([service.listSessions(options), service.listSessions(options)])).toEqual([result, result])
        expect(scan).not.toHaveBeenCalled()
        expect(discover).not.toHaveBeenCalled()
      } finally {
        discover.mockRestore()
        scan.mockRestore()
      }
    },
  )

  it('bounds summary scans during file fallback', async () => {
    const { gateway, ids } = await fixture()
    const offStatus = { ...gateway.getPublicStatus(), state: 'off' as const }
    gateway.getMode = () => 'off'
    gateway.getPublicStatus = () => offStatus
    const service = new SessionService(gateway)
    const internals = service as unknown as {
      scanSessionListSummary: (...args: unknown[]) => Promise<unknown>
    }
    let active = 0
    let peak = 0
    const original = internals.scanSessionListSummary.bind(service)
    const scan = spyOn(internals, 'scanSessionListSummary').mockImplementation(async (...args) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      try { return await original(...args) } finally { active -= 1 }
    })
    try {
      const result = await service.listSessions({ limit: 20 })
      expect(result.sessions.map(session => session.id)).toEqual([...ids].reverse())
      expect(peak).toBe(2)
    } finally {
      scan.mockRestore()
    }
  })

  it('records aggregate evidence for a slow file fallback without session paths', async () => {
    const { gateway, ids } = await fixture()
    const offStatus = { ...gateway.getPublicStatus(), state: 'off' as const }
    gateway.getMode = () => 'off'
    gateway.getPublicStatus = () => offStatus
    let clock = 1_000
    const service = new SessionService(gateway, { now: () => (clock += 250) })
    const record = spyOn(diagnosticsService, 'recordEvent').mockResolvedValue({ ok: true })
    try {
      await service.listSessions({ limit: 20 })

      const events = record.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === 'session_list_fallback_slow')
      expect(events).toHaveLength(1)
      expect(events[0]?.details).toMatchObject({
        indexMode: 'off',
        indexState: 'off',
        discovered: 6,
        included: 6,
      })
      expect(events[0]?.details?.totalMs).toBeGreaterThanOrEqual(1_000)
      const serialized = JSON.stringify(events[0])
      expect(serialized).not.toContain(configDir)
      expect(serialized).not.toContain(ids[0])
    } finally {
      record.mockRestore()
    }
  })

  it('serves list summaries without taking the interactive page lane', async () => {
    const { gateway, ids } = await fixture()
    const offStatus = { ...gateway.getPublicStatus(), state: 'off' as const }
    gateway.getMode = () => 'off'
    gateway.getPublicStatus = () => offStatus
    const service = new SessionService(gateway)
    const releases: Array<() => void> = []
    // 2 active + 8 queued fills the page lane; a 429 here used to drop every
    // uncached summary from the list instead of surfacing the session.
    const blockers = Array.from({ length: 10 }, () => withHistoryReadBudget(undefined, () => (
      new Promise<void>((resolve) => { releases.push(resolve) })
    ), 'page'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(releases).toHaveLength(2)
    await expect(withHistoryReadBudget(undefined, async () => 'ok', 'page'))
      .rejects.toMatchObject({ code: 'HISTORY_BUSY' })
    try {
      const result = await service.listSessions({ limit: 20 })
      expect(result.sessions.map((session) => session.id)).toEqual([...ids].reverse())
    } finally {
      while (releases.length > 0) {
        releases.shift()!()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      await Promise.allSettled(blockers)
    }
  })

  it('rate-limits the slow fallback event across repeated slow reads', async () => {
    const { gateway } = await fixture()
    const offStatus = { ...gateway.getPublicStatus(), state: 'off' as const }
    gateway.getMode = () => 'off'
    gateway.getPublicStatus = () => offStatus
    let clock = 1_000
    const service = new SessionService(gateway, { now: () => (clock += 250) })
    const record = spyOn(diagnosticsService, 'recordEvent').mockResolvedValue({ ok: true })
    try {
      await service.listSessions({ limit: 20 })
      clock += 6_000
      await service.listSessions({ limit: 20 })

      const events = record.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === 'session_list_fallback_slow')
      expect(events).toHaveLength(1)
    } finally {
      record.mockRestore()
    }
  })

  it('still falls back if an empty index page was returned during a read failure', async () => {
    const { gateway, ids } = await fixture()
    gateway.listSessions = () => {
      gateway.getPublicStatus = () => ({
        ...gatewayStatus, state: 'degraded', lastErrorCode: 'LOCAL_INDEX_READ_FAILED',
      })
      return { sessions: [], total: 0 }
    }
    const gatewayStatus = gateway.getPublicStatus()
    const result = await new SessionService(gateway).listSessions({ limit: 20 })
    expect(result.total).toBe(6)
    expect(result.sessions.map(session => session.id)).toEqual([...ids].reverse())
  })
})
