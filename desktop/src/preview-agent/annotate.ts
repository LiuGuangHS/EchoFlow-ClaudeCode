export type Box = { x: number; y: number; w: number; h: number }
export type RectLike = { left: number; top: number; width: number; height: number }

/**
 * Map an element's viewport rect into the html2canvas full-body capture's pixel coords.
 * Both rects are viewport-relative, so subtracting the body's rect yields the element's
 * offset within the captured body (scroll cancels out). Multiply by the capture scale.
 */
export function computeAnnotationRect(elementRect: RectLike, bodyRect: RectLike, scale = 1): Box {
  return {
    x: (elementRect.left - bodyRect.left) * scale,
    y: (elementRect.top - bodyRect.top) * scale,
    w: elementRect.width * scale,
    h: elementRect.height * scale,
  }
}

const ACCENT = '#2f7bff'

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Draw a blue rounded selection box + a numbered badge centered on the top edge (图4). */
export function drawAnnotation(ctx: CanvasRenderingContext2D, box: Box, label: number | string = 1, scale = 1): void {
  ctx.save()
  ctx.lineWidth = Math.max(2, Math.round(3 * scale))
  ctx.strokeStyle = ACCENT
  roundRectPath(ctx, box.x, box.y, box.w, box.h, 6 * scale)
  ctx.stroke()
  const cx = box.x + box.w / 2
  const cy = box.y
  const radius = 13 * scale
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = ACCENT
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.round(14 * scale)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(label), cx, cy)
  ctx.restore()
}
