import type { ElementMetadata } from '../preview-agent/metadata'
import type { EditDiff } from '../preview-agent/popover'

export type SelectionPayload = {
  pageUrl: string; sourceHint?: string
  element: ElementMetadata
  change?: EditDiff & { description?: string }
}

/**
 * 选中元素的「引用」由随附的圈选标注截图承载（截图里已把元素圈出来）。
 * 这里只产出用户的修改意见 + 具体改动（人话），**不再**把 selector / DOM 定位 /
 * computedStyles / 页面 URL 等写进输入框 —— 那些 DOM 噪音交互体验差，且图片已是引用。
 * 无描述、无改动时返回空串（让图片单独作为引用进输入框）。
 */
export function buildSelectionComposerText(p: SelectionPayload): string {
  const c = p.change
  const lines: string[] = []
  if (c?.description) lines.push(c.description)
  if (c?.text) lines.push(`- 文本：「${c.text.from}」→「${c.text.to}」`)
  if (c?.color) lines.push(`- 文字颜色：${c.color.from} → ${c.color.to}`)
  if (c?.background) lines.push(`- 背景：${c.background.from} → ${c.background.to}`)
  if (c?.opacity) lines.push(`- 不透明度：${c.opacity.from} → ${c.opacity.to}`)
  if (c?.fontFamily) lines.push(`- 字体：${c.fontFamily.from} → ${c.fontFamily.to}`)
  return lines.join('\n')
}
