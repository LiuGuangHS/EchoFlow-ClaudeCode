import { getDesktopHost } from '../lib/desktopHost'
import { isPublicAccessRuntime } from '../lib/publicAccessRuntime'

const ENV_BASE_URL =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env?.VITE_DESKTOP_SERVER_URL === 'string' &&
  import.meta.env.VITE_DESKTOP_SERVER_URL.length > 0
    ? import.meta.env.VITE_DESKTOP_SERVER_URL
    : undefined

const DEFAULT_BASE_URL = ENV_BASE_URL || 'http://127.0.0.1:3456'

let baseUrl = DEFAULT_BASE_URL
let authToken: string | null = null
let desktopServerRecovery: Promise<string> | null = null
const DIAGNOSTICS_PATH = '/api/diagnostics/events'
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const DIAGNOSTICS_REQUEST_TIMEOUT_MS = 5_000

function getErrorMessage(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message
  }

  if (typeof body === 'string' && body.trim().length > 0) {
    return body
  }

  return `API error ${status}`
}

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '')
}

export function getBaseUrl() {
  return baseUrl
}

export function getApiUrl(pathOrUrl: string) {
  try {
    return new URL(pathOrUrl).toString()
  } catch {
    const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
    return `${baseUrl}${normalizedPath}`
  }
}

export function setAuthToken(token: string | null) {
  const trimmed = token?.trim() ?? ''
  authToken = trimmed.length > 0 ? trimmed : null
}

export function getAuthToken() {
  return authToken
}

export function getDefaultBaseUrl() {
  return DEFAULT_BASE_URL
}

export function hasExplicitDefaultBaseUrl() {
  return Boolean(ENV_BASE_URL)
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(getErrorMessage(status, body))
    this.name = 'ApiError'
  }
}

/**
 * Chromium turns a response body larger than V8's maximum string length
 * (2^29 - 24 = 536,870,888 characters) into an *empty* string rather than
 * throwing, so the failure surfaces as a bare `Unexpected end of JSON input`
 * with no status — indistinguishable from real corruption. This carries the
 * numbers that tell the two apart.
 *
 * Character count can never exceed byte count for UTF-8, so a byte ceiling is
 * a safe proxy for the string limit. It sits just under the real cap (530 MB
 * vs 536,870,888 chars) so a body that could still be parsed is not refused.
 */
const MAX_JSON_RESPONSE_BYTES = 530_000_000

export class ApiResponseParseError extends Error {
  readonly bytes: number
  readonly readChars: number
  readonly contentType: string | null

  constructor(details: {
    bytes: number
    readChars: number
    contentType: string | null
  }) {
    super('The server response could not be parsed as JSON.')
    this.name = 'ApiResponseParseError'
    this.bytes = details.bytes
    this.readChars = details.readChars
    this.contentType = details.contentType
  }

  /** The response was bigger than any string this runtime can hold. */
  get tooLarge(): boolean {
    return this.bytes >= MAX_JSON_RESPONSE_BYTES
  }

  /**
   * A 200 whose body read back as nothing. When no size was declared this is
   * what an over-limit body looks like from here (Blink returns an empty
   * string), but a truncated transfer can produce the same shape — hence a
   * separate flag rather than folding it into `tooLarge`.
   */
  get emptyBody(): boolean {
    return this.readChars === 0
  }
}

export type ApiRequestOptions = {
  timeout?: number
  signal?: AbortSignal
}

async function request<T>(method: string, path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const abortFromCaller = () => controller.abort(options?.signal?.reason)
  if (options?.signal?.aborted) abortFromCaller()
  else options?.signal?.addEventListener('abort', abortFromCaller, { once: true })
  try {
    const fetchOnce = () => fetch(`${baseUrl}${path}`, {
      method,
      headers: buildHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    let res: Response
    try {
      res = await fetchOnce()
    } catch (error) {
      if (
        method !== 'GET' ||
        timedOut ||
        options?.signal?.aborted ||
        !(error instanceof TypeError) ||
        !await recoverDesktopServerUrl()
      ) {
        throw error
      }
      res = await fetchOnce()
    }
    if (!res.ok) {
      const errorBody = await res.json().catch(() => res.text())
      throw new ApiError(res.status, errorBody)
    }

    if (res.status === 204) return undefined as T
    return await readJsonBody<T>(res)
  } catch (err) {
    if (timedOut) {
      const timeoutError = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
      reportApiFailure(method, path, timeoutError)
      throw timeoutError
    }
    if (options?.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException('The operation was aborted', 'AbortError')
    }
    reportApiFailure(method, path, err)
    throw err
  } finally {
    clearTimeout(timeout)
    options?.signal?.removeEventListener('abort', abortFromCaller)
  }
}

async function readJsonBody<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type')
  const declaredLength = Number.parseInt(res.headers.get('content-length') ?? '', 10)
  const declaredBytes = Number.isFinite(declaredLength) && declaredLength > 0
    ? declaredLength
    : 0

  // Refuse an oversized body before it is downloaded: this runtime cannot turn
  // one into a string, so reading it would only burn memory to produce the same
  // answer.
  if (declaredBytes >= MAX_JSON_RESPONSE_BYTES) {
    throw new ApiResponseParseError({
      bytes: declaredBytes,
      readChars: 0,
      contentType,
    })
  }

  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    // A truncated or empty body has no status to report: the request itself
    // succeeded, so the byte counts are the only usable evidence.
    throw new ApiResponseParseError({
      bytes: declaredBytes || text.length,
      readChars: text.length,
      contentType,
    })
  }
}

async function recoverDesktopServerUrl(): Promise<boolean> {
  const host = getDesktopHost()
  if (!host.isDesktop) return false

  if (!desktopServerRecovery) {
    const recovery = Promise.all([
      host.runtime.getServerUrl(),
      host.runtime.getLocalAccessToken().catch(() => null),
    ]).then(([serverUrl, localAccessToken]) => {
      setBaseUrl(serverUrl)
      setAuthToken(localAccessToken)
      return serverUrl
    })
    const trackedRecovery = recovery.finally(() => {
      if (desktopServerRecovery === trackedRecovery) desktopServerRecovery = null
    })
    desktopServerRecovery = trackedRecovery
  }

  await desktopServerRecovery
  return true
}

function reportApiFailure(method: string, path: string, error: unknown) {
  if (path.startsWith('/api/diagnostics')) return

  const details: Record<string, unknown> = {
    method,
    path,
    errorName: error instanceof Error ? error.name : typeof error,
    message: sanitizeDiagnosticValue(error instanceof Error ? error.message : String(error)),
  }

  if (error instanceof ApiError) {
    details.status = error.status
    details.response = sanitizeDiagnosticValue(error.body)
  }

  if (error instanceof ApiResponseParseError) {
    details.bytes = error.bytes
    details.readChars = error.readChars
    details.contentType = error.contentType
    details.emptyBody = error.emptyBody
  }

  void rawRecordDiagnosticEvent({
    type: 'client_api_request_failed',
    severity: 'warn',
    summary: `${method} ${path} failed: ${details.message}`,
    details,
  })
}

export function rawRecordDiagnosticEvent(event: {
  type: string
  severity?: 'debug' | 'info' | 'warn' | 'error'
  summary: string
  sessionId?: string
  details?: unknown
}) {
  // Pairing material and remote content must never enter local diagnostics.
  if (isPublicAccessRuntime()) return Promise.resolve()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DIAGNOSTICS_REQUEST_TIMEOUT_MS)
  return fetch(`${baseUrl}${DIAGNOSTICS_PATH}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(event),
    signal: controller.signal,
  }).then(async response => {
    await response.arrayBuffer()
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timeout))
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  return headers
}

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (!authToken) return value

  if (typeof value === 'string') {
    return value.split(authToken).join('[redacted]')
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticValue(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeDiagnosticValue(entry)]),
    )
  }

  return value
}

/**
 * Read binary content through the same authenticated channel as `api.get`.
 *
 * Pointing an `<img src>` straight at an API endpoint does not work in the
 * packaged app: the renderer is loaded with `loadFile`, so the page origin is
 * `file://` and the image is a cross-origin subresource that can carry neither
 * the Authorization header nor a trusted Origin. The server's fetch-metadata
 * policy refuses exactly that shape (verified in a real `file://` page: the
 * image fires `error`). Fetching the bytes here and handing the DOM a blob URL
 * uses the credential path that already works for every other call.
 */
export async function apiGetBlob(path: string, options?: ApiRequestOptions): Promise<Blob> {
  const controller = new AbortController()
  const timeoutMs = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromCaller = () => controller.abort(options?.signal?.reason)
  if (options?.signal?.aborted) abortFromCaller()
  else options?.signal?.addEventListener('abort', abortFromCaller, { once: true })
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: buildHeaders(),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new ApiError(res.status, await res.text().catch(() => ''))
    }
    return await res.blob()
  } finally {
    clearTimeout(timeout)
    options?.signal?.removeEventListener('abort', abortFromCaller)
  }
}

export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) => request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}
