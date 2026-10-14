import { describe, expect, test } from 'bun:test'
import {
  extractSedExpressions,
  hasFileArgs,
  isPrintCommand,
  sedCommandIsAllowedByAllowlist,
} from './sedValidation'

// sed has two commands that escape the "just rewrite text" model: `w`/`W`
// write to a file and `e`/`E` execute a shell command. Anything that reaches
// an allowlisted sed must not smuggle either through, so these cases are the
// ones worth pinning.
describe('isPrintCommand', () => {
  test('accepts the bare print forms', () => {
    // The regex is strict: digits and ranges only, no `$` address.
    for (const cmd of ['p', '1p', '1,10p']) {
      expect(isPrintCommand(cmd), cmd).toBe(true)
    }
  })

  test('rejects write and execute commands', () => {
    for (const cmd of ['w out.txt', 'W out.txt', 'e id', 'E id', 'd', 'q', '$p']) {
      expect(isPrintCommand(cmd), cmd).toBe(false)
    }
  })

  test('rejects an empty command', () => {
    expect(isPrintCommand('')).toBe(false)
  })
})

describe('sedCommandIsAllowedByAllowlist', () => {
  describe('GNU sed w and e, the commands that escape the model', () => {
    // Two layers refuse these, and only the combination matters. The
    // substitution allowlist admits only flags from gpimIM plus one digit, so
    // `s/foo/bar/e` fails there first. containsDangerousOperations is the
    // backstop underneath it: disabling either layer alone leaves every case
    // below rejected, disabling both turns the three e-flag cases red. That
    // pair is what pins the defense-in-depth.
    const rejected = [
      // e runs its argument as a shell command.
      "sed 'e id'",
      "sed '1e id'",
      "sed '$e id'",
      "sed '/foo/e id'",
      "sed '1,5e id'",
      // e as a substitution flag.
      "sed 's/foo/bar/e'",
      "sed 's/foo/bar/ge'",
      "sed 's/foo/bar/E'",
      // w writes to a file.
      "sed 'w out.txt'",
      "sed '1w out.txt'",
      "sed '/foo/w out.txt'",
      "sed '1,$w out.txt'",
      "sed 'W out.txt'",
      // w as a substitution flag.
      "sed 's/foo/bar/w out.txt'",
      "sed 's/foo/bar/gw out.txt'",
      // A y command followed by any of those letters.
      "sed 'y/abc/xyz/;w out.txt'",
      // The same commands are refused whatever else is in the string.
      "sed -e 'e id' f.txt",
      "sed -e 's/foo/bar/w out.txt' f.txt",
    ]

    for (const command of rejected) {
      test(`rejects ${command}`, () => {
        expect(sedCommandIsAllowedByAllowlist(command)).toBe(false)
      })
    }

    test('rejects them again when file writes are allowed', () => {
      // allowFileWrites is meant to permit `s///` writing the file in place,
      // not to permit sed's separate w/e commands.
      for (const command of [
        "sed -e 'e id' f.txt",
        "sed -e 's/foo/bar/e' f.txt",
        "sed -e 'w out.txt' f.txt",
        "sed -e 's/foo/bar/w out.txt' f.txt",
      ]) {
        expect(
          sedCommandIsAllowedByAllowlist(command, { allowFileWrites: true }),
          command,
        ).toBe(false)
      }
    })
  })

  describe('conservative rejections', () => {
    const rejected = [
      // Unicode homoglyphs and combining marks.
      "sed -e 's/a/ｗ/' f.txt",
      // Block commands are too complex to reason about.
      "sed -e '{s/a/b/}' f.txt",
      // A newline can hide a second command.
      "sed -e 's/a/b/\ne id' f.txt",
      // Negation: re-runs the command on non-matching lines.
      "sed -e '!/foo/d' f.txt",
      "sed -e '/foo/!d' f.txt",
      // GNU step addresses.
      "sed -e '1~3p' f.txt",
      // Bare comma is shorthand for the 1,$ range.
      "sed -e ',p' f.txt",
      // A comment that is not a delimiter.
      "sed -e 's/a/b/ # note' f.txt",
      // Malformed substitution missing its trailing delimiter.
      "sed -e 's/a/b' f.txt",
    ]

    for (const command of rejected) {
      test(`rejects ${JSON.stringify(command)}`, () => {
        expect(sedCommandIsAllowedByAllowlist(command)).toBe(false)
      })
    }
  })

  test('does not reject ordinary substitutions out of hand', () => {
    // The denylist must not swallow the normal case, or the allowlist is
    // useless and every sed falls through to a manual prompt.
    // Only the inline-script form is admitted: the substitution path's flag
    // allowlist is -E/-r/--posix plus -i when file writes are on, and -e is
    // not among them. An -e form falls through to a manual prompt, which is
    // the conservative direction.
    for (const command of [
      "sed -i 's/foo/bar/g' f.txt",
      "sed -i 's/a/b/' f.txt",
      "sed -i 's/a/b/' '*.txt'",
    ]) {
      expect(
        sedCommandIsAllowedByAllowlist(command, { allowFileWrites: true }),
        command,
      ).toBe(true)
    }
  })

  test('refuses the -e form even with file writes allowed', () => {
    // Pinned because it reads as a gap: -e is a legitimate sed spelling, but
    // this validator's substitution flag allowlist does not include it.
    expect(
      sedCommandIsAllowedByAllowlist("sed -i -e 's/a/b/' f.txt", {
        allowFileWrites: true,
      }),
    ).toBe(false)
  })
})

describe('hasFileArgs', () => {
  test('sees a file argument', () => {
    expect(hasFileArgs("sed -e 's/a/b/' f.txt")).toBe(true)
    expect(hasFileArgs("sed -e 's/a/b/' '*.txt'")).toBe(true)
  })

  test('reports no file argument for stdin only', () => {
    expect(hasFileArgs("sed -e 's/a/b/'")).toBe(false)
  })

  test('reports no file argument for a non-sed command', () => {
    expect(hasFileArgs('grep foo f.txt')).toBe(false)
  })
})

describe('extractSedExpressions', () => {
  test('pulls the expression out of -e', () => {
    expect(extractSedExpressions("sed -e 's/a/b/' f.txt")).toEqual(['s/a/b/'])
  })

  test('pulls the expression out of an inline argument', () => {
    expect(extractSedExpressions("sed 's/a/b/' f.txt")).toEqual(['s/a/b/'])
  })

  test('has no expression when sed only takes a file', () => {
    // Without -e or an inline script, the remaining token is the file, not an
    // expression — which is why it must not be treated as one.
    expect(extractSedExpressions('sed -n')).toEqual([])
  })
})