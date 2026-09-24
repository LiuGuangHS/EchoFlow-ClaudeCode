#!/usr/bin/env bun

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type ReleaseAuditInput = {
  version: string
  releaseNote: string
  releaseNoteFiles: string[]
  unresolvedFiles: string[]
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

  const currentVersion = input.version.split('.').map(Number)
  const newerNotes = input.releaseNoteFiles.filter(file => {
    const match = file.match(/^release-notes\/v(\d+)\.(\d+)\.(\d+)\.md$/)
    if (!match || file === expectedNote) return false
    const candidate = match.slice(1).map(Number)
    return candidate.some((part, index) => part !== currentVersion[index]
      && candidate.slice(0, index).every((prefix, prefixIndex) => prefix === currentVersion[prefixIndex])
      && part > currentVersion[index])
  })
  if (newerNotes.length > 0) {
    errors.push(`release notes newer than the current EchoFlow version remain: ${newerNotes.join(', ')}`)
  }

  for (const marker of ['Claude Code Haha', 'Claude-Code-Haha-', 'NanmiCoder/cc-haha', 'cc-haha/compare']) {
    if (input.releaseNote.includes(marker)) errors.push(`upstream identity remains in release note: ${marker}`)
  }
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
  const releaseNoteFiles = readdirSync(releaseDir).map(file => `release-notes/${file}`)
  const releaseNotePath = path.join(root, `release-notes/v${packageJson.version}.md`)
  const releaseNote = readFileSync(releaseNotePath, 'utf8')
  return auditReleaseSurface({
    version: packageJson.version,
    releaseNote,
    releaseNoteFiles,
    unresolvedFiles: gitUnresolvedFiles(root),
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
