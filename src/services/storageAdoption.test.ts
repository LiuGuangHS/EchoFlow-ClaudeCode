import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { parseStorageAdoptionArgs, runStorageAdoptionCommand } from './storageAdoption.js'
import { resolveStorageBinding } from '../utils/echoFlowConfigRoot.js'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'

function ttyInput(value: string): NodeJS.ReadableStream & { isTTY: true } {
  const input = Readable.from([value]) as NodeJS.ReadableStream & { isTTY: true }
  input.isTTY = true
  return input
}

describe('storage adoption command', () => {
  test('parses only the fixed OpenAI OAuth file contract', () => {
    expect(parseStorageAdoptionArgs(['storage', 'adopt', 'openai-oauth', '--file', '/tmp/openai-oauth.json'])).toEqual({
      category: 'openai-oauth',
      file: '/tmp/openai-oauth.json',
    })
    expect(() => parseStorageAdoptionArgs(['storage', 'adopt', 'openai-oauth', '--file', 'openai-oauth.json'])).toThrow()
    expect(() => parseStorageAdoptionArgs(['storage', 'adopt', 'openai-oauth', '--file', '/tmp/token.json'])).toThrow()
    expect(() => parseStorageAdoptionArgs(['storage', 'adopt', 'openai-oauth', '--file', '/tmp/openai-oauth.json', '--yes'])).toThrow()
  })

  test('non-TTY cancellation leaves the source untouched', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-adoption-'))
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-root-'))
    const source = path.join(parent, 'openai-oauth.json')
    await fs.writeFile(source, '{"accessToken":"fixture"}\n')
    const output: string[] = []
    const input = Readable.from(['yes\n'])
    const handled = await runStorageAdoptionCommand(
      ['storage', 'adopt', 'openai-oauth', '--file', source],
      { input, output: { write: value => { output.push(String(value)); return true } } },
    )
    expect(handled).toBe(true)
    expect(await fs.readFile(source, 'utf8')).toContain('fixture')
    expect(output.join('')).toContain('interactive TTY')
    await fs.rm(parent, { recursive: true, force: true })
    await fs.rm(root, { recursive: true, force: true })
  })

  test('discloses source removal before confirmation and retains the file when declined', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-adoption-'))
    const source = path.join(parent, 'openai-oauth.json')
    const binding = resolveStorageBinding({ env: {}, roots: [path.join(parent, 'target')] })
    const contents = '{"accessToken":"fixture","refreshToken":"fixture","expiresAt":1}\n'
    const output: string[] = []
    try {
      await fs.writeFile(source, contents, { mode: 0o600 })
      await runStorageAdoptionCommand(['storage', 'adopt', 'openai-oauth', '--file', source], {
        binding,
        input: ttyInput('no\n'),
        output: { write: value => { output.push(String(value)); return true } },
      })
      expect(output[0]).toContain('EchoFlow will remove the original only after verifying the copy.\nType y or yes to continue: ')
      expect(output.join('')).toContain('Storage adoption cancelled')
      expect(await fs.readFile(source, 'utf8')).toBe(contents)
      await expect(fs.lstat(binding.root)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(parent, { recursive: true, force: true })
    }
  })

  test('rejects a replacement of the selected file during confirmation', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-adoption-'))
    const root = path.join(parent, 'target')
    const directory = path.join(parent, 'source')
    const source = path.join(directory, 'openai-oauth.json')
    const replacement = path.join(directory, 'replacement.json')
    const contents = '{"accessToken":"fixture","refreshToken":"fixture","expiresAt":1}\n'
    const previousExitCode = process.exitCode
    const previousRoot = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = root
    try {
      await fs.mkdir(directory)
      await fs.writeFile(source, contents, { mode: 0o600 })
      await fs.writeFile(replacement, contents, { mode: 0o600 })
      const input = Readable.from((async function* () {
        await fs.rename(source, `${source}.original`)
        await fs.rename(replacement, source)
        yield 'yes\n'
      })()) as NodeJS.ReadableStream & { isTTY: true }
      input.isTTY = true
      const output: string[] = []
      await runStorageAdoptionCommand(['storage', 'adopt', 'openai-oauth', '--file', source], {
        input,
        output: { write: value => { output.push(String(value)); return true } },
        hooks: { assertQuiescent: async () => {} },
      })
      expect(output.join('')).toContain('Approved storage file changed; choose it again')
      expect(process.exitCode).toBe(1)
      expect(await fs.readFile(source, 'utf8')).toBe(contents)
      await expect(fs.lstat(path.join(root, 'echoflow-code', 'openai-oauth.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      process.exitCode = previousExitCode ?? 0
      if (previousRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previousRoot
      await fs.rm(parent, { recursive: true, force: true })
    }
  })

  test.each(['{"unexpected":true}\n', '{"incomplete":\n'])('rejects invalid OAuth contents before confirmation', async contents => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-adoption-'))
    const source = path.join(parent, 'external', 'openai-oauth.json')
    const binding = resolveStorageBinding({ env: {}, roots: [path.join(parent, 'target')] })
    const output: string[] = []
    const previousExitCode = process.exitCode
    try {
      await fs.mkdir(path.dirname(source))
      await fs.writeFile(source, contents, { mode: 0o600 })
      await runStorageAdoptionCommand(['storage', 'adopt', 'openai-oauth', '--file', source], {
        binding,
        input: ttyInput('yes\n'),
        output: { write: value => { output.push(String(value)); return true } },
        hooks: { assertQuiescent: async () => {} },
      })
      expect(output.join('')).toBe('Invalid OpenAI sign-in file\n')
      expect(process.exitCode).toBe(1)
      expect(await fs.readFile(source, 'utf8')).toBe(contents)
      await expect(fs.lstat(binding.root)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      process.exitCode = previousExitCode ?? 0
      await fs.rm(parent, { recursive: true, force: true })
    }
  })

  test('adopts an exact OAuth file through the shared transaction', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-adoption-'))
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-root-'))
    const source = path.join(parent, 'openai-oauth.json')
    const contents = '{"accessToken":"fixture","refreshToken":"fixture","expiresAt":1}\n'
    await fs.writeFile(source, contents, { mode: 0o600 })
    const previousRoot = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = root
    try {
      const output: string[] = []
      const handled = await runStorageAdoptionCommand(
        ['storage', 'adopt', 'openai-oauth', '--file', source],
        {
          input: ttyInput('yes\n'),
          output: { write: value => { output.push(String(value)); return true } },
          hooks: { assertQuiescent: async () => {} },
        },
      )
      expect(handled).toBe(true)
      expect(output.join('')).not.toContain('Storage migration is blocked')
      const target = path.join(root, 'echoflow-code', 'openai-oauth.json')
      expect(await fs.readFile(target, 'utf8')).toBe(contents)
      const reader = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
        import assert from 'node:assert/strict'
        import { getOpenAIOAuthTokens, getOpenAIOAuthTokensAsync } from './src/services/openaiAuth/storage.ts'
        import { shouldUseOpenAICodexAuth } from './src/services/openaiAuth/fetch.ts'
        const expected = { accessToken: 'fixture', refreshToken: 'fixture', expiresAt: 1 }
        assert.deepEqual(getOpenAIOAuthTokens(), expected)
        assert.deepEqual(await getOpenAIOAuthTokensAsync(), expected)
        assert.equal(shouldUseOpenAICodexAuth(), true)
      `], {
        cwd: path.resolve(import.meta.dir, '../..'),
        env: createSandboxedTestEnvironment(path.join(root, 'reader-home'), {
          CLAUDE_CONFIG_DIR: root,
          OPENAI_CODEX_OAUTH_FILE: target,
        }),
        stdout: 'ignore', stderr: 'inherit',
      })
      expect(await reader.exited).toBe(0)
      await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(output.join('')).toContain('Storage adoption completed')
    } finally {
      if (previousRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previousRoot
      await fs.rm(parent, { recursive: true, force: true })
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
