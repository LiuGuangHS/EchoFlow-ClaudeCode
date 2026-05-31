import { expect, it } from 'vitest'
import { buildSelectionComposerText } from './selectionComposer'

it('renders only the user instruction + concrete changes (no selector/DOM/page noise)', () => {
  const text = buildSelectionComposerText({
    pageUrl: 'http://127.0.0.1:4321/preview-fs/s1/index.html',
    sourceHint: 'index.html',
    element: { selector: '#title', tag: 'h1', text: '模型还没用熟', classes: [] } as never,
    change: { text: { from: '模型还没用熟', to: '模型用熟了' }, description: '标题改积极一点' } as never,
  })
  // 用户的话 + 具体改动在
  expect(text).toContain('标题改积极一点')
  expect(text).toContain('模型用熟了')
  // selector / 页面 URL / 「请在源码中落地」 等 DOM 噪音不在（截图才是引用）
  expect(text).not.toContain('#title')
  expect(text).not.toContain('index.html')
  expect(text).not.toContain('请在源码中落地')
})

it('returns empty text when there is no description or change (image alone is the reference)', () => {
  const text = buildSelectionComposerText({
    pageUrl: 'http://x/',
    element: { selector: '#t', tag: 'div', classes: [] } as never,
  })
  expect(text).toBe('')
})
