import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'

const originalEnvironment = { ...process.env }
let sandbox: string
let workDir: string
let configDir: string
let handleSessionsApi: typeof import('./sessions.js').handleSessionsApi

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'session-rewind-'))
  const environment = createSandboxedTestEnvironment(sandbox, {
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    DISABLE_AUTOUPDATER: '1',
  })
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, environment)
  configDir = environment.CLAUDE_CONFIG_DIR!
  workDir = join(sandbox, 'workspace')
  await mkdir(workDir)
  await mkdir(join(configDir, 'projects', 'fixture'), { recursive: true })
  handleSessionsApi = (await import('./sessions.js')).handleSessionsApi
})

afterAll(async () => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnvironment)
  await rm(sandbox, { recursive: true, force: true })
})

function row(type: string, content: unknown, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    uuid: crypto.randomUUID(),
    type,
    cwd: workDir,
    timestamp: '2026-10-01T08:00:00.000Z',
    message: { role: type, content },
    ...extra,
  }) + '\n'
}

/** A two-prompt session: prompt 0 then prompt 1, with one user message per prompt. */
async function createTwoPromptSession() {
  const sessionId = crypto.randomUUID()
  const firstId = crypto.randomUUID()
  const secondId = crypto.randomUUID()
  const transcript =
    row('user', 'first prompt', { uuid: firstId }) +
    row('assistant', 'first answer') +
    row('user', 'second prompt', { uuid: secondId }) +
    row('assistant', 'second answer')
  await writeFile(
    join(configDir, 'projects', 'fixture', `${sessionId}.jsonl`),
    transcript,
  )
  return { sessionId, firstId, secondId }
}

function post(sessionId: string, body: unknown, resource = 'rewind') {
  const request = new Request(`http://localhost/api/sessions/${sessionId}/${resource}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const url = new URL(request.url)
  return handleSessionsApi(request, url, url.pathname.split('/').filter(Boolean))
}

async function errorBody(response: Response) {
  return (await response.json()) as { error?: string; message?: string }
}

/** ApiError carries the human-readable text in `message`; `error` is the code. */
async function errorText(response: Response) {
  const body = await errorBody(response)
  return body.message ?? body.error ?? ''
}

// The selector is a trust boundary: it names which messages get deleted, so a
// stale or wrong id must fail loudly rather than trim the wrong turn.
test('rewind rejects a target id that is not in the session', async () => {
  const { sessionId } = await createTwoPromptSession()
  const response = await post(sessionId, { targetUserMessageId: crypto.randomUUID(), dryRun: true })
  expect(response.status).toBe(400)
  expect(await errorText(response)).toContain('Invalid rewind target')
})

test('rewind rejects a userMessageIndex outside the transcript', async () => {
  const { sessionId } = await createTwoPromptSession()
  const response = await post(sessionId, { userMessageIndex: 7, dryRun: true })
  expect(response.status).toBe(400)
  expect(await errorText(response)).toContain('Invalid rewind target')
})

test('rewind rejects a body with neither selector field', async () => {
  const { sessionId } = await createTwoPromptSession()
  const response = await post(sessionId, {})
  expect(response.status).toBe(400)
  expect(await errorText(response)).toContain(
    'targetUserMessageId (string) or userMessageIndex (integer) is required',
  )
})

test('rewind rejects a mode that is not both or conversation', async () => {
  const { sessionId } = await createTwoPromptSession()
  const response = await post(sessionId, { userMessageIndex: 0, mode: 'sideways' })
  expect(response.status).toBe(400)
  expect(await errorText(response)).toContain('Invalid rewind mode')
})

// The whole point of expectedContent: the client sends the prompt text it
// rendered, and a mismatch means the transcript moved under it.
test('rewind refuses to delete a turn whose prompt no longer matches', async () => {
  const { sessionId, secondId } = await createTwoPromptSession()
  const mismatch = await post(sessionId, {
    targetUserMessageId: secondId,
    expectedContent: 'a prompt the user never sent',
    dryRun: true,
  })
  expect(mismatch.status).toBe(400)
  expect(await errorText(mismatch)).toContain('does not match the selected prompt')

  const match = await post(sessionId, {
    targetUserMessageId: secondId,
    expectedContent: 'second prompt',
    dryRun: true,
  })
  expect(match.status).toBe(200)
  const preview = (await match.json()) as {
    target: { targetUserMessageId: string; userMessageIndex: number; userMessageCount: number }
    conversation: { messagesRemoved: number }
  }
  expect(preview.target).toEqual({
    targetUserMessageId: secondId,
    userMessageIndex: 1,
    userMessageCount: 2,
  })
  // Trimming at the second prompt removes the prompt and its answer only.
  expect(preview.conversation.messagesRemoved).toBe(2)
})

test('rewind ignores surrounding whitespace when matching the expected prompt', async () => {
  const { sessionId, secondId } = await createTwoPromptSession()
  const response = await post(sessionId, {
    targetUserMessageId: secondId,
    expectedContent: '  second prompt\n',
    dryRun: true,
  })
  expect(response.status).toBe(200)
})

test('rewind selects the same target by index as by id', async () => {
  const { sessionId, firstId } = await createTwoPromptSession()
  const byIndex = await post(sessionId, { userMessageIndex: 0, dryRun: true })
  const byId = await post(sessionId, { targetUserMessageId: firstId, dryRun: true })
  expect(byIndex.status).toBe(200)
  expect(byId.status).toBe(200)
  const a = (await byIndex.json()) as { target: unknown; conversation: unknown }
  const b = (await byId.json()) as { target: unknown; conversation: unknown }
  expect(a.target).toEqual(b.target)
  expect(a.conversation).toEqual(b.conversation)
})

test('a dry run previews without deleting anything', async () => {
  const { sessionId, secondId } = await createTwoPromptSession()
  const before = await readFile(
    join(configDir, 'projects', 'fixture', `${sessionId}.jsonl`),
    'utf8',
  )
  await post(sessionId, { targetUserMessageId: secondId, dryRun: true })
  const after = await readFile(
    join(configDir, 'projects', 'fixture', `${sessionId}.jsonl`),
    'utf8',
  )
  expect(after).toBe(before)
})