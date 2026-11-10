import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import { BRAND_FILES, auditReleaseSurface, runReleaseAudit } from './release-surface-audit'

const valid = {
  version: '0.5.6',
  releaseNote: '# EchoFlow Code v0.5.6\n\nRelease content.',
  releaseNoteFiles: ['release-notes/v0.5.6.md'],
  unresolvedFiles: [],
}

describe('release surface audit', () => {
  test('accepts an EchoFlow release note with no unresolved conflicts', () => {
    expect(auditReleaseSurface(valid)).toEqual([])
  })

  test('does not infer release-note ownership from historical titles', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-surface-audit-'))
    const releaseDir = join(root, 'release-notes')
    mkdirSync(releaseDir)
    mkdirSync(join(root, 'desktop'))
    writeFileSync(join(root, 'desktop/package.json'), JSON.stringify({ version: '0.5.6' }))
    writeFileSync(join(releaseDir, 'v0.5.5.md'), '# Claude Code Haha v0.5.5\n')
    writeFileSync(join(releaseDir, 'v0.5.6.md'), '# EchoFlow Code v0.5.6\n')

    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root })
      expect(runReleaseAudit(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects a legacy product name in the current release note', () => {
    expect(auditReleaseSurface({
      ...valid,
      releaseNote: '# EchoFlow Code v0.5.6\nClaude Code Haha',
    })).toContain('legacy product name remains in release note: Claude Code Haha')
  })

  test('rejects legacy artifact branding in the current release note', () => {
    expect(auditReleaseSurface({
      ...valid,
      releaseNote: '# EchoFlow Code v0.5.6\nClaude-Code-Haha-0.5.6',
    })).toEqual(['legacy product name remains in release note: Claude-Code-Haha-'])
  })
})

describe('release note validation', () => {
  test('accepts prior release note paths without reading their contents', () => {
    expect(auditReleaseSurface({
      version: '0.7.4',
      releaseNote: '# EchoFlow Code v0.7.4\n',
      releaseNoteFiles: ['release-notes/v0.5.6.md', 'release-notes/v0.7.1.md', 'release-notes/v0.7.4.md'],
      unresolvedFiles: [],
    })).toEqual([])
  })

  test.each(['0.5.60', '0.5.6-rc.1', '0.5.6+build'])('rejects a different version sharing the target version prefix: %s', version => {
    expect(auditReleaseSurface({
      ...valid,
      releaseNote: `# EchoFlow Code v${version}\n`,
    })).toEqual(['release note title does not match EchoFlow v0.5.6'])
  })

  test('accepts an exact title with CRLF or no trailing newline', () => {
    for (const ending of ['\r\n', '']) {
      expect(auditReleaseSurface({ ...valid, releaseNote: `# EchoFlow Code v0.5.6${ending}` })).toEqual([])
    }
  })

  test('returns an actionable error when the release notes directory or target note is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-surface-missing-'))
    mkdirSync(join(root, 'desktop'))
    writeFileSync(join(root, 'desktop/package.json'), JSON.stringify({ version: '0.5.6' }))
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root })
      for (const withDirectory of [false, true]) {
        if (withDirectory) mkdirSync(join(root, 'release-notes'))
        expect(runReleaseAudit(root)).toEqual([
          'missing release note: release-notes/v0.5.6.md',
          'release note title does not match EchoFlow v0.5.6',
        ])
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('validates the target note title once', () => {
    // The target note is validated by its own title check.
    expect(auditReleaseSurface({
      version: '0.7.4',
      releaseNote: '# Wrong title\n',
      releaseNoteFiles: ['release-notes/v0.7.4.md'],
      unresolvedFiles: [],
    })).toEqual(['release note title does not match EchoFlow v0.7.4'])
  })

})

describe('public product identity audit', () => {
  // Keep legacy product names off public product surfaces without encoding any
  // former repository or ownership relationship.
  const clean = [
    { path: 'README.md', content: '# EchoFlow Code\n' },
    { path: 'package.json', content: '{ "name": "echoflow-code" }\n' },
    { path: 'desktop/package.json', content: '{ "name": "echoflow-code" }\n' },
    { path: 'AGENTS.md', content: 'Rules.\n' },
  ]

  test('accepts clean public-identity surfaces', () => {
    expect(auditReleaseSurface({ ...valid, brandFiles: clean })).toEqual([])
  })

  test('rejects a legacy product name in README', () => {
    expect(auditReleaseSurface({
      ...valid,
      brandFiles: [{ path: 'README.md', content: 'Claude Code Haha\n' }],
    })).toContain('legacy product name remains in README.md: Claude Code Haha')
  })

  test('rejects legacy product names in package metadata', () => {
    expect(auditReleaseSurface({
      ...valid,
      brandFiles: [
        { path: 'package.json', content: '{ "name": "Claude Code Haha" }' },
        { path: 'desktop/package.json', content: '{ "name": "Claude-Code-Haha-app" }' },
      ],
    })).toEqual([
      'legacy product name remains in package.json: Claude Code Haha',
      'legacy product name remains in desktop/package.json: Claude-Code-Haha-',
    ])
  })

  test('does not flag AGENTS.md for stating the rule it enforces', () => {
    // The rule text has to name the legacy product name it forbids.
    const ruleLine = '- Audit public identity after every merge: README, docs, '
      + 'release notes and package metadata must not use Claude Code Haha '
      + 'as the current product name.'

    expect(auditReleaseSurface({
      ...valid,
      brandFiles: [{ path: 'AGENTS.md', content: ruleLine }],
    })).toEqual([])
  })

  test('still flags a real violation elsewhere in AGENTS.md', () => {
    // The exemption is per-line, so it must not disable the scan for the file.
    const contents = [
      '- Audit public identity after every merge: do not use Claude Code Haha.',
      '',
      'Current product: Claude Code Haha',
    ].join('\n')

    expect(auditReleaseSurface({
      ...valid,
      brandFiles: [{ path: 'AGENTS.md', content: contents }],
    })).toEqual(['legacy product name remains in AGENTS.md: Claude Code Haha'])
  })

  test('reports each marker once per file', () => {
    // A file can repeat a marker; one error per marker keeps the report readable.
    const errors = auditReleaseSurface({
      ...valid,
      brandFiles: [{ path: 'README.md', content: 'a Claude Code Haha\nb Claude Code Haha\n' }],
    })

    expect(errors).toEqual(['legacy product name remains in README.md: Claude Code Haha'])
  })

  test('scans nothing when no brand files are supplied', () => {
    // `brandFiles` is optional so the pure function stays callable without a repo.
    expect(auditReleaseSurface(valid)).toEqual([])
  })

  test('covers the public identity files selected for the audit', () => {
    expect(BRAND_FILES).toEqual([
      'README.md',
      'package.json',
      'desktop/package.json',
      'AGENTS.md',
    ])
  })
})
