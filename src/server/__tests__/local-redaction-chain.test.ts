import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleProxyRequest } from '../proxy/handler.js'
import { ProviderService } from '../services/providerService.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { clearTraceCaptureStateForTests, drainTraceCaptureForTests } from '../../services/api/traceCapture.js'

const SECRET = 'ECHOFLOW_REDACTION_FIXTURE'
const PLACEHOLDER_RE = /\{\{[A-Z][A-Z0-9_]*_[a-z2-7]{8}\}\}/g

type Server = ReturnType<typeof Bun.serve>

let tmpDir: string
let originalConfigDir: string | undefined
let originalHome: string | undefined
const servers: Server[] = []

function settingsPath(): string {
  return path.join(tmpDir, 'settings.json')
}

function enableRedaction(): void {
  fs.writeFileSync(
    settingsPath(),
    JSON.stringify({ localRedaction: { enabled: true, personalInfo: false, customWords: [SECRET] } }),
    'utf8',
  )
}

function disableRedaction(): void {
  fs.writeFileSync(
    settingsPath(),
    JSON.stringify({ localRedaction: { enabled: false } }),
    'utf8',
  )
}

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'proxy-redaction-chain-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalHome = process.env.HOME
  // All config/trace state stays in a disposable directory.
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  process.env.HOME = tmpDir
  resetSettingsCache()
})

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop()
  if (originalConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  else delete process.env.CLAUDE_CONFIG_DIR
  if (originalHome !== undefined) process.env.HOME = originalHome
  else delete process.env.HOME
  resetSettingsCache()
  await drainTraceCaptureForTests()
  clearTraceCaptureStateForTests()
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

function startUpstream(
  received: string[],
  mode: 'json' | 'sse' | 'error' | 'openai_chat',
): Server {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const raw = await request.text()
      received.push(raw)
      const tokens = raw.match(PLACEHOLDER_RE) ?? []
      const echo = tokens.join('|')
      if (mode === 'sse') {
        const data = JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: echo } })
        return new Response(
          `event: content_block_delta\ndata: ${data}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      if (mode === 'error') {
        return new Response(
          JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: echo } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }
      if (mode === 'openai_chat') {
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-fixture',
            object: 'chat.completion',
            created: 0,
            model: 'fixture-model',
            choices: [{ index: 0, message: { role: 'assistant', content: echo }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ type: 'message', content: [{ type: 'text', text: echo }] }),
        { headers: { 'content-type': 'application/json' } },
      )
    },
  })
  servers.push(server)
  return server
}

function startProxy(): Server {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: request => handleProxyRequest(request, new URL(request.url)),
  })
  servers.push(server)
  return server
}

async function addProvider(
  upstream: Server,
  supportsNestedToolResultMedia = false,
  apiFormat: 'anthropic' | 'openai_chat' = 'anthropic',
): Promise<string> {
  const provider = await new ProviderService().addProvider({
    presetId: 'custom',
    name: 'Loopback Redaction Fixture',
    baseUrl: upstream.url.origin,
    apiKey: 'fixture-upstream-key',
    apiFormat,
    authStrategy: 'api_key',
    supportsNestedToolResultMedia,
    models: { main: 'fixture-model', haiku: '', sonnet: '', opus: '' },
  })
  return provider.id
}

function postMessage(proxy: Server, id: string, stream: boolean): Promise<Response> {
  return fetch(new URL(`/proxy/providers/${id}/v1/messages`, proxy.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'fixture-client-key',
    },
    body: JSON.stringify({
      model: 'fixture-model',
      max_tokens: 16,
      stream,
      messages: [{ role: 'user', content: [{ type: 'text', text: `please echo ${SECRET}` }] }],
    }),
  })
}

describe('proxy local redaction chain (loopback, no real provider)', () => {
  test('redacts the request before it reaches the upstream', async () => {
    const received: string[] = []
    const upstream = startUpstream(received, 'json')
    const proxy = startProxy()
    const id = await addProvider(upstream)
    enableRedaction()

    const response = await postMessage(proxy, id, false)

    expect(response.status).toBe(200)
    expect(received).toHaveLength(1)
    expect(received[0]).not.toContain(SECRET)
    expect(received[0]).toMatch(PLACEHOLDER_RE)
  })

  test('restores redacted values in a non-streaming response', async () => {
    const received: string[] = []
    const upstream = startUpstream(received, 'json')
    const proxy = startProxy()
    const id = await addProvider(upstream)
    enableRedaction()

    const response = await postMessage(proxy, id, false)
    const text = await response.text()

    expect(text).toContain(SECRET)
    expect(text).not.toMatch(PLACEHOLDER_RE)
  })

  test('restores redacted values in a streaming response', async () => {
    const received: string[] = []
    const upstream = startUpstream(received, 'sse')
    const proxy = startProxy()
    const id = await addProvider(upstream)
    enableRedaction()

    const response = await postMessage(proxy, id, true)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain(SECRET)
    expect(text).not.toMatch(PLACEHOLDER_RE)
  })

  test('restores redacted values in an upstream error body', async () => {
    const received: string[] = []
    const upstream = startUpstream(received, 'error')
    const proxy = startProxy()
    const id = await addProvider(upstream)
    enableRedaction()

    const response = await postMessage(proxy, id, false)
    const text = await response.text()

    expect(response.status).toBe(400)
    expect(text).toContain(SECRET)
    expect(text).not.toMatch(PLACEHOLDER_RE)
  })

  test('keeps an anthropic-format provider on the proxy instead of returning "proxy not needed"', async () => {
    const received: string[] = []
    const upstream = startUpstream(received, 'json')
    const proxy = startProxy()
    // A native anthropic endpoint normally short-circuits with "proxy not
    // needed". Redaction must keep it on the proxy instead.
    const id = await addProvider(upstream, true)
    enableRedaction()

    const response = await postMessage(proxy, id, false)
    const text = await response.text()

    expect(response.status).not.toBe(400)
    expect(text).not.toContain('proxy not needed')
    expect(received).toHaveLength(1)
  })

  test('fails closed: unreadable settings never reach the upstream', async () => {
    const received: string[] = []
    const upstream = startUpstream(received, 'json')
    const proxy = startProxy()
    const id = await addProvider(upstream)
    fs.writeFileSync(settingsPath(), '{ broken', 'utf8')

    const response = await postMessage(proxy, id, false)

    expect(response.status).toBe(503)
    expect(received).toHaveLength(0)
  })

  test('leaves the disabled path untouched (no redaction, no restore)', async () => {
    const received: string[] = []
    const upstream = startUpstream(received, 'json')
    const proxy = startProxy()
    const id = await addProvider(upstream)
    disableRedaction()

    const response = await postMessage(proxy, id, false)
    await response.text()

    expect(response.status).toBe(200)
    expect(received).toHaveLength(1)
    expect(received[0]).toContain(SECRET)
    expect(received[0]).not.toMatch(PLACEHOLDER_RE)
  })

  test('redacts and restores through the openai_chat protocol transform', async () => {
    const received: string[] = []
    const upstream = startUpstream(received, 'openai_chat')
    const proxy = startProxy()
    const id = await addProvider(upstream, false, 'openai_chat')
    enableRedaction()

    const response = await postMessage(proxy, id, false)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(received).toHaveLength(1)
    // The placeholder survives the Anthropic -> OpenAI chat transform.
    expect(received[0]).not.toContain(SECRET)
    expect(received[0]).toMatch(PLACEHOLDER_RE)
    // The OpenAI -> Anthropic transform returns the placeholder and the outer
    // restore layer turns it back into the original value.
    expect(text).toContain(SECRET)
    expect(text).not.toMatch(PLACEHOLDER_RE)
  })

  test('fails closed on a non-object JSON body instead of forwarding plaintext', async () => {
    const received: string[] = []
    const upstream = startUpstream(received, 'json')
    const proxy = startProxy()
    const id = await addProvider(upstream)
    enableRedaction()

    const response = await fetch(new URL(`/proxy/providers/${id}/v1/messages`, proxy.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ type: 'text', text: SECRET }]),
    })

    expect(response.status).toBe(400)
    expect(received).toHaveLength(0)
  })
})
