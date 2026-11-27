import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
const mode = process.env.CASE
if (mode === 'linked') {
  mkdirSync(binding.internalDir, { recursive: true })
  mkdirSync(join(process.env.HOME, 'outside'))
  symlinkSync(join(process.env.HOME, 'outside'), temporary, 'dir')
}
mock.module('./src/utils/config.ts', () => ({ getGlobalConfig: () => ({}), saveGlobalConfig: () => { throw new Error('unexpected settings write') } }))
mock.module('./src/services/analytics/index.ts', () => ({ logEvent: () => {} }))
let copied
mock.module('./src/ink/termio/osc.ts', () => ({ setClipboard: async text => { copied = text; return '' } }))
mock.module('./src/utils/messages.ts', () => ({
  extractTextContent: blocks => blocks.filter(block => block.type === 'text').map(block => block.text).join('\\n\\n'),
  stripPromptXMLTags: text => text,
}))
for (const [module, name] of [
  ['./src/components/CustomSelect/select.tsx', 'Select'],
  ['./src/components/design-system/Byline.tsx', 'Byline'],
  ['./src/components/design-system/KeyboardShortcutHint.tsx', 'KeyboardShortcutHint'],
  ['./src/components/design-system/Pane.tsx', 'Pane'],
]) mock.module(module, () => ({ [name]: () => null }))
mock.module('./src/ink.ts', () => ({ Box: () => null, Text: () => null }))
const { call } = await import('./src/commands/copy/copy.tsx')
let result
const text = 'fixture response, not user data'
await call(value => { result = value }, {
  messages: mode === 'empty' ? [] : [{ type: 'assistant', message: { content: [{ type: 'text', text }] } }],
}, '')
if (mode === 'empty') {
  assert.equal(result, 'No assistant message to copy')
  assert.equal(copied, undefined)
  assert.equal(existsSync(temporary), false)
} else if (mode === 'linked') {
  assert.equal(copied, text)
  assert.equal(result, 'Copied to clipboard (' + text.length + ' characters, 1 lines)')
  assert.deepEqual(readdirSync(join(process.env.HOME, 'outside')), [])
} else {
  const file = join(temporary, 'response.md')
  assert.equal(copied, text)
  assert.ok(result.endsWith('Also written to ' + file), result)
  assert.equal(readFileSync(file, 'utf8'), text)
  if (process.platform !== 'win32') assert.equal(lstatSync(temporary).mode & 0o777, 0o700)
}
`

for (const mode of ['response', 'empty', 'linked']) {
  test(`/copy fallback files stay in the selected root (${mode})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'copy-storage-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
        cwd: new URL('../../../', import.meta.url).pathname,
        env: createSandboxedTestEnvironment(home, { CASE: mode, CLAUDE_CONFIG_DIR: join(home, 'product') }),
        encoding: 'utf8', timeout: 30_000,
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
