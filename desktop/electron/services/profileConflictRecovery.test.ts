import { describe, expect, it } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareProfileRecovery } from './profileConflictRecovery'

describe('startup profile isolation', () => {
  it('isolates Chromium paths before readiness and cleans only its own directory', () => {
    const paths = new Map<string, string>()
    const cleanup = prepareProfileRecovery({ setPath: (name, value) => { paths.set(name, value) } })
    const directory = paths.get('userData')!
    try {
      expect(directory).toBeTruthy()
      expect(paths.get('sessionData')).toBe(directory)
      expect(existsSync(directory)).toBe(true)
      writeFileSync(join(directory, 'cache'), 'temporary')
    } finally {
      cleanup()
    }
    expect(existsSync(directory)).toBe(false)
    cleanup()
  })

  it('cleans the temporary directory if redirecting a Chromium path fails', () => {
    let directory = ''
    expect(() => prepareProfileRecovery({ setPath: (_name, value) => {
      directory = value
      throw new Error('path unavailable')
    } })).toThrow('path unavailable')
    expect(directory).toBeTruthy()
    expect(existsSync(directory)).toBe(false)
  })
})
