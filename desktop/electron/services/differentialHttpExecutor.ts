import type { IncomingMessage, RequestOptions } from 'node:http'
import { HttpExecutor, type DownloadOptions, type RequestHeaders } from 'builder-util-runtime'

type ByteRange = { start: number, end: number }
type ResponseLike = IncomingMessage & {
  statusCode?: number
  headers: Record<string, string | string[] | undefined>
}
type RequestLike = {
  abort?: () => void
  emit?: (event: string, ...args: unknown[]) => boolean
  end?: () => void
}

type DifferentialExecutorDelegate = Pick<HttpExecutor<any>, 'createRequest' | 'addErrorAndTimeoutHandlers'>

function parseHeader(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const value = headers[name.toLowerCase()] ?? headers[name]
  if (Array.isArray(value)) return value.at(-1) ?? null
  return value == null ? null : String(value)
}

function parseSingleRange(value: unknown): ByteRange | null {
  if (typeof value !== 'string') return null
  const match = /^bytes=(\d+)-(\d+)$/.exec(value.trim())
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end
    ? { start, end }
    : null
}

function assertSingleRangeResponse(response: ResponseLike, range: ByteRange) {
  if (response.statusCode !== 206) {
    throw new Error(`Differential range response must use 206, got ${response.statusCode}`)
  }
  if (parseHeader(response.headers, 'accept-ranges')?.toLowerCase() !== 'bytes') {
    throw new Error('Differential range response must advertise Accept-Ranges: bytes')
  }
  const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(parseHeader(response.headers, 'content-range') ?? '')
  if (!contentRange) {
    throw new Error('Differential range response is missing a valid Content-Range')
  }
  const start = Number(contentRange[1])
  const end = Number(contentRange[2])
  const total = Number(contentRange[3])
  if (![start, end, total].every(Number.isSafeInteger) || start !== range.start || end !== range.end || end >= total) {
    throw new Error(`Differential response Content-Range does not match requested bytes=${range.start}-${range.end}`)
  }
  const contentLength = Number(parseHeader(response.headers, 'content-length'))
  if (!Number.isSafeInteger(contentLength) || contentLength !== range.end - range.start + 1) {
    throw new Error(`Differential response Content-Length does not match requested range (${range.end - range.start + 1})`)
  }
}

export class DifferentialHttpExecutor extends HttpExecutor<any> {
  constructor(private readonly delegate: DifferentialExecutorDelegate) {
    super()
  }

  createRequest(
    options: RequestOptions & { headers?: RequestHeaders },
    callback: (response: ResponseLike) => void,
  ) {
    const rangeHeader = options.headers?.range ?? options.headers?.Range
    const range = parseSingleRange(rangeHeader)
    const hasMultipleRanges = typeof rangeHeader === 'string' && rangeHeader.includes(',')
    let request: RequestLike
    request = this.delegate.createRequest(options, response => {
      if (!range && !hasMultipleRanges) {
        callback(response)
        return
      }
      try {
        if (hasMultipleRanges) {
          throw new Error('Differential multiple ranges are not supported by the validated transport')
        }
        assertSingleRangeResponse(response, range!)
        callback(response)
      } catch (error) {
        if (request.emit) request.emit('error', error)
        else request.abort?.()
        response.destroy()
      }
    })
    return request
  }

  addErrorAndTimeoutHandlers(request: any, reject: (error: Error) => void, timeout?: number) {
    this.delegate.addErrorAndTimeoutHandlers(request, reject, timeout)
  }

  download(url: string, destination: string, options: DownloadOptions) {
    const delegate = this.delegate as DifferentialExecutorDelegate & {
      download?: (url: string, destination: string, options: DownloadOptions) => Promise<string>
    }
    if (!delegate.download) throw new Error('Differential executor delegate does not support downloads')
    return delegate.download(url, destination, options)
  }

  downloadToBuffer(url: URL, options: DownloadOptions) {
    return (this.delegate as DifferentialExecutorDelegate & {
      downloadToBuffer: (url: URL, options: DownloadOptions) => Promise<Buffer>
    }).downloadToBuffer(url, options)
  }
}

export function wrapDifferentialHttpExecutor(updater: { httpExecutor?: unknown }): boolean {
  const executor = updater.httpExecutor
  if (!executor || executor instanceof DifferentialHttpExecutor) return false
  if (typeof executor !== 'object' || executor === null) return false
  if (!('createRequest' in executor) || !('addErrorAndTimeoutHandlers' in executor)) return false
  updater.httpExecutor = new DifferentialHttpExecutor(executor as DifferentialExecutorDelegate)
  return true
}
