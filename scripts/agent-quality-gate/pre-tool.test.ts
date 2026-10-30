import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { classify, handlePreTool } from './pre-tool.js'
import { readState } from './state.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-quality-gate-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('classify', () => {
  test.each([
    ['Edit'],
    ['Write'],
    ['MultiEdit'],
    ['NotebookEdit'],
  ])('%s records an edit', tool => {
    const result = classify({ tool_name: tool, tool_input: { file_path: 'src/a.ts' } })
    expect(result).toEqual({ kind: 'edit', file: 'src/a.ts' })
  })

  test('a non-file tool is ignored', () => {
    expect(classify({ tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } })).toEqual({
      kind: 'ignore',
    })
  })

  test('a file tool without a path is ignored rather than recorded as nothing', () => {
    expect(classify({ tool_name: 'Edit', tool_input: {} })).toEqual({ kind: 'ignore' })
  })

  // NotebookEdit reports the file as notebook_path, never file_path. Reading the
  // wrong key would make every notebook edit invisible to the gate.
  test('NotebookEdit records the notebook it edits', () => {
    const result = classify({
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'notebooks/a.ipynb' },
    })
    expect(result).toEqual({ kind: 'edit', file: 'notebooks/a.ipynb' })
  })
})

describe('handlePreTool', () => {
  test('records the edited file', async () => {
    await handlePreTool(
      { session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } },
      dir,
    )
    const state = await readState('s1', dir)
    expect(state.editedFiles).toEqual(['src/a.ts'])
    expect(state.lastEditSeq).not.toBeNull()
    expect(state.lastTestSeq).toBeNull()
  })

  test('ignores unrelated tools without touching state', async () => {
    await handlePreTool({ session_id: 's1', tool_name: 'Read', tool_input: {} }, dir)
    const state = await readState('s1', dir)
    expect(state.seq).toBe(0)
  })

  test('ignores a request with no session id instead of writing a broken record', async () => {
    await handlePreTool({ tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } }, dir)
    expect(await readState('undefined', dir)).toMatchObject({ lastEditSeq: null })
    expect(await readState('', dir)).toMatchObject({ lastEditSeq: null })
  })

  // A hook fires before the command runs, so crediting here would count a
  // command that was denied, interrupted, or never started.
  test('does not credit a verification run before the command has executed', async () => {
    await handlePreTool(
      { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'bun test' } },
      dir,
    )
    expect((await readState('s1', dir)).lastTestSeq).toBeNull()
  })
})
