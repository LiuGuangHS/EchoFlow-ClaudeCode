import { describe, expect, test } from 'bun:test'
import { checkSemantics } from './ast'
import type { SimpleCommand } from './ast'

function cmd(
  argv: string[],
  rest: Partial<SimpleCommand> = {},
): SimpleCommand {
  return {
    argv,
    envVars: rest.envVars ?? [],
    redirects: rest.redirects ?? [],
    text: rest.text ?? argv.join(' '),
  }
}

function ok(argv: string[], rest?: Partial<SimpleCommand>) {
  return checkSemantics([cmd(argv, rest)])
}

describe('checkSemantics', () => {
  test('accepts a plain command', () => {
    expect(ok(['ls', '-la'])).toEqual({ ok: true })
  })

  test('rejects eval-like builtins that turn arguments into shell code', () => {
    for (const argv of [
      ['eval', 'rm -rf /'],
      ['source', '/tmp/x.sh'],
      ['.', './x.sh'],
      ['exec', 'sh'],
      ['command', 'rm', '-rf', '/'],
      ['builtin', 'eval', 'id'],
      ['coproc', 'rm', '-rf', '/'],
      ['trap', 'id', 'EXIT'],
      ['noglob', 'rm', '-rf', '/'],
    ]) {
      const result = ok(argv)
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.reason).toContain('evaluates arguments as shell code')
    }
  })

  test('lets through the command -v existence check but not bare command', () => {
    expect(ok(['command', '-v', 'rg'])).toEqual({ ok: true })
    expect(ok(['command', 'rm']).ok).toBe(false)
  })

  test('lets through safe fc and compgen forms but blocks the executing ones', () => {
    expect(ok(['fc', '-l'])).toEqual({ ok: true })
    expect(ok(['fc', '-e', 'ed']).ok).toBe(false)
    expect(ok(['fc', '-s']).ok).toBe(false)

    expect(ok(['compgen', '-c'])).toEqual({ ok: true })
    expect(ok(['compgen', '-C', 'id']).ok).toBe(false)
    expect(ok(['compgen', '-W', '$(id)']).ok).toBe(false)
  })

  test('rejects jq system() and the file-reading flags', () => {
    expect(ok(['jq', 'system("id")']).ok).toBe(false)
    expect(ok(['jq', '-f', '/tmp/filter']).ok).toBe(false)
    expect(ok(['jq', '--from-file', '/tmp/filter']).ok).toBe(false)
    expect(ok(['jq', '.foo'])).toEqual({ ok: true })
  })

  test('rejects /proc/*/environ in argv and in redirect targets', () => {
    expect(ok(['cat', '/proc/self/environ']).ok).toBe(false)
    expect(
      ok(['cat'], { redirects: [{ op: '<', target: '/proc/1/environ' }] }).ok,
    ).toBe(false)
  })

  test('rejects a newline-then-# argument that could hide argv from path validation', () => {
    expect(ok(['echo', 'a\n# rm -rf /']).ok).toBe(false)
    expect(
      ok(['echo', 'ok'], {
        envVars: [{ name: 'X', value: 'a\n# rm -rf /' }],
      }).ok,
    ).toBe(false)
    expect(
      ok(['cat'], { redirects: [{ op: '>', target: 'a\n# /etc/passwd' }] }).ok,
    ).toBe(false)
  })

  test('rejects an empty command name', () => {
    expect(ok(['', 'rm']).ok).toBe(false)
  })

  test('rejects an argv[0] fragment', () => {
    expect(ok(['-v', 'x']).ok).toBe(false)
  })

  test('rejects shell keywords that signal a tree-sitter mis-parse', () => {
    expect(ok(['do', 'false']).ok).toBe(false)
    expect(ok(['done']).ok).toBe(false)
  })

  describe('wrapper commands', () => {
    test('sees through nohup and time to the wrapped command', () => {
      expect(ok(['nohup', 'eval', 'id']).ok).toBe(false)
      expect(ok(['time', 'eval', 'id']).ok).toBe(false)
    })

    test('sees through timeout with known flags', () => {
      expect(ok(['timeout', '5', 'eval', 'id']).ok).toBe(false)
      expect(ok(['timeout', '--foreground', '5', 'eval', 'id']).ok).toBe(false)
      expect(ok(['timeout', '-k', '5', '10', 'eval', 'id']).ok).toBe(false)
    })

    test('fails closed on a timeout flag it cannot place', () => {
      const result = ok(['timeout', '--mystery', '5', 'eval', 'id'])
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.reason).toContain('cannot be statically analyzed')
    })

    test('fails closed on a timeout duration bash accepts but the regex does not', () => {
      // `timeout .5 echo ok` is valid GNU timeout; failing open here would
      // leave name='timeout' and never check the wrapped eval.
      const result = ok(['timeout', '.5', 'eval', 'id'])
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.reason).toContain('cannot be statically analyzed')
    })

    test('sees through nice and env', () => {
      expect(ok(['nice', '-n', '5', 'eval', 'id']).ok).toBe(false)
      expect(ok(['nice', '-10', 'eval', 'id']).ok).toBe(false)
      expect(ok(['env', 'FOO=bar', 'eval', 'id']).ok).toBe(false)
    })

    test('fails closed on env -S, -C and -P', () => {
      for (const flag of ['-S', '-C', '-P']) {
        const result = ok(['env', flag, 'x', 'eval', 'id'])
        expect(result.ok).toBe(false)
        if (!result.ok)
          expect(result.reason).toContain('cannot be statically analyzed')
      }
    })

    test('fails closed when nice receives an expansion bash would read as a priority', () => {
      const result = ok(['nice', '$((0-5))', 'jq', 'system("id")'])
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('cannot statically determine')
    })

    test('fails closed on a stdbuf flag it does not recognise', () => {
      const result = ok(['stdbuf', '--output', '0', 'eval', 'id'])
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.reason).toContain('cannot be statically analyzed')
    })
  })

  describe('array subscripts that bash evaluates', () => {
    test('rejects -v/-R NAME with a subscript', () => {
      expect(ok(['printf', '-v', 'a[$(id)]', 'x']).ok).toBe(false)
      expect(ok(['test', '-v', 'a[$(id)]']).ok).toBe(false)
      expect(ok(['wait', '-p', 'a[$(id)]']).ok).toBe(false)
    })

    test('rejects the fused and combined flag forms', () => {
      expect(ok(['printf', '-va[$(id)]', 'x']).ok).toBe(false)
      expect(ok(['read', '-ra', 'a[$(id)]']).ok).toBe(false)
    })

    test('rejects a subscript on either side of an arithmetic comparison in [[', () => {
      expect(ok(['[[', 'a[$(id)]', '-eq', '0', ']]']).ok).toBe(false)
      expect(ok(['[[', '0', '-eq', 'a[$(id)]', ']]']).ok).toBe(false)
    })

    test('leaves string comparison in [[ alone', () => {
      expect(ok(['[[', 'a[x]', '==', 'y', ']]'])).toEqual({ ok: true })
    })

    test('rejects bare positional NAME subscripts for read and unset', () => {
      expect(ok(['read', 'a[$(id)]']).ok).toBe(false)
      expect(ok(['unset', 'a[$(id)]']).ok).toBe(false)
    })

    test('leaves read -p prompts alone', () => {
      expect(ok(['read', '-p', '[foo] ', 'name'])).toEqual({ ok: true })
    })
  })

  test('checks every command in the list and reports the first failure', () => {
    expect(checkSemantics([cmd(['ls']), cmd(['eval', 'id'])])).toEqual({
      ok: false,
      reason: `'eval' evaluates arguments as shell code`,
    })
  })
})