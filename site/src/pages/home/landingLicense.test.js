import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const content = readFileSync(new URL('./landingContent.ts', import.meta.url), 'utf8')

test('both license FAQs refer to the retained root and third-party notices', () => {
  assert.equal(content.match(/LICENSE 与 THIRD_PARTY_LICENSES\.md/g)?.length, 1)
  assert.equal(content.match(/LICENSE and THIRD_PARTY_LICENSES\.md/g)?.length, 1)
  assert.doesNotMatch(content, /Community Source License|LICENSING\.md/)
})
