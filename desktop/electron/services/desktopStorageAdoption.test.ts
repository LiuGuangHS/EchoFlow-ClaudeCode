// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { armApprovedFileSource, executeStorageMigration, readApprovedFileSource, readStorageMigrationStatus } from '../../../src/services/storageMigration'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { approveImAdoption, desktopStorageAdoptionLaunch, desktopStorageAdoptionRelaunchArgs, executeDesktopStorageAdoption, previewImAdoption, previewOpenAiOauth } from './desktopStorageAdoption'

import { desktopStorageRelaunchArgs, initializeDesktopStorage } from './desktopStorageStartup'

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

it('round-trips WhatsApp cold controls without carrying account paths or accepting mixed approvals', () => {
  const launch = { kind: 'whatsapp-auth' as const, id: 'ecf00000-1111-4222-8333-444444444444', proof: 'a'.repeat(64) }
  const args = desktopStorageAdoptionRelaunchArgs(['main.cjs', '--', 'positional'], launch)
  const controls = Object.fromEntries(args.slice(1, -2).map(arg => arg.slice(2).split('=')))
  const parse = () => desktopStorageAdoptionLaunch({ hasSwitch: name => name in controls, getSwitchValue: name => controls[name] ?? '' })
  expect(args.slice(-2)).toEqual(['--', 'positional'])
  expect(Object.keys(controls)).toEqual(['echoflow-whatsapp-adoption-id', 'echoflow-whatsapp-adoption-proof'])
  expect(parse()).toEqual(launch)
  expect(desktopStorageRelaunchArgs(args, { adoption: launch })).toEqual(['main.cjs', '--', 'positional'])
  controls['echoflow-im-adoption-id'] = launch.id
  controls['echoflow-im-adoption-proof'] = launch.proof
  expect(parse).toThrow(/conflicting/i)
  delete controls['echoflow-im-adoption-id']
  delete controls['echoflow-im-adoption-proof']
  delete controls['echoflow-whatsapp-adoption-proof']
  expect(parse).toThrow(/invalid/i)
})

it('cold-adopts a single IM session file without validating unrelated desktop resources', async () => {
  const f = await fixture()
  const source = path.join(path.dirname(f.source), 'adapter-sessions.json')
  const bytes = '{"chat":{"sessionId":"fixture","workDir":"/workspace","updatedAt":1}}\n'
  await fs.writeFile(source, bytes)
  const preview = await previewImAdoption(f.binding, [source])
  const launch = await approveImAdoption(f.binding, preview)
  const validate = vi.fn(async () => { throw new Error('Unexpected native validation') })
  expect((await executeDesktopStorageAdoption(f.binding, launch, f.hooks, validate)).state).toBe('ready')
  expect(validate).not.toHaveBeenCalled()
  expect(await fs.readFile(path.join(f.binding.root, 'adapter-sessions.json'), 'utf8')).toBe(bytes)
  await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(f.source, 'utf8')).toBe(f.bytes)
})

it('continues a published IM transaction after cleanup is interrupted and the empty source folder is removed', async () => {
  const f = await fixture()
  const directory = path.join(path.dirname(f.binding.root), 'im-source')
  await fs.mkdir(directory)
  const source = path.join(directory, 'adapter-sessions.json')
  await fs.writeFile(source, '{}')
  const launch = await approveImAdoption(f.binding, await previewImAdoption(f.binding, [source]))
  const invalid = { ...launch, proof: '0'.repeat(64) }
  const validate = vi.fn(async () => { throw new Error('Unexpected native validation') })
  expect((await executeDesktopStorageAdoption(f.binding, invalid, f.hooks, validate)).state).toBe('blocked')
  const approved = await readApprovedFileSource(f.binding, launch.id, { approvalCategory: 'im-adapters', proof: launch.proof })
  expect((await executeStorageMigration({ binding: f.binding, hooks: f.hooks, sources: [approved] })).state).toBe('validation-required')
  expect(await fs.readFile(source, 'utf8')).toBe('{}')
  const ordinaryLaunch = { binding: f.binding, sources: [], issues: [] }
  const interrupt = async () => { throw new Error('cleanup interrupted') }
  await expect(initializeDesktopStorage(ordinaryLaunch, { ...f.hooks, cleanupResources: interrupt }, validate)).rejects.toThrow('cleanup interrupted')
  expect((await readStorageMigrationStatus(f.binding))?.state).toBe('cleanup-pending')
  await fs.rmdir(directory)
  const lease = await initializeDesktopStorage(ordinaryLaunch, f.hooks, validate)
  try {
    expect((await readStorageMigrationStatus(f.binding))?.state).toBe('ready')
    expect(validate).not.toHaveBeenCalled()
    await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await lease.release() }
  const restarted = await initializeDesktopStorage(ordinaryLaunch, f.hooks, validate)
  await restarted.release()
  await fs.mkdir(directory)
  await fs.writeFile(source, '{}')
  await expect(initializeDesktopStorage(ordinaryLaunch, f.hooks, validate)).rejects.toThrow()
})

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
  expect((await executeDesktopStorageAdoption(f.binding, f.launch, f.hooks, validate)).state).toBe('blocked')
  expect(validate).not.toHaveBeenCalled()
  expect(await readStorageMigrationStatus(f.binding)).toBeNull()
  expect(await fs.readFile(f.source, 'utf8')).toBe(f.bytes)
})

it('recovers the matching accepted adoption without revalidating or rereading a retired file', async () => {
  const f = await fixture()
  await f.approve()
  const validate = vi.fn(async () => {})
  const interrupt = async () => { throw new Error('cleanup interrupted') }
  const first = await executeDesktopStorageAdoption(f.binding, f.launch, { ...f.hooks, cleanupResources: interrupt }, validate)
  expect(first.state).toBe('cleanup-pending')
  await expect(fs.lstat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
  const badLaunch = { ...f.launch, proof: f.launch.proof.replace(/^./, char => char === 'a' ? 'b' : 'a') }
  expect((await executeDesktopStorageAdoption(f.binding, badLaunch, f.hooks, validate)).state).toBe('blocked')
  expect((await readStorageMigrationStatus(f.binding))?.state).toBe('cleanup-pending')
  const recovered = await executeDesktopStorageAdoption(f.binding, f.launch, f.hooks, validate)
  expect(recovered).toMatchObject({ id: first.id, state: 'ready' })
  const target = path.join(f.binding.internalDir, 'openai-oauth.json')
  expect(await fs.readFile(target, 'utf8')).toBe(f.bytes)
  await fs.writeFile(target, 'subsequent target write')
  expect(await executeDesktopStorageAdoption(f.binding, f.launch, f.hooks, validate)).toEqual(recovered)
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
  expect((await executeDesktopStorageAdoption(f.binding, f.launch, f.hooks, validate)).state).toBe('blocked')
  expect(validate).not.toHaveBeenCalled()
  expect((await readStorageMigrationStatus(f.binding))?.id).toBe(imported.id)
  expect(await fs.readFile(f.source, 'utf8')).toBe(f.bytes)
})
