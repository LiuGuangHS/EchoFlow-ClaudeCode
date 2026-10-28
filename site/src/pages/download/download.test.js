import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

const pageSource = await readFile(new URL('./DownloadPage.tsx', import.meta.url), 'utf8')
const styleSource = await readFile(new URL('./download.css', import.meta.url), 'utf8')

describe('download page theme contract', () => {
  test('uses the shared documentation theme shell and theme stylesheet', () => {
    assert.match(pageSource, /import ['"]\.\.\/\.\.\/docs\/doc-wandor\.css['"]/)
    assert.match(pageSource, /className="docs-site dl-site"/)
    assert.match(pageSource, /className="u-skip"/)
  })

  test('keeps the shared responsive breakpoints and token-backed surfaces', () => {
    assert.match(styleSource, /@media \(max-width: 1180px\)/)
    assert.match(styleSource, /@media \(max-width: 900px\)/)
    assert.match(styleSource, /@media \(max-width: 620px\)/)
    assert.match(styleSource, /var\(--brand\)/)
    assert.match(styleSource, /var\(--surface\)/)
    assert.match(styleSource, /var\(--ink\)/)
  })
})
