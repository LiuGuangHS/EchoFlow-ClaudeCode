import { afterEach, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { copyMigrationCredentials, createStorageMigrationCredentialHooks } from './storageMigrationCredentials.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'migration-credentials-'))
  roots.push(root)
  const directory = async (name: string) => {
    const dir = path.join(root, name)
    await fs.mkdir(dir)
    return dir
  }
  const target = await directory('target')
  const transaction = await directory('transaction')
  const values = new Map([['Claude Code-credentials', 'shared-sentinel']])
  const store = {
    read: mock(async (service: string) => values.get(service) ?? null),
    write: mock(async (service: string, value: string) => { values.set(service, value) }),
    remove: mock(async (service: string) => { values.delete(service) }),
  }
  return { directory, target, transaction, values, store }
}

const wholeRoot = (directory: string) => ({ directory, markerRoot: directory })
const serviceName = (directory: string) => `Claude Code-credentials-${createHash('sha256').update(directory.normalize('NFC')).digest('hex').slice(0, 8)}`

// The default macOS filesystem treats these two spellings as one directory.
test.skipIf(process.platform === 'darwin')('blocks distinct source and target roots that share a Keychain namespace', async () => {
  const f = await fixture()
  const source = await f.directory('café')
  const target = await f.directory('café')
  const service = serviceName(target)
  f.values.set(service, 'original')
  const beforeCreate = mock(async () => {})
  const hooks = createStorageMigrationCredentialHooks(target, f.store)
  await expect(hooks.prepareResources!(f.transaction, [wholeRoot(source)])).rejects.toThrow('same macOS Keychain namespace')
  await expect(copyMigrationCredentials(source, false, target, f.store, beforeCreate)).rejects.toThrow('same macOS Keychain namespace')
  expect(beforeCreate).not.toHaveBeenCalled()
  expect(f.store.read).not.toHaveBeenCalled()
  expect(f.store.write).not.toHaveBeenCalled()
  expect(f.store.remove).not.toHaveBeenCalled()
  expect(f.values.get(service)).toBe('original')
})

test.skipIf(process.platform === 'darwin')('checks all eligible sources for collisions before reading any source credential', async () => {
  const f = await fixture()
  const sources = await Promise.all(['unrelated', 'café', 'café'].map(f.directory))
  f.values.set(serviceName(sources[0]!), 'first-fixture')
  const hooks = createStorageMigrationCredentialHooks(f.target, f.store)
  await expect(hooks.prepareResources!(f.transaction, sources.map(wholeRoot))).rejects.toThrow('same macOS Keychain namespace')
  expect(f.store.read).not.toHaveBeenCalled()
  expect(f.store.write).not.toHaveBeenCalled()
  expect(f.store.remove).not.toHaveBeenCalled()
})

test('preserves the existing namespace of an in-place root', async () => {
  const f = await fixture()
  const service = serviceName(f.target)
  f.values.set(service, 'original')
  const hooks = createStorageMigrationCredentialHooks(f.target, f.store)
  await hooks.prepareResources!(f.transaction, [wholeRoot(f.target)])
  await hooks.validateResources!(f.transaction)
  await hooks.cleanupResources!(f.transaction)
  expect(f.store.read).not.toHaveBeenCalled()
  expect(f.store.write).not.toHaveBeenCalled()
  expect(f.store.remove).not.toHaveBeenCalled()
  expect(f.values.get(service)).toBe('original')
})

test('resumes a copy after an interrupted write and only retires the copied source', async () => {
  const f = await fixture()
  const source = await f.directory('café')
  const oldService = serviceName(source)
  const newService = serviceName(f.target)
  f.values.set(oldService, 'fake-owned-token')
  f.store.write.mockImplementationOnce(async (service, value) => {
    f.values.set(service, value)
    throw new Error('fixture interruption')
  })
  const sources = [wholeRoot(source)]
  const hooks = createStorageMigrationCredentialHooks(f.target, f.store)
  await expect(hooks.prepareResources!(f.transaction, sources)).rejects.toThrow('fixture interruption')
  expect(f.values.get(oldService)).toBe('fake-owned-token')
  await hooks.prepareResources!(f.transaction, sources)
  await hooks.validateResources!(f.transaction)
  await hooks.cleanupResources!(f.transaction)
  expect(f.store.write).toHaveBeenCalledTimes(1)
  expect(f.store.remove).toHaveBeenCalledTimes(1)
  expect(f.store.remove).toHaveBeenCalledWith(oldService)
  expect(f.values).toEqual(new Map([['Claude Code-credentials', 'shared-sentinel'], [newService, 'fake-owned-token']]))
})
