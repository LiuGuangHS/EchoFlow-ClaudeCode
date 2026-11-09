import { expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const harnessDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(harnessDir, 'test/fixtures/native-profile.mjs')

function runIsolated(executable: string, root: string, phase: 'create' | 'resume') {
  const home = join(root, 'home')
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    DSH_HOME: join(root, 'dsh'),
    DSH_AGENTS_HOME: join(root, 'agents'),
    XDG_CONFIG_HOME: join(root, 'xdg', 'config'),
    XDG_DATA_HOME: join(root, 'xdg', 'data'),
    XDG_CACHE_HOME: join(root, 'xdg', 'cache'),
    XDG_STATE_HOME: join(root, 'xdg', 'state'),
    TMPDIR: join(root, 'tmp'),
    TEMP: join(root, 'tmp'),
    TMP: join(root, 'tmp'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    ECHOFLOW_NATIVE_FIXTURE_API_KEY: 'native-profile-offline-fixture',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  }
  return spawnSync(executable, [fixture, root, phase], {
    cwd: join(root, 'workspace'),
    env,
    encoding: 'utf8',
    timeout: 60_000,
    stdio: 'pipe',
  })
}

test('locked native profile resumes after an isolated Node process exit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'echoflow-native-profile-'))
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  for (const name of ['home', 'dsh', 'agents', 'xdg/config', 'xdg/data', 'xdg/cache', 'xdg/state', 'tmp', 'claude']) {
    mkdirSync(join(root, name), { recursive: true })
  }

  try {
    const executable = process.execPath
    expect(executable).toMatch(/node/)
    const first = runIsolated(executable, root, 'create')
    expect(first.status, first.stderr || first.stdout).toBe(0)
    const second = runIsolated(executable, root, 'resume')
    expect(second.status, second.stderr || second.stdout).toBe(0)

    const allowedRoots = ['workspace', 'home', 'dsh', 'agents', 'xdg', 'tmp', 'claude'].map(name => join(root, name))
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      expect(allowedRoots.some(path => join(root, entry.name) === path), `unexpected output: ${entry.name}`).toBe(true)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 180_000)
