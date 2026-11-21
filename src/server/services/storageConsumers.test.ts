import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EchoFlowOAuthService, echoFlowOAuthService } from './echoFlowOAuthService.js'
import { HahaOAuthService, hahaOAuthService } from './hahaOAuthService.js'
import { echoFlowOpenAIOAuthService } from './echoFlowOpenAIOAuthService.js'
import { hahaOpenAIOAuthService } from './hahaOpenAIOAuthService.js'
import { echoFlowGrokOAuthService } from './echoFlowGrokOAuthService.js'
import { hahaGrokOAuthService } from './hahaGrokOAuthService.js'

let root: string
let savedRoot: string | undefined

beforeEach(async () => {
  savedRoot = process.env.CLAUDE_CONFIG_DIR
  root = await mkdtemp(join(tmpdir(), 'storage-consumers-'))
  process.env.CLAUDE_CONFIG_DIR = root
})

afterEach(async () => {
  if (savedRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedRoot
  await rm(root, { recursive: true, force: true })
})

test('old and new OAuth API names share the exact session, refresh and callback owners', () => {
  expect(EchoFlowOAuthService).toBe(HahaOAuthService)
  expect(echoFlowOAuthService).toBe(hahaOAuthService)
  expect(echoFlowOpenAIOAuthService).toBe(hahaOpenAIOAuthService)
  expect(echoFlowGrokOAuthService).toBe(hahaGrokOAuthService)
  const session = echoFlowOAuthService.startSession({ serverPort: 54321 })
  expect(hahaOAuthService.consumeSession(session.state)).toEqual(session)
  expect(echoFlowOAuthService.getSession(session.state)).toBeNull()
})

test('canonical OAuth writes never adopt or resurrect a legacy token file', async () => {
  const service = new EchoFlowOAuthService()
  const legacy = join(root, 'cc-haha', 'oauth.json')
  await mkdir(join(root, 'cc-haha'))
  await writeFile(legacy, '{"accessToken":"legacy-fixture"}')
  expect(await service.loadTokens()).toBeNull()
  const tokens = { accessToken: 'fixture', refreshToken: null, expiresAt: null, scopes: [], subscriptionType: null }
  await service.saveTokens(tokens)
  expect(JSON.parse(await readFile(join(root, 'echoflow-code', 'oauth.json'), 'utf8'))).toEqual(tokens)
  await service.deleteTokens()
  expect(await new HahaOAuthService().loadTokens()).toBeNull()
  expect(await readFile(legacy, 'utf8')).toBe('{"accessToken":"legacy-fixture"}')
  await expect(stat(join(root, 'echoflow-code', 'oauth.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('the shared Claude implementation coalesces parallel refreshes', async () => {
  const service = new EchoFlowOAuthService()
  const tokens = { accessToken: 'fixture-old', refreshToken: 'fixture-refresh', expiresAt: 1, scopes: ['user:inference'], subscriptionType: null }
  await service.saveTokens(tokens)
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  service.setRefreshFn(async () => {
    calls++
    started()
    await gate
    return { ...tokens, accessToken: 'fixture-fresh', expiresAt: Date.now() + 3_600_000, rateLimitTier: null }
  })
  const pending = Array.from({ length: 8 }, () => service.ensureFreshAccessToken())
  try {
    await entered
  } finally {
    release()
  }
  expect(await Promise.all(pending)).toEqual(Array(8).fill('fixture-fresh'))
  expect(calls).toBe(1)
})
