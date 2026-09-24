import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providersApi } from '../../api/providers'
import { ProviderSettings } from './ProviderSettings'
import { ApiError } from '../../api/client'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SavedProvider } from '../../types/provider'

type EchoFlowTokenSource = {
  endpoint: 'main' | 'dedicated'
  tokenId: string
  tokenName: string
  keyPreview: string
}

const {
  createProviderFromTokenMock,
  testProviderFromTokenMock,
  fetchModelsFromTokenMock,
} = vi.hoisted(() => ({
  createProviderFromTokenMock: vi.fn(),
  testProviderFromTokenMock: vi.fn(),
  fetchModelsFromTokenMock: vi.fn(),
}))

vi.mock('../../api/echoflow', () => ({
  echoflowApi: {
    createProviderFromToken: createProviderFromTokenMock,
    testProviderFromToken: testProviderFromTokenMock,
    fetchModelsFromToken: fetchModelsFromTokenMock,
  },
}))

vi.mock('../../components/settings/ClaudeOfficialLogin', () => ({ ClaudeOfficialLogin: () => null }))
vi.mock('../../components/settings/ChatGPTOfficialLogin', () => ({ ChatGPTOfficialLogin: () => null }))
vi.mock('../../components/settings/GrokOfficialLogin', () => ({ GrokOfficialLogin: () => null }))
vi.mock('../../components/settings/EchoFlowAPIOfficialLogin', () => ({
  EchoFlowAPIOfficialLogin: ({ onAddFromToken }: { onAddFromToken: (source: EchoFlowTokenSource) => void }) => (
    <div data-testid="mock-echoflow-login">
      <button
        type="button"
        onClick={() => onAddFromToken({
          endpoint: 'main',
          tokenId: 'main-token-id',
          tokenName: 'Main key',
          keyPreview: 'sk-main…1234',
        })}
      >
        Select main token
      </button>
      <button
        type="button"
        onClick={() => onAddFromToken({
          endpoint: 'dedicated',
          tokenId: 'dedicated-token-id',
          tokenName: 'Dedicated key',
          keyPreview: 'sk-dedicated…5678',
        })}
      >
        Select dedicated token
      </button>
    </div>
  ),
}))

const savedProviders: SavedProvider[] = ([
  ['xuanshuapi', '玄枢API', 'https://www.xuanshuapi.com', 'claude-sonnet-5'],
  ['fennoai', 'FennoAI', 'https://api.fenno.ai', 'claude-sonnet-5'],
  ['qiniuai', '七牛云 AI', 'https://api.qnaigc.com', 'deepseek/deepseek-v4-pro'],
] as const).map(([presetId, name, baseUrl, model]) => ({
  id: `saved-${presetId}`,
  presetId,
  name,
  baseUrl,
  apiKey: 'fake-saved-api-key',
  apiFormat: 'anthropic',
  models: { main: model, haiku: model, sonnet: model, opus: model },
}))

describe('EchoFlow provider setup', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useProviderStore.setState({ providers: [], activeId: null, hasLoadedProviders: false, error: null })
    vi.spyOn(useSettingsStore.getState(), 'fetchAll').mockResolvedValue()
    vi.spyOn(providersApi, 'list').mockResolvedValue({ providers: [], activeId: null })
    vi.spyOn(providersApi, 'getSettings').mockResolvedValue({})
    vi.spyOn(providersApi, 'updateSettings').mockResolvedValue({ ok: true })
    createProviderFromTokenMock.mockReset()
    testProviderFromTokenMock.mockReset()
    fetchModelsFromTokenMock.mockReset()
    createProviderFromTokenMock.mockResolvedValue({ provider: {} })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens the shared configuration modal without creating a provider', async () => {
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select dedicated token' }))
    const dialog = within(await screen.findByRole('dialog'))

    expect(dialog.getByDisplayValue('https://expapi.echoflowai.cc')).toBeInTheDocument()
    expect(dialog.getByText('sk-dedicated…5678')).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Show API Key' })).not.toBeInTheDocument()
    expect(dialog.getByText(/full key is not exposed/i)).toBeInTheDocument()
    expect(dialog.getByText('API Format')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: /Anthropic Messages \(native\)/ })).toBeInTheDocument()
    expect(createProviderFromTokenMock).not.toHaveBeenCalled()

    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each([
    ['main', 'Select main token', 'main-token-id', 'https://api.echoflowai.cc'],
    ['dedicated', 'Select dedicated token', 'dedicated-token-id', 'https://expapi.echoflowai.cc'],
  ] as const)('saves the %s token through the server-resolved provider flow', async (_endpoint, buttonName, tokenId, baseUrl) => {
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: buttonName }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(createProviderFromTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: _endpoint,
      tokenId,
      baseUrl,
    })))
    const payload = createProviderFromTokenMock.mock.calls.at(-1)?.[0]
    expect(payload).not.toHaveProperty('apiKey')
    expect(payload).not.toHaveProperty('presetId')
    expect(payload).not.toHaveProperty('key')
    expect(payload).not.toHaveProperty('managementToken')
  })

  it('keeps the modal open and reports a create failure', async () => {
    createProviderFromTokenMock.mockRejectedValueOnce(new Error('create failed'))
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select main token' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(dialog.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('provider-echoflow-provider')).not.toBeInTheDocument()
  })

  it('refreshes the provider list after creating an EchoFlow provider', async () => {
    const provider: SavedProvider = {
      id: 'echoflow-provider',
      presetId: 'echoflowai',
      name: 'EchoFlow API · 主站',
      baseUrl: 'https://api.echoflowai.cc',
      apiKey: 'sk-••••1234',
      apiFormat: 'anthropic',
      models: { main: 'claude-test-model', haiku: 'claude-test-model', sonnet: 'claude-test-model', opus: 'claude-test-model' },
    }
    const listSpy = vi.spyOn(providersApi, 'list')
    listSpy
      .mockResolvedValueOnce({ providers: [], activeId: null })
      .mockResolvedValueOnce({ providers: [provider], activeId: null })
    createProviderFromTokenMock.mockResolvedValueOnce({ provider })
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select main token' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add' }))

    expect(await screen.findByTestId('provider-echoflow-provider')).toHaveTextContent('EchoFlow API · 主站')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('clears the selected token draft when the shared modal is canceled', async () => {
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select dedicated token' }))
    const tokenDialog = within(await screen.findByRole('dialog'))
    expect(tokenDialog.getByDisplayValue('专线 · Dedicated key')).toBeInTheDocument()
    fireEvent.click(tokenDialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Add Model/ }))
    const regularDialog = within(screen.getByRole('dialog'))
    expect(regularDialog.queryByDisplayValue('专线 · Dedicated key')).not.toBeInTheDocument()
    fireEvent.click(regularDialog.getByRole('button', { name: 'Cancel' }))
  })

  it('passes a manually selected API format through the token flow', async () => {
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select main token' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: /Anthropic Messages \(native\)/ }))
    fireEvent.click(within(dialog.getByRole('listbox')).getByRole('option', { name: /OpenAI Chat Completions/ }))
    expect(dialog.getByRole('button', { name: /OpenAI Chat Completions/ })).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(createProviderFromTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'main',
      tokenId: 'main-token-id',
      apiFormat: 'openai_chat',
    })))
  })

  it('uses the endpoint-scoped model discovery flow for EchoFlow tokens', async () => {
    fetchModelsFromTokenMock.mockResolvedValue({
      ok: true,
      models: [{ id: 'gpt-test-model', ownedBy: 'echoflow' }],
      endpoint: 'dedicated',
    })
    const fetchModels = vi.spyOn(providersApi, 'fetchModels')
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select dedicated token' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: /Fetch models/ }))

    await waitFor(() => expect(fetchModelsFromTokenMock).toHaveBeenCalledWith({
      endpoint: 'dedicated',
      tokenId: 'dedicated-token-id',
    }))
    expect(fetchModels).not.toHaveBeenCalled()
    expect(dialog.getByRole('button', { name: /Anthropic Messages \(native\)/ })).toBeInTheDocument()
  })

  it('uses the normal provider test path when no EchoFlow token is selected', async () => {
    const testConfig = vi.spyOn(providersApi, 'testConfig').mockResolvedValue({
      result: { connectivity: { success: true, latencyMs: 8 } },
    })
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /Add Model/ }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Custom' }))
    fireEvent.change(dialog.getByPlaceholderText('https://api.example.com/anthropic'), { target: { value: 'https://ordinary.example.test' } })
    fireEvent.change(dialog.getByPlaceholderText('sk-...'), { target: { value: 'ordinary-api-key' } })
    fireEvent.change(dialog.getByPlaceholderText('e.g. deepseek-v4-flash'), { target: { value: 'ordinary-model' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => expect(testConfig).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://ordinary.example.test',
      apiKey: 'ordinary-api-key',
      modelId: 'ordinary-model',
    })))
    expect(testProviderFromTokenMock).not.toHaveBeenCalled()
  })

  it('uses the normal model discovery flow when no EchoFlow token is selected', async () => {
    const fetchModels = vi.spyOn(providersApi, 'fetchModels').mockResolvedValue({
      ok: true,
      models: [{ id: 'ordinary-model' }],
      endpoint: 'https://api.example.test/v1/models',
    })
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /Add Model/ }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByPlaceholderText('sk-...'), { target: { value: 'ordinary-api-key' } })
    fireEvent.click(dialog.getByRole('button', { name: /Fetch models/ }))

    await waitFor(() => expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'ordinary-api-key',
    })))
    expect(fetchModelsFromTokenMock).not.toHaveBeenCalled()
  })

  it('toggles visibility for manually entered API keys', async () => {
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /Add Model/ }))
    const dialog = within(screen.getByRole('dialog'))
    const keyInput = dialog.getByPlaceholderText('sk-...')
    fireEvent.change(keyInput, { target: { value: 'sk-manual-key' } })

    expect(keyInput).toHaveAttribute('type', 'password')
    fireEvent.click(dialog.getByRole('button', { name: 'Show API Key' }))
    expect(keyInput).toHaveAttribute('type', 'text')
    fireEvent.click(dialog.getByRole('button', { name: 'Hide API Key' }))
    expect(keyInput).toHaveAttribute('type', 'password')
  })

  it('tests an EchoFlow token with its endpoint and token id', async () => {
    testProviderFromTokenMock.mockResolvedValue({
      result: { connectivity: { success: true, latencyMs: 12 } },
    })
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select dedicated token' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => expect(testProviderFromTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'dedicated',
      tokenId: 'dedicated-token-id',
      baseUrl: 'https://expapi.echoflowai.cc',
    })))
    const payload = testProviderFromTokenMock.mock.calls.at(-1)?.[0]
    expect(payload).not.toHaveProperty('apiKey')
    expect(payload).not.toHaveProperty('key')
    expect(payload).not.toHaveProperty('managementToken')
  })

  it('passes OpenAI Responses selection through the token flow', async () => {
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select main token' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: /Anthropic Messages \(native\)/ }))
    fireEvent.click(within(dialog.getByRole('listbox')).getByRole('option', { name: /OpenAI Responses/ }))
    fireEvent.click(dialog.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(createProviderFromTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'main',
      tokenId: 'main-token-id',
      apiFormat: 'openai_responses',
    })))
    const payload = createProviderFromTokenMock.mock.calls.at(-1)?.[0]
    expect(payload).not.toHaveProperty('apiKey')
    expect(payload).not.toHaveProperty('key')
    expect(payload).not.toHaveProperty('managementToken')
  })

})

describe('saved and legacy providers', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    vi.spyOn(useSettingsStore.getState(), 'fetchAll').mockResolvedValue()
    vi.spyOn(providersApi, 'list').mockResolvedValue({ providers: savedProviders, activeId: null })
    vi.spyOn(providersApi, 'getSettings').mockResolvedValue({})
    vi.spyOn(providersApi, 'updateSettings').mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('explains why a remote endpoint change needs an explicit key and allows retry', async () => {
    const provider = { ...savedProviders[0]!, apiKey: '' }
    vi.spyOn(providersApi, 'list').mockResolvedValue({ providers: [provider], activeId: null })
    const update = vi.spyOn(providersApi, 'update')
      .mockRejectedValueOnce(new ApiError(400, { code: 'REMOTE_PROVIDER_CREDENTIAL_REQUIRED' }))
      .mockResolvedValue({ provider })
    render(<ProviderSettings browserMode />)
    fireEvent.click(within(await screen.findByTestId(`provider-${provider.id}`)).getByRole('button', { name: 'Edit' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByDisplayValue(provider.baseUrl), { target: { value: 'https://replacement.invalid' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('enter the model or image API key again')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.change(dialog.getAllByPlaceholderText('sk-...')[0]!, { target: { value: 'fake-explicit-new-key' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(provider.id, expect.objectContaining({ apiKey: 'fake-explicit-new-key', baseUrl: 'https://replacement.invalid' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('loads saved providers while hiding their add-provider chips', async () => {
    render(<ProviderSettings />)
    for (const provider of savedProviders) {
      expect(await screen.findByTestId(`provider-${provider.id}`)).toHaveTextContent(provider.name)
    }
    expect(useProviderStore.getState().providers).toEqual(savedProviders)

    fireEvent.click(screen.getByRole('button', { name: /Add Model/ }))
    const dialog = within(screen.getByRole('dialog'))
    for (const provider of savedProviders) {
      expect(dialog.queryByRole('button', { name: provider.name })).not.toBeInTheDocument()
    }
    expect(dialog.getByRole('button', { name: 'EchoFlow API' })).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Custom' })).toBeInTheDocument()
  })

  it.each(savedProviders)('edits and saves an existing $presetId provider without losing its connection', async (provider) => {
    const listSpy = vi.spyOn(providersApi, 'list')
    const update = vi.spyOn(providersApi, 'update').mockImplementation(async (id, input) => {
      expect(id).toBe(provider.id)
      const updated = { ...provider, ...input } as SavedProvider
      listSpy.mockResolvedValue({
        providers: savedProviders.map((saved) => saved.id === id ? updated : saved),
        activeId: null,
      })
      return { provider: updated }
    })
    render(<ProviderSettings />)
    const card = await screen.findByTestId(`provider-${provider.id}`)
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))

    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByDisplayValue(provider.baseUrl)).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: /Get API Key/ })).not.toBeInTheDocument()
    fireEvent.change(dialog.getByDisplayValue(provider.name), { target: { value: `${provider.name} edited` } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith(provider.id, expect.objectContaining({
      name: `${provider.name} edited`,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiFormat: provider.apiFormat,
      authStrategy: 'auth_token',
      models: provider.models,
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useProviderStore.getState().providers.find((saved) => saved.id === provider.id))
      .toMatchObject({ ...provider, name: `${provider.name} edited` })
    expect(screen.getByTestId(`provider-${provider.id}`)).toHaveTextContent(`${provider.name} edited`)
  })
})

describe('provider request compatibility', () => {
  const provider = {
    ...savedProviders[0]!, id: 'compat-provider', apiFormat: 'openai_chat' as const,
    requestCompatibility: { maxOutputTokens: 64000, sampling: 'unsupported' as const, futureOption: { keep: true } },
  }
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    vi.spyOn(useSettingsStore.getState(), 'fetchAll').mockResolvedValue()
    vi.spyOn(providersApi, 'list').mockResolvedValue({ providers: [provider], activeId: null })
    vi.spyOn(providersApi, 'getSettings').mockResolvedValue({ env: { CUSTOM_ENV: 'keep' }, futureSetting: true })
    vi.spyOn(providersApi, 'updateSettings').mockResolvedValue({ ok: true })
    vi.spyOn(providersApi, 'update').mockImplementation(async (_id, input) => ({ provider: { ...provider, ...input } as SavedProvider }))
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  const open = async () => {
    render(<ProviderSettings />)
    const card = await screen.findByTestId('provider-compat-provider')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    const dialog = within(screen.getByRole('dialog'))
    await waitFor(() => expect((dialog.getByRole('textbox', { name: 'Settings JSON' }) as HTMLTextAreaElement).value).toContain('CUSTOM_ENV'))
    return dialog
  }
  it('loads, edits and saves compatibility while preserving unknown provider fields', async () => {
    const dialog = await open()
    const budget = dialog.getByRole('textbox', { name: 'Reply output budget' })
    expect(budget).toHaveValue('64000')
    fireEvent.change(budget, { target: { value: '48000' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Advanced compatibility' }))
    expect(dialog.getByRole('combobox', { name: 'Sampling parameters' })).toHaveValue('unsupported')
    fireEvent.change(dialog.getByRole('combobox', { name: 'Output token field' }), { target: { value: 'max_completion_tokens' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(providersApi.update).toHaveBeenCalledWith('compat-provider', expect.objectContaining({ requestCompatibility: { maxOutputTokens: 48000, sampling: 'unsupported', outputTokenField: 'max_completion_tokens', futureOption: { keep: true } } })))
    const settings = vi.mocked(providersApi.updateSettings).mock.calls.at(-1)?.[0]
    expect(settings).not.toHaveProperty('requestCompatibility')
    expect(settings).toMatchObject({ futureSetting: true, env: { CUSTOM_ENV: 'keep', CLAUDE_CODE_PROVIDER_MAX_OUTPUT_TOKENS: '48000' } })
  })
  it('disables save for invalid budgets and clearing sends null', async () => {
    const dialog = await open()
    fireEvent.change(dialog.getByRole('textbox', { name: 'Reply output budget' }), { target: { value: '-3' } })
    expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(dialog.getByRole('alert')).toHaveTextContent('positive whole number')
    fireEvent.click(dialog.getByRole('button', { name: 'Reset compatibility' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(providersApi.update).toHaveBeenCalledWith('compat-provider', expect.objectContaining({ requestCompatibility: null })))
    expect(vi.mocked(providersApi.updateSettings).mock.calls.at(-1)?.[0]).not.toHaveProperty('env.CLAUDE_CODE_PROVIDER_MAX_OUTPUT_TOKENS')
  })
  it('raw JSON updates and removes the same provider configuration', async () => {
    const dialog = await open()
    const editor = dialog.getByRole('textbox', { name: 'Settings JSON' })
    const parsed = JSON.parse((editor as HTMLTextAreaElement).value)
    parsed.requestCompatibility = { maxOutputTokens: 42000, reasoning: 'unsupported' }
    fireEvent.change(editor, { target: { value: JSON.stringify(parsed) } })
    expect(dialog.getByRole('textbox', { name: 'Reply output budget' })).toHaveValue('42000')
    const next = JSON.parse((editor as HTMLTextAreaElement).value)
    delete next.requestCompatibility
    fireEvent.change(editor, { target: { value: JSON.stringify(next) } })
    expect(dialog.getByRole('textbox', { name: 'Reply output budget' })).toHaveValue('')
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(providersApi.update).toHaveBeenCalledWith('compat-provider', expect.objectContaining({ requestCompatibility: null, baseUrl: provider.baseUrl })))
  })
  it('shows Responses capabilities without Chat-only token parameter controls', async () => {
    vi.spyOn(providersApi, 'list').mockResolvedValue({ providers: [{ ...provider, apiFormat: 'openai_responses' }], activeId: null })
    const dialog = await open()
    fireEvent.click(dialog.getByRole('button', { name: 'Advanced compatibility' }))
    expect(dialog.queryByRole('combobox', { name: 'Output token field' })).not.toBeInTheDocument()
    expect(dialog.getByRole('combobox', { name: 'Reasoning parameters' })).toBeInTheDocument()
  })
  it('keeps compatibility controls hidden for Anthropic providers', async () => {
    vi.spyOn(providersApi, 'list').mockResolvedValue({ providers: [{ ...provider, apiFormat: 'anthropic' }], activeId: null })
    const dialog = await open()
    expect(dialog.queryByRole('textbox', { name: 'Reply output budget' })).not.toBeInTheDocument()
  })
})
