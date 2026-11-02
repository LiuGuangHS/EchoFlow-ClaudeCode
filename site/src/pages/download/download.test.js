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

  test('prioritizes downloads on narrow screens and keeps the release summary version-bound', () => {
    assert.match(styleSource, /\.dl-picker,\s*\.dl-empty\s*\{\s*order: 0;/)
    assert.match(styleSource, /\.dl-release-summary\s*\{[^}]*order: 1;/s)
    assert.match(styleSource, /\.dl-content__intro\s*\{\s*order: 2;/)
    assert.match(styleSource, /@media \(max-width: 900px\)[\s\S]*?\.dl-release-summary\s*\{\s*grid-column: 1;/)
    assert.match(pageSource, /!en && manifest\?\.summary/)
    assert.match(pageSource, /className="dl-release-summary"/)
  })

  test('tightens the first-screen spacing while retaining shared breakpoints and theme tokens', () => {
    assert.match(styleSource, /padding: clamp\(44px, 5vw, 72px\).*56px;/)
    assert.match(styleSource, /margin-bottom: clamp\(32px, 4vw, 56px\)/)
    assert.match(styleSource, /@media \(max-width: 1180px\)/)
    assert.match(styleSource, /@media \(max-width: 900px\)/)
    assert.match(styleSource, /@media \(max-width: 620px\)/)
    assert.match(styleSource, /var\(--brand\)/)
    assert.match(styleSource, /var\(--surface\)/)
    assert.match(styleSource, /var\(--ink\)/)
  })
})
