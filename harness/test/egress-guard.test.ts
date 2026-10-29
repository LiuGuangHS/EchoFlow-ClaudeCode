import { afterEach, describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EgressViolationError,
  assertNoEgress,
  snapshotLoaderTree,
  verifyEffectiveConfig,
} from '../bundles/egress-guard/src/verify.js'
import { composeEffectiveProfile, readEgressBlocklist } from '../src/profileConfig.js'

const TEST_TIMEOUT = 60_000
const harnessRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const launcher = join(harnessRoot, 'src', 'dshProcess.js')
const reloadFixture = join(harnessRoot, 'test', 'fixtures', 'reload-violation.mjs')
const unguardedProfile = join(harnessRoot, 'test', 'fixtures', 'unguarded-profile')
const missingRowsProfile = join(harnessRoot, 'test', 'fixtures', 'missing-rows-profile')

const blocklist = readEgressBlocklist()
let sandboxes: string[] = []

afterEach(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true })
  sandboxes = []
})

type EffectiveEntry = { id: string, config?: unknown, disabled?: unknown }

/** A tree that satisfies every rule, so a test can break exactly one thing. */
function compliantEntries(): EffectiveEntry[] {
  return [
    ...blocklist.plugins.map(plugin => ({ id: plugin.id, disabled: true })),
    ...blocklist.requiredPlugins.map(id => ({ id, disabled: false })),
  ]
}

function violationsFor(entries: EffectiveEntry[]): string[] {
  return verifyEffectiveConfig(entries, blocklist)
}

/**
 * A sandbox with its own HOME and DSH_HOME. The home patch only defines a
 * provider that is never called; it keeps the model row resolvable so the
 * test measures the guard, not provider wiring.
 */
function makeSandbox(): { home: string, dshHome: string, agentsHome: string, workspace: string, env: NodeJS.ProcessEnv } {
  const sandbox = mkdtempSync(join(tmpdir(), 'echoflow-guard-'))
  sandboxes.push(sandbox)
  const home = join(sandbox, 'home')
  const dshHome = join(sandbox, 'dsh-home')
  const agentsHome = join(sandbox, 'agents-home')
  const workspace = join(sandbox, 'workspace')
  for (const dir of [home, dshHome, agentsHome, workspace]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dshHome, 'cordis.patch.yml'), [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      echoflow:',
    '        api: openai-completions',
    '        baseURL: http://127.0.0.1:9/v1',
    '        apiKeyEnv: ECHOFLOW_API_KEY',
    '        models:',
    '          - id: echoflow-mock',
    '            contextWindow: 128000',
    '- id: agent-default-model',
    '  config:',
    '    provider: echoflow',
    '    model: echoflow-mock',
    '- id: acp',
    '  config:',
    '    provider: echoflow',
    '    model: echoflow-mock',
    '',
  ].join('\n'))
  return {
    home,
    dshHome,
    agentsHome,
    workspace,
    env: {
      HOME: home,
      DSH_HOME: dshHome,
      DSH_AGENTS_HOME: agentsHome,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_CACHE_HOME: join(home, '.cache'),
      PATH: process.env.PATH ?? '',
      LANG: process.env.LANG ?? 'C.UTF-8',
      ECHOFLOW_API_KEY: 'echoflow-test-key',
    },
  }
}

type RunResult = { code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }

function runChild(
  args: string[],
  env: NodeJS.ProcessEnv,
  { closeStdin = false }: { closeStdin?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.on('error', () => {})
    child.once('error', reject)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`child did not settle in time\nstderr:\n${stderr}`))
    }, TEST_TIMEOUT - 5_000)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
    if (closeStdin) child.stdin.end()
  })
}

describe('verifyEffectiveConfig rejects every unguarded shape', () => {
  test('reports an enabled blocklisted plugin', () => {
    const entries = compliantEntries().map(entry =>
      entry.id === 'session-log-deepseek' ? { ...entry, disabled: false } : entry)
    const violations = violationsFor(entries)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.join('\n')).toContain('session-log-deepseek')
  })

  test('passes a tree that disables every blocklisted plugin and keeps the guard running', () => {
    expect(violationsFor(compliantEntries())).toEqual([])
  })

  test('reports a blocklisted plugin missing from the tree', () => {
    const entries = compliantEntries().filter(entry => entry.id !== 'otel')
    const violations = violationsFor(entries)
    expect(violations.join('\n')).toContain('otel')
  })

  test('treats an unevaluated disabled expression as not proven disabled', () => {
    const entries = compliantEntries().map(entry =>
      entry.id === 'llm-deepseek' ? { ...entry, disabled: { expression: true } } : entry)
    expect(violationsFor(entries).join('\n')).toContain('llm-deepseek')
  })

  test('reports a blocked host reachable from an enabled config', () => {
    const entries = [...compliantEntries(), {
      id: 'some-plugin',
      config: { endpoint: 'https://api.deepseek.com/v1/chat' },
    }]
    expect(violationsFor(entries).join('\n')).toContain('api.deepseek.com')
  })

  test('ignores a blocked host that only survives in a disabled row', () => {
    const entries = compliantEntries().map(entry =>
      entry.id === 'session-telemetry-otel'
        ? { ...entry, config: { endpoint: 'https://dsh-otel-collector.deepseeksvc.com' } }
        : entry)
    expect(violationsFor(entries)).toEqual([])
  })

  test('reports a blocked route named by an enabled config', () => {
    const entries = [...compliantEntries(), {
      id: 'web',
      config: { searchProvider: 'deepseek-official' },
    }]
    expect(violationsFor(entries).join('\n')).toContain('deepseek-official')
  })

  test('reports a required plugin that was disabled', () => {
    const entries = compliantEntries().map(entry =>
      entry.id === 'egress-guard' ? { ...entry, disabled: true } : entry)
    expect(violationsFor(entries).join('\n')).toContain('egress-guard')
  })

  test('the assertion path throws the typed violation', () => {
    const entries = compliantEntries().filter(entry => entry.id !== 'otel')
    expect(() => assertNoEgress(entries, blocklist)).toThrow(EgressViolationError)
  })

  test('reads the Loader effective state, not the raw options', () => {
    const fake = {
      loader: {
        entries: () => [{
          id: 'session-log-deepseek',
          options: { id: 'session-log-deepseek', disabled: false },
          // A disabled parent group produces this gap: the raw option says
          // enabled, the effective state says disabled.
          get disabled() { return true },
        }],
      },
    }
    const snapshot = snapshotLoaderTree(fake as never)
    expect(snapshot).toEqual([{ id: 'session-log-deepseek', config: undefined, disabled: true }])
  })

  test('the guard bundle is part of the shipped profile and stays enabled', () => {
    const { entries } = composeEffectiveProfile()
    const guard = entries.find(entry => entry.id === 'egress-guard')
    expect(guard, 'egress-guard must be in the composition').toBeDefined()
    expect(guard?.disabled).not.toBe(true)
  })

  test('the real profile passes the rule the launcher enforces', () => {
    const { entries } = composeEffectiveProfile()
    expect(verifyEffectiveConfig(entries, blocklist)).toEqual([])
  })
})

describe('the guard runs at the boot seam', () => {
  // The launcher always applies the hard-disable layer last, so a profile
  // cannot boot with a blocklisted *plugin row* enabled — Task 3 proves that.
  // What the boot gate still has to catch is everything that layer does not
  // cover: a route or host named by an active config, and a row that vanished
  // upstream. The reload gate covers the re-enabled-row case.
  test('refuses to start a profile whose active config selects a blocked route', async () => {
    const sandbox = makeSandbox()
    const result = await runChild([launcher], {
      ...sandbox.env,
      ECHOFLOW_DSH_PROFILE_DIR: unguardedProfile,
    })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('egress-guard')
    expect(result.stderr).toContain('deepseek-official')
  }, TEST_TIMEOUT)

  test('refuses to start a profile whose blocklisted rows disappeared', async () => {
    const sandbox = makeSandbox()
    const result = await runChild([launcher], {
      ...sandbox.env,
      ECHOFLOW_DSH_PROFILE_DIR: missingRowsProfile,
    })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('egress-guard')
    expect(result.stderr).toContain('session-log-deepseek')
  }, TEST_TIMEOUT)

  test('starts the guarded profile and exits cleanly on stdin EOF', async () => {
    const sandbox = makeSandbox()
    const result = await runChild([launcher], sandbox.env, { closeStdin: true })
    expect(result.stderr).not.toContain('egress-guard:')
    expect(result.code).toBe(0)
  }, TEST_TIMEOUT)

  test('fails closed when a reload re-enables a blocklisted plugin', async () => {
    const sandbox = makeSandbox()
    const result = await runChild([reloadFixture], sandbox.env)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('session-log-deepseek')
  }, TEST_TIMEOUT)
})
