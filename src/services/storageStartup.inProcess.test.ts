import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'
import * as config from '../utils/echoFlowConfigRoot.js'
import { readStorageMigrationStatus } from './storageMigration.js'
import { discoverHeadlessStorageSources, prepareHeadlessStorage } from './storageStartup.js'

describe.skipIf(process.platform !== 'linux')('in-process headless storage startup', () => {
  let home: string
  let root: string
  let writers: string
  let saved: NodeJS.ProcessEnv
  let homeSpy: { mockRestore(): void }

  beforeEach(async () => {
    saved = { ...process.env }
    home = await realpath(await mkdtemp(join(os.tmpdir(), 'headless-startup-')))
    // Bun caches os.homedir() at launch, independently of later HOME changes.
    homeSpy = spyOn(os, 'homedir').mockReturnValue(home)
    root = join(home, 'selected')
    writers = join(root, 'echoflow-code', 'migrations', 'writers')
    const env = createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: root })
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, env)
  })

  afterEach(async () => {
    homeSpy.mockRestore()
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, saved)
    await rm(home, { recursive: true, force: true })
  })

  test.serial('retains both XDG profile candidates and refuses unproven ownership before creating a writer', async () => {
    const profiles = ['echoflow-code', 'claude-code-desktop'].map(name => join(process.env.XDG_CONFIG_HOME!, name))
    for (const directory of profiles) {
      await mkdir(directory)
      await writeFile(join(directory, 'opaque.bin'), directory)
    }
    const sources = await discoverHeadlessStorageSources(config.resolveStorageBinding())
    expect(sources).toEqual(profiles.map(directory => ({ directory, markerRoot: directory })))
    await expect(prepareHeadlessStorage()).rejects.toThrow('Unproven or future storage ownership')
    expect(existsSync(writers)).toBe(false)
    for (const directory of profiles) expect(await readFile(join(directory, 'opaque.bin'), 'utf8')).toBe(directory)
  })

  test.serial('recovers failed validation before granting a writer, and preserves shared settings on cleanup', async () => {
    const shared = join(home, '.claude')
    const legacy = join(shared, 'cc-haha')
    await mkdir(legacy, { recursive: true })
    await writeFile(join(shared, 'app.json'), JSON.stringify(config.buildEchoFlowOwnershipMarker()))
    await writeFile(join(legacy, 'opaque.bin'), 'legacy bytes')
    await writeFile(join(shared, 'settings.json'), '{"foreign":true}\n')
    const hooks = { assertQuiescent: async () => {} }
    await expect(prepareHeadlessStorage({ hooks, validateRestrictedStartup: async () => { throw new Error('fixture validation refused') } }))
      .rejects.toThrow('fixture validation refused')
    expect(await readFile(join(legacy, 'opaque.bin'), 'utf8')).toBe('legacy bytes')
    expect(existsSync(writers) ? await readdir(writers) : []).toEqual([])

    const binding = config.resolveStorageBinding()
    const pending = await readStorageMigrationStatus(binding)
    expect(pending?.state).toBe('validation-required')

    // Exercise the real binding without permanently pinning other suites to this fixture.
    const isolated: typeof config = await import(`../utils/echoFlowConfigRoot.js?startup=${encodeURIComponent(home)}`)
    const binder = spyOn(config, 'bindStorageRoot').mockImplementation(isolated.bindStorageRoot)
    try {
      let validated = false
      const lease = await prepareHeadlessStorage({ hooks, validateRestrictedStartup: async binding => {
        expect(await readFile(join(binding.internalDir, 'opaque.bin'), 'utf8')).toBe('legacy bytes')
        expect(existsSync(writers) ? await readdir(writers) : []).toEqual([])
        validated = true
      } })
      try {
        expect(validated).toBe(true)
        expect(await readStorageMigrationStatus(binding)).toMatchObject({ id: pending!.id, state: 'ready' })
        const entries = await readdir(join(binding.internalDir, 'migrations'))
        expect(entries.filter(name => /^[a-f0-9-]{36}$/.test(name))).toEqual([pending!.id])
        expect(isolated.getEchoFlowConfigDir()).toBe(root)
        expect(await readdir(writers)).toHaveLength(1)
        expect((await readdir(shared)).sort()).toEqual(['app.json', 'settings.json'])
        expect(await readFile(join(shared, 'settings.json'), 'utf8')).toBe('{"foreign":true}\n')
      } finally { await lease.release() }
      expect(await readdir(writers)).toEqual([])

      // A subsequent admission can create a receipt but cannot switch the bound root.
      const other = join(home, 'other')
      process.env.CLAUDE_CONFIG_DIR = other
      await expect(prepareHeadlessStorage()).rejects.toThrow('already bound')
      expect(await readdir(join(other, 'echoflow-code', 'migrations', 'writers'))).toEqual([])
    } finally { binder.mockRestore() }
  })
})
