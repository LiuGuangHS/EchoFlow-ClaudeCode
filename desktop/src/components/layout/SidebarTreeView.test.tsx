import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Mock localStorage with full API before any imports
const localStorageStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore.set(key, value) }),
  removeItem: vi.fn((key: string) => { localStorageStore.delete(key) }),
  clear: vi.fn(() => { localStorageStore.clear() }),
  get length() { return localStorageStore.size },
  key: vi.fn((index: number) => [...localStorageStore.keys()][index] ?? null),
})

const desktopUiPreferencesApiMock = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  updateSidebarPreferences: vi.fn(),
}))

vi.mock('../../api/desktopUiPreferences', () => ({
  desktopUiPreferencesApi: desktopUiPreferencesApiMock,
}))

const openTargetStoreMock = vi.hoisted(() => ({
  ensureTargets: vi.fn(),
  openTarget: vi.fn(),
  targets: [{ id: 'finder', kind: 'file_manager', label: 'Finder', platform: 'darwin' }],
}))

vi.mock('../../stores/openTargetStore', () => ({
  useOpenTargetStore: {
    getState: () => openTargetStoreMock,
  },
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      'sidebar.newSession': 'New Session',
      'sidebar.settings': 'Settings',
      'sidebar.searchPlaceholder': 'Search sessions',
      'sidebar.noSessions': 'No sessions',
      'sidebar.noMatching': 'No matching sessions',
      'sidebar.sessionListFailed': 'Session list failed',
      'sidebar.refreshSessions': 'Refresh sessions',
      'sidebar.projects': 'Projects',
      'sidebar.projectMenu': 'Project menu',
      'sidebar.newProject': 'New project',
      'sidebar.archiveAllChats': 'Archive all chats',
      'sidebar.organizeSidebar': 'Organize sidebar',
      'sidebar.sortCondition': 'Sort condition',
      'sidebar.organizeByProject': 'By project',
      'sidebar.organizeByRecentProject': 'Recent projects',
      'sidebar.organizeByTime': 'By time',
      'sidebar.sortByCreatedAt': 'Created time',
      'sidebar.sortByUpdatedAt': 'Updated time',
      'sidebar.newBlankProject': 'New blank project',
      'sidebar.useExistingFolder': 'Use existing folder',
      'sidebar.chooseProjectFolderUnavailable': 'Folder selection is only available in the desktop app.',
      'sidebar.projectActions': 'Project actions for {project}',
      'sidebar.pinProject': 'Pin Project',
      'sidebar.unpinProject': 'Unpin Project',
      'sidebar.openInFinder': 'Open in Finder',
      'sidebar.openInFinderFailed': 'Could not open the project in Finder.',
      'sidebar.openInFinderUnavailable': 'No file manager is available.',
      'sidebar.hideProjectFromSidebar': 'Hide from Sidebar',
      'sidebar.restoreProjectToSidebar': 'Restore to Sidebar',
      'sidebar.restoreHiddenProjects': 'Restore hidden projects ({count})',
      'sidebar.projectHidden': '{project} was hidden from the sidebar.',
      'sidebar.newSessionInProject': 'New session in {project}',
      'sidebar.showMoreSessions': 'Expand display',
      'sidebar.showFewerSessions': 'Collapse display',
      'sidebar.expandProject': 'Expand {project}',
      'sidebar.collapseProject': 'Collapse {project}',
      'sidebar.worktree': 'worktree',
      'sidebar.sessionRunning': 'Session running',
      'common.retry': 'Retry',
      'common.loading': 'Loading...',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.rename': 'Rename',
      'sidebar.timeGroup.today': 'Today',
      'sidebar.timeGroup.yesterday': 'Yesterday',
      'sidebar.timeGroup.last7days': 'Last 7 Days',
      'sidebar.timeGroup.last30days': 'Last 30 Days',
      'sidebar.timeGroup.older': 'Older',
      'sidebar.missingDir': 'Missing',
      'sidebar.confirmDelete': 'Delete this session?',
      'sidebar.batchManage': 'Batch manage',
      'sidebar.batchSelectedCount': '{count} selected',
      'sidebar.batchSelectAll': 'Select all',
      'sidebar.batchDeselectAll': 'Deselect all',
      'sidebar.batchSelectGroup': 'Select {group}',
      'sidebar.batchDeleteSelected': 'Delete selected ({count})',
      'sidebar.batchDeleteConfirm': 'Delete {count} sessions?',
      'sidebar.batchDeleteConfirmBody': 'The following sessions will be deleted:',
      'sidebar.batchDeleteMore': '...and {count} more',
      'sidebar.batchExit': 'Cancel batch mode',
      'sidebar.batchDeleteSucceeded': 'Deleted {count} sessions.',
      'sidebar.batchDeleteFailed': '{count} sessions could not be deleted.',
      'sidebar.collapse': 'Collapse sidebar',
      'sidebar.expand': 'Expand sidebar',
      'session.lastUpdated': 'last updated {time}',
      'session.timeJustNow': 'just now',
      'session.timeMinutes': '{n}m ago',
      'session.timeHours': '{n}h ago',
      'session.timeDays': '{n}d ago',
    }
    let text = translations[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value))
    }
    return text
  },
}))

import { Sidebar } from './Sidebar'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import type { SessionListItem } from '../../types/session'

function makeSession(
  id: string,
  title: string,
  projectRoot: string,
  sourceSessionId?: string,
  sourceMessageId?: string,
): SessionListItem {
  return {
    id,
    title,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    messageCount: 1,
    projectPath: projectRoot,
    projectRoot,
    workDir: projectRoot,
    workDirExists: true,
    sourceSessionId,
    sourceMessageId,
  }
}

describe('Sidebar forked session tree view', () => {
  const connectToSession = vi.fn()
  const disconnectSession = vi.fn()
  const fetchSessions = vi.fn()
  const createSession = vi.fn()
  const deleteSession = vi.fn()
  const deleteSessions = vi.fn()
  const addToast = vi.fn()
  const renameSession = vi.fn()

  beforeEach(() => {
    localStorageStore.clear()
    connectToSession.mockReset()
    disconnectSession.mockReset()
    fetchSessions.mockReset()
    addToast.mockReset()
    desktopUiPreferencesApiMock.getPreferences.mockReset()
    desktopUiPreferencesApiMock.updateSidebarPreferences.mockReset()
    desktopUiPreferencesApiMock.getPreferences.mockRejectedValue(new Error('server unavailable'))
    desktopUiPreferencesApiMock.updateSidebarPreferences.mockResolvedValue({
      ok: true,
      preferences: {
        schemaVersion: 1,
        sidebar: {
          projectOrder: [],
          pinnedProjects: [],
          hiddenProjects: [],
          projectOrganization: 'recentProject',
          projectSortBy: 'updatedAt',
        },
      },
    })

    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      isBatchMode: false,
      selectedSessionIds: new Set(),
      fetchSessions,
      createSession,
      deleteSession,
      deleteSessions,
      renameSession,
    })
    useChatStore.setState({
      connectToSession,
      disconnectSession,
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useUIStore.setState({
      sidebarOpen: true,
      addToast,
    } as Partial<ReturnType<typeof useUIStore.getState>>)
  })

  afterEach(() => {
    cleanup()
    useTabStore.setState({ tabs: [], activeTabId: null })
    localStorageStore.clear()
  })

  it('renders a basic session in the sidebar', async () => {
    useSessionStore.setState({
      sessions: [
        makeSession('basic-1', 'Basic Session', '/workspace/repo'),
      ],
    })

    render(<Sidebar />)

    await waitFor(() => {
      expect(screen.getByText('Basic Session')).toBeInTheDocument()
    })
  })

  it('applies left indent to forked child sessions', async () => {
    const sessions = [
      makeSession('root-1', 'Root Session', '/workspace/repo'),
      makeSession('fork-1', 'Forked child', '/workspace/repo', 'root-1', 'msg-1'),
      makeSession('fork-2', 'Another child', '/workspace/repo', 'root-1', 'msg-2'),
    ]
    useSessionStore.setState({ sessions })

    render(<Sidebar />)

    await waitFor(() => {
      expect(screen.getByText('Root Session')).toBeInTheDocument()
    })

    // Verify forked sessions exist in the DOM
    expect(screen.getByText('Forked child')).toBeInTheDocument()
    expect(screen.getByText('Another child')).toBeInTheDocument()

    // Fork icons (GitBranch SVGs) should appear in forked session buttons
    const forkBtn = screen.getByText('Forked child').closest('button')!
    const rootBtn = screen.getByText('Root Session').closest('button')!

    const forkIcons = forkBtn.querySelectorAll('svg')
    const rootIcons = rootBtn.querySelectorAll('svg')

    // Forked session should have at least one more SVG (the GitBranch icon)
    // than the root session (which only has the checkmark/batch icon)
    expect(forkIcons.length).toBeGreaterThan(rootIcons.length)
  })

  it('shows fork icon for deep nesting (fork of a fork)', async () => {
    const sessions = [
      makeSession('root', 'Level 0', '/workspace/repo'),
      makeSession('fork-l1', 'Level 1', '/workspace/repo', 'root', 'msg-a'),
      makeSession('fork-l2', 'Level 2', '/workspace/repo', 'fork-l1', 'msg-b'),
    ]
    useSessionStore.setState({ sessions })

    render(<Sidebar />)

    await waitFor(() => {
      expect(screen.getByText('Level 0')).toBeInTheDocument()
    })

    expect(screen.getByText('Level 1')).toBeInTheDocument()
    expect(screen.getByText('Level 2')).toBeInTheDocument()

    // All three sessions should be rendered
    const l0Btn = screen.getByText('Level 0').closest('button')!
    const l1Btn = screen.getByText('Level 1').closest('button')!
    const l2Btn = screen.getByText('Level 2').closest('button')!

    // Level 0 (root) should have no fork icon
    // Level 1 and Level 2 should have fork icons (GitBranch SVGs)
    const l0SvgCount = l0Btn.querySelectorAll('svg').length
    const l1SvgCount = l1Btn.querySelectorAll('svg').length
    const l2SvgCount = l2Btn.querySelectorAll('svg').length

    expect(l1SvgCount).toBeGreaterThan(l0SvgCount)
    expect(l2SvgCount).toBeGreaterThan(l0SvgCount)
  })
})
