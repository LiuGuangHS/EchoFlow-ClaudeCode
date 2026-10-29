import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReport, parseArgs, REQUIRED_CHECK_IDS } from './harness-audit.js'

const auditScript = fileURLToPath(new URL('./harness-audit.js', import.meta.url))

function runAudit(rootDir: string, ...args: string[]) {
  return spawnSync(process.execPath, [auditScript, '--format=json', '--root', rootDir, ...args], {
    encoding: 'utf8',
  })
}

function fixture(options: { provider?: string; consumer?: boolean } = {}): string {
  const rootDir = mkdtempSync(join(tmpdir(), 'harness-audit-'))
  if (!options.provider && !options.consumer) {
    mkdirSync(join(rootDir, '.claude-plugin'), { recursive: true })
    mkdirSync(join(rootDir, 'agents'), { recursive: true })
    mkdirSync(join(rootDir, 'skills'), { recursive: true })
    mkdirSync(join(rootDir, 'scripts'), { recursive: true })
    writeFileSync(join(rootDir, '.claude-plugin', 'plugin.json'), '{"name":"ecc"}\n')
    writeFileSync(join(rootDir, 'scripts', 'harness-audit.js'), '#!/usr/bin/env node\n')
  }
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: options.provider || options.consumer ? 'fixture-consumer' : 'everything-claude-code' }))
  if (options.provider) writeFileSync(join(rootDir, options.provider), '{}\n')
  return rootDir
}

describe('repository harness audit', () => {
  test('uses the report contract and ignores private project state', () => {
    const rootDir = fixture()
    try {
      mkdirSync(join(rootDir, '.claude'), { recursive: true })
      writeFileSync(join(rootDir, '.claude', 'private.txt'), 'PRIVATE_HARNESS_STATE')

      const report = buildReport('repo', { rootDir })

      expect(report.target_mode).toBe('repo')
      expect(report.rubric_version).toBe('2026-05-19')
      expect(report.deterministic).toBe(true)
      expect(report.category_count).toBe(report.applicable_categories.length)
      expect(JSON.stringify(report)).not.toContain('PRIVATE_HARNESS_STATE')
      expect(report.checks.every((check) => typeof check.id === 'string')).toBe(true)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test('supports all scopes and filters checks by scope', () => {
    const rootDir = fixture()
    try {
      const full = buildReport('repo', { rootDir })
      const scoped = buildReport('skills', { rootDir })

      expect(scoped.scope).toBe('skills')
      expect(scoped.max_score).toBeLessThan(full.max_score)
      expect(scoped.checks.some((check) => check.id === 'tool-skill-count')).toBe(true)
      expect(scoped.checks.some((check) => check.id === 'eval-commands')).toBe(true)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test('activates deployment categories only for matching markers', () => {
    const plainRoot = fixture({ consumer: true })
    const vercelRoot = fixture({ provider: 'vercel.json' })
    try {
      const plain = buildReport('repo', { rootDir: plainRoot })
      const vercel = buildReport('repo', { rootDir: vercelRoot })

      expect(plain.applicable_categories).not.toContain('Vercel Integration')
      expect(vercel.applicable_categories).toContain('Vercel Integration')
      expect(vercel.max_score).toBeGreaterThan(plain.max_score)
    } finally {
      rmSync(plainRoot, { recursive: true, force: true })
      rmSync(vercelRoot, { recursive: true, force: true })
    }
  })

  test('parses command arguments and normalizes paths', () => {
    expect(parseArgs(['node', 'scripts/harness-audit.js', '--scope=agents', '--format=json', '--root=fixture'])).toMatchObject({
      scope: 'agents',
      format: 'json',
      help: false,
      root: resolve('fixture'),
    })
    expect(parseArgs(['node', 'scripts/harness-audit.js', '--fail-on=consumer-ci-workflow', '--fail-on', 'brand-residue-scan'])).toMatchObject({
      failOn: ['consumer-ci-workflow', 'brand-residue-scan'],
    })
    expect(parseArgs(['node', 'scripts/harness-audit.js', '--fail-on-required']).failOnRequired).toBe(true)
    expect(parseArgs(['node', 'scripts/harness-audit.js', '--help']).help).toBe(true)
    expect(() => parseArgs(['node', 'scripts/harness-audit.js', '--format', 'yaml'])).toThrow('Invalid format')
    expect(() => parseArgs(['node', 'scripts/harness-audit.js', 'unknown'])).toThrow('Invalid scope')
  })

  test('exits nonzero when a named required check fails', () => {
    const rootDir = fixture({ consumer: true })
    try {
      const failing = runAudit(rootDir, '--fail-on=consumer-instructions')

      expect(failing.status).toBe(1)
      const report = JSON.parse(failing.stdout)
      expect(report.checks.find((check: { id: string }) => check.id === 'consumer-instructions')?.pass).toBe(false)
      expect(failing.stderr).toContain('consumer-instructions')

      writeFileSync(join(rootDir, 'AGENTS.md'), '# Fixture instructions\n')
      const passing = runAudit(rootDir, '--fail-on=consumer-instructions')

      expect(passing.status).toBe(0)
      expect(JSON.parse(passing.stdout).checks.find((check: { id: string }) => check.id === 'consumer-instructions')?.pass).toBe(true)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test('rejects a required check id that the scope does not evaluate', () => {
    const rootDir = fixture({ consumer: true })
    try {
      const result = runAudit(rootDir, '--fail-on=not-a-check')

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Unknown fail-on check: not-a-check')
      expect(() => JSON.parse(result.stdout)).toThrow()
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test('keeps every required check id in the evaluated report', () => {
    const report = buildReport('repo', { rootDir: process.cwd() })
    const evaluated = new Set(report.checks.map((check) => check.id))

    for (const checkId of REQUIRED_CHECK_IDS) {
      expect(evaluated.has(checkId), checkId).toBe(true)
    }
  })

  test('enforces the required check policy through the CLI', () => {
    const rootDir = fixture({ consumer: true })
    try {
      const result = runAudit(rootDir, '--fail-on-required')

      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).target_mode).toBe('consumer')
      expect(result.stderr).toContain('Required checks failed:')
      expect(result.stderr).toContain('consumer-ci-workflow')
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
