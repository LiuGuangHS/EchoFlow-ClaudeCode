#!/usr/bin/env bun

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type ReleaseAuditInput = {
  version: string
  releaseNote: string
  releaseNoteFiles: string[]
  unresolvedFiles: string[]
  /** Public product-identity surfaces to scan for legacy names. */
  brandFiles?: { path: string; content: string }[]
}

/**
 * The public surfaces carrying product identity, plus the agent contract
 * that documents the rule.
 */
export const BRAND_FILES = [
  'README.md',
  'package.json',
  'desktop/package.json',
  'AGENTS.md',
]

export const BRAND_MARKERS = [
  'Claude Code Haha',
  'Claude-Code-Haha-',
]

/**
 * `AGENTS.md` states the identity policy by naming what must not appear, so the
 * file always contains legacy names. Exempt that policy line only.
 */
const AGENTS_RULE_LINE = 'Audit public identity after every merge'

function brandViolations(files: { path: string; content: string }[]): string[] {
  const errors: string[] = []

  for (const file of files) {
    const lines = file.content.split(/\r?\n/)
    const offending = new Set<string>()

    for (const line of lines) {
      if (file.path === 'AGENTS.md' && line.includes(AGENTS_RULE_LINE)) {
        continue
      }

      for (const marker of BRAND_MARKERS) {
        if (line.includes(marker)) offending.add(marker)
      }
    }

    for (const marker of offending) {
      errors.push(`legacy product name remains in ${file.path}: ${marker}`)
    }
  }

  return errors
}

export function auditReleaseSurface(input: ReleaseAuditInput): string[] {
  const errors: string[] = []
  const expectedNote = `release-notes/v${input.version}.md`

  if (input.unresolvedFiles.length > 0) {
    errors.push(`unresolved merge conflicts: ${input.unresolvedFiles.join(', ')}`)
  }
  if (!input.releaseNoteFiles.includes(expectedNote)) {
    errors.push(`missing release note: ${expectedNote}`)
  }
  if (!input.releaseNote.split(/\r?\n/).includes(`# EchoFlow Code v${input.version}`)) {
    errors.push(`release note title does not match EchoFlow v${input.version}`)
  }

  for (const marker of BRAND_MARKERS) {
    if (input.releaseNote.includes(marker)) errors.push(`legacy product name remains in release note: ${marker}`)
  }

  // Keep the release check focused on stable product-identity surfaces.
  errors.push(...brandViolations(input.brandFiles ?? []))

  return errors
}

function gitUnresolvedFiles(root: string): string[] {
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .map(file => file.trim())
    .filter(Boolean)
}

export function runReleaseAudit(root: string): string[] {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'desktop/package.json'), 'utf8')) as { version?: unknown }
  if (typeof packageJson.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
    return ['desktop/package.json has no valid release version']
  }
  const releaseDir = path.join(root, 'release-notes')
  const releaseNoteFiles = (existsSync(releaseDir) ? readdirSync(releaseDir) : [])
    .filter(file => file.endsWith('.md'))
    .map(file => `release-notes/${file}`)
  const releaseNotePath = path.join(root, `release-notes/v${packageJson.version}.md`)
  const releaseNote = existsSync(releaseNotePath) ? readFileSync(releaseNotePath, 'utf8') : ''
  const brandFiles = BRAND_FILES.flatMap((file) => {
    const absolute = path.join(root, file)
    return existsSync(absolute) ? [{ path: file, content: readFileSync(absolute, 'utf8') }] : []
  })

  return auditReleaseSurface({
    version: packageJson.version,
    releaseNote,
    releaseNoteFiles,
    unresolvedFiles: gitUnresolvedFiles(root),
    brandFiles,
  })
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, '..', '..')
  const errors = runReleaseAudit(root)
  if (errors.length > 0) {
    console.error(['Release surface audit failed:', ...errors.map(error => `- ${error}`)].join('\n'))
    process.exit(1)
  }
  console.log('Release surface audit passed.')
}
