import assert from 'node:assert/strict'
import { test } from 'node:test'
import { llmsIndex, markdownPath, renderStaticDoc } from '../../scripts/static-docs.mjs'

const records = [
  { sourcePath: 'docs/en/start/index.md', path: '/en/start', locale: 'en', section: 'start', title: 'Overview', description: 'Product overview' },
  { sourcePath: 'docs/en/desktop/index.md', path: '/en/desktop', locale: 'en', section: 'desktop', title: 'Desktop', description: 'Desktop features' }
]

test('static Markdown exposes prose, resolves source-relative links and images, and rejects active content', () => {
  const body = '# Overview\n\nReadable answer. [Desktop](../desktop/index.md#features) ![UI](../../images/app/en/session-main.webp)\n\n<script>alert(1)</script>\n\n[bad](javascript:alert)'
  const html = renderStaticDoc({ ...records[0], body }, records)
  assert.match(html, /<h1 id="overview">Overview<\/h1>/)
  assert.match(html, /Readable answer/)
  assert.match(html, /href="\/en\/desktop#features"/)
  assert.match(html, /src="\/images\/app\/en\/session-main.webp"/)
  assert.doesNotMatch(html, /<script>|href="javascript:/)
  assert.match(html, /&lt;script&gt;/)
})

test('English docs resolve a shared diagram outside their locale directory', () => {
  const html = renderStaticDoc({
    ...records[0],
    sourcePath: 'docs/en/internals/agent.md',
    path: '/en/internals/agent',
    body: '![Overview](../../internals/images/01-agent-overview.png)',
  }, records)
  assert.match(html, /src="\/internals\/images\/01-agent-overview.png"/)
})

test('machine-readable index preserves source directories and bilingual section grouping', () => {
  assert.equal(markdownPath(records[0]), '/en/start/index.md')
  const index = llmsIndex(records, 'https://code.echoflow.cn')
  assert.match(index, /## en \/ start/)
  assert.match(index, /\[Overview\]\(https:\/\/code.echoflow.cn\/en\/start\/index.md\): Product overview/)
})
