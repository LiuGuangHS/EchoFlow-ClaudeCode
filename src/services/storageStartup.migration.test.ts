import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'

const repository = resolve(import.meta.dir, '../..')
const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

async function startup(body: string, seed?: string) {
  const home = mkdtempSync(join(tmpdir(), 'echoflow-headless-migration-'))
  homes.push(home)
  const root = join(home, 'selected')
  const run = async (body: string) => {
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
    import { mock } from 'bun:test'
    import fs from 'node:fs/promises'
    import path from 'node:path'
    const home = process.env.HOME
    const root = process.env.CLAUDE_CONFIG_DIR
    globalThis.fetch = async () => { throw new Error('Unexpected network request') }
    let inventoryError = ''
    let onInventory
    // Only replace the OS inventory: these private fixtures have no other owners.
    mock.module('./src/server/migrationInventory.ts', () => ({
      assertMigrationQuiescent: async (roots, owned) => {
        if (!roots.length || roots.some(value => !value.startsWith(home + path.sep))) throw new Error('Inventory escaped fixture')
        if (owned.length !== 1 || owned[0] !== process.pid) throw new Error('Unexpected owner exclusion')
        if (inventoryError) throw new Error(inventoryError)
        await onInventory?.()
      },
    }))
    const { initializeProcessStorage, releaseProcessStorage } = await import('./src/services/storageStartup.ts')
    const { openLocalIndexDatabase } = await import('./src/server/services/localIndex/database.ts')
    const { buildEchoFlowOwnershipMarker } = await import('./src/utils/echoFlowConfigRoot.ts')
    const put = async (file, content) => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, content)
    }
    const providers = {
      schemaVersion: 1,
      providers: [{ id: 'fixture', presetId: 'custom', name: 'Fixture', baseUrl: 'https://fixture.invalid', apiKey: 'fake-key', models: { main: 'fixture', haiku: 'fixture', sonnet: 'fixture', opus: 'fixture' } }],
      activeId: 'fixture', extension: { preserve: true },
    }
    ${body}
    `], {
      cwd: repository,
      env: createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: root }),
      stdout: 'pipe', stderr: 'pipe', timeout: 20_000,
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    return { stdout, stderr, code }
  }
  if (seed) expect(await run(seed)).toEqual({ stdout: '', stderr: '', code: 0 })
  return await run(body)
}

const pendingAcceptedMigration = `
  const { executeStorageMigration, completeStorageMigration } = await import('./src/services/storageMigration.ts')
  const { resolveStorageBinding } = await import('./src/utils/echoFlowConfigRoot.ts')
  const binding = resolveStorageBinding()
  const shared = path.join(home, '.claude')
  const retired = path.join(shared, 'cc-haha')
  const original = path.join(retired, 'opaque.bin')
  await put(original, 'accepted bytes')
  await put(path.join(retired, 'providers.json'), JSON.stringify(providers))
  const { upgradePersistentStorageValue } = await import('./src/server/services/persistentStorageMigrations.ts')
  const imported = await executeStorageMigration({
    binding, sources: [{ directory: retired, markerRoot: shared, ownership: 'legacy-internal', destination: 'echoflow-code' }],
    hooks: { assertQuiescent: async () => {}, platform: 'linux', upgradeJson: upgradePersistentStorageValue },
  })
  if (imported.state !== 'validation-required') throw new Error(JSON.stringify(imported))
  await fs.writeFile(original, 'temporary late bytes')
  const pending = await completeStorageMigration(binding, imported.id, { assertQuiescent: async () => {}, platform: 'linux' })
  if (pending.state !== 'cleanup-pending') throw new Error(JSON.stringify(pending))
  await fs.writeFile(original, 'accepted bytes')
`

describe('default headless migration admission', () => {
  test.each(['unaccepted', 'accepted', 'missing journal'])('headless admission checks the legacy selection receipt: %s', async phase => {
    const result = await startup(`
      const phase = ${JSON.stringify(phase)}
      const { prepareHeadlessStorage } = await import('./src/services/storageStartup.ts')
      const { acquireStorageWriter, completeStorageMigration, executeStorageMigration, readStorageMigrationStatus, selectStartupStorage, storageLocationFile, readStorageLocation } = await import('./src/services/storageMigration.ts')
      const { resolveStorageBinding } = await import('./src/utils/echoFlowConfigRoot.ts')
      const { createHash } = await import('node:crypto')
      const file = storageLocationFile()
      const binding = selectStartupStorage(resolveStorageBinding(), file)
      const directory = path.join(home, 'legacy-profile')
      const name = 'app-mode.json'
      const pointer = path.join(directory, name)
      const bytes = JSON.stringify({ mode: 'portable', portable_dir: root })
      await put(pointer, bytes)
      const stat = await fs.lstat(pointer, { bigint: true })
      const hooks = { platform: 'linux', assertQuiescent: async () => {} }
      const imported = await executeStorageMigration({
        binding, hooks, legacySelection: { directory, name },
        sources: [{ directory, markerRoot: directory, layout: 'legacy-controls', controls: {
          [name]: { digest: createHash('sha256').update(bytes).digest('hex'), dev: String(stat.dev), ino: String(stat.ino) },
        } }],
      })
      if (imported.state !== 'validation-required') throw new Error(JSON.stringify(imported))
      if (phase !== 'unaccepted') {
        const pending = await completeStorageMigration(binding, imported.id, {
          ...hooks, cleanupResources: async () => { throw new Error('fixture interrupted accepted cleanup') },
        })
        if (pending.state !== 'cleanup-pending' || readStorageLocation(file) !== root || await fs.exists(pointer)) throw new Error(JSON.stringify(pending))
        if (phase === 'missing journal') await fs.rm(path.join(binding.internalDir, 'migrations', imported.id), { recursive: true })
        delete process.env.CLAUDE_CONFIG_DIR
      }
      const options = { hooks, validateRestrictedStartup: async () => { throw new Error('Headless startup must not validate a desktop selection') } }
      let failure
      try {
        const lease = await prepareHeadlessStorage(options)
        if (lease.binding.root !== root) throw new Error('Registered root was not selected')
        await lease.release()
      } catch (error) { failure = String(error) }
      if (phase === 'accepted') {
        if (failure || (await readStorageMigrationStatus(binding))?.state !== 'ready') throw new Error('Accepted migration was not completed: ' + failure)
      } else if (phase === 'missing journal') {
        if (!failure?.includes('Missing active EchoFlow storage transaction')) throw new Error('Invalid selection was admitted: ' + failure)
        try {
          const lease = await acquireStorageWriter(binding)
          await lease.release()
          throw new Error('Invalid selection was admitted by the writer lease')
        } catch (error) {
          if (!String(error).includes('Missing active EchoFlow storage transaction')) throw error
        }
      } else {
        if (!failure?.includes('open EchoFlow Desktop')) throw new Error('Unexpected admission result: ' + failure)
        if (readStorageLocation(file) || await fs.readFile(pointer, 'utf8') !== bytes) throw new Error('Pending legacy selection changed')
      }
    `)
    expect(result).toEqual({ stdout: '', stderr: '', code: 0 })
  })

  test.each(['none', 'owned', 'unowned'])('cold recovery rediscovers sources after accepted cleanup: %s', async variant => {
    const result = await startup(`
      const variant = ${JSON.stringify(variant)}
      const retired = path.join(home, '.claude/cc-haha')
      const appeared = path.join(process.env.XDG_CONFIG_HOME, 'claude-code-desktop')
      let injected = false
      onInventory = async () => {
        if (injected || variant === 'none') return
        injected = true
        if (variant === 'owned') await put(path.join(appeared, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
        await put(path.join(appeared, 'projects/new.jsonl'), 'new source')
      }
      let failure
      try { await initializeProcessStorage() } catch (error) { failure = String(error) }
      if (variant === 'unowned') {
        if (!failure?.includes('Unproven or future storage ownership')) throw new Error('Unexpected admission result: ' + failure)
        if (await fs.readFile(path.join(appeared, 'projects/new.jsonl'), 'utf8') !== 'new source') throw new Error('Unknown owner changed')
      } else {
        if (failure) throw new Error(failure)
        if (variant === 'owned' && await fs.readFile(path.join(root, 'projects/new.jsonl'), 'utf8') !== 'new source') throw new Error('New source not discovered')
        if (await fs.stat(appeared).catch(error => { if (error.code === 'ENOENT') return null; throw error })) throw new Error('New owned source retained')
        await releaseProcessStorage()
      }
      if (await fs.stat(retired).catch(error => { if (error.code === 'ENOENT') return null; throw error })) throw new Error('Accepted source not retired')
      if (await fs.readFile(path.join(root, 'echoflow-code/opaque.bin'), 'utf8') !== 'accepted bytes') throw new Error('Accepted target changed')
      const transactions = path.join(root, 'echoflow-code/migrations')
      const ids = (await fs.readdir(transactions)).filter(name => /^[a-f0-9-]{36}$/.test(name))
      if (ids.length !== (variant === 'owned' ? 2 : 1)) throw new Error('Unexpected reimport transaction')
      const writers = await fs.readdir(path.join(transactions, 'writers')).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      if (writers.length) throw new Error('Writer leaked or unowned source admitted')
      console.log('protected')
    `, pendingAcceptedMigration)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('protected')
  })

  test('cold ready startup still blocks a recreated retired source', async () => {
    const result = await startup(`
      let failure
      try { await initializeProcessStorage() } catch (error) { failure = String(error) }
      if (!failure?.includes('Retired storage root')) throw new Error('Unexpected admission result: ' + failure)
      if (await fs.readFile(path.join(home, '.claude/cc-haha/opaque.bin'), 'utf8') !== 'fork bytes') throw new Error('Fork changed')
      if (await fs.readFile(path.join(root, 'echoflow-code/opaque.bin'), 'utf8') !== 'accepted bytes') throw new Error('Accepted target changed')
      const writers = await fs.readdir(path.join(root, 'echoflow-code/migrations/writers')).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      if (writers.length) throw new Error('Fork admitted a writer')
      console.log('protected')
    `, pendingAcceptedMigration + `
      const { recoverStorageMigration } = await import('./src/services/storageMigration.ts')
      const ready = await recoverStorageMigration(binding, { assertQuiescent: async () => {}, platform: 'linux' })
      if (ready.state !== 'ready') throw new Error(JSON.stringify(ready))
      await put(original, 'fork bytes')
      await put(path.join(retired, 'providers.json'), JSON.stringify(providers))
    `)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('protected')
  })

  test.each(['live-owner', 'future-database', 'native-profile'])('does not accept or clean a migration without consumer admission: %s', async variant => {
    const result = await startup(`
      const variant = ${JSON.stringify(variant)}
      const internal = path.join(root, 'echoflow-code')
      await put(path.join(root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
      const original = path.join(internal, 'index-v1.sqlite')
      const source = openLocalIndexDatabase({ path: original })
      source.write(sql => {
        sql.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', 'protected', 'retained')
        if (variant === 'future-database') sql.exec('PRAGMA user_version = 999')
      })
      source.close()
      const before = await fs.readFile(original)
      if (variant === 'live-owner') inventoryError = 'fixture owner remains active'
      if (variant === 'native-profile') await put(path.join(root, 'Local Storage/saved.bin'), 'native saved bytes')
      let failure
      try { await initializeProcessStorage() } catch (error) { failure = String(error) }
      const expected = variant === 'live-owner' ? 'fixture owner remains active' : variant === 'future-database' ? 'Unsupported local index' : 'restricted native desktop validation'
      if (!failure?.includes(expected)) throw new Error('Unexpected admission result: ' + failure)
      if (!before.equals(await fs.readFile(original))) throw new Error('Unaccepted source changed')
      const writers = await fs.readdir(path.join(internal, 'migrations/writers')).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      if (writers.length) throw new Error('Unvalidated business writer was admitted')
      console.log('protected')
    `)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('protected')
  })

  test('initializes real consumers from both historical namespaces before leasing a writer', async () => {
    const result = await startup(`
      const shared = path.join(home, '.claude')
      const old = path.join(shared, 'cc-haha')
      const sibling = path.join(shared, 'echoflow-code')
      await put(path.join(shared, 'settings.json'), '{"unrelated":"preserved"}\\n')
      await put(path.join(old, 'providers.json'), JSON.stringify(providers))
      await put(path.join(sibling, 'opaque.bin'), 'unknown owned bytes')
      const source = openLocalIndexDatabase({ path: path.join(sibling, 'index-v1.sqlite') })
      source.write(sql => sql.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', 'headless-migration', 'preserved'))
      source.close()
      await initializeProcessStorage()
      const current = JSON.parse(await fs.readFile(path.join(root, 'echoflow-code/providers.json'), 'utf8'))
      if (current.schemaVersion <= 1 || current.providers[0].apiKey !== 'fake-key' || !current.extension.preserve) throw new Error('Provider upgrade lost data')
      const consumer = openLocalIndexDatabase()
      try {
        const row = consumer.read(sql => sql.get('SELECT value FROM schema_meta WHERE key = ?', 'headless-migration'))
        if (row?.value !== 'preserved') throw new Error('Default DB consumer cannot read migrated data')
      } finally { consumer.close() }
      if (await fs.readFile(path.join(root, 'echoflow-code/opaque.bin'), 'utf8') !== 'unknown owned bytes') throw new Error('Unknown owned data lost')
      if (await fs.readFile(path.join(shared, 'settings.json'), 'utf8') !== '{"unrelated":"preserved"}\\n') throw new Error('Shared state changed')
      if ((await fs.readdir(shared)).join(',') !== 'settings.json') throw new Error('Retired namespaces retained')
      await releaseProcessStorage()
      console.log('ready')
    `)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('ready')
  })

  test('headless startup adopts only proven shared desktop state and preserves raw bytes and unrelated settings', async () => {
    const result = await startup(`
      const shared = path.join(home, '.claude')
      const state = {
        'window-state.json': '{ "x":0,"y":0,"width":1280,"height":820,"maximized":false,"future":[1,2] }\\n',
        'terminal-config.json': '{ "bash_path": null, "future": {"keep":true} }\\n',
        'appearance-state.json': '{ "isDark":true,"followSystem":false,"background":"#201D17","lightBackground":"#FFFFFF","future":7 }\\n',
      }
      for (const [name, bytes] of Object.entries(state)) await put(path.join(shared, name), bytes)
      await put(path.join(shared, 'settings.json'), '{"unrelated":"preserved"}\\n')
      await initializeProcessStorage()
      for (const [name, bytes] of Object.entries(state)) {
        if (await fs.readFile(path.join(root, name), 'utf8') !== bytes) throw new Error('State bytes changed: ' + name)
        if (await fs.stat(path.join(shared, name)).catch(() => null)) throw new Error('Legacy state not retired: ' + name)
      }
      if ((await fs.readdir(shared)).join(',') !== 'settings.json') throw new Error('Shared parent was claimed')
      if (await fs.readFile(path.join(shared, 'settings.json'), 'utf8') !== '{"unrelated":"preserved"}\\n') throw new Error('Shared settings changed')
      const relocations = JSON.parse(await fs.readFile(path.join(root, 'echoflow-code/storage-relocations.json'), 'utf8'))
      if (relocations.mappings.length) throw new Error('Shared parent became an attachment relocation')
      await releaseProcessStorage()
      console.log('ready')
    `)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('ready')
  })

  test('headless startup refuses an unproven shared desktop state before leasing a writer', async () => {
    const result = await startup(`
      const file = path.join(home, '.claude/window-state.json')
      const bytes = '{"foreign":true}\\n'
      await put(file, bytes)
      let failure
      try { await initializeProcessStorage() } catch (error) { failure = String(error) }
      if (!failure?.includes('Unproven legacy desktop state')) throw new Error('Unexpected admission result: ' + failure)
      if (await fs.readFile(file, 'utf8') !== bytes) throw new Error('Unproven state changed')
      const writers = await fs.readdir(path.join(root, 'echoflow-code/migrations/writers')).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      if (writers.length) throw new Error('Unproven state admitted a writer')
      console.log('protected')
    `)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('protected')
  })

  test('a shared desktop state recreated after acceptance blocks headless startup without resurrecting it', async () => {
    const result = await startup(`
      let failure
      try { await initializeProcessStorage() } catch (error) { failure = String(error) }
      if (!failure?.includes('Retired legacy file')) throw new Error('Unexpected admission result: ' + failure)
      if (await fs.readFile(path.join(home, '.claude/terminal-config.json'), 'utf8') !== '{"bash_path":"fork"}') throw new Error('Fork changed')
      if (await fs.readFile(path.join(root, 'terminal-config.json'), 'utf8') !== '{"bash_path":null}') throw new Error('Accepted state changed')
      console.log('protected')
    `, `
      const file = path.join(home, '.claude/terminal-config.json')
      await put(file, '{"bash_path":null}')
      await initializeProcessStorage()
      await releaseProcessStorage()
      await put(file, '{"bash_path":"fork"}')
    `)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('protected')
  })

  test('upgrades an already selected root without recursively claiming its active internal directory', async () => {
    const result = await startup(`
      const internal = path.join(root, 'echoflow-code')
      await put(path.join(root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
      await put(path.join(internal, 'opaque.bin'), 'keep active bytes')
      const source = openLocalIndexDatabase({ path: path.join(internal, 'index-v1.sqlite') })
      source.write(sql => sql.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', 'headless-flat', 'preserved'))
      source.close()
      await initializeProcessStorage()
      const consumer = openLocalIndexDatabase()
      try {
        const row = consumer.read(sql => sql.get('SELECT value FROM schema_meta WHERE key = ?', 'headless-flat'))
        if (row?.value !== 'preserved') throw new Error('Flat DB not consumed from canonical path')
      } finally { consumer.close() }
      if (await fs.readFile(path.join(internal, 'opaque.bin'), 'utf8') !== 'keep active bytes') throw new Error('Active directory changed')
      if (await fs.stat(path.join(internal, 'index-v1.sqlite')).catch(() => null)) throw new Error('Flat DB not retired')
      await releaseProcessStorage()
      console.log('ready')
    `)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('ready')
  })
})
