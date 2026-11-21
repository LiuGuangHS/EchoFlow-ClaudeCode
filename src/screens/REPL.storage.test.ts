import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

// Run the actual key handler without mounting the provider-connected REPL.
const source = ts.createSourceFile('REPL.tsx', readFileSync(new URL('./REPL.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers: string[] = []
function visit(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useInput') {
    const handler = node.arguments[0]
    if (handler && ts.isArrowFunction(handler) && handler.getText(source).includes('editorRenderingRef.current')) handlers.push(handler.getText(source))
  }
  ts.forEachChild(node, visit)
}
visit(source)
if (handlers.length !== 1) throw new Error('Expected exactly one transcript editor key handler')
const handlerCode = ts.transpileModule(`(${handlers[0]})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText

const fixture = `
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
// Dynamic destructuring preserves the production dependency names inside the evaluated handler.
const { writeFile } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { dirname, join } = await import('node:path')
const { ensurePrivateStorageTempRoot } = await import('./src/utils/cachePaths.ts')
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const mode = process.env.CASE
const temporary = join(binding.internalDir, 'tmp')
if (mode === 'linked') {
  mkdirSync(binding.internalDir, { recursive: true })
  mkdirSync(join(process.env.HOME, 'outside'))
  symlinkSync(join(process.env.HOME, 'outside'), temporary, 'dir')
}
const editorRenderingRef = { current: false }
const editorGenRef = { current: 1 }
const editorTimerRef = { current: undefined }
const deferredMessages = [{ fixture: 'not user data' }]
const tools = []
const dumpMode = false
let renders = 0
const renderMessagesToPlainText = async (messages, suppliedTools, width) => {
  renders++
  assert.equal(messages, deferredMessages)
  assert.equal(suppliedTools, tools)
  assert.ok(width >= 80)
  if (mode === 'render-error') throw new Error('fixture render failure')
  return 'fixture transcript  \\nsecond line\\t\\n'
}
const opened = []
const openFileInExternalEditor = path => { opened.push(path); return mode !== 'no-editor' }
let finish
const finished = new Promise(resolve => { finish = resolve })
const statuses = []
const setEditorStatus = status => {
  statuses.push(status)
  if (!status.startsWith('rendering ')) finish()
}
const setTimeout = () => 0
const clearTimeout = () => {}
// Only the checked-in handler transpiled above executes, in this isolated fixture; no user text is evaluated.
const handler = eval(${JSON.stringify(handlerCode)})
let stopped = 0
const event = { stopImmediatePropagation: () => stopped++ }
handler('v', {}, event)
handler('v', {}, event)
await finished
assert.equal(renders, 1, 'double-tap must not start another render')
assert.equal(stopped, 2)
assert.equal(editorRenderingRef.current, false)
if (mode === 'render-error' || mode === 'linked') {
  assert.deepEqual(opened, [])
  assert.ok(statuses.at(-1).startsWith('render failed: '))
  if (mode === 'render-error') {
    assert.equal(statuses.at(-1), 'render failed: fixture render failure')
    assert.equal(existsSync(temporary), false)
  } else assert.deepEqual(readdirSync(join(process.env.HOME, 'outside')), [])
} else {
  assert.equal(opened.length, 1, JSON.stringify(statuses))
  const file = opened[0]
  assert.equal(dirname(file), temporary)
  assert.equal(readFileSync(file, 'utf8'), 'fixture transcript\\nsecond line\\n')
  assert.equal(statuses.at(-1), mode === 'no-editor' ? 'wrote ' + file + ' · no $VISUAL/$EDITOR set' : 'opening ' + file)
}
`

for (const mode of ['success', 'no-editor', 'render-error', 'linked']) {
  test(`transcript editor key handler uses managed scratch (${mode})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'transcript-storage-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
        cwd: new URL('../../', import.meta.url).pathname,
        env: createSandboxedTestEnvironment(home, { CASE: mode, CLAUDE_CONFIG_DIR: join(home, 'product') }),
        encoding: 'utf8', timeout: 30_000,
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
