import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionService } from './sessionService.js'
import { registerSideChat, closeSideChatsForParent } from './sideChatRegistry.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'

const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
let directory: string
let service: SessionService
let previousConfig: string | undefined
let previousHome: string | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'session-runtime-selection-'))
  previousConfig = process.env.CLAUDE_CONFIG_DIR
  previousHome = process.env.HOME
  process.env.CLAUDE_CONFIG_DIR = directory
  process.env.HOME = directory
  resetSettingsCache()
  service = new SessionService()
})

afterEach(async () => {
  closeSideChatsForParent(sessionId)
  if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfig
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  resetSettingsCache()
  await rm(directory, { recursive: true, force: true })
})

async function seedLegacySelection() {
  const projectDir = sanitizePath(directory)
  const filePath = join(directory, 'projects', projectDir, `${sessionId}.jsonl`)
  await mkdir(join(directory, 'projects', projectDir), { recursive: true })
  await writeFile(filePath, [
    { type: 'session-meta', workDir: directory, runtimeProviderId: 'old-provider', runtimeModelId: 'old-model', effortLevel: 'high' },
    { type: 'user', uuid: 'old-message', message: { role: 'user', content: 'Existing conversation' } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n')
  return filePath
}

async function expectSelection(reader: SessionService, provider: string | null, model: string, effort: string | undefined) {
  const launchInfo = await reader.getSessionLaunchInfo(sessionId)
  const summary = await reader.getSessionSummary(sessionId)
  const listed = (await reader.listSessions()).sessions.find(session => session.id === sessionId)
  const inspection = await reader.getInspectionTranscriptSnapshot(sessionId)
  for (const result of [launchInfo, summary, listed, inspection?.launchInfo]) {
    expect(result).toMatchObject({ runtimeProviderId: provider, runtimeModelId: model })
    expect(result?.effortLevel).toBe(effort)
  }
}

test('old transcripts default Fast off and explicit false replaces true in every metadata reader', async () => {
  const filePath = await seedLegacySelection()
  expect((await service.getSessionLaunchInfo(sessionId))?.openAIFastMode).toBeUndefined()
  await service.appendSessionMetadata(sessionId, {
    workDir: directory, runtimeProviderId: 'openai-official', runtimeModelId: 'future-model', openAIFastMode: true,
  })
  for (const reader of [service, new SessionService()]) {
    expect((await reader.getSessionLaunchInfo(sessionId))?.openAIFastMode).toBe(true)
    expect((await reader.getSessionSummary(sessionId))?.openAIFastMode).toBe(true)
    expect((await reader.listSessions()).sessions.find(item => item.id === sessionId)?.openAIFastMode).toBe(true)
  }
  await service.appendSessionMetadata(sessionId, { workDir: directory, openAIFastMode: false })
  for (const reader of [service, new SessionService()]) {
    expect((await reader.getSessionLaunchInfo(sessionId))?.openAIFastMode).toBe(false)
    expect((await reader.getSessionSummary(sessionId))?.openAIFastMode).toBe(false)
    expect((await reader.listSessions()).sessions.find(item => item.id === sessionId)?.openAIFastMode).toBe(false)
  }
  expect(JSON.parse((await readFile(filePath, 'utf8')).trim().split('\n').at(-1)!).openAIFastMode).toBe(false)
})

test('a complete runtime replacement clears old effort from warm readers and after restart', async () => {
  const filePath = await seedLegacySelection()
  await expectSelection(service, 'old-provider', 'old-model', 'high')
  await service.appendSessionMetadata(sessionId, {
    workDir: directory, runtimeProviderId: 'replacement-provider', runtimeModelId: 'replacement-model',
  })
  await expectSelection(service, 'replacement-provider', 'replacement-model', undefined)
  await expectSelection(new SessionService(), 'replacement-provider', 'replacement-model', undefined)
  const latest = JSON.parse((await readFile(filePath, 'utf8')).trim().split('\n').at(-1)!)
  expect(latest).not.toHaveProperty('effortLevel')
})

test('resetting effort on an unchanged provider and model is persisted exactly once', async () => {
  const filePath = await seedLegacySelection()
  const before = await readFile(filePath, 'utf8')
  const metadata = { workDir: directory, runtimeProviderId: 'old-provider', runtimeModelId: 'old-model' }
  await service.appendSessionMetadata(sessionId, metadata)
  const reset = await readFile(filePath, 'utf8')
  expect(reset).not.toBe(before)
  await expectSelection(new SessionService(), 'old-provider', 'old-model', undefined)
  await service.appendSessionMetadata(sessionId, metadata)
  expect(await readFile(filePath, 'utf8')).toBe(reset)
})

test('ordinary metadata and historical partial runtime updates preserve effort', async () => {
  await seedLegacySelection()
  await service.appendSessionMetadata(sessionId, { workDir: directory, permissionMode: 'plan' })
  await service.appendSessionMetadata(sessionId, { workDir: directory, runtimeModelId: 'legacy-model' })
  await expectSelection(new SessionService(), 'old-provider', 'legacy-model', 'high')
})

test('a complete built-in runtime selection also clears old effort', async () => {
  await seedLegacySelection()
  await service.appendSessionMetadata(sessionId, { workDir: directory, runtimeProviderId: null, runtimeModelId: 'default-model' })
  await expectSelection(new SessionService(), null, 'default-model', undefined)
})

test('memory-only runtime changes clear inherited effort without writing a transcript', async () => {
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 0 }))
  resetSettingsCache()
  const created = await service.createSession(directory)
  await service.appendSessionMetadata(created.sessionId, {
    workDir: directory, runtimeProviderId: 'old-provider', runtimeModelId: 'old-model', effortLevel: 'high',
  })
  await service.appendSessionMetadata(created.sessionId, {
    workDir: directory, runtimeProviderId: 'replacement-provider', runtimeModelId: 'replacement-model',
  })
  const launchInfo = await service.getSessionLaunchInfo(created.sessionId)
  expect(launchInfo?.runtimeModelId).toBe('replacement-model')
  expect(launchInfo?.effortLevel).toBeUndefined()
  await expect(readFile(launchInfo!.filePath)).rejects.toThrow()
})

test('a memory-only runtime replacement overrides old persisted effort without changing history', async () => {
  const filePath = await seedLegacySelection()
  const original = await readFile(filePath, 'utf8')
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 0 }))
  resetSettingsCache()
  await service.appendSessionMetadata(sessionId, {
    workDir: directory, runtimeProviderId: 'replacement-provider', runtimeModelId: 'replacement-model',
  })
  const launchInfo = await service.getSessionLaunchInfo(sessionId)
  expect(launchInfo).toMatchObject({ runtimeProviderId: 'replacement-provider', runtimeModelId: 'replacement-model' })
  expect(launchInfo?.effortLevel).toBeUndefined()
  expect(await readFile(filePath, 'utf8')).toBe(original)
})

test('v0.7.4 CLI runtime pins survive cold readers and transcript clearing without leaking into session lists', async () => {
  const filePath = await seedLegacySelection()
  const records = (await readFile(filePath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  records[0].cliRuntimeId = 'installed'
  records[0].unknownRuntimeField = { keep: true }
  await writeFile(filePath, records.map(record => JSON.stringify(record)).join('\n') + '\n')

  for (const reader of [service, new SessionService()]) {
    expect(await reader.getSessionLaunchInfo(sessionId)).toMatchObject({ cliRuntimeId: 'installed' })
    const listed = (await reader.listSessions()).sessions.find(session => session.id === sessionId)
    expect(listed).toBeDefined()
    expect(Object.hasOwn(listed!, 'cliRuntimeId')).toBe(false)
  }
  // The metadata writer must not append a duplicate just to acknowledge a recovered choice.
  const before = await readFile(filePath, 'utf8')
  const metadata = { workDir: directory, cliRuntimeId: 'installed' as const }
  await service.appendSessionMetadata(sessionId, metadata)
  expect(await readFile(filePath, 'utf8')).toBe(before)
  await service.appendSessionMetadata(sessionId, { workDir: directory, permissionMode: 'plan' })
  expect(await new SessionService().getSessionLaunchInfo(sessionId)).toMatchObject({ cliRuntimeId: 'installed' })
  expect(await readFile(filePath, 'utf8')).toContain('unknownRuntimeField')

  await service.clearSessionTranscript(sessionId, directory)
  expect(await new SessionService().getSessionLaunchInfo(sessionId)).toMatchObject({ cliRuntimeId: 'installed' })
})

test('invalid historical CLI runtime metadata is ignored and the latest valid pin is preserved on restart', async () => {
  const filePath = await seedLegacySelection()
  const entries = ['invalid', 'installed', 'invalid', 'bundled', null].map(cliRuntimeId => ({
    type: 'session-meta', workDir: directory, cliRuntimeId,
  }))
  // Prefixes establish that invalid metadata is never promoted to an executable choice.
  const original = await readFile(filePath, 'utf8')
  for (const [index, expected] of [undefined, 'installed', 'installed', 'bundled', 'bundled'].entries()) {
    await writeFile(filePath, original + entries.slice(0, index + 1).map(entry => JSON.stringify(entry)).join('\n') + '\n')
    const launchInfo = await new SessionService().getSessionLaunchInfo(sessionId)
    if (expected) expect(launchInfo).toMatchObject({ cliRuntimeId: expected })
    else expect(launchInfo).not.toHaveProperty('cliRuntimeId')
  }
})

test.each([
  ['unpinned', undefined, 'installed'],
  ['pinned', 'bundled', 'bundled'],
] as const)('cold launch preserves CLI runtime precedence for a %s worktree conversation before metadata transfer', async (_label, conversationRuntimeId, expectedRuntimeId) => {
  const workDir = join(directory, '.claude', 'worktrees', 'fixture')
  const projectDir = sanitizePath(workDir)
  const transcriptDir = join(directory, 'projects', projectDir)
  const placeholderDir = join(directory, 'projects', sanitizePath(directory))
  await mkdir(transcriptDir, { recursive: true })
  await mkdir(placeholderDir, { recursive: true })
  const filePath = join(transcriptDir, `${sessionId}.jsonl`)
  const placeholderPath = join(placeholderDir, `${sessionId}.jsonl`)
  const conversation = [
    { type: 'session-meta', workDir, ...(conversationRuntimeId ? { cliRuntimeId: conversationRuntimeId } : {}) },
    { type: 'user', uuid: 'worktree-message', cwd: workDir, message: { role: 'user', content: 'Keep this conversation' } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n'
  const placeholder = JSON.stringify({ type: 'session-meta', workDir: directory, cliRuntimeId: 'installed' }) + '\n'
  await writeFile(filePath, conversation)
  await writeFile(placeholderPath, placeholder)

  const launchInfo = await new SessionService().getSessionLaunchInfo(sessionId)
  expect(launchInfo).toMatchObject({ filePath, projectDir, workDir, transcriptMessageCount: 1 })
  expect(await readFile(filePath, 'utf8')).toBe(conversation)
  expect(await readFile(placeholderPath, 'utf8')).toBe(placeholder)
  expect(launchInfo?.cliRuntimeId).toBe(expectedRuntimeId)
})

test('a side conversation clears inherited effort when its runtime selection changes', async () => {
  await seedLegacySelection()
  const launchInfo = (await service.getSessionLaunchInfo(sessionId))!
  const sideId = `side-${sessionId}`
  registerSideChat({
    sessionId: sideId, parentSessionId: sessionId, cliSessionId: sessionId,
    resumePath: launchInfo.filePath, resumeAt: 'old-message', launchInfo,
    createdAt: new Date().toISOString(), started: false, closed: false,
  })
  await service.appendSessionMetadata(sideId, {
    workDir: directory, runtimeProviderId: 'replacement-provider', runtimeModelId: 'replacement-model',
  })
  expect((await service.getSessionLaunchInfo(sideId))?.effortLevel).toBeUndefined()
})
