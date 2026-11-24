import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const homes: string[] = []
afterEach(async () => { for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true }) })

async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-config-adoption-'))
  homes.push(home)
  const root = path.join(home, 'selected')
  const run = async (body: string, overrides: Record<string, string> = {}) => {
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
      import assert from 'node:assert/strict'
      import fs from 'node:fs/promises'
      import path from 'node:path'
      import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
      import { discoverHeadlessStorageSources, prepareHeadlessStorage } from './src/services/storageStartup.ts'
      import { discoverDesktopStorage, initializeDesktopStorage } from './desktop/electron/services/desktopStorageStartup.ts'
      import { acquireStorageWriter, executeStorageMigration, completeStorageMigration, recoverStorageMigration } from './src/services/storageMigration.ts'
      globalThis.fetch = async () => { throw new Error('Unexpected network request') }
      const home = process.env.HOME
      const root = process.env.CLAUDE_CONFIG_DIR
      const binding = resolveStorageBinding()
      const internal = binding.internalDir
      const profile = path.join(process.env.XDG_CONFIG_HOME, 'claude-code-desktop')
      const bytes = ' {"oauthAccount":{"accountUuid":"fake-account"},"extension":{"unknown":[1,{"keep":true}]},"__proto__":{"keep":"own"}}\\n'
      const put = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value) }
      const mark = async directory => put(path.join(directory, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
      const hooks = { assertQuiescent: async roots => assert(roots.every(value => value.startsWith(home + path.sep))), platform: 'linux' }
      const app = {
        getPath: name => name === 'home' ? home : name === 'exe' ? path.join(home, 'install/echoflow') : root,
        commandLine: { hasSwitch: () => false, getSwitchValue: () => '' },
      }
      const discover = () => discoverDesktopStorage(app, process.env, 'linux', home)
      const journals = async () => {
        const directory = path.join(internal, 'migrations')
        const ids = (await fs.readdir(directory)).filter(name => /^[a-f0-9-]{36}$/.test(name))
        return Promise.all(ids.map(async id => ({ id, directory: path.join(directory, id), ...JSON.parse(await fs.readFile(path.join(directory, id, 'journal.json'), 'utf8')) })))
      }
      ${body}
    `], {
      cwd: path.resolve(import.meta.dir, '../..'),
      env: createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: root, ...overrides }),
      stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
    })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: '', stdout: '' })
  }
  return { home, root, run }
}

for (const startup of ['headless', 'desktop']) {
  for (const scope of ['profile', 'in-place']) {
    test(`${startup} adopts ${scope} legacy config before the real global config consumer`, async () => {
      const f = await fixture()
      await f.run(`
        const source = ${JSON.stringify(scope)} === 'profile' ? profile : root
        await mark(source)
        await put(path.join(source, '.config.json'), bytes)
        await put(path.join(source, 'unknown/opaque.bin'), Buffer.from([0, 255, 8, 0]))
        await put(path.join(home, '.claude.json'), 'shared home bytes')
        await put(path.join(home, '.claude/.config.json'), 'shared root bytes')
        const lease = ${JSON.stringify(startup)} === 'desktop'
          ? await initializeDesktopStorage(discover(), hooks, async () => {})
          : await prepareHeadlessStorage({ hooks, validateRestrictedStartup: async () => {} })
        try {
          const { getGlobalClaudeFile } = await import('./src/utils/env.ts')
          assert.equal(getGlobalClaudeFile(), path.join(root, '.claude.json'))
          assert.equal(await fs.readFile(getGlobalClaudeFile(), 'utf8'), bytes)
          assert.equal(JSON.parse(await fs.readFile(getGlobalClaudeFile(), 'utf8')).extension.unknown[1].keep, true)
          assert.equal(await fs.exists(path.join(source, '.config.json')), false)
          assert.deepEqual(await fs.readFile(path.join(root, 'unknown/opaque.bin')), Buffer.from([0, 255, 8, 0]))
          assert.equal(await fs.readFile(path.join(home, '.claude.json'), 'utf8'), 'shared home bytes')
          assert.equal(await fs.readFile(path.join(home, '.claude/.config.json'), 'utf8'), 'shared root bytes')
          const [journal] = await journals()
          const entry = journal.entries.find(entry => entry.relative === '.config.json')
          assert.equal(entry.destination, '.claude.json')
          assert.equal(await fs.readFile(path.join(journal.directory, 'sources', String(entry.source), '.config.json'), 'utf8'), bytes)
          if (source === root) {
            assert.equal(journal.sources[entry.source].layout, 'root-config')
            assert.equal(journal.entries.length, 1)
            assert.deepEqual(journal.sources[entry.source].directories, [])
            const relocations = JSON.parse(await fs.readFile(path.join(internal, 'storage-relocations.json'), 'utf8'))
            assert.deepEqual(relocations.mappings, [])
            assert.deepEqual(relocations.previousRoots, [])
          } else assert.equal(await fs.exists(source), false)
        } finally { await lease.release() }
        const again = await initializeDesktopStorage(discover(), hooks, async () => { throw new Error('Already accepted') })
        await again.release()
      `)
    })
  }
}

for (const scope of ['profile', 'in-place']) {
  test(`${scope} canonical config conflicts retain both originals and block writers`, async () => {
    const f = await fixture()
    await f.run(`
      const source = ${JSON.stringify(scope)} === 'profile' ? profile : root
      await mark(source)
      await mark(root)
      await put(path.join(source, '.config.json'), bytes)
      const canonical = '{"different":"canonical","extension":{"unknown":"conflict"}}\\n'
      await put(path.join(root, '.claude.json'), canonical)
      await assert.rejects(initializeDesktopStorage(discover(), hooks, async () => {}), /Conflicting storage entity/)
      assert.equal(await fs.readFile(path.join(source, '.config.json'), 'utf8'), bytes)
      assert.equal(await fs.readFile(path.join(root, '.claude.json'), 'utf8'), canonical)
      await assert.rejects(acquireStorageWriter(binding))
      assert.equal((await recoverStorageMigration(binding, hooks)).state, 'blocked')
      const [journal] = await journals()
      const entry = journal.entries.find(entry => entry.relative === '.config.json')
      assert.equal(await fs.readFile(path.join(journal.directory, 'sources', String(entry.source), '.config.json'), 'utf8'), bytes)
    `)
  })
}

for (const identical of [true, false]) {
  test(`a whole profile containing both legacy and canonical config is ${identical ? 'deduplicated' : 'blocked'}`, async () => {
    const f = await fixture()
    await f.run(`
      await mark(profile)
      await put(path.join(profile, '.config.json'), bytes)
      const canonical = ${identical} ? bytes : '{"other":"saved canonical"}'
      await put(path.join(profile, '.claude.json'), canonical)
      await put(path.join(profile, '.claude-local-oauth.json'), 'unselected OAuth bytes')
      const result = await executeStorageMigration({ binding, sources: [{ directory: profile, markerRoot: profile }], hooks })
      if (${identical}) {
        assert.equal(result.state, 'validation-required', JSON.stringify(result))
        assert.equal((await completeStorageMigration(binding, result.id, hooks)).state, 'ready')
        assert.equal(await fs.readFile(path.join(root, '.claude.json'), 'utf8'), bytes)
        assert.equal(await fs.readFile(path.join(root, '.claude-local-oauth.json'), 'utf8'), 'unselected OAuth bytes')
        assert.equal(await fs.exists(profile), false)
      } else {
        assert.equal(result.state, 'blocked')
        assert.equal(await fs.readFile(path.join(profile, '.config.json'), 'utf8'), bytes)
        assert.equal(await fs.readFile(path.join(profile, '.claude.json'), 'utf8'), canonical)
        assert.equal(await fs.exists(path.join(root, '.claude.json')), false)
        await assert.rejects(acquireStorageWriter(binding))
      }
    `)
  })
}

test('conflicting unknown relocation fields retain both original records', async () => {
  const f = await fixture()
  await f.run(`
    await mark(profile)
    await mark(root)
    const file = 'echoflow-code/storage-relocations.json'
    const record = value => JSON.stringify({ version: 2, previousRoots: [], mappings: [
      { from: path.join(home, 'retired'), to: 'whatsapp-auth/default', future: { value } },
    ] })
    await put(path.join(profile, file), record('source'))
    await put(path.join(root, file), record('target'))
    const result = await executeStorageMigration({ binding, sources: [{ directory: profile, markerRoot: profile }], hooks })
    assert.equal(result.state, 'blocked')
    assert.match(result.issues.join(), /Conflicting storage entity/)
    assert.equal(await fs.readFile(path.join(profile, file), 'utf8'), record('source'))
    assert.equal(await fs.readFile(path.join(root, file), 'utf8'), record('target'))
  `)
})

test('selective root config coexists with active flat indexes and an external whole owned profile', async () => {
  const f = await fixture()
  await f.run(`
    await mark(root)
    await mark(profile)
    await put(path.join(root, '.config.json'), bytes)
    await put(path.join(profile, '.config.json'), bytes)
    await put(path.join(profile, 'projects/old.jsonl'), 'owned profile bytes')
    await put(path.join(internal, 'opaque.bin'), 'active bytes')
    const { openLocalIndexDatabase } = await import('./src/server/services/localIndex/database.ts')
    const database = openLocalIndexDatabase({ path: path.join(internal, 'index-v1.sqlite') })
    database.close()
    const { Database } = await import('bun:sqlite')
    hooks.validateSQLite = async file => { const db = new Database(file, { readonly: true }); try { assert.equal(db.query('PRAGMA quick_check').get().quick_check, 'ok') } finally { db.close() } }
    const launch = discover()
    assert.equal(launch.sources.length, 3)
    const lease = await initializeDesktopStorage(launch, hooks, async () => {})
    await lease.release()
    assert.equal(await fs.readFile(path.join(root, '.claude.json'), 'utf8'), bytes)
    assert.equal(await fs.readFile(path.join(internal, 'opaque.bin'), 'utf8'), 'active bytes')
    assert.equal(await fs.readFile(path.join(root, 'projects/old.jsonl'), 'utf8'), 'owned profile bytes')
    assert.equal(await fs.exists(path.join(internal, 'db/index-v1.sqlite')), true)
    assert.equal(await fs.exists(path.join(internal, 'index-v1.sqlite')), false)
    assert.equal((await journals())[0].sources.length, 3)
    const relocations = JSON.parse(await fs.readFile(path.join(internal, 'storage-relocations.json'), 'utf8'))
    assert(!relocations.previousRoots.includes(root))
    assert(relocations.mappings.every(mapping => !mapping.from.startsWith(root + path.sep) && mapping.from !== root))
    assert.equal((await recoverStorageMigration(binding, hooks)).state, 'ready')
  `)
})

for (const [suffix, oauth] of [
  ['', {}],
  ['-custom-oauth', { CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://claude.fedstart.com' }],
  ['-staging-oauth', { USER_TYPE: 'ant', USE_STAGING_OAUTH: '1' }],
  ['-local-oauth', { USER_TYPE: 'ant', USE_LOCAL_OAUTH: '1' }],
] as const) {
  test(`cold recovery retains the recorded ${suffix || 'production'} canonical destination despite changed OAuth env`, async () => {
    const f = await fixture()
    const canonical = `.claude${suffix}.json`
    await f.run(`
      await mark(root)
      await put(path.join(root, '.config.json'), bytes)
      const sources = await discoverHeadlessStorageSources(binding)
      const result = await executeStorageMigration({ binding, sources, hooks: { ...hooks, prepareResources: async () => { throw new Error('Simulated stop before publication') } } })
      assert.equal(result.state, 'blocked')
      assert.match(result.issues.join('; '), /Simulated stop/)
      assert.equal((await journals())[0].entries[0].destination, ${JSON.stringify(canonical)})
    `, oauth)
    await f.run(`
      const result = await recoverStorageMigration(binding, hooks)
      assert.equal(result.state, 'validation-required', JSON.stringify(result))
      assert.equal((await completeStorageMigration(binding, result.id, hooks)).state, 'ready')
      assert.equal(await fs.readFile(path.join(root, ${JSON.stringify(canonical)}), 'utf8'), bytes)
      assert.equal(await fs.exists(path.join(root, '.config.json')), false)
    `, suffix ? {} : { USER_TYPE: 'ant', USE_LOCAL_OAUTH: '1' })
    await f.run(`
      const lease = await prepareHeadlessStorage({ hooks, validateRestrictedStartup: async () => {} })
      const { getGlobalClaudeFile } = await import('./src/utils/env.ts')
      assert.equal(getGlobalClaudeFile(), path.join(root, ${JSON.stringify(canonical)}))
      assert.equal(await fs.readFile(getGlobalClaudeFile(), 'utf8'), bytes)
      await lease.release()
    `, oauth)
  })
}

test('in-place cleanup resumes after a late source write and detects a recreated config after acceptance', async () => {
  const f = await fixture()
  await f.run(`
    await mark(root)
    await put(path.join(root, '.config.json'), bytes)
    await put(path.join(root, '.claude.json'), bytes)
    const before = await fs.stat(path.join(root, '.claude.json'), { bigint: true })
    const result = await executeStorageMigration({ binding, sources: await discoverHeadlessStorageSources(binding), hooks })
    assert.equal(result.state, 'validation-required')
    assert.equal((await fs.stat(path.join(root, '.claude.json'), { bigint: true })).ino, before.ino)
    await fs.writeFile(path.join(root, '.config.json'), 'late source write')
    assert.equal((await completeStorageMigration(binding, result.id, hooks)).state, 'cleanup-pending')
    assert.equal(await fs.readFile(path.join(root, '.config.json'), 'utf8'), 'late source write')
    await fs.writeFile(path.join(root, '.config.json'), bytes)
  `)
  await f.run(`
    assert.equal((await recoverStorageMigration(binding, hooks)).state, 'ready')
    assert.equal(await fs.exists(path.join(root, '.config.json')), false)
    await fs.unlink(path.join(root, '.claude.json'))
    await put(path.join(root, '.config.json'), bytes)
    const result = await recoverStorageMigration(binding, hooks)
    assert.equal(result.state, 'blocked')
    assert.match(result.issues.join('; '), /Retired.*config/)
    await assert.rejects(acquireStorageWriter(binding), /Retired.*config/)
    await assert.rejects(initializeDesktopStorage(discover(), hooks, async () => {}), /Retired.*config/)
    assert.equal(await fs.exists(path.join(root, '.claude.json')), false)
  `)
})

test('unmarked selected roots and linked configs cannot be adopted or claim shared home data', async () => {
  const f = await fixture()
  await f.run(`
    await put(path.join(root, '.config.json'), bytes)
    await put(path.join(home, '.claude/.config.json'), 'unowned shared config')
    await put(path.join(home, '.claude.json'), 'unowned home config')
    await assert.rejects(prepareHeadlessStorage({ hooks, validateRestrictedStartup: async () => {} }), /ownership/)
    assert.equal(await fs.exists(path.join(root, 'app.json')), false)
    assert.equal(await fs.readFile(path.join(root, '.config.json'), 'utf8'), bytes)
    await mark(root)
    await fs.unlink(path.join(root, '.config.json'))
    await fs.symlink(path.join(home, '.claude.json'), path.join(root, '.config.json'))
    await assert.rejects(initializeDesktopStorage(discover(), hooks, async () => {}), /regular file/)
    assert.equal(await fs.readFile(path.join(home, '.claude.json'), 'utf8'), 'unowned home config')
    assert.equal(await fs.readFile(path.join(home, '.claude/.config.json'), 'utf8'), 'unowned shared config')
  `)
})

test('malformed legacy config blocks before canonical publication without normalizing its bytes', async () => {
  const f = await fixture()
  await f.run(`
    await mark(root)
    await put(path.join(root, '.config.json'), '{broken legacy bytes')
    await assert.rejects(initializeDesktopStorage(discover(), hooks, async () => {}))
    assert.equal(await fs.exists(path.join(root, '.claude.json')), false)
    assert.equal(await fs.readFile(path.join(root, '.config.json'), 'utf8'), '{broken legacy bytes')
  `)
})

test('cold recovery rediscovers a newly appeared selected-root config before admitting a writer', async () => {
  const f = await fixture()
  await f.run(`
    await mark(profile)
    await put(path.join(profile, 'opaque.bin'), 'accepted profile')
    const result = await executeStorageMigration({ binding, sources: [{ directory: profile, markerRoot: profile }], hooks })
    assert.equal(result.state, 'validation-required')
    await fs.writeFile(path.join(profile, 'opaque.bin'), 'late bytes')
    assert.equal((await completeStorageMigration(binding, result.id, hooks)).state, 'cleanup-pending')
    await fs.writeFile(path.join(profile, 'opaque.bin'), 'accepted profile')
  `)
  await f.run(`
    let injected = false
    const initial = discover()
    assert.equal(initial.sources.some(source => source.layout === 'root-config'), false)
    const recovering = { ...hooks, assertQuiescent: async roots => {
      await hooks.assertQuiescent(roots)
      if (!injected) { injected = true; await put(path.join(root, '.config.json'), bytes) }
    } }
    const lease = await initializeDesktopStorage(initial, recovering, async () => {})
    await lease.release()
    assert.equal(await fs.readFile(path.join(root, '.claude.json'), 'utf8'), bytes)
    assert.equal(await fs.exists(profile), false)
    assert.equal((await journals()).length, 2)
  `)
})

test('config adoption recovery rejects a replaced selected root', async () => {
  const f = await fixture()
  await f.run(`
    await mark(root)
    await put(path.join(root, '.config.json'), bytes)
    const result = await executeStorageMigration({ binding, sources: await discoverHeadlessStorageSources(binding), hooks })
    assert.equal(result.state, 'validation-required')
    await fs.rename(root, root + '-original')
    await fs.cp(root + '-original', root, { recursive: true })
    const recovered = await recoverStorageMigration(binding, hooks)
    assert.equal(recovered.state, 'blocked')
    assert.match(recovered.issues.join('; '), /directory was replaced/)
    await assert.rejects(acquireStorageWriter(binding), /directory was replaced/)
    assert.equal(await fs.readFile(path.join(root, '.config.json'), 'utf8'), bytes)
    assert.equal(await fs.readFile(path.join(root + '-original', '.config.json'), 'utf8'), bytes)
  `)
})

test('root-config receipts cannot widen the source, selector or recorded destination', async () => {
  const f = await fixture()
  await f.run(`
    await mark(root)
    await put(path.join(root, '.config.json'), bytes)
    const lease = await initializeDesktopStorage(discover(), hooks, async () => {})
    await lease.release()
    const [journal] = await journals()
    const file = path.join(journal.directory, 'journal.json')
    const original = await fs.readFile(file, 'utf8')
    const value = JSON.parse(original)
    const edits = [
      { ...value, sources: [{ ...value.sources[0], directory: home }] },
      { ...value, sources: [{ ...value.sources[0], markerRoot: home }] },
      { ...value, sources: [{ ...value.sources[0], destination: 'arbitrary' }] },
      { ...value, sources: [{ ...value.sources[0], layout: undefined }] },
      { ...value, entries: [{ ...value.entries[0], relative: 'settings.json' }] },
      { ...value, entries: [{ ...value.entries[0], destination: '.config.json' }] },
      { ...value, entries: [] },
      { ...value, globalConfigDestination: '../escape.json' },
      { ...value, globalConfigDestination: undefined },
    ]
    for (const edit of edits) {
      await fs.writeFile(file, JSON.stringify(edit))
      assert.equal((await recoverStorageMigration(binding, hooks)).state, 'blocked')
      await assert.rejects(acquireStorageWriter(binding))
    }
    await fs.writeFile(file, original)
    assert.equal((await recoverStorageMigration(binding, hooks)).state, 'ready')
  `)
})
