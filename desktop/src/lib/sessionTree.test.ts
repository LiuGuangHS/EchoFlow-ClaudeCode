import { describe, expect, it } from 'vitest'
import { buildSessionTree } from './sessionTree'
import type { SessionListItem } from '../types/session'

function makeSession(
  id: string,
  title: string,
  sourceSessionId?: string,
  sourceMessageId?: string,
): SessionListItem {
  return {
    id,
    title,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 1,
    projectPath: '/workspace/repo',
    projectRoot: '/workspace/repo',
    workDir: '/workspace/repo',
    workDirExists: true,
    sourceSessionId,
    sourceMessageId,
  }
}

describe('buildSessionTree', () => {
  it('returns flat list unchanged when no sessions have parents', () => {
    const sessions = [
      makeSession('s1', 'Session 1'),
      makeSession('s2', 'Session 2'),
      makeSession('s3', 'Session 3'),
    ]
    const tree = buildSessionTree(sessions)
    expect(tree.map((t) => t.id)).toEqual(['s1', 's2', 's3'])
    expect(tree.every((t) => t.depth === 0)).toBe(true)
  })

  it('nests forked sessions under their parent', () => {
    const sessions = [
      makeSession('parent', 'Parent Session'),
      makeSession('child', 'Forked Child', 'parent', 'msg-1'),
      makeSession('sibling', 'Sibling Session'),
    ]
    const tree = buildSessionTree(sessions)
    expect(tree.map((t) => ({ id: t.id, depth: t.depth }))).toEqual([
      { id: 'parent', depth: 0 },
      { id: 'child', depth: 1 },
      { id: 'sibling', depth: 0 },
    ])
  })

  it('supports multi-level nesting (fork of a fork)', () => {
    const sessions = [
      makeSession('root', 'Root'),
      makeSession('fork1', 'Fork Level 1', 'root', 'msg-a'),
      makeSession('fork2', 'Fork Level 2', 'fork1', 'msg-b'),
    ]
    const tree = buildSessionTree(sessions)
    expect(tree.map((t) => ({ id: t.id, depth: t.depth }))).toEqual([
      { id: 'root', depth: 0 },
      { id: 'fork1', depth: 1 },
      { id: 'fork2', depth: 2 },
    ])
  })

  it('groups multiple children of the same parent', () => {
    const sessions = [
      makeSession('root', 'Root'),
      makeSession('child-a', 'Child A', 'root', 'msg-1'),
      makeSession('child-b', 'Child B', 'root', 'msg-2'),
    ]
    const tree = buildSessionTree(sessions)
    expect(tree.map((t) => ({ id: t.id, depth: t.depth }))).toEqual([
      { id: 'root', depth: 0 },
      { id: 'child-a', depth: 1 },
      { id: 'child-b', depth: 1 },
    ])
  })

  it('handles sessions whose parent is not in the list', () => {
    // This can happen when a parent session is deleted
    const sessions = [
      makeSession('orphan', 'Orphan Fork', 'nonexistent-parent', 'msg-1'),
    ]
    const tree = buildSessionTree(sessions)
    // Orphan sessions should be rendered at root level
    expect(tree.map((t) => ({ id: t.id, depth: t.depth }))).toEqual([
      { id: 'orphan', depth: 0 },
    ])
  })

  it('marks the last child of a parent for visual connecting line', () => {
    const sessions = [
      makeSession('root', 'Root'),
      makeSession('child-a', 'Child A', 'root', 'msg-1'),
      makeSession('child-b', 'Child B', 'root', 'msg-2'),
      makeSession('other', 'Other'),
    ]
    const tree = buildSessionTree(sessions)

    const childA = tree.find((t) => t.id === 'child-a')!
    const childB = tree.find((t) => t.id === 'child-b')!
    const other = tree.find((t) => t.id === 'other')!

    expect(childA.isLastChild).toBe(false)
    expect(childB.isLastChild).toBe(true)
    expect(other.isLastChild).toBe(false)
  })

  it('preserves original sort order within same depth level', () => {
    const sessions = [
      makeSession('a', 'A'),
      makeSession('b-child', 'B Child', 'a', 'msg-1'),
      makeSession('c', 'C'),
      makeSession('d', 'D'),
    ]
    const tree = buildSessionTree(sessions)
    expect(tree.map((t) => t.id)).toEqual(['a', 'b-child', 'c', 'd'])
  })
})
