import { describe, expect, test } from 'bun:test'

import { auditReleaseSurface } from './audit'

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
      unresolvedFiles: ['desktop/package.json'],
    })).toEqual([
      'unresolved merge conflicts: desktop/package.json',
      'release notes newer than the current EchoFlow version remain: release-notes/v0.6.6.md',
    ])
  })

  test('rejects upstream branding in the current release note', () => {
    expect(auditReleaseSurface({
      ...valid,
      releaseNote: '# EchoFlow Code v0.5.6\nClaude Code Haha',
    })).toContain('upstream identity remains in release note: Claude Code Haha')
  })
})
