// @vitest-environment jsdom
import '@testing-library/jest-dom'
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const openTarget = vi.hoisted(() => vi.fn())
const shellOpen = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../../stores/openTargetStore', () => ({
  useOpenTargetStore: (sel: (s: unknown) => unknown) =>
    sel({
      targets: [
        { id: 'code', kind: 'ide', label: 'VS Code', icon: '', platform: 'darwin' },
        { id: 'finder', kind: 'file_manager', label: 'Finder', icon: '', platform: 'darwin' },
      ],
      ensureTargets: () => {},
      openTarget,
    }),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }))

vi.mock('../../i18n', () => ({
  useTranslation: () => (k: string, v?: Record<string, string>) =>
    v?.target ? `${k}:${v.target}` : k,
}))

import { WorkspaceFileOpenWith } from './WorkspaceFileOpenWith'

describe('WorkspaceFileOpenWith', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an item for the IDE target, the file_manager target, and a system-default item', () => {
    const { getAllByRole } = render(
      <WorkspaceFileOpenWith absolutePath="/w/report.md" />,
    )

    const menuItems = getAllByRole('menuitem')
    // IDE + file_manager + system = 3 items
    expect(menuItems).toHaveLength(3)

    const labels = menuItems.map((el) => el.textContent)
    expect(labels.some((l) => l?.includes('VS Code'))).toBe(true)
    expect(labels.some((l) => l?.includes('Finder'))).toBe(true)
    // system default item uses the 'openWith.systemDefault' key (returned as-is by mock)
    expect(labels.some((l) => l?.includes('openWith.systemDefault'))).toBe(true)
  })

  it('clicking the IDE item calls openTarget and onAfterSelect', () => {
    const onAfter = vi.fn()
    const { getAllByRole } = render(
      <WorkspaceFileOpenWith absolutePath="/w/report.md" onAfterSelect={onAfter} />,
    )

    const menuItems = getAllByRole('menuitem')
    const ideItem = menuItems.find((el) => el.textContent?.includes('VS Code'))
    if (!ideItem) throw new Error('IDE menu item not found')

    fireEvent.click(ideItem)

    expect(openTarget).toHaveBeenCalledWith('code', '/w/report.md')
    expect(onAfter).toHaveBeenCalledTimes(1)
  })

  it('clicking the system-default item calls shellOpen and onAfterSelect', async () => {
    const onAfter = vi.fn()
    const { getAllByRole } = render(
      <WorkspaceFileOpenWith absolutePath="/w/report.md" onAfterSelect={onAfter} />,
    )

    const menuItems = getAllByRole('menuitem')
    const systemItem = menuItems.find((el) => el.textContent?.includes('openWith.systemDefault'))
    if (!systemItem) throw new Error('System default menu item not found')

    fireEvent.click(systemItem)

    // onAfterSelect is synchronous (called before the dynamic import chain)
    expect(onAfter).toHaveBeenCalledTimes(1)

    // Flush the microtask queue for the dynamic import + .then chain
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
    }

    expect(shellOpen).toHaveBeenCalledWith('/w/report.md')
  })
})
