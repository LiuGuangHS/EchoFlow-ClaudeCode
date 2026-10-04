import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  resolveClaudeCodeRuntimeId,
  resolveClaudeCodeRuntimePath,
} from '../services/claudeCodeRuntimeService.js'

const tempDirs: string[] = []

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'echoflow-code-runtime-service-'))
  tempDirs.push(directory)
  return directory
}

function writeRuntimeConfig(configPath: string, installedPath: string | null): void {
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    defaultRuntimeId: installedPath ? 'installed' : 'bundled',
    installedPath,
  }))
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('Claude Code runtime resolution', () => {
  test('uses the installed executable only from the trusted runtime config file', () => {
    const directory = tempDir()
    const executablePath = path.join(directory, 'claude')
    const configPath = path.join(directory, 'claude-code-runtime.json')
    fs.writeFileSync(executablePath, '')
    fs.chmodSync(executablePath, 0o755)
    writeRuntimeConfig(configPath, executablePath)

    expect(resolveClaudeCodeRuntimePath('installed', {
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: configPath,
    })).toBe(fs.realpathSync.native(executablePath))
  })

  test('does not override the bundled launcher path', () => {
    expect(resolveClaudeCodeRuntimePath('bundled', {
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: '/unused/runtime.json',
    })).toBeNull()
  })

  test('uses the configured default runtime when a session does not pin one', () => {
    const directory = tempDir()
    const executablePath = path.join(directory, 'claude')
    const configPath = path.join(directory, 'claude-code-runtime.json')
    fs.writeFileSync(executablePath, '')
    fs.chmodSync(executablePath, 0o755)
    writeRuntimeConfig(configPath, executablePath)

    expect(resolveClaudeCodeRuntimeId(undefined, {
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: configPath,
    })).toBe('installed')
    expect(resolveClaudeCodeRuntimePath(undefined, {
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: configPath,
    })).toBe(fs.realpathSync.native(executablePath))
  })

  test('falls back to bundled for an invalid trusted default config', () => {
    const directory = tempDir()
    const configPath = path.join(directory, 'claude-code-runtime.json')
    fs.writeFileSync(configPath, '{"schemaVersion": 0}')

    expect(resolveClaudeCodeRuntimeId(undefined, {
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: configPath,
    })).toBe('bundled')
    expect(resolveClaudeCodeRuntimePath(undefined, {
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: configPath,
    })).toBeNull()
  })

  test('rejects an installed runtime without a trusted config path', () => {
    expect(() => resolveClaudeCodeRuntimePath('installed', {}))
      .toThrow('runtime config is unavailable')
  })

  test('rejects a relative executable path from the config file', () => {
    const directory = tempDir()
    const configPath = path.join(directory, 'claude-code-runtime.json')
    writeRuntimeConfig(configPath, 'claude')

    expect(() => resolveClaudeCodeRuntimePath('installed', {
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: configPath,
    })).toThrow('must be absolute')
  })
})
