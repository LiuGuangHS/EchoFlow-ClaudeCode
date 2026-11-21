import { afterEach, expect, test } from 'bun:test'
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { useMultiFileAuthState } from '@whiskeysockets/baileys/lib/Utils/use-multi-file-auth-state.js'
import { runStorageAdoptionCommand } from '../../src/services/storageAdoption.js'
import {
  armWhatsAppStorageApproval, completeStorageMigration, executeStorageMigration, previewWhatsAppAdoption,
  readApprovedWhatsAppSources, recoverStorageMigration,
} from '../../src/services/storageMigration.js'
import { resolveStorageBinding } from '../../src/utils/echoFlowConfigRoot.js'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'

const accountJid = '15550100001@s.whatsapp.net'
const appKey = 'fixture-key'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(custom = false, missingKey = false) {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'whatsapp-storage-migration-')))
  roots.push(home)
  const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'active')] })
  const shared = path.join(home, '.claude')
  const config = path.join(shared, 'adapters.json')
  const directory = custom ? path.join(home, 'custom auth') : path.join(shared, 'whatsapp-auth', 'default')
  await mkdir(shared)
  await writeFile(path.join(shared, 'settings.json'), 'unrelated')
  const configBytes = JSON.stringify({
    whatsapp: { accountJid, ...(custom && { authDir: directory }) },
    future: { keep: true },
  }) + '\n'
  await writeFile(config, configBytes)
  const auth = await useMultiFileAuthState(directory)
  auth.state.creds.me = { id: '15550100001:4@s.whatsapp.net' }
  auth.state.creds.myAppStateKeyId = appKey
  await auth.saveCreds()
  await writeFile(path.join(directory, 'creds.json.bak'), await readFile(path.join(directory, 'creds.json')))
  if (!missingKey) await auth.state.keys.set({ 'app-state-sync-key': { [appKey]: { keyData: Buffer.alloc(32, 42) } } })
  const hooks = { assertQuiescent: async (directories: readonly string[]) => {
    expect(directories.every(dir => dir.startsWith(home + path.sep))).toBe(true)
  } }
  return { home, binding, shared, config, configBytes, directory, auth, hooks }
}

test.each([false, true])('CLI migrates the whole account and preserves the saved config (custom path: %s)', async custom => {
  const f = await fixture(custom)
  const preview = await previewWhatsAppAdoption(f.binding, f.directory, f.config)
  const target = path.join(f.binding.root, preview.account.destination)
  const input = Object.assign(Readable.from(['yes\n']), { isTTY: true })
  const messages: string[] = []
  const previousExitCode = process.exitCode
  try {
    await runStorageAdoptionCommand(['storage', 'adopt', 'whatsapp-auth', '--directory', f.directory, '--config', f.config], {
      binding: f.binding, hooks: f.hooks, input,
      output: { write: message => { messages.push(String(message)); return true } },
    })
    expect(messages.join('')).toContain('Storage adoption completed')
    expect(messages.join('')).not.toContain(accountJid)
    expect(messages.join('')).not.toContain(`app-state-sync-key-${appKey}.json`)
    expect(await readFile(path.join(f.binding.root, 'adapters.json'), 'utf8')).toBe(f.configBytes)
    expect(await Bun.file(f.config).exists()).toBe(false)
    await expect(readdir(f.directory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(f.shared, 'settings.json'), 'utf8')).toBe('unrelated')
    const assertConsumer = async (root: string, expected: string) => {
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
        import assert from 'node:assert/strict'
        import { loadConfig } from './adapters/common/config.ts'
        import { validateWhatsAppAuthDirectory } from './adapters/whatsapp/storageAdoption.ts'
        const { authDir, accountJid } = loadConfig().whatsapp
        assert.equal(authDir, process.env.EXPECTED_AUTH)
        await validateWhatsAppAuthDirectory(authDir, accountJid)
      `], {
        cwd: path.resolve(import.meta.dir, '../..'),
        env: createSandboxedTestEnvironment(f.home, {
          CLAUDE_CONFIG_DIR: root, EXPECTED_AUTH: expected,
          ...(custom && { WHATSAPP_AUTH_DIR: f.directory }),
        }), stdout: 'ignore', stderr: 'inherit', timeout: 30_000,
      })
      expect(await child.exited).toBe(0)
    }
    await assertConsumer(f.binding.root, target)

    const moved = resolveStorageBinding({ env: {}, roots: [path.join(f.home, 'moved')] })
    const result = await executeStorageMigration({ binding: moved,
      sources: [{ directory: f.binding.root, markerRoot: f.binding.root }], hooks: f.hooks })
    expect(result.state).toBe('validation-required')
    expect((await completeStorageMigration(moved, result.id!, f.hooks, async () => {})).state).toBe('ready')
    expect(await readFile(path.join(moved.root, 'adapters.json'), 'utf8')).toBe(f.configBytes)
    await assertConsumer(moved.root, path.join(moved.root, preview.account.destination))
  } finally { process.exitCode = previousExitCode ?? 0 }
}, 30_000)

test('an existing config can bind a custom legacy directory without replacing the config', async () => {
  const f = await fixture(true)
  const activeConfig = path.join(f.binding.root, 'adapters.json')
  const { buildEchoFlowOwnershipMarker } = await import('../../src/utils/echoFlowConfigRoot.js')
  await mkdir(f.binding.root)
  await writeFile(path.join(f.binding.root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
  await writeFile(activeConfig, f.configBytes)
  const preview = await previewWhatsAppAdoption(f.binding, f.directory)
  const sources = await readApprovedWhatsAppSources(f.binding, await armWhatsAppStorageApproval(f.binding, preview))
  expect(sources).toHaveLength(1)
  const result = await executeStorageMigration({ binding: f.binding, sources, hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  expect(await readFile(activeConfig, 'utf8')).toBe(f.configBytes)
  expect(await readFile(f.config, 'utf8')).toBe(f.configBytes)
})

test('CLI failure keeps the account identifier in rejected filenames private', async () => {
  const f = await fixture()
  const key = path.join(f.directory, `tctoken-${accountJid}.json`)
  const other = path.join(f.shared, 'unrelated.json')
  await writeFile(other, '{}')
  await link(other, key)
  const input = Object.assign(Readable.from(['yes\n']), { isTTY: true })
  const messages: string[] = []
  const previousExitCode = process.exitCode
  try {
    await runStorageAdoptionCommand(['storage', 'adopt', 'whatsapp-auth', '--directory', f.directory, '--config', f.config], {
      binding: f.binding, hooks: f.hooks, input,
      output: { write: message => { messages.push(String(message)); return true } },
    })
    expect(process.exitCode).toBe(1)
    expect(messages.join('')).not.toContain(accountJid)
    expect(await readFile(key, 'utf8')).toBe('{}')
    expect(await readFile(f.config, 'utf8')).toBe(f.configBytes)
  } finally { process.exitCode = previousExitCode ?? 0 }
})

test('a missing app-state key blocks publication and keeps all original account files', async () => {
  const f = await fixture(false, true)
  const preview = await previewWhatsAppAdoption(f.binding, f.directory, f.config)
  const sources = await readApprovedWhatsAppSources(f.binding, await armWhatsAppStorageApproval(f.binding, preview))
  const result = await executeStorageMigration({ binding: f.binding, sources, hooks: f.hooks })
  expect(result.state).toBe('blocked')
  expect(result.issues.join()).toContain('WhatsApp authentication directory could not be validated')
  expect((await readdir(f.directory)).sort()).toEqual(['creds.json', 'creds.json.bak'])
  await expect(readdir(path.join(f.binding.root, preview.account.destination))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(f.config, 'utf8')).toBe(f.configBytes)
})

test('a late account file prevents acceptance and recovery finishes the same unchanged snapshot', async () => {
  const f = await fixture()
  const preview = await previewWhatsAppAdoption(f.binding, f.directory, f.config)
  const sources = await readApprovedWhatsAppSources(f.binding, await armWhatsAppStorageApproval(f.binding, preview))
  const result = await executeStorageMigration({ binding: f.binding, sources, hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  const added = path.join(f.directory, 'session-late.json')
  await writeFile(added, '{}')
  const blocked = await completeStorageMigration(f.binding, result.id!, f.hooks)
  expect(blocked.state).toBe('blocked')
  expect(blocked.issues.join()).toContain('Approved WhatsApp directory contents changed')
  expect(await readFile(f.config, 'utf8')).toBe(f.configBytes)
  expect(await Bun.file(path.join(f.directory, 'creds.json')).exists()).toBe(true)
  expect(await Bun.file(added).exists()).toBe(true)
  await rm(added)
  expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('validation-required')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
})

test('a file added to the target after publication prevents acceptance', async () => {
  const f = await fixture()
  const preview = await previewWhatsAppAdoption(f.binding, f.directory, f.config)
  const sources = await readApprovedWhatsAppSources(f.binding, await armWhatsAppStorageApproval(f.binding, preview))
  const result = await executeStorageMigration({ binding: f.binding, sources, hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  const added = path.join(f.binding.root, preview.account.destination, 'session-late.json')
  await writeFile(added, '{}')
  const blocked = await completeStorageMigration(f.binding, result.id!, f.hooks)
  expect(blocked.state).toBe('blocked')
  expect(blocked.issues.join()).toContain('WhatsApp sign-in copy is incomplete or contains unapproved files')
  expect(await readFile(added, 'utf8')).toBe('{}')
  expect(await readFile(f.config, 'utf8')).toBe(f.configBytes)
  expect(await Bun.file(path.join(f.directory, 'creds.json')).exists()).toBe(true)
})
