// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { armApprovedFileSource, executeStorageMigration, readStorageMigrationStatus } from '../../../src/services/storageMigration'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { executeDesktopOpenAiOauth, previewOpenAiOauth } from './desktopStorageAdoption'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })

async function fixture() {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-oauth-adoption-')))
  directories.push(home)
  const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'product')] })
  await fs.mkdir(binding.root)
  await fs.writeFile(path.join(binding.root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
  const source = path.join(home, 'external', 'openai-oauth.json')
  await fs.mkdir(path.dirname(source))
  const bytes = '{"accessToken":"fixture-only","refreshToken":"fixture-refresh","expiresAt":1,"future":true}\n'
  await fs.writeFile(source, bytes)
  const { identity } = await previewOpenAiOauth(binding, source)
  const proof = `${identity.digest}:${identity.dev}:${identity.ino}:${identity.size}`
  const launch = { kind: 'openai-oauth' as const, id: 'ecf00000-1111-4222-8333-444444444444', source, proof }
  const hooks = { platform: 'linux' as const, assertQuiescent: vi.fn(async () => {}) }
  const approve = () => armApprovedFileSource(binding, launch.id, { destination: 'echoflow-code', files: [source] })
  return { binding, source, bytes, launch, hooks, approve }
}

it.each([
  '{"unexpected":true}\n',
  '{"incomplete":\n',
  '{"accessToken":"fixture-only","refreshToken":null,"expiresAt":null}\n',
  '{"accessToken":"fixture-only","refreshToken":"","expiresAt":1}\n',
])('rejects invalid OAuth contents before offering approval', async bytes => {
  const f = await fixture()
  await fs.writeFile(f.source, bytes)
  await expect(previewOpenAiOauth(f.binding, f.source)).rejects.toThrow(/^Invalid OpenAI sign-in file$/)
  expect(await fs.readFile(f.source, 'utf8')).toBe(bytes)
  await expect(fs.lstat(f.binding.internalDir)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('requires a durable approval before opening a cold OAuth adoption transaction', async () => {
  const f = await fixture()
  const validate = vi.fn(async () => {})
  expect((await executeDesktopOpenAiOauth(f.binding, f.launch, f.hooks, validate)).state).toBe('blocked')
  expect(validate).not.toHaveBeenCalled()
  expect(await readStorageMigrationStatus(f.binding)).toBeNull()
  expect(await fs.readFile(f.source, 'utf8')).toBe(f.bytes)
})

it('recovers the matching accepted adoption without revalidating or rereading a retired file', async () => {
  const f = await fixture()
  await f.approve()
  const validate = vi.fn(async () => {})
  const interrupt = async () => { throw new Error('cleanup interrupted') }
  const first = await executeDesktopOpenAiOauth(f.binding, f.launch, { ...f.hooks, cleanupResources: interrupt }, validate)
  expect(first.state).toBe('cleanup-pending')
  await expect(fs.lstat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
  const badLaunch = { ...f.launch, proof: f.launch.proof.replace(/^./, char => char === 'a' ? 'b' : 'a') }
  expect((await executeDesktopOpenAiOauth(f.binding, badLaunch, f.hooks, validate)).state).toBe('blocked')
  expect((await readStorageMigrationStatus(f.binding))?.state).toBe('cleanup-pending')
  const recovered = await executeDesktopOpenAiOauth(f.binding, f.launch, f.hooks, validate)
  expect(recovered).toMatchObject({ id: first.id, state: 'ready' })
  const target = path.join(f.binding.internalDir, 'openai-oauth.json')
  expect(await fs.readFile(target, 'utf8')).toBe(f.bytes)
  await fs.writeFile(target, 'subsequent target write')
  expect(await executeDesktopOpenAiOauth(f.binding, f.launch, f.hooks, validate)).toEqual(recovered)
  expect(await fs.readFile(target, 'utf8')).toBe('subsequent target write')
  expect(validate).toHaveBeenCalledOnce()
})

it('rejects cold adoption while another transaction awaits validation', async () => {
  const f = await fixture()
  await f.approve()
  const directory = path.join(f.binding.root, 'cc-haha')
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'opaque'), 'unrelated migration')
  const imported = await executeStorageMigration({ binding: f.binding, hooks: f.hooks, sources: [{ directory, markerRoot: f.binding.root, destination: 'echoflow-code', ownership: 'legacy-internal' }] })
  expect(imported.state).toBe('validation-required')
  const validate = vi.fn(async () => {})
  expect((await executeDesktopOpenAiOauth(f.binding, f.launch, f.hooks, validate)).state).toBe('blocked')
  expect(validate).not.toHaveBeenCalled()
  expect((await readStorageMigrationStatus(f.binding))?.id).toBe(imported.id)
  expect(await fs.readFile(f.source, 'utf8')).toBe(f.bytes)
})
