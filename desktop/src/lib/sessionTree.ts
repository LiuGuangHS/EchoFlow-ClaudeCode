import type { SessionListItem } from '../types/session'

export type TreeSession = SessionListItem & {
  depth: number
  isLastChild: boolean
}

/**
 * Build a tree-flattened list from sessions with parent-child relationships.
 * Child sessions (those with sourceSessionId) are inserted after their parent
 * with increased depth. The input order is preserved at each depth level.
 */
export function buildSessionTree(sessions: SessionListItem[]): TreeSession[] {
  // Build a lookup of parent → children
  const childrenMap = new Map<string, TreeSession[]>()
  const sessionMap = new Map<string, TreeSession>()

  for (const session of sessions) {
    const treeSession: TreeSession = {
      ...session,
      depth: 0,
      isLastChild: false,
    }
    sessionMap.set(session.id, treeSession)

    if (session.sourceSessionId) {
      const siblings = childrenMap.get(session.sourceSessionId) || []
      siblings.push(treeSession)
      childrenMap.set(session.sourceSessionId, siblings)
    }
  }

  // Mark the last child in each sibling group
  for (const children of childrenMap.values()) {
    if (children.length > 0) {
      children[children.length - 1]!.isLastChild = true
    }
  }

  // Flatten in original order with nesting
  const result: TreeSession[] = []

  function insertWithChildren(item: TreeSession, depth: number) {
    item.depth = depth
    result.push(item)

    const children = childrenMap.get(item.id)
    if (children) {
      for (const child of children) {
        insertWithChildren(child, depth + 1)
      }
    }
  }

  // Collect top-level items in original order, skipping items that have a parent in the list.
  // Only parents that are actually in the session list should prevent their children from being top-level.
  const visibleParentIds = new Set(
    [...childrenMap.keys()].filter((id) => sessionMap.has(id))
  )
  for (const session of sessions) {
    const treeSession = sessionMap.get(session.id)!
    // Only insert at top level if this session is not a child of another visible session
    if (!session.sourceSessionId || !visibleParentIds.has(session.sourceSessionId)) {
      // If the parent is not in this list (orphan), treat as root
      insertWithChildren(treeSession, 0)
    }
  }

  return result
}
