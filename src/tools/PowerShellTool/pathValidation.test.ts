import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import {
  dangerousRemovalDeny,
  isDangerousRemovalRawPath,
} from './pathValidation'

// `Remove-Item` runs whatever path it is handed, so the guard that decides a
// target is protected is the only thing between a typo and an emptied system
// directory. Pure and platform-independent, so it runs on any host.
describe('isDangerousRemovalRawPath', () => {
  test('flags the filesystem root and a wildcard', () => {
    expect(isDangerousRemovalRawPath('C:/')).toBe(true)
    expect(isDangerousRemovalRawPath('C:/Windows')).toBe(true)
    expect(isDangerousRemovalRawPath('C:\\')).toBe(true)
    expect(isDangerousRemovalRawPath('*')).toBe(true)
    expect(isDangerousRemovalRawPath('C:/Users/*')).toBe(true)
  })

  test('flags the home directory', () => {
    // The tilde is expanded first, so both spellings must resolve to it.
    expect(isDangerousRemovalRawPath('~')).toBe(true)
    expect(isDangerousRemovalRawPath('~/')).toBe(true)
    expect(isDangerousRemovalRawPath('~\\')).toBe(true)
    expect(isDangerousRemovalRawPath(homedir().replace(/\\/g, '/'))).toBe(true)
  })

  test('does not flag an ordinary project path', () => {
    expect(isDangerousRemovalRawPath('C:/Users/alice/project')).toBe(false)
    expect(isDangerousRemovalRawPath('./dist')).toBe(false)
  })

  test('accepts a quoted path', () => {
    // PowerShell passes paths through quotes; stripping them must not change
    // the verdict, or a quoted dangerous path would be waved through.
    expect(isDangerousRemovalRawPath('"C:/Windows"')).toBe(true)
    expect(isDangerousRemovalRawPath("'C:/Windows'")).toBe(true)
  })

  test('collapses repeated separators so a doubled backslash cannot slip past the drive check', () => {
    expect(isDangerousRemovalRawPath('C:\\\\Windows')).toBe(true)
  })
})

describe('dangerousRemovalDeny', () => {
  test('denies with a reason, and does not merely ask', () => {
    // Remove-Item on a protected path must be refused outright — asking would
    // let an unattended run answer yes.
    const result = dangerousRemovalDeny('C:/Windows')
    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('C:/Windows')
    expect(result.decisionReason).toEqual({
      type: 'other',
      reason: 'Removal targets a protected system path',
    })
  })
})
