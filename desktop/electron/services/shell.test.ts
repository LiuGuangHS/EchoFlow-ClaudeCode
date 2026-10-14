import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandTildePath, normalizeExternalUrl, normalizeOpenPath, normalizeSystemSettingsUrl, showItemInFolder } from './shell'

describe('Electron shell service', () => {
  it('allows only explicit external URL schemes', () => {
    expect(normalizeExternalUrl('https://example.com/path')).toBe('https://example.com/path')
    expect(normalizeExternalUrl('mailto:support@example.com')).toBe('mailto:support@example.com')
    expect(() => normalizeExternalUrl('file:///tmp/report.md')).toThrow('Unsupported external URL scheme')
    expect(() => normalizeExternalUrl('/tmp/report.md')).toThrow('absolute URLs')
  })

  it('allows only existing non-executable file-system paths for openPath', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'electron-shell-'))
    const reportPath = join(rootDir, 'report.md')
    const folderPath = join(rootDir, 'folder')
    const scriptPath = join(rootDir, 'run.sh')
    const appPath = join(rootDir, 'Tool.app')
    try {
      writeFileSync(reportPath, 'ok')
      mkdirSync(folderPath)
      writeFileSync(scriptPath, '#!/bin/sh\n')
      chmodSync(scriptPath, 0o755)
      mkdirSync(appPath)

      expect(normalizeOpenPath(reportPath)).toBe(realpathSync(reportPath))
      expect(normalizeOpenPath(new URL(`file://${reportPath}`).toString())).toBe(realpathSync(reportPath))
      expect(normalizeOpenPath(folderPath)).toBe(realpathSync(folderPath))
      expect(() => normalizeOpenPath(scriptPath)).toThrow('executable')
      expect(() => normalizeOpenPath(appPath)).toThrow('executable')
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
    expect(() => normalizeOpenPath('relative/report.md')).toThrow('absolute')
  })

  it('reveals an executable, unlike openPath which refuses to launch one', async () => {
    // Runtime management lists executable paths; revealing one is exactly what
    // its "show in folder" asks for. openPath blocks them because it would run
    // them — revealing only selects the entry, so the same rule must not apply.
    const rootDir = mkdtempSync(join(tmpdir(), 'electron-shell-reveal-'))
    const scriptPath = join(rootDir, 'claude')
    const shown: string[] = []
    const shellApi = { showItemInFolder: (target: string) => { shown.push(target) } }
    try {
      writeFileSync(scriptPath, '#!/bin/sh\n')
      chmodSync(scriptPath, 0o755)
      expect(() => normalizeOpenPath(scriptPath)).toThrow('executable')

      await showItemInFolder(scriptPath, shellApi)
      expect(shown).toEqual([realpathSync(scriptPath)])
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('reveals only paths that exist on this machine', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'electron-shell-reveal-missing-'))
    const shown: string[] = []
    const shellApi = { showItemInFolder: (target: string) => { shown.push(target) } }
    try {
      await expect(showItemInFolder(join(rootDir, 'gone'), shellApi)).rejects.toThrow()
      await expect(showItemInFolder('relative/claude', shellApi)).rejects.toThrow('absolute')
      expect(shown).toHaveLength(0)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('expands tilde paths per platform', () => {
    expect(expandTildePath('~', 'darwin')).toBe(homedir())
    expect(expandTildePath('~/reports/a.html', 'linux')).toBe(`${homedir()}/reports/a.html`)
    expect(expandTildePath('~\\reports\\a.html', 'win32')).toBe(`${homedir()}\\reports\\a.html`)
    // On POSIX "~\..." is a regular file name; "~user" expansion is unsupported.
    expect(expandTildePath('~\\reports\\a.html', 'darwin')).toBe('~\\reports\\a.html')
    expect(expandTildePath('~user/file.md', 'linux')).toBe('~user/file.md')
    expect(expandTildePath('a/~/b.md', 'linux')).toBe('a/~/b.md')
  })

  it('expands tilde paths before the absolute-path check in openPath', () => {
    expect(normalizeOpenPath('~')).toBe(realpathSync(homedir()))
  })

  it('allows only explicit system settings URLs', () => {
    expect(normalizeSystemSettingsUrl('ms-settings:notifications')).toBe('ms-settings:notifications')
    expect(normalizeSystemSettingsUrl('x-apple.systempreferences:com.apple.preference.notifications')).toBe(
      'x-apple.systempreferences:com.apple.preference.notifications',
    )
    expect(() => normalizeSystemSettingsUrl('ms-settings:privacy')).toThrow('Unsupported system settings URL')
  })
})
