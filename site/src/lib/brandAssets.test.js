import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (relative) => readFile(new URL(relative, import.meta.url))

test('public brand icon and social metadata use the official desktop identity', async () => {
  assert.equal(
    (await read('../../../docs/images/app-icon.png')).equals(await read('../../../desktop/public/app-icon.png')),
    true,
    'Refresh the docs compatibility icon from desktop/public/app-icon.png'
  )
  const shell = String(await read('../../index.html'))
  assert.match(shell, /rel="icon" href="\/images\/app-icon\.png"/)
  assert.match(shell, /property="og:image" content="https:\/\/code\.echoflow\.cn\/images\/app-icon\.png"/)
  assert.match(shell, /name="twitter:card" content="summary"/)
})
