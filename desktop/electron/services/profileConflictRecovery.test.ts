import { describe, expect, it, vi } from 'vitest'
import { UserDataProfileConflictError } from './echoFlowDataRoot'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareProfileRecovery, recoverProfileConflict } from './profileConflictRecovery'

function fixture(response: number, checkboxChecked: boolean) {
  const app = { relaunch: vi.fn(), exit: vi.fn() }
  const dialog = { showMessageBox: vi.fn().mockResolvedValue({ response, checkboxChecked }), showErrorBox: vi.fn() }
  const conflict = new UserDataProfileConflictError(['/fixture/Local/profile', '/fixture/Roaming/legacy'], 'win32')
  return { app, dialog, conflict }
}

describe('explicit profile conflict recovery', () => {
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

  it.each([0, 1])('cleans isolated Chromium state before exit (%s)', async response => {
    const f = fixture(response, true)
    const paths = new Map<string, string>()
    const cleanup = prepareProfileRecovery({ setPath: (name, value) => { paths.set(name, value) } })
    const directory = paths.get('userData')!
    writeFileSync(join(directory, 'cache'), 'temporary')
    expect(readFileSync(join(directory, 'cache'), 'utf8')).toBe('temporary')
    f.app.exit.mockImplementation(() => { expect(existsSync(directory)).toBe(false) })
    try {
      await recoverProfileConflict(f.app, f.dialog, f.conflict, [], cleanup)
      expect(f.app.exit).toHaveBeenCalledWith(response === 0 ? 1 : 0)
    } finally {
      cleanup()
    }
  })

  it.each([[0, true], [1, false], [3, true], [-1, true]])('exits without relaunch for cancelled/unacknowledged/invalid choice (%s, %s)', async (response, acknowledged) => {
    const f = fixture(response as number, acknowledged as boolean)
    await recoverProfileConflict(f.app, f.dialog, f.conflict, ['app.cjs'])
    expect(f.app.relaunch).not.toHaveBeenCalled()
    expect(f.app.exit).toHaveBeenCalledWith(1)
  })

  it('defaults to cancel and exposes all directories before asking for backup acknowledgement', async () => {
    const f = fixture(0, false)
    await recoverProfileConflict(f.app, f.dialog, f.conflict, [])
    const options = f.dialog.showMessageBox.mock.calls[0]![0]
    expect(options).toMatchObject({ defaultId: 0, cancelId: 0, checkboxChecked: false })
    for (const directory of f.conflict.directories) expect(options.detail).toContain(directory)
    expect(options.checkboxLabel).toContain('backed up')
  })

  it('relaunches only the explicitly selected profile without persisting or merging state', async () => {
    const f = fixture(2, true)
    await recoverProfileConflict(f.app, f.dialog, f.conflict, ['app.cjs', '--existing-option'])
    expect(f.app.relaunch).toHaveBeenCalledExactlyOnceWith({ args: ['app.cjs', '--existing-option', '--user-data-dir=/fixture/Roaming/legacy'] })
    expect(f.app.exit).toHaveBeenCalledWith(0)
  })

  it('fails closed if the dialog fails', async () => {
    const f = fixture(1, true)
    f.dialog.showMessageBox.mockRejectedValue(new Error('dialog failed'))
    await recoverProfileConflict(f.app, f.dialog, f.conflict, [])
    expect(f.app.relaunch).not.toHaveBeenCalled()
    expect(f.dialog.showErrorBox).toHaveBeenCalled()
    expect(f.app.exit).toHaveBeenCalledWith(1)
  })
})
