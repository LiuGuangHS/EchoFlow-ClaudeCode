import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorageMigrationHooks, validateStorageSQLite } from './storageMigrationValidation.js'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixtureDirectory() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'migration-validation-')))
  directories.push(directory)
  return directory
}

const binding = (root: string) => ({ root, internalDir: join(root, 'echoflow-code'), selection: 'explicit' as const })

test('validates an intact database through a private copy', async () => {
  const directory = await fixtureDirectory()
  const database = join(directory, 'state.sqlite')
  const db = new DatabaseSync(database)
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY); INSERT INTO items VALUES (1)')
  db.close()
  const hooks = createStorageMigrationHooks(binding(directory))
  let copy = ''
  await hooks.validateSQLite!(database, path => { copy = path })
  expect(copy).not.toBe(database)
  expect(copy.endsWith('state.sqlite')).toBe(true)
})

test('rejects a file that is not a database', async () => {
  const directory = await fixtureDirectory()
  const database = join(directory, 'broken.sqlite')
  await writeFile(database, 'this is not sqlite '.repeat(200))
  await expect(validateStorageSQLite(database)).rejects.toThrow()
})

test('hooks expose the Windows permission operations and add credential hooks only on macOS', () => {
  const root = join(tmpdir(), 'migration-validation-hooks')
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const linux = createStorageMigrationHooks(binding(root))
    expect(typeof linux.permissions?.restrictStaging).toBe('function')
    expect(typeof linux.permissions?.preflight).toBe('function')
    expect(typeof linux.permissions?.preserve).toBe('function')
    expect(linux.prepareResources).toBeUndefined()

    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const darwin = createStorageMigrationHooks(binding(root))
    expect(typeof darwin.prepareResources).toBe('function')
    expect(typeof darwin.validateResources).toBe('function')
    expect(typeof darwin.cleanupResources).toBe('function')
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
})
