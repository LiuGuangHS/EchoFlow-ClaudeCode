import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getClaudeCodeRuntimeConfig,
  isUsableInstalledPath,
  setClaudeCodeRuntimeConfig,
  type ClaudeCodeRuntimeConfig,
} from './claudeCodeRuntime'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echoflow-code-runtime-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('Claude Code runtime config', () => {
  it('defaults to the bundled runtime when no config exists', () => {
    expect(getClaudeCodeRuntimeConfig(tempDir())).toEqual({
      schemaVersion: 1,
      defaultRuntimeId: 'bundled',
      installedPath: null,
    })
  })

  it('persists an installed runtime only with an absolute executable path', () => {
    const userDataPath = tempDir()
    const executablePath = path.join(userDataPath, process.platform === 'win32' ? 'claude.exe' : 'claude')
    fs.writeFileSync(executablePath, '')
    fs.chmodSync(executablePath, 0o755)

    const config: ClaudeCodeRuntimeConfig = {
      schemaVersion: 1,
      defaultRuntimeId: 'installed',
      installedPath: executablePath,
    }

    setClaudeCodeRuntimeConfig(userDataPath, config)

    expect(getClaudeCodeRuntimeConfig(userDataPath)).toEqual(config)
  })

  it.each([
    { label: 'a relative path', path: 'claude' },
    { label: 'a path with a control character', path: `${path.sep}tmp${path.sep}claude\n` },
  ])('rejects $label', ({ path: installedPath }) => {
    expect(() => setClaudeCodeRuntimeConfig(tempDir(), {
      schemaVersion: 1,
      defaultRuntimeId: 'installed',
      installedPath,
    })).toThrow()
  })

  it('does not replace a valid config when writing an invalid one fails', () => {
    const userDataPath = tempDir()
    const executablePath = path.join(userDataPath, process.platform === 'win32' ? 'claude.exe' : 'claude')
    fs.writeFileSync(executablePath, '')
    fs.chmodSync(executablePath, 0o755)
    const original: ClaudeCodeRuntimeConfig = {
      schemaVersion: 1,
      defaultRuntimeId: 'installed',
      installedPath: executablePath,
    }
    setClaudeCodeRuntimeConfig(userDataPath, original)

    expect(() => setClaudeCodeRuntimeConfig(userDataPath, {
      schemaVersion: 1,
      defaultRuntimeId: 'installed',
      installedPath: 'claude',
    })).toThrow()

    expect(getClaudeCodeRuntimeConfig(userDataPath)).toEqual(original)
  })

  // The stored path outlives the executable: the user may uninstall or rename
  // Claude Code after choosing it. Reporting it as installed leaves External
  // selectable and only fails once a session starts.
  it('reports a stored installed path as unusable once the executable is gone', () => {
    const userDataPath = tempDir()
    const executablePath = path.join(userDataPath, process.platform === 'win32' ? 'claude.exe' : 'claude')
    fs.writeFileSync(executablePath, '')
    fs.chmodSync(executablePath, 0o755)
    setClaudeCodeRuntimeConfig(userDataPath, {
      schemaVersion: 1,
      defaultRuntimeId: 'installed',
      installedPath: executablePath,
    })

    expect(isUsableInstalledPath(getClaudeCodeRuntimeConfig(userDataPath).installedPath)).toBe(true)

    fs.rmSync(executablePath)

    expect(isUsableInstalledPath(getClaudeCodeRuntimeConfig(userDataPath).installedPath)).toBe(false)
  })

  it('reports a null or malformed installed path as unusable', () => {
    expect(isUsableInstalledPath(null)).toBe(false)
    expect(isUsableInstalledPath('')).toBe(false)
    expect(isUsableInstalledPath('claude')).toBe(false)
  })
})
