import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { filesystemApi } from '@/api/filesystem'
import type { ComposerReferenceCandidate } from '@/types/composerReference'
import { ComposerReferenceMenu, type ComposerReferenceMenuHandle } from '@/components/chat/ComposerReferenceMenu'

vi.mock('@/api/filesystem', () => ({ filesystemApi: { browse: vi.fn(), search: vi.fn() } }))
const directory = { name: 'src', path: '/work/src', isDirectory: true }
const file = { name: 'app.ts', path: '/work/app.ts', isDirectory: false }
const references: ComposerReferenceCandidate[] = [
  { kind: 'plugin', id: 'hyperframes', name: 'hyperframes', displayName: 'HyperFrames', description: 'Video creation', source: 'plugin', modelText: 'Use HyperFrames', icon: '/connectors/hyperframes.svg' },
  { kind: 'skill', id: 'design', name: 'design', displayName: 'Design', description: 'Create interfaces', source: 'user', path: '/skills/design/SKILL.md', modelText: 'Use design' },
]
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(filesystemApi.browse).mockResolvedValue({ currentPath: '/work', parentPath: '/', entries: [directory, file] })
  vi.mocked(filesystemApi.search).mockResolvedValue({ currentPath: '/work', parentPath: '/', entries: [file] })
})

it('previews capabilities without tabs or filesystem reads and inserts structured references', () => {
  const ref = createRef<ComposerReferenceMenuHandle>()
  const onSelect = vi.fn()
  render(<ComposerReferenceMenu ref={ref} id="references" cwd="/work" references={references} onSelect={onSelect} />)
  expect(screen.getAllByRole('option').map(row => row.textContent)).toEqual(['DesignCreate interfacesPersonal', 'HyperFramesVideo creationPlugin'])
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  expect(filesystemApi.browse).not.toHaveBeenCalled()
  expect(filesystemApi.search).not.toHaveBeenCalled()
  expect(screen.getByRole('option', { name: 'HyperFrames' })).toHaveAccessibleDescription('Video creation')
  act(() => { ref.current!.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })) })
  expect(onSelect).not.toHaveBeenCalled()
  act(() => { ref.current!.handleKeyDown(new KeyboardEvent('keydown', { key: 'Tab' })) })
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'skill', path: '/skills/design/SKILL.md', modelText: 'Use design' }))
})

it('limits empty previews to three per capability and gives embedded category browsers full access', () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ ...references[1]!, id: String(index), displayName: `Design ${index}` }))
  const action = { key: 'manage', label: 'Manage', onSelect: vi.fn() }
  const view = render(<ComposerReferenceMenu id="large" cwd="/work" references={many} actions={[action]} onSelect={vi.fn()} />)
  expect(screen.getAllByRole('option')).toHaveLength(3)
  expect(screen.queryByRole('option', { name: 'Manage' })).not.toBeInTheDocument()
  view.rerender(<ComposerReferenceMenu embedded browseReferences id="large" cwd="/work" references={many} actions={[action]} onSelect={vi.fn()} />)
  expect(screen.getAllByRole('option')).toHaveLength(13)
  fireEvent.click(screen.getByRole('option', { name: 'Manage' }))
  expect(action.onSelect).toHaveBeenCalledOnce()
  expect(filesystemApi.browse).not.toHaveBeenCalled()
})

it('ranks file, capability and action results together with a total limit of eight', async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ ...references[1]!, id: String(index), displayName: `helper ${index}`, description: 'app helper' }))
  const action = { key: 'app', label: 'app', onSelect: vi.fn() }
  render(<ComposerReferenceMenu id="ranked" cwd="/work" filter="app" references={many} actions={[action]} onSelect={vi.fn()} />)
  await screen.findByRole('option', { name: 'app.ts' })
  expect(screen.getAllByRole('option')).toHaveLength(8)
  expect(screen.getAllByRole('option')[0]).toHaveAccessibleName('app')
  expect(screen.queryByRole('group', { name: 'Skills' })).not.toBeInTheDocument()
})

it('keeps directory selection separate from ArrowRight and pointer navigation', async () => {
  vi.mocked(filesystemApi.search).mockResolvedValue({ currentPath: '/work', parentPath: '/', entries: [directory] })
  const ref = createRef<ComposerReferenceMenuHandle>()
  const onSelect = vi.fn()
  const onNavigate = vi.fn()
  render(<ComposerReferenceMenu ref={ref} id="files" cwd="/work" filter="src" references={[]} onSelect={onSelect} onNavigate={onNavigate} />)
  const option = await screen.findByRole('option', { name: 'src' })
  act(() => { ref.current!.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' })) })
  expect(onNavigate).toHaveBeenLastCalledWith('src/')
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.click(option.querySelector('[data-navigate-directory]')!)
  expect(onNavigate).toHaveBeenCalledTimes(2)
  fireEvent.click(option)
  expect(onSelect).toHaveBeenCalledWith({ label: 'src/', path: '/work/src', isDirectory: true })
})

it('browses directory queries without filtering out their children', async () => {
  const onSelect = vi.fn()
  render(<ComposerReferenceMenu id="path" cwd="/work" filter="src/" references={references} onSelect={onSelect} />)
  await screen.findByRole('option', { name: 'app.ts' })
  expect(filesystemApi.browse).toHaveBeenCalledWith('/work/src', { includeFiles: true })
  expect(screen.queryByRole('option', { name: 'Design' })).not.toBeInTheDocument()
})

it('discards late query and workspace results and never selects stale files', async () => {
  let oldResolve!: (value: Awaited<ReturnType<typeof filesystemApi.search>>) => void
  vi.mocked(filesystemApi.search).mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve }))
  const onSelect = vi.fn()
  const ref = createRef<ComposerReferenceMenuHandle>()
  const view = render(<ComposerReferenceMenu ref={ref} id="search" cwd="/old" filter="old" references={[]} onSelect={onSelect} />)
  view.rerender(<ComposerReferenceMenu ref={ref} id="search" cwd="/work" filter="app" references={[]} onSelect={onSelect} />)
  act(() => { ref.current!.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' })) })
  expect(onSelect).not.toHaveBeenCalled()
  await screen.findByRole('option', { name: 'app.ts' })
  await act(async () => { oldResolve({ currentPath: '/old', parentPath: '/', entries: [{ name: 'old.ts', path: '/old/old.ts', isDirectory: false }] }) })
  expect(screen.queryByRole('option', { name: 'old.ts' })).not.toBeInTheDocument()
  view.rerender(<ComposerReferenceMenu ref={ref} id="search" cwd="/work" references={references} onSelect={onSelect} />)
  expect(screen.queryByRole('option', { name: 'app.ts' })).not.toBeInTheDocument()
})

it('keeps plugin results usable after search failure without exposing raw errors or remote icons', async () => {
  vi.mocked(filesystemApi.search).mockRejectedValue(new Error('secret-server-error'))
  const onSelect = vi.fn()
  render(<ComposerReferenceMenu id="failure" cwd="/work" filter="hyper" references={[{ ...references[0]!, icon: 'https://untrusted.test/tracker.svg' }]} referencesError="secret-reference-error" onSelect={onSelect} />)
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
  expect(document.body.textContent).not.toContain('secret-')
  expect(document.querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('option', { name: 'HyperFrames' }))
  expect(onSelect).toHaveBeenCalled()
})

it('preserves explicitly highlighted results when asynchronous files change their ranking', async () => {
  let resolveFiles!: (value: Awaited<ReturnType<typeof filesystemApi.search>>) => void
  vi.mocked(filesystemApi.search).mockImplementationOnce(() => new Promise(resolve => { resolveFiles = resolve }))
  const ref = createRef<ComposerReferenceMenuHandle>()
  const onSelect = vi.fn()
  render(<ComposerReferenceMenu ref={ref} id="pending" cwd="/work" filter="hyper" references={references} onSelect={onSelect} />)
  fireEvent.mouseEnter(screen.getByRole('option', { name: 'HyperFrames' }))
  await act(async () => { resolveFiles({ currentPath: '/work', parentPath: '/', entries: [{ ...file, name: 'hyper', path: '/work/hyper' }] }) })
  expect(screen.getAllByRole('option')[0]).toHaveAccessibleName('hyper')
  expect(screen.getByRole('option', { name: 'HyperFrames' })).toHaveAttribute('aria-selected', 'true')
  act(() => { ref.current!.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' })) })
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'plugin', id: 'hyperframes' }))
})

it('keeps explicit capability category searches out of the filesystem', () => {
  render(<ComposerReferenceMenu embedded browseReferences id="category" cwd="/work" filter="design" references={references} onSelect={vi.fn()} />)
  expect(screen.getByRole('option', { name: 'Design' })).toBeInTheDocument()
  expect(filesystemApi.search).not.toHaveBeenCalled()
  expect(filesystemApi.browse).not.toHaveBeenCalled()
  expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
})

it.each(['src/', 'src\\'])('keeps every child accessible while browsing %s', async filter => {
  vi.mocked(filesystemApi.browse).mockResolvedValue({ currentPath: '/work/src', parentPath: '/work', entries: Array.from({ length: 15 }, (_, index) => ({ name: `file-${index}.ts`, path: `/work/src/file-${index}.ts`, isDirectory: false })) })
  render(<ComposerReferenceMenu id="directory" cwd="/work" filter={filter} references={[]} onSelect={vi.fn()} />)
  await screen.findByRole('option', { name: 'file-14.ts' })
  expect(screen.getAllByRole('option')).toHaveLength(15)
  expect(filesystemApi.browse).toHaveBeenCalledWith('/work/src', { includeFiles: true })
  expect(filesystemApi.search).not.toHaveBeenCalled()
})

it('resolves plugin icons against the packaged asset base', () => {
  vi.stubEnv('BASE_URL', './')
  try {
    render(<ComposerReferenceMenu id="brand" cwd="/work" references={references} onSelect={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'HyperFrames' }).querySelector('img')).toHaveAttribute('src', './connectors/hyperframes.svg')
  } finally { vi.unstubAllEnvs() }
})
