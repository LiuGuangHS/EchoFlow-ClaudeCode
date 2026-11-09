import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const content = read('site/src/pages/home/landingContent.ts')
const readmes = ['README.md', 'README.en.md', 'README.zh-CN.md']
const computerUseDocs = ['docs/internals/computer-use.md', 'docs/en/internals/computer-use.md']

test('both license FAQs describe the root scope and retained third-party notices', () => {
  assert.equal(content.match(/LICENSE 与 THIRD_PARTY_LICENSES\.md/g)?.length, 1)
  assert.equal(content.match(/LICENSE and THIRD_PARTY_LICENSES\.md/g)?.length, 1)
  assert.match(content, /仅保留 EchoFlow Code 原创内容的全部权利/)
  assert.match(content, /reserves all rights in original EchoFlow Code work only/)
  assert.match(content, /不授予第三方代码许可/)
  assert.match(content, /does not license third-party code/)
})

test('license descriptions do not refer to withdrawn terms or missing license files', () => {
  for (const path of [...readmes, 'CONTRIBUTING.md', ...computerUseDocs, 'site/src/pages/home/landingContent.ts']) {
    const text = read(path)
    assert.doesNotMatch(text, /Community[ _]Source|LICENSING\.md/, path)
    for (const [, target] of text.matchAll(/\]\(([^)\s]*(?:LICENSE|LICENSING)[^)\s]*)\)/g)) {
      assert.ok(existsSync(new URL(target, root)), `${path}: missing ${target}`)
    }
  }
  for (const path of [...readmes, 'CONTRIBUTING.md']) {
    assert.match(read(path), /\]\(LICENSE\)/, path)
    assert.match(read(path), /\]\(THIRD_PARTY_LICENSES\.md\)/, path)
  }
  for (const path of readmes) {
    assert.match(read(path), /signed by LiuGuangHS \/ EchoFlow Code|由 LiuGuangHS \/ EchoFlow Code 签署/, path)
    assert.match(read(path), /original EchoFlow Code work only|仅保留 EchoFlow Code 原创内容的全部权利/, path)
  }
})

test('native Apache-2.0 attribution and packaged notices remain documented', () => {
  for (const path of readmes) {
    assert.match(read(path), /Apache-2\.0[^\n]*\]\(native\/agent-desktop\/LICENSE\)/, path)
  }
  for (const path of computerUseDocs) {
    const text = read(path)
    assert.match(text, /Apache-2\.0/, path)
    for (const notice of ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES', 'UPSTREAM.json', 'PATCHES.md']) {
      assert.ok(text.includes(`\`${notice}\``), `${path}: missing ${notice}`)
    }
  }
})
