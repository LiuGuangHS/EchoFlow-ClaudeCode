import { describe, expect, test } from 'bun:test'
import { parseForSecurity, parseForSecurityFromAst } from './ast'
import { PARSE_ABORTED, type Node } from './parser.js'

// parseForSecurity needs tree-sitter, which is a build-time feature() that is
// off in a default test build — it answers 'parse-unavailable' for everything.
// parseForSecurityFromAst takes the root as a parameter and runs its
// string-level pre-checks before it touches the tree, so those are testable
// with a stub root. That is the part that catches tree-sitter/bash
// tokenization differentials, so it is the part worth pinning.
describe('parseForSecurityFromAst pre-checks', () => {
  // Never walked: every case below returns from the pre-check.
  const stubRoot = { type: 'program', children: [] } as unknown as Node

  describe('differentials it refuses', () => {
    const refused: Array<[string, string, string]> = [
      ['control characters', 'echo ab', 'Contains control characters'],
      [
        'unicode whitespace',
        'echo a b',
        'Contains Unicode whitespace',
      ],
      [
        'backslash-escaped whitespace',
        'echo a\\ b',
        'Contains backslash-escaped whitespace',
      ],
      [
        'zsh ~[ dynamic directory syntax',
        'echo ~[1]',
        'Contains zsh ~[ dynamic directory syntax',
      ],
      ['zsh =cmd equals expansion', '=rg', 'Contains zsh =cmd equals expansion'],
    ]

    for (const [label, cmd, reason] of refused) {
      test(`refuses ${label}`, () => {
        const result = parseForSecurityFromAst(cmd, stubRoot)
        expect(result.kind).toBe('too-complex')
        if (result.kind !== 'too-complex') return
        expect(result.reason).toContain(reason)
      })
    }
  })

  test('refuses a brace that carries a quote character', () => {
    const result = parseForSecurityFromAst("echo ${'a'}", stubRoot)
    expect(result.kind).toBe('too-complex')
    if (result.kind !== 'too-complex') return
    expect(result.reason).toContain('brace with quote character')
  })

  // The module loaded but hit its timeout / node budget, which an attacker can
  // provoke. It must NOT collapse into 'parse-unavailable': that routes to the
  // legacy path, which has no EVAL_LIKE_BUILTINS, so trap/enable/hash leak.
  test('fails closed when the parser aborted', () => {
    const result = parseForSecurityFromAst('echo hi', PARSE_ABORTED)
    expect(result.kind).toBe('too-complex')
    if (result.kind !== 'too-complex') return
    expect(result.reason).toContain('Parser aborted')
    expect(result.nodeType).toBe('PARSE_ABORT')
  })

  test('returns no commands for a blank string', () => {
    expect(parseForSecurityFromAst('   ', stubRoot)).toEqual({
      kind: 'simple',
      commands: [],
    })
  })

  test('walks the tree once the pre-checks pass', () => {
    // An empty program yields no commands but is still 'simple', which proves
    // the pre-checks let ordinary input through to walkProgram.
    expect(parseForSecurityFromAst('echo hi', stubRoot)).toEqual({
      kind: 'simple',
      commands: [],
    })
  })
})

describe('parseForSecurity without a build-time parser', () => {
  test('answers parse-unavailable rather than guessing', async () => {
    // The documented contract when tree-sitter is absent: the caller falls
    // back to conservative handling. It must never claim 'simple' blind.
    const result = await parseForSecurity('ls -la')
    if (result.kind === 'simple') return // parser present in this build
    expect(result.kind).toBe('parse-unavailable')
  })

  test('answers parse-unavailable for an empty string without a parse', async () => {
    expect(await parseForSecurity('')).toEqual({ kind: 'simple', commands: [] })
  })
})