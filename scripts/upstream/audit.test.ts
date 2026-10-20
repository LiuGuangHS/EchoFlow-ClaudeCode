import { describe, expect, test } from 'bun:test'

import { BRAND_FILES, auditReleaseSurface } from './audit'

const valid = {
  version: '0.5.6',
  releaseNote: '# EchoFlow Code v0.5.6\n\nRelease content.',
  releaseNoteFiles: ['release-notes/v0.5.6.md'],
  unresolvedFiles: [],
}

describe('upstream release audit', () => {
  test('accepts a fork release note with no unresolved conflicts', () => {
    expect(auditReleaseSurface(valid)).toEqual([])
  })

  test('rejects unresolved conflicts and upstream release notes', () => {
    expect(auditReleaseSurface({
      ...valid,
      releaseNoteFiles: ['release-notes/v0.5.5.md', 'release-notes/v0.5.6.md', 'release-notes/v0.6.6.md'],
      releaseNotes: [
        { path: 'release-notes/v0.5.5.md', content: '# EchoFlow Code v0.5.5\n' },
        { path: 'release-notes/v0.5.6.md', content: '# EchoFlow Code v0.5.6\n' },
        { path: 'release-notes/v0.6.6.md', content: '# Claude Code Haha v0.6.6\n' },
      ],
      unresolvedFiles: ['desktop/package.json'],
    })).toEqual([
      'unresolved merge conflicts: desktop/package.json',
      'upstream release notes remain unfolded: release-notes/v0.6.6.md',
    ])
  })

  test('rejects upstream branding in the current release note', () => {
    expect(auditReleaseSurface({
      ...valid,
      releaseNote: '# EchoFlow Code v0.5.6\nClaude Code Haha',
    })).toContain('upstream identity remains in release note: Claude Code Haha')
  })

  test('flags every marker, including the Chinese name, in the current note', () => {
    // The inline scan used to carry its own hard-coded marker list and missed the
    // marker that only exists in `BRAND_MARKERS`, so a folded note that named the
    // upstream maintainer passed the gate.
    expect(auditReleaseSurface({
      ...valid,
      releaseNote: '# EchoFlow Code v0.5.6\n维护者：阿江',
    })).toEqual(['upstream identity remains in release note: 阿江'])
  })
})

describe('unfolded upstream release notes', () => {
  const notes = (...entries: [string, string][]) =>
    entries.map(([path, content]) => ({ path, content }))

  test('flags an upstream note that sits below the fork version', () => {
    // v0.7.2 and v0.7.3 are ancestors of v0.7.4, so merging v0.7.4 subsumes them
    // commit-wise while their notes stay on disk. A "newer than current version"
    // check cannot see them: they are older. This is the exact v0.7.4 shape.
    expect(auditReleaseSurface({
      version: '0.7.4',
      releaseNote: '# EchoFlow Code v0.7.4\n\nFolded content.\n',
      releaseNoteFiles: [
        'release-notes/v0.7.2.md',
        'release-notes/v0.7.3.md',
        'release-notes/v0.7.4.md',
      ],
      releaseNotes: notes(
        ['release-notes/v0.7.2.md', '# Claude Code Haha v0.7.2\n'],
        ['release-notes/v0.7.3.md', '# Claude Code Haha v0.7.3\n'],
        ['release-notes/v0.7.4.md', '# EchoFlow Code v0.7.4\n\nFolded content.\n'],
      ),
      unresolvedFiles: [],
    })).toEqual([
      'upstream release notes remain unfolded: release-notes/v0.7.2.md, release-notes/v0.7.3.md',
    ])
  })

  test('accepts a history of fork notes with no upstream notes left', () => {
    expect(auditReleaseSurface({
      version: '0.7.4',
      releaseNote: '# EchoFlow Code v0.7.4\n',
      releaseNoteFiles: ['release-notes/v0.5.6.md', 'release-notes/v0.7.1.md', 'release-notes/v0.7.4.md'],
      releaseNotes: notes(
        ['release-notes/v0.5.6.md', '# EchoFlow Code v0.5.6\n'],
        ['release-notes/v0.7.1.md', '# EchoFlow Code v0.7.1\n'],
        ['release-notes/v0.7.4.md', '# EchoFlow Code v0.7.4\n'],
      ),
      unresolvedFiles: [],
    })).toEqual([])
  })

  test('does not accuse the target note of being an upstream note', () => {
    // The target note is validated by its own title check; double-reporting it
    // under both rules would make one mistake look like two.
    expect(auditReleaseSurface({
      version: '0.7.4',
      releaseNote: '# Wrong title\n',
      releaseNoteFiles: ['release-notes/v0.7.4.md'],
      releaseNotes: notes(['release-notes/v0.7.4.md', '# Wrong title\n']),
      unresolvedFiles: [],
    })).toEqual(['release note title does not match EchoFlow v0.7.4'])
  })

  test('ignores non-release files in the notes directory', () => {
    expect(auditReleaseSurface({
      ...valid,
      releaseNotes: notes(
        ['release-notes/v0.5.6.md', '# EchoFlow Code v0.5.6\n'],
        ['release-notes/README.md', '# Notes\n'],
      ),
    })).toEqual([])
  })

  test('says nothing about notes when no contents are supplied', () => {
    // Paths alone cannot distinguish the two owners, so an uninformed caller gets
    // no verdict rather than a guess.
    expect(auditReleaseSurface({
      ...valid,
      releaseNoteFiles: ['release-notes/v0.5.5.md', 'release-notes/v0.5.6.md'],
    })).toEqual([])
  })
})

describe('brand surface audit', () => {
  // `AGENTS.md` requires auditing README, docs, package metadata, diagnostics
  // export, signing/privacy pages, updater links, and desktop About/profile
  // defaults after every merge. These are the ones that actually conflict during
  // a sync, so they are the ones worth automating.
  const clean = [
    { path: 'README.md', content: '# EchoFlow Code\n' },
    { path: 'package.json', content: '{ "name": "echoflow-code" }\n' },
    { path: 'desktop/package.json', content: '{ "name": "echoflow-code" }\n' },
    { path: 'AGENTS.md', content: 'Rules.\n' },
  ]

  test('accepts clean public-identity surfaces', () => {
    expect(auditReleaseSurface({ ...valid, brandFiles: clean })).toEqual([])
  })

  test('rejects upstream branding in README', () => {
    // README is the highest-traffic public surface and one of the files that
    // conflicts in every sync, so it is the one most likely to regress.
    expect(auditReleaseSurface({
      ...valid,
      brandFiles: [{ path: 'README.md', content: 'Fork of NanmiCoder/cc-haha\n' }],
    })).toContain('upstream identity remains in README.md: NanmiCoder/cc-haha')
  })

  test('rejects upstream branding in package metadata', () => {
    expect(auditReleaseSurface({
      ...valid,
      brandFiles: [
        { path: 'package.json', content: '{ "author": "Claude Code Haha" }' },
        { path: 'desktop/package.json', content: '{ "author": "阿江" }' },
      ],
    })).toEqual([
      'upstream identity remains in package.json: Claude Code Haha',
      'upstream identity remains in desktop/package.json: 阿江',
    ])
  })

  test('does not flag AGENTS.md for stating the rule it enforces', () => {
    // The rule text has to name what must not appear, so the file always contains
    // the markers. Without this exemption the scan would fail on itself.
    const ruleLine = '- Audit public identity after every merge: README, docs, '
      + 'release notes, package metadata must not identify NanmiCoder/阿江 or `cc-haha` '
      + 'as the current EchoFlow author.'

    expect(auditReleaseSurface({
      ...valid,
      brandFiles: [{ path: 'AGENTS.md', content: ruleLine }],
    })).toEqual([])
  })

  test('still flags a real violation elsewhere in AGENTS.md', () => {
    // The exemption is per-line, so it must not disable the scan for the file.
    const contents = [
      '- Audit public identity after every merge: must not identify NanmiCoder/阿江.',
      '',
      'Contact: cc-haha/compare',
    ].join('\n')

    expect(auditReleaseSurface({
      ...valid,
      brandFiles: [{ path: 'AGENTS.md', content: contents }],
    })).toEqual(['upstream identity remains in AGENTS.md: cc-haha/compare'])
  })

  test('reports each marker once per file', () => {
    // A file can repeat a marker; one error per marker keeps the report readable.
    const errors = auditReleaseSurface({
      ...valid,
      brandFiles: [{ path: 'README.md', content: 'a NanmiCoder/cc-haha\nb NanmiCoder/cc-haha\n' }],
    })

    expect(errors).toEqual(['upstream identity remains in README.md: NanmiCoder/cc-haha'])
  })

  test('scans nothing when no brand files are supplied', () => {
    // `brandFiles` is optional so the pure function stays callable without a repo.
    expect(auditReleaseSurface(valid)).toEqual([])
  })

  test('covers the files that conflict during a sync', () => {
    // v0.7.4 conflicted on README.md, package.json and desktop/package.json.
    expect(BRAND_FILES).toEqual([
      'README.md',
      'package.json',
      'desktop/package.json',
      'AGENTS.md',
    ])
  })
})
