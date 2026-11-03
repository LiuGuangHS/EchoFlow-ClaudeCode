import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

const pageSource = await readFile(new URL('./DownloadPage.tsx', import.meta.url), 'utf8')
const styleSource = await readFile(new URL('./download.css', import.meta.url), 'utf8')

describe('download page theme contract', () => {
  test('does not pass the React click event as the candidate list', () => {
    assert.match(pageSource, /onClick=\{\(\) => handleDownload\(\)\}/)
  })

  test('uses the shared documentation theme shell and theme stylesheet', () => {
    assert.match(pageSource, /import ['"]\.\.\/\.\.\/docs\/doc-wandor\.css['"]/)
    assert.match(pageSource, /className="docs-site dl-site"/)
    assert.match(pageSource, /className="u-skip"/)
  })

  test('places the download picker beside the introduction on desktop and stacks it first on narrow screens', () => {
    assert.match(styleSource, /grid-template-columns: minmax\(0, 0\.9fr\) minmax\(0, 1\.1fr\)/)
    assert.match(styleSource, /\.dl-page__head\s*\{[^}]*grid-column: 1;[^}]*grid-row: 1;/s)
    assert.match(styleSource, /\.dl-picker,\s*\.dl-empty\s*\{[^}]*grid-column: 2;[^}]*grid-row: 1 \/ span 2;/s)
    assert.match(styleSource, /@media \(max-width: 900px\)[\s\S]*?\.dl-picker,\s*\.dl-empty\s*\{\s*grid-column: 1;\s*grid-row: 2;/)
    assert.match(styleSource, /\.dl-content__intro\s*\{[^}]*grid-row: 3;/s)
    assert.match(pageSource, /!en && manifest\?\.summary/)
    assert.match(pageSource, /className="dl-release-summary"/)
  })

  test('retains shared breakpoints and theme tokens', () => {
    assert.match(styleSource, /@media \(max-width: 1180px\)/)
    assert.match(styleSource, /@media \(max-width: 900px\)/)
    assert.match(styleSource, /@media \(max-width: 620px\)/)
    assert.match(styleSource, /var\(--brand\)/)
    assert.match(styleSource, /var\(--surface\)/)
    assert.match(styleSource, /var\(--ink\)/)
  })
})
