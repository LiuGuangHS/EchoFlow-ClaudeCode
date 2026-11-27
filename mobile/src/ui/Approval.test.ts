import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { test } from 'bun:test'

test('Approval unlocks only its definite rejection, not unrelated errors or uncertain outcomes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mobile-approval-render-'))
  const script = `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    let state, rendered
    mock.module(${JSON.stringify(import.meta.resolve('react'))}, () => ({
      useState: (initial) => {
        state ??= initial
        return [state, (next) => { state = next }]
      },
    }))
    const jsx = (type, props) => ({ type, props })
    mock.module(${JSON.stringify(import.meta.resolve('react/jsx-dev-runtime'))}, () => ({ jsxDEV: jsx }))
    mock.module(${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}, () => ({ jsx, jsxs: jsx }))
    mock.module(${JSON.stringify(import.meta.resolve('./kit'))}, () => ({ Card: 'Card', Mono: 'Mono', useColors: () => ({}) }))
    mock.module(${JSON.stringify(import.meta.resolve('./Text'))}, () => ({ Text: 'Text' }))
    mock.module(${JSON.stringify(import.meta.resolve('./decision/PlanDecision'))}, () => ({ PlanDecision: 'PlanDecision' }))
    mock.module(${JSON.stringify(import.meta.resolve('./decision/PlanDocument'))}, () => ({ PlanDocument: 'PlanDocument' }))
    mock.module(${JSON.stringify(import.meta.resolve('./decision/QuestionDecision'))}, () => ({ QuestionDecision: 'QuestionDecision' }))
    mock.module(${JSON.stringify(import.meta.resolve('./decision/ToolDecision'))}, () => ({ ToolDecision: 'ToolDecision' }))
    const { Approval } = require(${JSON.stringify(import.meta.resolve('./Approval'))})
    let sends = 0
    const props = { request: { requestId: 'r', toolName: 'Read', input: {} }, ready: true, send: () => { sends++; return true } }
    const render = () => { rendered = Approval(props).props; return rendered }
    render().respond({ allowed: true })
    assert.equal(render().sent, true)
    props.serverError = { message: 'unrelated', code: 'RUNTIME_CONFIG_INVALID', requestId: 'other', permissionType: 'tool', approvalOutcome: 'rejected' }
    render()
    assert.equal(render().sent, true, 'unrelated rejection must not unlock')
    props.serverError = { ...props.serverError, requestId: 'r', approvalOutcome: 'uncertain' }
    render()
    assert.equal(render().sent, true, 'uncertain effect must not unlock')
    props.ready = false
    render()
    props.ready = true
    render()
    assert.equal(render().sent, true, 'reconnect alone must not replay an uncertain effect')
    props.serverError = { ...props.serverError, approvalOutcome: 'rejected' }
    render()
    assert.equal(render().sent, false, 'definite correlated rejection unlocks')
    render().respond({ allowed: true })
    assert.equal(render().sent, true)
    props.request = { ...props.request, requestId: 'next' }
    render()
    assert.equal(render().sent, false, 'a new owner request starts actionable')
    assert.equal(sends, 2)
  `
  const file = join(dir, 'render.ts')
  writeFileSync(file, script)
  try {
    execFileSync(process.execPath, ['--no-env-file', file], { cwd: dir, stdio: 'pipe' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
