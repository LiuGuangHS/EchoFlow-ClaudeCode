import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { skillMarketApi } from '../api/skillMarket'
import { useSettingsStore } from '../stores/settingsStore'
import { useSkillMarketStore } from '../stores/skillMarketStore'
import type { SkillMarketDetail, SkillMarketItem } from '../types/skillMarket'
import { SkillCenter } from './SkillCenter'

vi.mock('../api/skillMarket', () => ({
  skillMarketApi: {
    list: vi.fn(),
    detail: vi.fn(),
    install: vi.fn(),
  },
}))

vi.mock('../components/skills/SkillList', () => ({
  SkillList: () => <div data-testid="installed-skill-list">Installed skills</div>,
}))

const mockedSkillMarketApi = vi.mocked(skillMarketApi)

function makeItem(overrides: Partial<SkillMarketItem> = {}): SkillMarketItem {
  return {
    source: 'clawhub',
    sourceMode: 'primary',
    slug: 'ppt-generator',
    displayName: 'PPT Generator',
    summary: 'Create presentation decks from structured prompts.',
    owner: 'OpenClaw',
    canonicalUrl: 'https://clawhub.ai/skills/ppt-generator',
    upstreamUrl: 'https://github.com/example/ppt-generator',
    license: 'MIT',
    version: '1.0.0',
    downloads: 42000,
    stars: 128,
    trustState: 'clean',
    installed: false,
    ...overrides,
  }
}

function makeDetail(overrides: Partial<SkillMarketDetail> = {}): SkillMarketDetail {
  return {
    ...makeItem(),
    files: [{ path: 'SKILL.md', size: 512 }],
    entryPreview: '# PPT Generator',
    riskLabels: [],
    installEligibility: { status: 'installable' },
    ...overrides,
  }
}

describe('SkillCenter', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useSkillMarketStore.setState({
      items: [],
      selectedDetail: null,
      source: 'auto',
      sort: 'downloads',
      query: '',
      isLoading: false,
      isDetailLoading: false,
      isInstalling: false,
      error: null,
    })
    mockedSkillMarketApi.list.mockResolvedValue({
      items: [makeItem()],
      nextCursor: null,
      source: 'clawhub',
      sourceStatus: 'ok',
    })
    mockedSkillMarketApi.detail.mockResolvedValue({ detail: makeDetail() })
    mockedSkillMarketApi.install.mockResolvedValue({
      installed: true,
      skillName: 'ppt-generator',
      targetPath: '/Users/nanmi/.claude/skills/ppt-generator',
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    useSkillMarketStore.setState({
      items: [],
      selectedDetail: null,
      source: 'auto',
      sort: 'downloads',
      query: '',
      isLoading: false,
      isDetailLoading: false,
      isInstalling: false,
      error: null,
    })
  })

  it('loads marketplace cards and opens a detail confirmation panel', async () => {
    render(<SkillCenter />)

    expect(await screen.findByRole('button', { name: 'PPT Generator' })).toBeInTheDocument()
    expect(mockedSkillMarketApi.list).toHaveBeenCalledWith({
      source: 'auto',
      sort: 'downloads',
      q: undefined,
    })

    fireEvent.click(screen.getByRole('button', { name: 'PPT Generator' }))

    await waitFor(() => {
      expect(mockedSkillMarketApi.detail).toHaveBeenCalledWith('clawhub', 'ppt-generator')
    })
    const detail = await screen.findByText('# PPT Generator')
    expect(detail).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled()
    expect(screen.getByText('Open upstream')).toHaveAttribute('href', 'https://github.com/example/ppt-generator')
  })

  it('submits market searches without auto-searching every keystroke', async () => {
    render(<SkillCenter />)
    await screen.findByRole('button', { name: 'PPT Generator' })
    mockedSkillMarketApi.list.mockClear()

    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: '  ppt  ' },
    })
    expect(mockedSkillMarketApi.list).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Run search' }))

    await waitFor(() => {
      expect(mockedSkillMarketApi.list).toHaveBeenCalledWith({
        source: 'auto',
        sort: 'downloads',
        q: 'ppt',
      })
    })
  })

  it('marks blocked marketplace details as not installable', async () => {
    mockedSkillMarketApi.detail.mockResolvedValue({
      detail: makeDetail({
        trustState: 'blocked',
        riskLabels: ['scripts'],
        installEligibility: { status: 'blocked', reason: 'Risky script detected.' },
      }),
    })
    render(<SkillCenter />)

    fireEvent.click(await screen.findByRole('button', { name: 'PPT Generator' }))

    const detailPanel = await screen.findByText('Risk signals')
    expect(detailPanel).toBeInTheDocument()
    expect(screen.getByText('Scripts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Blocked' })).toBeDisabled()
  })

  it('switches to the installed skills tab', async () => {
    render(<SkillCenter />)
    await screen.findByRole('button', { name: 'PPT Generator' })

    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }))

    expect(screen.getByTestId('installed-skill-list')).toBeInTheDocument()
    expect(within(screen.getByTestId('skill-mine-tab')).getByText('Installed skills')).toBeInTheDocument()
  })
})
