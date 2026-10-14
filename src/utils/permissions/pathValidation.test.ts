import { describe, expect, it } from 'bun:test'
import { homedir } from 'os'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  expandTilde,
  formatDirectoryList,
  getGlobBaseDirectory,
  isDangerousRemovalPath,
  validatePath,
} from './pathValidation'

// MACRO is a build-time define; pathValidation reaches it via the internal
// readable-path check. Same shim as QueryEngine.teamWorkerPreset.test.ts.
;(globalThis as any).MACRO = { VERSION: 'fixture', BUILD_TIME: 'fixture' }

const context = getEmptyToolPermissionContext()

describe('isDangerousRemovalPath', () => {
  it('flags wildcards and the filesystem root', () => {
    expect(isDangerousRemovalPath('*')).toBe(true)
    expect(isDangerousRemovalPath('/tmp/*')).toBe(true)
    expect(isDangerousRemovalPath('/')).toBe(true)
    expect(isDangerousRemovalPath('//')).toBe(true)
  })

  it('flags the home directory', () => {
    expect(isDangerousRemovalPath(homedir())).toBe(true)
    expect(isDangerousRemovalPath(`${homedir()}/`)).toBe(true)
  })

  it('flags direct children of the root but not deeper paths', () => {
    expect(isDangerousRemovalPath('/usr')).toBe(true)
    expect(isDangerousRemovalPath('/etc')).toBe(true)
    expect(isDangerousRemovalPath('/usr/local')).toBe(false)
  })

  it('collapses repeated separators so C:\\Windows cannot slip past the drive check', () => {
    expect(isDangerousRemovalPath('C:\\')).toBe(true)
    expect(isDangerousRemovalPath('C:\\\\Windows')).toBe(true)
    expect(isDangerousRemovalPath('C:\\Users\\alice\\project')).toBe(false)
  })
})

describe('validatePath', () => {
  it('rejects unexpanded tilde variants that the shell would resolve elsewhere', () => {
    const result = validatePath('~root/.ssh/id_rsa', '/cwd', context, 'read')
    expect(result.allowed).toBe(false)
    expect(result.resolvedPath).toBe('~root/.ssh/id_rsa')
    expect(result.decisionReason).toEqual({
      type: 'other',
      reason:
        'Tilde expansion variants (~user, ~+, ~-) in paths require manual approval',
    })
  })

  it('rejects shell expansion syntax by name, not incidentally', () => {
    for (const candidate of [
      '$HOME/.ssh',
      '${HOME}/.ssh',
      '$(echo /etc)',
      '%TEMP%',
      '=rg',
    ]) {
      const result = validatePath(candidate, '/cwd', context, 'read')
      expect(result.allowed).toBe(false)
      expect(result.resolvedPath).toBe(candidate)
      expect(result.decisionReason).toEqual({
        type: 'other',
        reason: 'Shell expansion syntax in paths requires manual approval',
      })
    }
  })

  it('rejects glob patterns outright on write and create', () => {
    for (const operation of ['write', 'create'] as const) {
      const result = validatePath('/tmp/*.txt', '/cwd', context, operation)
      expect(result.allowed).toBe(false)
      expect(result.decisionReason).toEqual({
        type: 'other',
        reason:
          'Glob patterns are not allowed in write operations. Please specify an exact file path.',
      })
    }
  })

  // Read never returns the write-specific rejection above. It resolves the
  // glob's base directory and judges that instead — here /tmp, which an empty
  // context has no rule for, so it falls through to a bare deny.
  it('resolves the glob base directory on read instead of rejecting the pattern', () => {
    const result = validatePath('/tmp/*.txt', '/cwd', context, 'read')
    expect(result.resolvedPath).toBe('/tmp')
    expect(result.decisionReason).toBeUndefined()
  })
})

describe('getGlobBaseDirectory', () => {
  it('strips the wildcard segment', () => {
    expect(getGlobBaseDirectory('/path/to/*.txt')).toBe('/path/to')
    expect(getGlobBaseDirectory('/path/to/**/*.ts')).toBe('/path/to')
  })

  it('returns the path untouched when there is no wildcard', () => {
    expect(getGlobBaseDirectory('/path/to/file.txt')).toBe('/path/to/file.txt')
  })
})

describe('expandTilde', () => {
  it('expands a bare tilde to the home directory', () => {
    expect(expandTilde('~')).toBe(homedir())
    expect(expandTilde('~/project')).toBe(`${homedir()}/project`)
  })

  it('leaves other paths alone', () => {
    expect(expandTilde('/absolute/path')).toBe('/absolute/path')
    expect(expandTilde('relative/path')).toBe('relative/path')
  })
})

describe('formatDirectoryList', () => {
  it('quotes and joins every directory when there are few', () => {
    expect(formatDirectoryList(['/a', '/b'])).toBe("'/a', '/b'")
  })

  it('summarises the tail past the display limit', () => {
    const dirs = ['/a', '/b', '/c', '/d', '/e', '/f', '/g']
    expect(formatDirectoryList(dirs)).toBe(
      "'/a', '/b', '/c', '/d', '/e', and 2 more",
    )
  })
})