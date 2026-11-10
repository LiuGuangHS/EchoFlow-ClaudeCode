import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { DifferentialHttpExecutor, wrapDifferentialHttpExecutor } from './differentialHttpExecutor'

type FakeResponse = PassThrough & {
  statusCode: number
  headers: Record<string, string | string[]>
}

function response(statusCode: number, headers: Record<string, string | string[]>): FakeResponse {
  const stream = new PassThrough() as FakeResponse
  stream.statusCode = statusCode
  stream.headers = headers
  return stream
}

function fixture() {
  const request = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> }
  request.end = vi.fn()
  let responseHandler: ((response: FakeResponse) => void) | null = null
  const base = {
    createRequest: vi.fn((_options: unknown, handler: (response: FakeResponse) => void) => {
      responseHandler = handler
      return request
    }),
    addErrorAndTimeoutHandlers: vi.fn((value: EventEmitter, reject: (error: Error) => void) => {
      value.once('error', reject)
    }),
    download: vi.fn(),
    downloadToBuffer: vi.fn(),
  }
  return {
    base,
    request,
    emitResponse: (value: FakeResponse, body = Buffer.alloc(0)) => {
      responseHandler?.(value)
      if (value.listenerCount('error') === 0) value.on('error', () => {})
      if (body.length > 0) value.write(body)
      value.end()
    },
  }
}

function observe(executor: DifferentialHttpExecutor, options: { range?: string }) {
  return new Promise<void>((resolve, reject) => {
    const request = executor.createRequest({ headers: options.range ? { range: options.range } : {} }, response => {
      response.once('error', reject)
      response.once('end', resolve)
      response.resume()
    })
    executor.addErrorAndTimeoutHandlers(request, reject)
    request.end()
  })
}

describe('DifferentialHttpExecutor', () => {
  it('passes a valid single-range response through', async () => {
    const fixtureValue = fixture()
    const executor = new DifferentialHttpExecutor(fixtureValue.base)
    const observed = observe(executor, { range: 'bytes=32-63' })

    fixtureValue.emitResponse(response(206, {
      'accept-ranges': 'bytes',
      'content-range': 'bytes 32-63/96',
      'content-length': '32',
    }), Buffer.alloc(32))

    await expect(observed).resolves.toBeUndefined()
  })

  it('rejects a single-range response with a mismatched Content-Range', async () => {
    const fixtureValue = fixture()
    const executor = new DifferentialHttpExecutor(fixtureValue.base)
    const observed = observe(executor, { range: 'bytes=32-63' })

    fixtureValue.emitResponse(response(206, {
      'accept-ranges': 'bytes',
      'content-range': 'bytes 0-31/96',
      'content-length': '32',
    }))

    await expect(observed).rejects.toThrow('Content-Range')
  })

  it.each([
    ['a 200 response', 200, { 'content-length': '32' }, '206'],
    ['a response without Accept-Ranges', 206, { 'content-range': 'bytes 32-63/96', 'content-length': '32' }, 'Accept-Ranges'],
    ['a response with the wrong Content-Length', 206, { 'accept-ranges': 'bytes', 'content-range': 'bytes 32-63/96', 'content-length': '31' }, 'Content-Length'],
  ])('rejects %s', async (_name, statusCode, headers, message) => {
    const fixtureValue = fixture()
    const executor = new DifferentialHttpExecutor(fixtureValue.base)
    const observed = observe(executor, { range: 'bytes=32-63' })

    fixtureValue.emitResponse(response(statusCode, headers))

    await expect(observed).rejects.toThrow(message)
  })

  it('rejects a single-range body whose bytes do not match Content-Length', async () => {
    const fixtureValue = fixture()
    const executor = new DifferentialHttpExecutor(fixtureValue.base)
    const observed = observe(executor, { range: 'bytes=32-63' })

    fixtureValue.emitResponse(response(206, {
      'accept-ranges': 'bytes',
      'content-range': 'bytes 32-63/96',
      'content-length': '32',
    }), Buffer.alloc(31))

    await expect(observed).rejects.toThrow('body length')
  })

  it('passes non-range responses to the original callback unchanged', async () => {
    const fixtureValue = fixture()
    const executor = new DifferentialHttpExecutor(fixtureValue.base)
    const observed = observe(executor, {})
    const received = response(200, { 'content-length': '4' })

    fixtureValue.emitResponse(received)

    await expect(observed).resolves.toBeUndefined()
    expect(fixtureValue.base.createRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects multipart ranges so the updater can use the full-package fallback', async () => {
    const fixtureValue = fixture()
    const executor = new DifferentialHttpExecutor(fixtureValue.base)
    const observed = observe(executor, { range: 'bytes=0-31,64-95' })

    fixtureValue.emitResponse(response(206, {
      'accept-ranges': 'bytes',
      'content-type': 'multipart/byteranges; boundary=range-boundary',
    }))

    await expect(observed).rejects.toThrow('multiple ranges')
  })

  it('wraps an updater executor once and preserves the delegate for non-range requests', () => {
    const fixtureValue = fixture()
    const updater = { httpExecutor: fixtureValue.base as never }

    expect(wrapDifferentialHttpExecutor(updater)).toBe(true)
    expect(wrapDifferentialHttpExecutor(updater)).toBe(true)
    expect(updater.httpExecutor).toBeInstanceOf(DifferentialHttpExecutor)
  })

  it.each([undefined, {}, { createRequest: true, addErrorAndTimeoutHandlers() {} }])('refuses an unusable executor', executor => {
    expect(wrapDifferentialHttpExecutor({ httpExecutor: executor })).toBe(false)
  })

  it('fails closed when the executor cannot be replaced', () => {
    const original = fixture().base
    const updater = Object.freeze({ httpExecutor: original })
    expect(wrapDifferentialHttpExecutor(updater)).toBe(false)
    expect(updater.httpExecutor).toBe(original)
  })

  it.each(['aborted', 'error', 'close'])('rejects a response %s without reporting end', async event => {
    const value = fixture()
    const observed = observe(new DifferentialHttpExecutor(value.base), { range: 'bytes=32-63' })
    const stream = response(206, {
      'accept-ranges': 'bytes',
      'content-range': 'bytes 32-63/96',
      'content-length': '32',
    })
    value.base.createRequest.mock.calls[0]![1](stream)
    stream.emit(event, new Error('transport failed'))
    await expect(observed).rejects.toThrow()
  })

  it('preserves request identity and redirect events for Electron followRedirect', () => {
    const value = fixture()
    const followRedirect = vi.fn()
    Object.assign(value.request, { followRedirect })
    const request = new DifferentialHttpExecutor(value.base).createRequest({}, () => {})
    expect(request).toBe(value.request)
    value.request.on('redirect', () => (request as typeof value.request & { followRedirect(): void }).followRedirect())
    value.request.emit('redirect', 302, 'GET', 'https://example.test/update')
    expect(followRedirect).toHaveBeenCalledOnce()
  })

  it('delegates complete-package downloads to the original executor', async () => {
    const fixtureValue = fixture()
    const destination = '/tmp/update.exe'
    fixtureValue.base.download.mockResolvedValue(destination)
    const executor = new DifferentialHttpExecutor(fixtureValue.base)

    await expect((executor as any).download('https://example.test/update.exe', destination, { cancellationToken: {} }))
      .resolves.toBe(destination)
    expect(fixtureValue.base.download).toHaveBeenCalledWith(
      'https://example.test/update.exe',
      destination,
      { cancellationToken: {} },
    )
  })

  it('delegates metadata buffer downloads to the original executor', async () => {
    const fixtureValue = fixture()
    const options = { cancellationToken: {} }
    const buffer = Buffer.from('blockmap')
    fixtureValue.base.downloadToBuffer.mockResolvedValue(buffer)
    const executor = new DifferentialHttpExecutor(fixtureValue.base)

    await expect(executor.downloadToBuffer(new URL('https://example.test/blockmap'), options as any))
      .resolves.toBe(buffer)
    expect(fixtureValue.base.downloadToBuffer).toHaveBeenCalledWith(expect.any(URL), options)
  })
})
