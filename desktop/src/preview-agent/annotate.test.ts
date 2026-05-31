import { describe, expect, it, vi } from 'vitest'
import { computeAnnotationRect, drawAnnotation } from './annotate'

// ---------------------------------------------------------------------------
// computeAnnotationRect
// ---------------------------------------------------------------------------

describe('computeAnnotationRect', () => {
  it('(a) maps element rect relative to body rect at scale 1', () => {
    const box = computeAnnotationRect(
      { left: 100, top: 50, width: 80, height: 40 },
      { left: 0, top: 0, width: 1000, height: 2000 },
      1,
    )
    expect(box).toEqual({ x: 100, y: 50, w: 80, h: 40 })
  })

  it('(b) cancels scroll — scrolled body with top:-200 gives correct page-offset y', () => {
    // body rect top = -200 means page has scrolled 200px down
    const box = computeAnnotationRect(
      { left: 100, top: 50, width: 80, height: 40 },
      { left: 0, top: -200, width: 1000, height: 2000 },
      1,
    )
    expect(box).toEqual({ x: 100, y: 250, w: 80, h: 40 })
  })

  it('(c) scale 2 doubles all four values', () => {
    const box = computeAnnotationRect(
      { left: 100, top: 50, width: 80, height: 40 },
      { left: 0, top: 0, width: 1000, height: 2000 },
      2,
    )
    expect(box).toEqual({ x: 200, y: 100, w: 160, h: 80 })
  })
})

// ---------------------------------------------------------------------------
// drawAnnotation — mock 2d context
// ---------------------------------------------------------------------------

function makeMockCtx() {
  return {
    // mutable props
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: '' as CanvasRenderingContext2D['textAlign'],
    textBaseline: '' as CanvasRenderingContext2D['textBaseline'],
    // mock functions
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

describe('drawAnnotation', () => {
  it('draws the selection outline and badge with expected calls', () => {
    const ctx = makeMockCtx()
    drawAnnotation(ctx as unknown as CanvasRenderingContext2D, { x: 10, y: 20, w: 30, h: 40 }, 1)

    // selection outline must be stroked
    expect(ctx.stroke).toHaveBeenCalled()

    // badge: arc(cx, cy, radius, ...) — cx = x + w/2 = 10 + 15 = 25, cy = y = 20, radius = 13
    expect(ctx.arc).toHaveBeenCalled()
    const arcCall = ctx.arc.mock.calls[0]
    expect(arcCall?.[0]).toBe(25)   // cx
    expect(arcCall?.[1]).toBe(20)   // cy
    expect(arcCall?.[2]).toBe(13)   // radius

    // fillText('1', cx, cy)
    expect(ctx.fillText).toHaveBeenCalled()
    const textCall = ctx.fillText.mock.calls[0]
    expect(textCall?.[0]).toBe('1')
    expect(textCall?.[1]).toBe(25)
    expect(textCall?.[2]).toBe(20)
  })
})
