import { describe, expect, test } from 'bun:test'
import type { ExternalCommandConfig } from './readOnlyCommandValidation'
import {
  FLAG_PATTERN,
  GIT_READ_ONLY_COMMANDS,
  PYRIGHT_READ_ONLY_COMMANDS,
  validateFlagArgument,
  validateFlags,
} from './readOnlyCommandValidation'

// Mirrors the xargs shape the bundled-flag and -E= fixes were written for.
const xargs: ExternalCommandConfig = {
  safeFlags: {
    '-r': 'none',
    '-I': '{}',
    '-E': 'EOF',
    '-n': 'number',
    '--max-args': 'number',
  },
}

describe('validateFlagArgument', () => {
  test('accepts only digits for number', () => {
    expect(validateFlagArgument('12', 'number')).toBe(true)
    expect(validateFlagArgument('1a', 'number')).toBe(false)
    expect(validateFlagArgument('', 'number')).toBe(false)
  })

  test('accepts any string including empty for string', () => {
    expect(validateFlagArgument('', 'string')).toBe(true)
    expect(validateFlagArgument('-x', 'string')).toBe(true)
  })

  test('requires exactly one character for char', () => {
    expect(validateFlagArgument(',', 'char')).toBe(true)
    expect(validateFlagArgument('ab', 'char')).toBe(false)
  })

  test('requires the literal token for {} and EOF', () => {
    expect(validateFlagArgument('{}', '{}')).toBe(true)
    expect(validateFlagArgument('{ }', '{}')).toBe(false)
    expect(validateFlagArgument('EOF', 'EOF')).toBe(true)
    expect(validateFlagArgument('eof', 'EOF')).toBe(false)
  })

  test('rejects a value for none', () => {
    expect(validateFlagArgument('', 'none')).toBe(false)
  })
})

describe('validateFlags', () => {
  test('accepts a no-arg flag and a correct typed argument', () => {
    expect(validateFlags(['-r'], 0, xargs)).toBe(true)
    expect(validateFlags(['-n', '3'], 0, xargs)).toBe(true)
    expect(validateFlags(['--max-args=3'], 0, xargs)).toBe(true)
  })

  test('rejects an unknown flag', () => {
    expect(validateFlags(['--mystery'], 0, xargs)).toBe(false)
  })

  test('rejects a no-arg flag given an inline value', () => {
    // `-r=` must not be waved through just because the inline value is empty.
    expect(validateFlags(['-r='], 0, xargs)).toBe(false)
  })

  test('does not let -E= consume the next token', () => {
    // GNU xargs reads `-E=` as -E with attached arg `=`, so EOF stays the
    // target command. Consuming it here would auto-allow code execution.
    expect(
      validateFlags(['-E=', 'EOF', 'echo', 'foo'], 0, xargs, {
        commandName: 'xargs',
        xargsTargetCommands: ['echo'],
      }),
    ).toBe(false)
  })

  test('rejects a bundle containing an arg-taking flag', () => {
    // -I consumes the NEXT token under GNU getopt, which a single i++ would
    // mis-model: the validator would see `echo` as the target while xargs
    // executes `sh -c id`.
    expect(
      validateFlags(['-rI', 'echo', 'sh', '-c', 'id'], 0, xargs, {
        commandName: 'xargs',
        xargsTargetCommands: ['echo'],
      }),
    ).toBe(false)
  })

  test('accepts a bundle of no-arg flags', () => {
    const cfg: ExternalCommandConfig = {
      safeFlags: { '-r': 'none', '-s': 'none' },
    }
    expect(validateFlags(['-rs'], 0, cfg)).toBe(true)
  })

  test('rejects a missing argument at the end of the token list', () => {
    expect(validateFlags(['-n'], 0, xargs)).toBe(false)
  })

  test('rejects a flag value that itself looks like a flag', () => {
    expect(validateFlags(['-n', '-3'], 0, xargs)).toBe(false)
  })

  test('stops at -- for tools that respect it', () => {
    expect(validateFlags(['--', '--mystery'], 0, xargs)).toBe(true)
  })

  test('keeps validating past -- when the tool ignores it', () => {
    const pyright = PYRIGHT_READ_ONLY_COMMANDS['pyright']
    expect(pyright).toBeDefined()
    expect(validateFlags(['--', '--mystery'], 0, pyright!)).toBe(false)
  })

  test('treats non-flag positionals as allowed', () => {
    expect(validateFlags(['HEAD~1', 'path/to/file'], 0, xargs)).toBe(true)
  })

  test('allows git -<number> shorthand and rejects other unknown short flags', () => {
    const gitLog = GIT_READ_ONLY_COMMANDS['git log']
    expect(gitLog).toBeDefined()
    expect(validateFlags(['-5'], 0, gitLog!, { commandName: 'git' })).toBe(true)
    expect(validateFlags(['-z'], 0, gitLog!, { commandName: 'git' })).toBe(false)
  })
})

describe('FLAG_PATTERN', () => {
  test('matches flags and not bare dashes or positionals', () => {
    expect(FLAG_PATTERN.test('-n')).toBe(true)
    expect(FLAG_PATTERN.test('--sort')).toBe(true)
    expect(FLAG_PATTERN.test('-')).toBe(false)
    expect(FLAG_PATTERN.test('file')).toBe(false)
  })
})