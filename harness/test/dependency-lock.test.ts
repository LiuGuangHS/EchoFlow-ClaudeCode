import { describe, expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const harnessRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(harnessRoot, relativePath), 'utf8'))
}

describe('harness dependency contract', () => {
  test('pins every dsh dependency to an exact version', () => {
    const manifest = readJson('package.json')
    const dshDependencies = Object.entries(manifest.dependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/'))

    expect(dshDependencies.length).toBeGreaterThan(0)
    for (const [name, version] of dshDependencies) {
      // dsh is a developer preview and its npm `latest` tag points at an older
      // release than the newest one, so a range would silently downgrade.
      expect(version, `${name} must be pinned`).toMatch(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/)
    }
  })

  test('pins the ACP client SDK to an exact version', () => {
    const manifest = readJson('package.json')
    expect(manifest.dependencies?.['@agentclientprotocol/sdk']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('requires the Node version dsh itself requires', () => {
    const manifest = readJson('package.json')
    expect(manifest.engines?.node).toBe('>=24.9.0')
  })

  test('commits a lockfile so CI installs the same tree', () => {
    const lockPath = join(harnessRoot, 'package-lock.json')
    expect(existsSync(lockPath)).toBe(true)
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(2)
  })

  test('keeps Claude Code platform payloads out of the dependency graph', () => {
    const manifest = readJson('package.json')
    const forbidden = [
      '@anthropic-ai/claude-agent-sdk',
      '@anthropic-ai/claude-code',
      '@deepseek-ai/dsh-subagent-claude-code',
      '@deepseek-ai/dsh-subagent-codex',
    ]
    const declared = Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    })
    for (const name of forbidden) {
      expect(declared, `${name} must not be a dependency`).not.toContain(name)
    }
  })
})
