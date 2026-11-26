import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleSessionsApi } from '../api/sessions.js'
import { handleSettingsApi } from '../api/settings.js'
import { SessionService } from '../services/sessionService.js'
import { closeSideChatsForParent, registerSideChat } from '../services/sideChatRegistry.js'
import { conversationService } from '../services/conversationService.js'
import { clearLegacySessionChatState, markSessionChatQueued } from '../ws/handler.js'
import * as socketHandler from '../ws/handler.js'
import { sessionService } from '../services/sessionService.js'
import type { IndexedSessionRow, LocalIndexGateway } from '../services/localIndex/sessionIndex.js'
import { activeBackgroundTaskIds, activeNonAgentTasks } from '../ws/agentTaskState.js'
import * as teamRuntime from '../services/teamPlanRuntime.js'
import { cleanupOldFileHistoryBackups, cleanupOldSessionEnvDirs, cleanupOldSessionFiles } from '../../utils/cleanup.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { getEchoFlowInternalDir } from '../../utils/echoFlowConfigRoot.js'
import * as lockfile from '../../utils/lockfile.js'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'

let configDir: string
let projectRoot: string
let previousHome: string | undefined
let previousConfigDir: string | undefined
const idFor = (n: number) => `${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`

beforeEach(async () => {
  previousHome = process.env.HOME
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-archive-'))
  process.env.HOME = configDir
  process.env.CLAUDE_CONFIG_DIR = configDir
  projectRoot = path.join(await fs.realpath(configDir), 'project')
  await fs.mkdir(projectRoot)
})
afterEach(async () => {
  clearLegacySessionChatState(idFor(0))
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  await fs.rm(configDir, { recursive: true, force: true })
})

async function seed(n: number, root = projectRoot) {
  const filePath = path.join(configDir, 'projects', sanitizePath(root), `${idFor(n)}.jsonl`)
  const timestamp = new Date(Date.UTC(2020, 0, 1, 0, n)).toISOString()
  const entries = [
    { type: 'session-meta', workDir: root, future: { preserve: true } },
    { type: 'user', uuid: `user-${n}`, timestamp, message: { role: 'user', content: `Archive fixture ${n}` } },
    { type: 'assistant', uuid: `assistant-${n}`, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Preserved reply' }] } },
  ]
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
  return filePath
}

function request(resource = '', method = 'GET', body?: unknown) {
  const url = new URL(`http://127.0.0.1/api/sessions${resource}`)
  return handleSessionsApi(new Request(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  }), url, url.pathname.split('/').filter(Boolean))
}

describe('reversible session archive', () => {
  it.each([
    '{malformed unrelated record}\n',
    '{"type":"session-archive","archived":"true"}\n',
    '{"type":"assistant"',
  ])('browses only classified history before migration, but retention still refuses unresolved input: %s', async tail => {
    const files = await Promise.all([0, 1, 2, 3, 4].map(n => seed(n)))
    for (const [n, type, archived] of [[0, 'session-archive', true], [3, 'session-meta', true], [4, 'session-meta', false]] as const) {
      await fs.appendFile(files[n]!, JSON.stringify({ type, archived }) + '\n')
    }
    await fs.appendFile(files[2]!, tail)
    await fs.appendFile(files[3]!, '{malformed but explicitly restored}\n')
    await fs.appendFile(files[4]!, '{"type":"assistant"')
    const archivePath = path.join(getEchoFlowInternalDir(configDir), 'session-archives.json')
    const marker = path.join(getEchoFlowInternalDir(configDir), 'session-archives.legacy-jsonl-migration.json')
    await fs.mkdir(path.dirname(archivePath), { recursive: true })
    const explicit = JSON.stringify({ schemaVersion: 1, futureRoot: 'keep', sessions: {
      [idFor(3)]: { archived: false, futureRecord: ['keep'] },
      [idFor(4)]: { archived: true, futureRecord: ['keep'] },
    } })
    await fs.writeFile(archivePath, explicit)
    const backing = [path.join(configDir, 'file-history', idFor(1), 'original'), path.join(configDir, 'session-env', idFor(1), 'snapshot')]
    const old = new Date('2000-01-01T00:00:00.000Z')
    for (const file of backing) {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, 'preserved backing fixture')
      await fs.utimes(path.dirname(file), old, old)
    }
    for (const file of [...files, ...backing]) await fs.utimes(file, old, old)
    const before = await Promise.all([...files, ...backing].map(file => fs.readFile(file, 'utf8')))
    await expect(fs.access(marker)).rejects.toThrow()

    const sidebarResponse = await request('?view=sidebar')
    expect(sidebarResponse.status).toBe(200)
    const sidebar = await sidebarResponse.json()
    expect(sidebar.sessions.map((session: { id: string }) => session.id)).toEqual([idFor(3), idFor(1)])
    expect(sidebar.projects).toEqual([{ projectRoot, total: 2, archivedTotal: 2 }])
    expect(sidebar.archivedSessionIds.sort()).toEqual([idFor(0), idFor(4)])
    expect(await (await request('?archived=true')).json()).toMatchObject({ total: 2, sessions: [{ id: idFor(4) }, { id: idFor(0) }] })
    const history = await (await request(`/project-history?${new URLSearchParams({ projectRoot })}`)).json()
    expect(history.sessions.map((session: { id: string }) => session.id)).toEqual([idFor(3), idFor(1)])
    expect(await (await request(`/${idFor(0)}/summary`)).json()).toMatchObject({ id: idFor(0), archived: true })
    expect(await fs.readFile(archivePath, 'utf8')).toBe(explicit)
    await expect(fs.access(marker)).rejects.toThrow()

    for (const dryRun of [true, false]) await expect(cleanupOldSessionFiles(new Date(), { dryRun })).rejects.toThrow()
    await expect(cleanupOldFileHistoryBackups()).rejects.toThrow()
    await expect(cleanupOldSessionEnvDirs()).rejects.toThrow()
    expect(await Promise.all([...files, ...backing].map(file => fs.readFile(file, 'utf8')))).toEqual(before)
    expect(await fs.readFile(archivePath, 'utf8')).toBe(explicit)
    await expect(fs.access(marker)).rejects.toThrow()
  })

  it('archives through the actual API, survives service reload, and restores unchanged transcripts', async () => {
    const file = await seed(0)
    await seed(1)
    const original = await fs.readFile(file, 'utf8')
    const archive = await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })
    expect(archive.status).toBe(200)
    expect(await archive.json()).toEqual({ success: true, archived: true })
    expect((await (await request()).json()).sessions.map((s: { id: string }) => s.id)).toEqual([idFor(1)])
    const reloaded = new SessionService()
    expect((await reloaded.listSessions()).sessions.map(s => s.id)).toEqual([idFor(1)])
    const archives = await (await request('?archived=true')).json()
    expect(archives).toMatchObject({ sessions: [{ id: idFor(0), archived: true }], total: 1 })
    const detail = await (await request(`/${idFor(0)}`)).json()
    expect(detail).toMatchObject({ id: idFor(0), archived: true })
    expect(detail.messages).toHaveLength(2)
    expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: false })).status).toBe(200)
    expect((await reloaded.listSessions()).sessions.map(s => s.id)).toEqual([idFor(1), idFor(0)])
    expect((await (await request('?archived=true')).json()).total).toBe(0)
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('keeps an archived-only project discoverable and filters before pagination', async () => {
    await seed(0)
    await seed(1)
    const anotherRoot = path.join(configDir, 'another-project')
    await seed(2, anotherRoot)
    await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })
    await request(`/${idFor(1)}/archive`, 'PATCH', { archived: true })
    const sidebar = await (await request('?view=sidebar')).json()
    expect(sidebar.sessions.map((s: { id: string }) => s.id)).toEqual([idFor(2)])
    expect(sidebar.projects).toContainEqual({ projectRoot, total: 0, archivedTotal: 2 })
    expect(sidebar.archivedSessionIds.sort()).toEqual([idFor(0), idFor(1)])
    const first = await (await request(`/project-history?${new URLSearchParams({ projectRoot, archived: 'true', limit: '1' })}`)).json()
    expect(first.sessions.map((s: { id: string }) => s.id)).toEqual([idFor(1)])
    expect(first.nextCursor).toBeString()
    await request(`/${idFor(0)}/archive`, 'PATCH', { archived: false })
    const second = await (await request(`/project-history?${new URLSearchParams({ projectRoot, archived: 'true', cursor: first.nextCursor })}`)).json()
    expect(second.sessions).toEqual([])
    expect(second.nextCursor).toBeNull()
    expect((await request(`/project-history?${new URLSearchParams({ projectRoot, cursor: first.nextCursor })}`)).status).toBe(400)
    expect((await (await request(`?${new URLSearchParams({ archived: 'true', project: anotherRoot })}`)).json()).total).toBe(0)
    expect((await (await request('?limit=1')).json()).sessions.map((s: { id: string }) => s.id)).toEqual([idFor(2)])
    expect((await (await request('?limit=1&offset=1')).json()).sessions.map((s: { id: string }) => s.id)).toEqual([idFor(0)])
  })

  it('refuses active or waiting sessions without stopping them or writing archive state', async () => {
    await seed(0)
    const stop = spyOn(conversationService, 'stopSession')
    try {
      markSessionChatQueued(idFor(0))
      expect(await (await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })).json()).toMatchObject({ error: 'SESSION_ACTIVE' })
      clearLegacySessionChatState(idFor(0))
      const permission = spyOn(conversationService, 'getPendingPermissionRequests').mockReturnValue([{ requestId: 'pending', toolName: 'Bash', input: {} }] as any)
      try {
        expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })).status).toBe(409)
      } finally { permission.mockRestore() }
      expect(stop).not.toHaveBeenCalled()
      expect((await (await request()).json()).total).toBe(1)
      await expect(fs.access(path.join(getEchoFlowInternalDir(configDir), 'session-archives.json'))).rejects.toThrow()
    } finally { stop.mockRestore() }
  })

  it('validates archive bodies, methods, filters and missing sessions', async () => {
    await seed(0)
    for (const body of [{}, { archived: 'true' }, null, []]) {
      expect((await request(`/${idFor(0)}/archive`, 'PATCH', body)).status).toBe(400)
    }
    expect((await request(`/${idFor(0)}/archive`, 'POST', { archived: true })).status).toBe(405)
    expect((await request(`/${idFor(9)}/archive`, 'PATCH', { archived: true })).status).toBe(404)
    expect((await request('?archived=maybe')).status).toBe(400)
  })

  it('checks activity after asynchronous preparation and leaves later activity independent of archive metadata', async () => {
    await seed(0)
    const find = sessionService.findSessionFile.bind(sessionService)
    const lookup = spyOn(sessionService, 'findSessionFile').mockImplementation(async id => {
      const found = await find(id)
      markSessionChatQueued(id)
      return found
    })
    try {
      expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })).status).toBe(409)
    } finally { lookup.mockRestore(); clearLegacySessionChatState(idFor(0)) }
    expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })).status).toBe(200)
    markSessionChatQueued(idFor(0))
    expect(socketHandler.getSessionChatActivityState(idFor(0))).toBe('running')
    // Later work can still start and be inspected; archiving only organizes lists.
    expect((await (await request(`/${idFor(0)}/summary`)).json()).archived).toBe(true)
    expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: false })).status).toBe(200)
    expect(socketHandler.getSessionChatActivityState(idFor(0))).toBe('running')
  })

  it('refuses background work and idle team leaders until their work is finished', async () => {
    await seed(0)
    activeNonAgentTasks.set(idFor(0), new Map([['background', { taskId: 'background', toolUseId: 'tool', taskType: 'local_bash' }]]))
    activeBackgroundTaskIds.set(idFor(0), new Set(['background']))
    try {
      expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })).status).toBe(409)
      expect(activeNonAgentTasks.get(idFor(0))?.has('background')).toBe(true)
    } finally { activeNonAgentTasks.delete(idFor(0)); activeBackgroundTaskIds.delete(idFor(0)) }
    const team = spyOn(teamRuntime, 'hasActiveTeamWorkForParent').mockReturnValue(true)
    try {
      expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })).status).toBe(409)
    } finally { team.mockRestore() }
    expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })).status).toBe(200)
  })

  it('preserves independent archives during concurrent writes from multiple service instances', async () => {
    await seed(0)
    await seed(1)
    await Promise.all([new SessionService().setSessionArchived(idFor(0), true), new SessionService().setSessionArchived(idFor(1), true)])
    expect((await (await request('?archived=true')).json()).total).toBe(2)
    await Promise.all([new SessionService().setSessionArchived(idFor(0), false), new SessionService().setSessionArchived(idFor(1), true)])
    expect((await (await request('?archived=true')).json()).sessions.map((s: { id: string }) => s.id)).toEqual([idFor(1)])
  })

  it('retries a list when another client archives during workspace hydration', async () => {
    await seed(0)
    await seed(1)
    const service = new SessionService()
    const internals = service as unknown as { resolveWorkspaceAvailability: (...args: unknown[]) => Promise<unknown> }
    const hydrate = internals.resolveWorkspaceAvailability.bind(internals)
    let changed = false
    const hydration = spyOn(internals, 'resolveWorkspaceAvailability').mockImplementation(async (...args) => {
      if (!changed) {
        changed = true
        await new SessionService().setSessionArchived(idFor(0), true)
      }
      return hydrate(...args)
    })
    try {
      expect(await service.listSessions()).toMatchObject({ total: 1, sessions: [{ id: idFor(1) }] })
    } finally { hydration.mockRestore() }
  })

  it.each(['on', 'shadow', 'degraded'] as const)('filters indexed metadata before pagination and only hydrates returned rows in %s mode', async mode => {
    const files = await Promise.all([0, 1, 2].map(n => seed(n)))
    const rows: IndexedSessionRow[] = files.map((file, n) => ({
      transcriptPath: file, id: idFor(n), legacyArchived: false, title: `Archive fixture ${n}`, createdAt: new Date(Date.UTC(2020, 0, 1, 0, n)).toISOString(),
      modifiedAt: new Date(Date.UTC(2020, 0, 1, 0, n)).toISOString(), messageCount: 2, projectPath: sanitizePath(projectRoot), workDir: projectRoot,
    })).reverse()
    const status = { mode: mode === 'shadow' ? 'shadow' as const : 'on' as const, state: mode === 'degraded' ? 'degraded' as const : 'ready' as const, discovered: 3, indexed: 3, degradedSources: mode === 'degraded' ? 1 : 0, databaseBytes: 0, walBytes: 0, lastUpdatedAt: '2026-01-01T00:00:00.000Z', lastErrorCode: null }
    const gateway: LocalIndexGateway = {
      getMode: () => status.mode, getPublicStatus: () => status, isSessionScopeReady: () => mode !== 'degraded',
      start: async () => {}, stop: async () => {}, rebuild: async () => status,
      listSessions: options => {
        const archiveIds = new Set(options?.archive?.ids)
        const selected = rows.filter(row =>
          (!options?.project || row.projectPath === options.project) &&
          (!options?.archive || archiveIds.has(row.id) === options.archive.archived))
        const offset = options?.offset ?? 0
        return { sessions: selected.slice(offset, offset + (options?.limit ?? 50)), total: selected.length }
      },
      findSessionFiles: id => rows.filter(row => row.id === id).map(row => ({ filePath: row.transcriptPath, projectDir: row.projectPath })),
      getSession: id => rows.find(row => row.id === id) ?? null,
      getSourceScopedFailurePaths: () => [files[1]!],
    }
    await request(`/${idFor(2)}/archive`, 'PATCH', { archived: true })
    const service = new SessionService(gateway)
    const internals = service as unknown as { hydrateIndexedSession: (...args: unknown[]) => Promise<unknown> }
    const hydrate = spyOn(internals, 'hydrateIndexedSession')
    const list = spyOn(gateway, 'listSessions')
    try {
      expect(await service.listSessions({ limit: 1, offset: 1 })).toMatchObject({ total: 2, sessions: [{ id: idFor(0) }] })
      expect(hydrate).toHaveBeenCalledTimes(1)
      if (mode !== 'degraded') {
        expect(list).toHaveBeenCalledTimes(1)
        expect(list.mock.calls[0]?.[0]).toMatchObject({ limit: 1, offset: 1, archive: { ids: [idFor(2)], archived: false } })
      }
      list.mockClear()
      expect(await service.listSessions({ archived: true, limit: 1 })).toMatchObject({ total: 1, sessions: [{ id: idFor(2), archived: true }] })
      if (mode !== 'degraded') {
        expect(list).toHaveBeenCalledTimes(1)
        expect(list.mock.calls[0]?.[0]).toMatchObject({ limit: 1, archive: { ids: [idFor(2)], archived: true } })
      }
      expect(hydrate).toHaveBeenCalledTimes(2)
      expect(await service.listSessions({ archived: true, offset: 1 })).toMatchObject({ total: 1, sessions: [] })
      expect(hydrate).toHaveBeenCalledTimes(2)
    } finally { hydrate.mockRestore(); list.mockRestore() }
  })

  it.each(['bundled', 'installed'] as const)('preserves validated %s runtime metadata across append, inspection and clear without listing it', async cliRuntimeId => {
    const file = await seed(0)
    const service = new SessionService()
    const metadata = { workDir: projectRoot, cliRuntimeId }
    await service.appendSessionMetadata(idFor(0), metadata)
    const pinned = await fs.readFile(file, 'utf8')
    expect(JSON.parse(pinned.trim().split('\n').at(-1)!)).toMatchObject({ type: 'session-meta', cliRuntimeId })
    await service.appendSessionMetadata(idFor(0), metadata)
    expect(await fs.readFile(file, 'utf8')).toBe(pinned)

    for (const invalid of ['unknown-runtime', null]) {
      await fs.appendFile(file, JSON.stringify({ type: 'session-meta', workDir: projectRoot, cliRuntimeId: invalid }) + '\n')
      const before = await fs.readFile(file, 'utf8')
      await service.appendSessionMetadata(idFor(0), {
        workDir: projectRoot,
        cliRuntimeId: invalid as unknown as typeof cliRuntimeId,
      })
      expect(await fs.readFile(file, 'utf8')).toBe(before)
      for (const reader of [service, new SessionService()]) {
        expect(await reader.getSessionLaunchInfo(idFor(0))).toMatchObject({ cliRuntimeId })
        expect((await reader.getSessionStatusMetadata(idFor(0)))?.launchInfo).toMatchObject({ cliRuntimeId })
        expect((await reader.getInspectionTranscriptSnapshot(idFor(0)))?.launchInfo).toMatchObject({ cliRuntimeId })
        expect(await reader.getSessionSummary(idFor(0))).not.toHaveProperty('cliRuntimeId')
        const listed = (await reader.listSessions()).sessions.find(session => session.id === idFor(0))
        expect(listed).toBeDefined()
        expect(listed).not.toHaveProperty('cliRuntimeId')
      }
    }

    await service.appendSessionMetadata(idFor(0), { workDir: projectRoot, permissionMode: 'plan' })
    await service.clearSessionTranscript(idFor(0), projectRoot)
    expect(await new SessionService().getSessionLaunchInfo(idFor(0))).toMatchObject({ cliRuntimeId })
    const cleared = (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(cleared.find(entry => entry.type === 'session-meta')).toMatchObject({ cliRuntimeId, future: { preserve: true } })
  })

  it('updates memory-only and side-chat runtime pins without persisting invalid values or exposing list fields', async () => {
    const file = await seed(0)
    const original = await fs.readFile(file, 'utf8')
    const service = new SessionService()
    const persist = spyOn(service as unknown as { shouldPersistSession: () => boolean }, 'shouldPersistSession').mockReturnValue(false)
    const sideId = `side-${idFor(0)}`
    try {
      await service.appendSessionMetadata(idFor(0), { workDir: projectRoot, cliRuntimeId: 'installed' })
      await service.appendSessionMetadata(idFor(0), { workDir: projectRoot, cliRuntimeId: 'bundled' })
      await service.appendSessionMetadata(idFor(0), { workDir: projectRoot, cliRuntimeId: null as unknown as 'bundled' })
      await service.clearSessionTranscript(idFor(0), projectRoot)
      const launchInfo = (await service.getSessionLaunchInfo(idFor(0)))!
      expect(launchInfo).toMatchObject({ cliRuntimeId: 'bundled' })
      registerSideChat({
        sessionId: sideId, parentSessionId: idFor(0), cliSessionId: idFor(0), launchInfo,
        resumePath: file, resumeAt: 'user-0', createdAt: new Date().toISOString(), started: false, closed: false,
      })
      await service.appendSessionMetadata(sideId, { workDir: projectRoot, cliRuntimeId: 'installed' })
      await service.appendSessionMetadata(sideId, { workDir: projectRoot, cliRuntimeId: 'invalid' as 'installed' })
      expect(await service.getSessionLaunchInfo(sideId)).toMatchObject({ cliRuntimeId: 'installed' })
      expect(await service.getSessionSummary(sideId)).not.toHaveProperty('cliRuntimeId')
      expect(await fs.readFile(file, 'utf8')).toBe(original)
    } finally { persist.mockRestore(); closeSideChatsForParent(idFor(0)) }
  })

  it('transfers a runtime pin to the conversation transcript before removing its placeholder', async () => {
    const service = new SessionService()
    const placeholder = path.join(configDir, 'projects', sanitizePath(projectRoot), `${idFor(0)}.jsonl`)
    await fs.mkdir(path.dirname(placeholder), { recursive: true })
    await fs.writeFile(placeholder, JSON.stringify({ type: 'session-meta', workDir: projectRoot, cliRuntimeId: 'installed' }) + '\n')
    const worktree = path.join(projectRoot, 'worktree')
    const conversation = await seed(0, worktree)
    await service.appendSessionMetadata(idFor(0), { workDir: worktree })
    expect(JSON.parse((await fs.readFile(conversation, 'utf8')).trim().split('\n').at(-1)!)).toMatchObject({ cliRuntimeId: 'installed' })
    expect(await service.deletePlaceholderSessionFiles(idFor(0), worktree)).toBe(1)
    expect(await new SessionService().getSessionLaunchInfo(idFor(0))).toMatchObject({ cliRuntimeId: 'installed' })
  })

  it('preserves unsupported or corrupt archive files instead of overwriting them', async () => {
    await seed(0)
    const archivePath = path.join(getEchoFlowInternalDir(configDir), 'session-archives.json')
    await fs.mkdir(path.dirname(archivePath))
    const unsupported = JSON.stringify({ schemaVersion: 2, sessions: { [idFor(0)]: { archived: true } }, future: 'keep' })
    for (const fixture of [unsupported, '{broken']) {
      await fs.writeFile(archivePath, fixture)
      await expect(new SessionService().setSessionArchived(idFor(0), false)).rejects.toThrow()
      expect(await fs.readFile(archivePath, 'utf8')).toBe(fixture)
    }
  })

  it.each(['session-meta', 'session-archive'] as const)('recovers v0.7.4 %s before settings cleanup, reloads, and explicitly restores without rewriting JSONL', async type => {
    const archivedFile = await seed(0)
    const ordinaryFile = await seed(1)
    await fs.appendFile(archivedFile, JSON.stringify({ type, archived: true, timestamp: '2020-01-02T00:00:00.000Z', futureArchiveField: { keep: true } }) + '\n')
    const original = await fs.readFile(archivedFile, 'utf8')
    const old = new Date('2000-01-01T00:00:00.000Z')
    await fs.utimes(archivedFile, old, old)
    await fs.utimes(ordinaryFile, old, old)
    const archivePath = path.join(getEchoFlowInternalDir(configDir), 'session-archives.json')
    await expect(fs.access(archivePath)).rejects.toThrow()

    // Cleanup is deliberately the first product entry point, before any list,
    // detail, or archive mutation can initialize the new store.
    for (const dryRun of [true, false]) {
      const url = new URL('http://127.0.0.1/api/settings/session-cleanup')
      const response = await handleSettingsApi(new Request(url, {
        method: 'POST', body: JSON.stringify({ days: 0, dryRun }), headers: { 'content-type': 'application/json' },
      }), url, ['api', 'settings', 'session-cleanup'])
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, files: 1, errors: 0 })
      expect(await fs.readFile(archivedFile, 'utf8')).toBe(original)
      if (dryRun) expect(await fs.readFile(ordinaryFile, 'utf8')).toContain('Archive fixture 1')
    }
    await expect(fs.access(ordinaryFile)).rejects.toThrow()
    const persisted = await fs.readFile(archivePath, 'utf8')
    expect(JSON.parse(persisted)).toMatchObject({ schemaVersion: 1, sessions: { [idFor(0)]: { archived: true } } })
    const reloaded = new SessionService()
    expect(await reloaded.listSessions()).toMatchObject({ sessions: [], total: 0 })
    expect(await reloaded.listSessions({ archived: true })).toMatchObject({ sessions: [{ id: idFor(0), archived: true }], total: 1 })
    expect(await (await request(`/${idFor(0)}`)).json()).toMatchObject({ id: idFor(0), archived: true })
    expect(await fs.readFile(archivePath, 'utf8')).toBe(persisted)

    expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: false })).status).toBe(200)
    expect(await new SessionService().listSessions()).toMatchObject({ sessions: [{ id: idFor(0) }], total: 1 })
    expect(await new SessionService().listSessions({ archived: true })).toMatchObject({ sessions: [], total: 0 })
    expect(await fs.readFile(archivedFile, 'utf8')).toBe(original)
    expect(JSON.parse(await fs.readFile(archivePath, 'utf8'))).toMatchObject({ sessions: { [idFor(0)]: { archived: false } } })
    expect(await cleanupOldSessionFiles(new Date())).toEqual({ messages: 1, errors: 0 })
    await expect(fs.access(archivedFile)).rejects.toThrow()
  })

  it.each([
    [true, false, false], [false, false, false],
    [true, false, true], [false, false, true],
    [true, true, false], [false, true, false],
  ] as const)('preserves archived=%s through clear and retention (explicit: %s, metadata last: %s)', async (archived, explicit, metadataLast) => {
    const file = await seed(0)
    const records = [
      { type: metadataLast ? 'session-archive' : 'session-meta', archived: !archived },
      { type: metadataLast ? 'session-meta' : 'session-archive', archived: explicit ? !archived : archived },
    ]
    await fs.appendFile(file, records.map(entry => JSON.stringify(entry)).join('\n') + '\n')
    const internalDir = getEchoFlowInternalDir(configDir)
    const archivePath = path.join(internalDir, 'session-archives.json')
    await expect(fs.access(archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(path.join(internalDir, 'session-archives.legacy-jsonl-migration.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    if (explicit) {
      await fs.mkdir(internalDir, { recursive: true })
      await fs.writeFile(archivePath, JSON.stringify({ schemaVersion: 1, sessions: { [idFor(0)]: { archived } } }))
    }

    await new SessionService().clearSessionTranscript(idFor(0), projectRoot)
    const cleared = await fs.readFile(file, 'utf8')
    expect(cleared).not.toContain('Archive fixture 0')
    const old = new Date('2000-01-01T00:00:00.000Z')
    await fs.utimes(file, old, old)
    expect(await cleanupOldSessionFiles(new Date('2026-01-01T00:00:00.000Z'))).toEqual({ messages: archived ? 0 : 1, errors: 0 })
    if (archived) expect(await fs.readFile(file, 'utf8')).toBe(cleared)
    else await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('clears with the explicit archive decision published by a competing process', async () => {
    const file = await seed(0)
    await fs.appendFile(file, '{"type":"session-archive","archived":"unknown"}\n')
    const store = new URL('../../utils/sessionArchiveStore.ts', import.meta.url).href
    const writer = Bun.spawn([process.execPath, '--no-env-file', '-e', `
      import { withSessionArchiveLock, writeSessionArchive } from ${JSON.stringify(store)}
      const root = process.env.CLAUDE_CONFIG_DIR
      await withSessionArchiveLock(root, async () => {
        console.log('locked')
        await Bun.stdin.text()
        writeSessionArchive(root, ${JSON.stringify(idFor(0))}, true)
      })
    `], { env: createSandboxedTestEnvironment(configDir, { CLAUDE_CONFIG_DIR: configDir }), stdin: 'pipe', stdout: 'pipe' })
    const attempted = Promise.withResolvers<void>()
    const lock = lockfile.lock
    const attempt = spyOn(lockfile, 'lock').mockImplementation((...args) => {
      attempted.resolve()
      return lock(...args)
    })
    try {
      expect(new TextDecoder().decode((await writer.stdout.getReader().read()).value)).toContain('locked')
      const clearing = new SessionService().clearSessionTranscript(idFor(0), projectRoot)
      await Promise.race([attempted.promise, clearing.then(() => { throw new Error('Clear completed before the archive write') })])
      writer.stdin.end()
      expect(await writer.exited).toBe(0)
      await clearing
      expect(await fs.readFile(file, 'utf8')).not.toContain('Archive fixture 0')
      expect((await new SessionService().getSessionSummary(idFor(0)))?.archived).toBe(true)
    } finally {
      attempt.mockRestore()
      writer.kill()
      await writer.exited
    }
  })

  it('leaves history intact when clear cannot classify its legacy archive records', async () => {
    const file = await seed(0)
    await fs.appendFile(file, '{"type":"session-archive","archived":"unknown"}\n')
    const original = await fs.readFile(file, 'utf8')
    await expect(new SessionService().clearSessionTranscript(idFor(0), projectRoot)).rejects.toThrow('Session archive state is not yet classified')
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('keeps archived history when the settings API previews and runs retention cleanup', async () => {
    const archivedFile = await seed(0)
    const ordinaryFile = await seed(1)
    const original = await fs.readFile(archivedFile, 'utf8')
    const old = new Date('2000-01-01T00:00:00.000Z')
    await fs.utimes(archivedFile, old, old)
    await fs.utimes(ordinaryFile, old, old)
    await request(`/${idFor(0)}/archive`, 'PATCH', { archived: true })
    for (const dryRun of [true, false]) {
      const url = new URL('http://127.0.0.1/api/settings/session-cleanup')
      const response = await handleSettingsApi(new Request(url, {
        method: 'POST', body: JSON.stringify({ days: 0, dryRun }), headers: { 'content-type': 'application/json' },
      }), url, ['api', 'settings', 'session-cleanup'])
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, files: 1, errors: 0 })
      expect(await fs.readFile(archivedFile, 'utf8')).toBe(original)
    }
    await expect(fs.access(ordinaryFile)).rejects.toThrow()
    expect((await (await request('?archived=true')).json()).sessions.map((s: { id: string }) => s.id)).toEqual([idFor(0)])
  })

  it('serializes an already dispatched cleanup deletion with archive admission', async () => {
    const file = await seed(0)
    const old = new Date('2000-01-01T00:00:00.000Z')
    await fs.utimes(file, old, old)
    const fsImpl = getFsImplementation()
    const unlink = fsImpl.unlink.bind(fsImpl)
    let began!: () => void
    const beganDeleting = new Promise<void>(resolve => { began = resolve })
    let resume!: () => void
    const resumeDeleting = new Promise<void>(resolve => { resume = resolve })
    const deletion = spyOn(fsImpl, 'unlink').mockImplementation(async target => {
      if (target === file) { began(); await resumeDeleting }
      return unlink(target)
    })
    try {
      const cleanup = cleanupOldSessionFiles(new Date())
      await beganDeleting
      let settled = false
      const archive = request(`/${idFor(0)}/archive`, 'PATCH', { archived: true }).then(response => { settled = true; return response })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(settled).toBe(false)
      resume()
      expect(await cleanup).toEqual({ messages: 1, errors: 0 })
      // Cleanup won the lock: the archive checks existence afterwards and must
      // not claim that it preserved a transcript which was already removed.
      expect((await archive).status).toBe(404)
      expect(sessionService.listArchivedSessionIds()).toEqual([])
    } finally { resume(); deletion.mockRestore() }
  })

  it('migrates unversioned archive metadata, preserving unknown fields and old transcript fixtures', async () => {
    const transcript = await seed(0)
    const original = await fs.readFile(transcript, 'utf8')
    const archivePath = path.join(getEchoFlowInternalDir(configDir), 'session-archives.json')
    await fs.mkdir(path.dirname(archivePath))
    await fs.writeFile(archivePath, JSON.stringify({ future: { keep: true }, sessions: { [idFor(0)]: { archived: true, futureRecord: 'keep' } } }))
    expect((await (await request()).json()).total).toBe(0)
    expect((await request(`/${idFor(0)}/archive`, 'PATCH', { archived: false })).status).toBe(200)
    expect(JSON.parse(await fs.readFile(archivePath, 'utf8'))).toEqual({ schemaVersion: 1, future: { keep: true }, sessions: { [idFor(0)]: { archived: false, futureRecord: 'keep' } } })
    expect(await fs.readFile(transcript, 'utf8')).toBe(original)
  })
})
