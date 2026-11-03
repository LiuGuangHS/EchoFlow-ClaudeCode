import { Marked } from 'marked'

export function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// HTML 直出不经过浏览器 DOMPurify：禁用原始 HTML，并在链接边界拒绝可执行协议。
export function renderStaticDoc(record, records) {
  const source = record.sourcePath.replace(/^docs\//, '')
  const resolve = (href) => {
    if (/^(?:https?:|mailto:|#)/i.test(href)) return href
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null
    const url = new URL(href, `https://code.echoflow.cn/${source}`)
    const target = records.find((doc) => doc.sourcePath === `docs${decodeURIComponent(url.pathname)}`)
    return `${target?.path || url.pathname}${url.search}${url.hash}`
  }
  const headingCounts = new Map()
  const parser = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const content = this.parser.parseInline(tokens)
        const base = content.replace(/<[^>]*>/g, '').replace(/[*_`~]/g, '').toLowerCase()
          .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').trim().replace(/\s+/g, '-') || 'section'
        const count = headingCounts.get(base) || 0
        headingCounts.set(base, count + 1)
        return `<h${depth} id="${escapeHtml(count ? `${base}-${count}` : base)}">${content}</h${depth}>`
      },
      html: ({ text }) => escapeHtml(text),
      link({ href, tokens }) {
        const target = resolve(href)
        const label = this.parser.parseInline(tokens)
        return target ? `<a href="${escapeHtml(target)}">${label}</a>` : label
      },
      image({ href, text }) {
        const target = resolve(href)
        return target ? `<img src="${escapeHtml(target)}" alt="${escapeHtml(text)}" loading="lazy">` : escapeHtml(text)
      }
    }
  })
  return `<main><article>${parser.parse(record.body)}</article></main>`
}

export function markdownPath(record) {
  // index.md 仍用源文件路径，避免 /start.md 与相对文档链接的目录语义冲突。
  return `/${record.sourcePath.replace(/^docs\//, '')}`
}

export function llmsIndex(records, origin) {
  const sections = [...new Set(records.map((record) => `${record.locale}/${record.section}`))]
  return sections.map((section) => {
    const [locale, name] = section.split('/')
    return `## ${locale} / ${name}\n\n${records.filter((r) => r.locale === locale && r.section === name)
      .map((r) => `- [${r.title}](${origin}${markdownPath(r)}): ${r.description}`).join('\n')}`
  }).join('\n\n')
}
