import { describe, expect, it, vi, beforeEach } from 'vitest'

const html2canvasMock = vi.fn()
vi.mock('html2canvas', () => ({ default: (...args: unknown[]) => html2canvasMock(...args) }))
vi.mock('../lib/imageCompress', () => ({ compressDataUrl: vi.fn(async (d: string) => `c:${d}`) }))

import { captureToDataUrl, captureAnnotatedRegion } from './screenshot'
import { compressDataUrl } from '../lib/imageCompress'

function makeMockCtx() {
  return {
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: '' as CanvasRenderingContext2D['textAlign'],
    textBaseline: '' as CanvasRenderingContext2D['textBaseline'],
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
  }
}

beforeEach(() => {
  html2canvasMock.mockReset()
  html2canvasMock.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,RAW' })
  vi.mocked(compressDataUrl).mockClear()
})

describe('captureToDataUrl', () => {
  it('captures document.body for full and compresses the result', async () => {
    const out = await captureToDataUrl('full')
    expect(html2canvasMock).toHaveBeenCalledWith(document.body, expect.any(Object))
    expect(compressDataUrl).toHaveBeenCalledWith('data:image/png;base64,RAW')
    expect(out).toBe('c:data:image/png;base64,RAW')
  })
  it('captures the given element for element kind', async () => {
    const el = document.createElement('div')
    await captureToDataUrl('element', el)
    expect(html2canvasMock).toHaveBeenCalledWith(el, expect.any(Object))
  })
  it('falls back to document.body for element kind without element', async () => {
    await captureToDataUrl('element')
    expect(html2canvasMock).toHaveBeenCalledWith(document.body, expect.any(Object))
  })
  it('passes viewport height option for viewport kind', async () => {
    await captureToDataUrl('viewport')
    const opts = html2canvasMock.mock.calls[0]![1] as Record<string, unknown>
    expect(opts.height).toBe(window.innerHeight)
    expect(opts.windowWidth).toBe(window.innerWidth)
  })
})

describe('captureAnnotatedRegion', () => {
  it('calls html2canvas with document.body and scale:1', async () => {
    const ctx = makeMockCtx()
    html2canvasMock.mockResolvedValue({
      getContext: () => ctx as unknown as CanvasRenderingContext2D,
      toDataURL: () => 'data:image/png;base64,RAW',
      width: 1000,
      height: 2000,
    })
    const el = document.createElement('div')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 50, width: 80, height: 40,
      right: 180, bottom: 90, x: 100, y: 50,
      toJSON: () => ({}),
    } as DOMRect)

    await captureAnnotatedRegion(el, 1)

    expect(html2canvasMock).toHaveBeenCalledWith(document.body, expect.objectContaining({ scale: 1 }))
  })

  it('draws the annotation on the captured canvas (stroke and fillText called)', async () => {
    const ctx = makeMockCtx()
    html2canvasMock.mockResolvedValue({
      getContext: () => ctx as unknown as CanvasRenderingContext2D,
      toDataURL: () => 'data:image/png;base64,RAW',
      width: 1000,
      height: 2000,
    })
    const el = document.createElement('div')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 50, width: 80, height: 40,
      right: 180, bottom: 90, x: 100, y: 50,
      toJSON: () => ({}),
    } as DOMRect)

    await captureAnnotatedRegion(el, 1)

    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalled()
  })

  it('returns the compressed wrapper of the canvas dataURL', async () => {
    const ctx = makeMockCtx()
    html2canvasMock.mockResolvedValue({
      getContext: () => ctx as unknown as CanvasRenderingContext2D,
      toDataURL: () => 'data:image/png;base64,RAW',
      width: 1000,
      height: 2000,
    })
    const el = document.createElement('div')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 50, height: 50,
      right: 50, bottom: 50, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const result = await captureAnnotatedRegion(el, 1)

    expect(compressDataUrl).toHaveBeenCalledWith('data:image/png;base64,RAW')
    expect(result).toBe('c:data:image/png;base64,RAW')
  })
})
