import html2canvas from 'html2canvas'
import { compressDataUrl } from '../lib/imageCompress'
import { computeAnnotationRect, drawAnnotation } from './annotate'

export type CaptureKind = 'full' | 'viewport' | 'element'

export async function captureToDataUrl(kind: CaptureKind, element?: Element): Promise<string> {
  const target = (kind === 'element' && element ? element : document.body) as HTMLElement
  const canvas = await html2canvas(target, {
    ...(kind === 'viewport'
      ? { windowWidth: window.innerWidth, height: window.innerHeight }
      : {}),
    useCORS: true,
    logging: false,
  })
  return compressDataUrl(canvas.toDataURL('image/png'))
}

/** Full-page screenshot with the picked element's region annotated (blue box + numbered badge). 图4 */
export async function captureAnnotatedRegion(el: Element, label = 1): Promise<string> {
  const elementRect = el.getBoundingClientRect()
  const bodyRect = document.body.getBoundingClientRect()
  const canvas = await html2canvas(document.body, { useCORS: true, logging: false, scale: 1 })
  const ctx = canvas.getContext('2d')
  if (ctx) drawAnnotation(ctx, computeAnnotationRect(elementRect, bodyRect, 1), label)
  return compressDataUrl(canvas.toDataURL('image/png'))
}
