import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const repository = resolve(import.meta.dir, '../..')

for (const startup of ['headless', 'desktop']) {
  test(`${startup} does not turn external overrides into owned sources while migrating a proven profile`, async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'storage-external-startup-')))
    try {
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', String.raw`
        import assert from 'node:assert/strict'
        import fs from 'node:fs/promises'
        import path from 'node:path'
        import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
        import { PRODUCT_IDENTITY } from './src/utils/productIdentity.generated.ts'
        import { discoverHeadlessStorageSources, prepareHeadlessStorage } from './src/services/storageStartup.ts'
        import { discoverDesktopStorage, initializeDesktopStorage } from './desktop/electron/services/desktopStorageStartup.ts'
        globalThis.fetch = async () => { throw new Error('Unexpected network request') }
        const home = process.env.HOME
        const root = process.env.CLAUDE_CONFIG_DIR
        const binding = resolveStorageBinding()
        const profileParent = process.platform === 'win32' ? process.env.APPDATA
          : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME
        const profile = path.join(profileParent, PRODUCT_IDENTITY.legacyDesktopPackageName)
        const external = path.join(home, 'mixed-external')
        const bytes = '{ "fixture":true, "future":{"keep":[1,2]} }\n'
        const preserved = new Map()
        const put = async (file, raw) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, raw) }
        const retain = async (relative, raw = bytes) => {
          const file = path.join(external, relative)
          await put(file, raw)
          preserved.set(file, raw)
          return file
        }
        process.env.CC_HAHA_TRACE_DIR = path.dirname(await retain('trace/capture.jsonl'))
        process.env.OPENAI_CODEX_OAUTH_FILE = await retain('oauth/token.json', '{"accessToken":"fixture-only","future":7}')
        await retain('oauth/foreign-account.json')
        process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = path.dirname(await retain('plugins/installed_plugins.json'))
        process.env.CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE = '1'
        await retain('plugins/plugins/fixture/1.0.zip')
        process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = path.dirname(await retain('cowork/MEMORY.md'))
        process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR = path.join(external, 'remote')
        await retain('remote/projects/project-a/memory/MEMORY.md')
        await retain('remote/projects/foreign-project/memory/MEMORY.md')
        const setting = path.dirname(await retain('setting/MEMORY.md'))
        process.env.WHATSAPP_AUTH_DIR = path.dirname(await retain('whatsapp/creds.json'))
        await retain('whatsapp/session-peer.json')
        await retain('whatsapp/keys/app-state.json')
        await retain('unrelated.json')
        await put(path.join(profile, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
        const settings = JSON.stringify({ autoMemoryDirectory: setting, future: { keep: true } }) + '\n'
        await put(path.join(profile, 'settings.json'), settings)
        const transcript = JSON.stringify({ type: 'user', content: external, unknown: true }) + '\n'
        await put(path.join(profile, 'projects/fixture/session.jsonl'), transcript)
        const shared = path.join(home, '.claude')
        for (const relative of [
          'settings.json',
          'adapters.json',
          'adapter-sessions.json',
          'im-downloads/telegram/fixture-session/file.txt',
          'whatsapp-auth/default/creds.json',
          'whatsapp-auth/default/session-fixture.json',
        ]) {
          const file = path.join(shared, relative)
          await put(file, bytes)
          preserved.set(file, bytes)
        }
        const sharedGlobal = path.join(home, '.claude.json')
        await put(sharedGlobal, bytes)
        preserved.set(sharedGlobal, bytes)
        const app = {
          getPath: name => name === 'home' ? home : name === 'exe' ? path.join(home, 'install/echoflow') : root,
          commandLine: { hasSwitch: () => false, getSwitchValue: () => '' },
        }
        const desktop = discoverDesktopStorage(app, process.env, process.platform, home)
        const sources = ${JSON.stringify(startup)} === 'desktop' ? desktop.sources : await discoverHeadlessStorageSources(binding)
        assert.deepEqual(sources.map(source => source.directory), [profile])
        const hooks = { platform: 'linux', assertQuiescent: async roots => assert(roots.every(value => value.startsWith(home + path.sep))) }
        const lease = ${JSON.stringify(startup)} === 'desktop'
          ? await initializeDesktopStorage(desktop, hooks, async () => {})
          : await prepareHeadlessStorage({ hooks, validateRestrictedStartup: async () => {} })
        try {
          assert.equal(await fs.exists(profile), false)
          assert.equal(await fs.readFile(path.join(root, 'settings.json'), 'utf8'), settings)
          assert.equal(await fs.readFile(path.join(root, 'projects/fixture/session.jsonl'), 'utf8'), transcript)
          for (const [file, raw] of preserved) assert.equal(await fs.readFile(file, 'utf8'), raw)
          assert.equal(await fs.exists(path.join(external, 'app.json')), false)
          assert.equal(await fs.exists(path.join(shared, 'app.json')), false)
          const relocations = JSON.parse(await fs.readFile(path.join(binding.internalDir, 'storage-relocations.json'), 'utf8'))
          assert.deepEqual(relocations.previousRoots, [profile])
          assert(relocations.mappings.every(mapping => mapping.from === profile || mapping.from === path.join(profile, 'cc-haha')))
          const migrations = path.join(binding.internalDir, 'migrations')
          const ids = (await fs.readdir(migrations)).filter(name => /^[a-f0-9-]{36}$/.test(name))
          assert.equal(ids.length, 1)
          const journal = JSON.parse(await fs.readFile(path.join(migrations, ids[0], 'journal.json'), 'utf8'))
          assert.deepEqual(journal.sources.map(source => source.directory), [profile])
          assert.equal(journal.state, 'ready')
        } finally { await lease.release() }
      `], {
        cwd: repository,
        env: createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: join(home, 'selected') }),
        stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: '', stdout: '' })
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
