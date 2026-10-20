#!/usr/bin/env bun

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type ReleaseAuditInput = {
  version: string
  releaseNote: string
  releaseNoteFiles: string[]
  unresolvedFiles: string[]
  /** Public-identity surfaces to scan for upstream branding. */
  brandFiles?: { path: string; content: string }[]
  /**
   * Every release note with its content, so the audit can tell the fork's notes
   * from upstream's. Paths alone cannot: the two use identical filenames.
   */
  releaseNotes?: { path: string; content: string }[]
}

/**
 * The public surfaces `AGENTS.md` requires auditing after every merge.
 *
 * A fixed list rather than a repository-wide scan: these are the files that
 * actually conflict during a sync (README, both package manifests) plus the one
 * that documents the rule, and a whitelist keeps false positives — the rule text
 * itself names the upstream project — from making the gate permanently red.
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
  'NanmiCoder/cc-haha',
  'cc-haha/compare',
  '阿江',
]

/**
 * `AGENTS.md` states the identity policy by naming what must not appear, so the
 * file always contains the markers. Exempting that one line keeps the scan
 * honest everywhere else instead of disabling it for the file.
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
      errors.push(`upstream identity remains in ${file.path}: ${marker}`)
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
  if (!new RegExp(`^# EchoFlow Code v${input.version.replaceAll('.', '\\.')}`, 'm').test(input.releaseNote)) {
    errors.push(`release note title does not match EchoFlow v${input.version}`)
  }

  // Upstream and fork both name their notes `release-notes/vX.Y.Z.md`, so the
  // path cannot say whose note it is — and a version-greater-than check missed
  // the actual failure mode: merging v0.7.4 subsumes v0.7.2 and v0.7.3
  // commit-wise, so their notes sit *below* the fork version and stayed green
  // while the contract says they must be folded into the fork note and deleted.
  // The heading does identify the author, so compare against it instead.
  const foreignNotes = (input.releaseNotes ?? []).filter((note) => {
    if (note.path === expectedNote) return false
    const match = note.path.match(/^release-notes\/v(\d+\.\d+\.\d+)\.md$/)
    if (!match) return false
    return !new RegExp(`^# EchoFlow Code v${match[1].replaceAll('.', '\\.')}`, 'm').test(note.content)
  })
  if (foreignNotes.length > 0) {
    errors.push(
      `upstream release notes remain unfolded: ${foreignNotes.map(note => note.path).join(', ')}`,
    )
  }

  for (const marker of BRAND_MARKERS) {
    if (input.releaseNote.includes(marker)) errors.push(`upstream identity remains in release note: ${marker}`)
  }

  // The note is one surface; `AGENTS.md` names README, docs, package metadata,
  // diagnostics export, signing/privacy pages, updater links, and desktop
  // About/profile defaults. The files that actually conflict during a sync are the
  // ones worth automating — the rest stay on the manual checklist.
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
  const releaseNoteFiles = readdirSync(releaseDir)
    .filter(file => file.endsWith('.md'))
    .map(file => `release-notes/${file}`)
  const releaseNotes = releaseNoteFiles.map((file) => {
    // A note that vanished between readdir and read is not worth crashing on; the
    // missing-note check above already reports the target when it is the one gone.
    try {
      return { path: file, content: readFileSync(path.join(root, file), 'utf8') }
    } catch {
      return { path: file, content: '' }
    }
  })
  const releaseNotePath = path.join(root, `release-notes/v${packageJson.version}.md`)
  const releaseNote = readFileSync(releaseNotePath, 'utf8')
  const brandFiles = BRAND_FILES.flatMap((file) => {
    const absolute = path.join(root, file)
    return existsSync(absolute) ? [{ path: file, content: readFileSync(absolute, 'utf8') }] : []
  })

  return auditReleaseSurface({
    version: packageJson.version,
    releaseNote,
    releaseNoteFiles,
    releaseNotes,
    unresolvedFiles: gitUnresolvedFiles(root),
    brandFiles,
  })
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, '..', '..')
  const errors = runReleaseAudit(root)
  if (errors.length > 0) {
    console.error(['Upstream release audit failed:', ...errors.map(error => `- ${error}`)].join('\n'))
    process.exit(1)
  }
  console.log('Upstream release audit passed.')
}
