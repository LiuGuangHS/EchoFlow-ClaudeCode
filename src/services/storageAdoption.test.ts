import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { parseStorageAdoptionArgs, runStorageAdoptionCommand } from './storageAdoption.js'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../utils/echoFlowConfigRoot.js'
import { acquireStorageWriter } from './storageMigration.js'
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

  test('selects exactly one WhatsApp directory and an optional saved adapter config', () => {
    expect(parseStorageAdoptionArgs(['storage', 'adopt', 'whatsapp-auth', '--directory', '/tmp/account', '--config', '/tmp/adapters.json'])).toEqual({
      category: 'whatsapp-auth', directory: '/tmp/account', config: '/tmp/adapters.json',
    })
    expect(() => parseStorageAdoptionArgs(['storage', 'adopt', 'whatsapp-auth', '--directory', 'relative'])).toThrow()
    expect(() => parseStorageAdoptionArgs(['storage', 'adopt', 'whatsapp-auth', '--directory', '/tmp/account', '--config', '/tmp/other.json'])).toThrow()
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

  test('adopts both IM files without touching unrelated Chromium data or shared files', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-im-adoption-'))
    const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'product')] })
    const shared = path.join(home, '.claude')
    const config = path.join(shared, 'adapters.json')
    const sessions = path.join(shared, 'adapter-sessions.json')
    const sentinel = path.join(binding.root, 'Partitions', 'browser', 'fixture')
    const configBytes = '{"serverUrl":"ws://127.0.0.1:12345","telegram":{"allowedUsers":[42]},"futureField":true}\n'
    const sessionBytes = '{"chat":{"sessionId":"fixture","workDir":"/workspace","updatedAt":1,"futureField":true}}\n'
    const previousExitCode = process.exitCode
    const output: string[] = []
    try {
      await fs.mkdir(shared)
      await fs.mkdir(path.dirname(sentinel), { recursive: true })
      await fs.writeFile(path.join(binding.root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
      await fs.writeFile(sentinel, 'chromium fixture')
      await fs.writeFile(path.join(shared, 'settings.json'), '{}')
      await fs.writeFile(config, configBytes)
      await fs.writeFile(sessions, sessionBytes)
      await runStorageAdoptionCommand(['storage', 'adopt', 'im-adapters', '--file', config, '--file', sessions], {
        binding,
        input: ttyInput('yes\n'),
        output: { write: value => { output.push(String(value)); return true } },
        hooks: { assertQuiescent: async () => {} },
      })
      expect(output.join('')).toContain('Storage adoption completed')
      expect(await fs.readFile(path.join(binding.root, 'adapters.json'), 'utf8')).toBe(configBytes)
      expect(await fs.readFile(path.join(binding.root, 'adapter-sessions.json'), 'utf8')).toBe(sessionBytes)
      expect(await fs.readdir(shared)).toEqual(['settings.json'])
      expect(await fs.readFile(sentinel, 'utf8')).toBe('chromium fixture')
      const reader = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
        import assert from 'node:assert/strict'
        import { loadConfig } from './adapters/common/config.ts'
        import { SessionStore } from './adapters/common/session-store.ts'
        import { isPaired } from './adapters/common/pairing.ts'
        import { adapterService } from './src/server/services/adapterService.ts'
        assert.equal(loadConfig().serverUrl, 'ws://127.0.0.1:12345')
        assert.equal(new SessionStore().get('chat')?.sessionId, 'fixture')
        const config = await adapterService.getRawConfig()
        assert.equal(isPaired('telegram', 42, config), true)
        assert.equal(config.futureField, true)
      `], {
        cwd: path.resolve(import.meta.dir, '../..'),
        env: createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: binding.root }),
        stdout: 'ignore', stderr: 'inherit',
      })
      expect(await reader.exited).toBe(0)
    } finally {
      process.exitCode = previousExitCode ?? 0
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  test.each(['invalid', 'external-auth', 'target-conflict', 'late-target', 'live-writer', 'replaced'] as const)(
    'preserves the IM pair when adoption encounters %s', async scenario => {
      const home = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-im-blocked-'))
      const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'product')] })
      const directory = path.join(home, 'external')
      const config = path.join(directory, 'adapters.json')
      const sessions = path.join(directory, 'adapter-sessions.json')
      const target = path.join(binding.root, 'adapter-sessions.json')
      const configBytes = scenario === 'invalid' ? '{"telegram":["private-fixture"]}' : scenario === 'external-auth'
        ? JSON.stringify({ whatsapp: { authDir: path.join(directory, 'private-fixture') } }) : '{}'
      const previousExitCode = process.exitCode
      const messages: string[] = []
      let lease: Awaited<ReturnType<typeof acquireStorageWriter>> | undefined
      try {
        await fs.mkdir(directory)
        await fs.mkdir(binding.root)
        await fs.writeFile(path.join(binding.root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
        await fs.writeFile(config, configBytes)
        await fs.writeFile(sessions, '{}')
        if (scenario === 'target-conflict') await fs.writeFile(target, '{"different":true}')
        if (scenario === 'live-writer') lease = await acquireStorageWriter(binding)
        const input = Readable.from((async function* () {
          if (scenario === 'late-target') await fs.writeFile(target, '{"different":true}')
          if (scenario === 'replaced') {
            await fs.rename(sessions, `${sessions}.original`)
            await fs.writeFile(sessions, '{}')
          }
          yield 'yes\n'
        })()) as NodeJS.ReadableStream & { isTTY: true }
        input.isTTY = true
        await runStorageAdoptionCommand(['storage', 'adopt', 'im-adapters', '--file', config, '--file', sessions], {
          binding, input, output: { write: value => { messages.push(String(value)); return true } },
          hooks: { assertQuiescent: async () => {} },
        })
        const expected = {
          invalid: 'Invalid IM adapter configuration', 'external-auth': 'migrate the complete account first',
          'target-conflict': 'Conflicting IM storage file', 'late-target': 'Conflicting IM storage file',
          'live-writer': 'Active storage writer', replaced: 'Approved storage file changed',
        }
        expect(messages.join('')).toContain(expected[scenario])
        expect(messages.join('')).not.toContain('private-fixture')
        expect(process.exitCode).toBe(1)
        expect(await fs.readFile(config, 'utf8')).toBe(configBytes)
        expect(await fs.readFile(sessions, 'utf8')).toBe('{}')
        await expect(fs.lstat(path.join(binding.root, 'adapters.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        await lease?.release()
        process.exitCode = previousExitCode ?? 0
        await fs.rm(home, { recursive: true, force: true })
      }
    },
  )

  test.each(['overridden-saved-auth', 'unbound-default'] as const)('checks saved WhatsApp configuration: %s', async scenario => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-im-auth-'))
    const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'product')] })
    const source = path.join(home, 'external', 'adapters.json')
    const managed = path.join(binding.root, 'whatsapp-auth', 'default')
    const external = path.join(home, 'external', 'whatsapp-auth', 'default')
    const override = scenario === 'overridden-saved-auth'
    const bytes = JSON.stringify({ telegram: { allowedUsers: [42] }, whatsapp: { authDir: override ? external : managed } })
    const previousExitCode = process.exitCode
    const previousOverride = process.env.WHATSAPP_AUTH_DIR
    const output: string[] = []
    try {
      await fs.mkdir(path.dirname(source))
      await fs.writeFile(source, bytes)
      delete process.env.WHATSAPP_AUTH_DIR
      if (override) {
        await fs.mkdir(managed, { recursive: true })
        await fs.writeFile(path.join(binding.root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
        await fs.writeFile(path.join(managed, 'creds.json'), '{}')
        process.env.WHATSAPP_AUTH_DIR = managed
      }
      await runStorageAdoptionCommand(['storage', 'adopt', 'im-adapters', '--file', source], {
        binding, input: ttyInput('yes\n'), output: { write: value => { output.push(String(value)); return true } },
        hooks: { assertQuiescent: async () => {} },
      })
      const target = path.join(binding.root, 'adapters.json')
      if (override) {
        expect(output.join('')).toContain('migrate the complete account first')
        expect(await fs.readFile(source, 'utf8')).toBe(bytes)
        await expect(fs.lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
      } else {
        expect(output.join('')).toContain('Storage adoption completed')
        expect(await fs.readFile(target, 'utf8')).toBe(bytes)
        await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    } finally {
      if (previousOverride === undefined) delete process.env.WHATSAPP_AUTH_DIR
      else process.env.WHATSAPP_AUTH_DIR = previousOverride
      process.exitCode = previousExitCode ?? 0
      await fs.rm(home, { recursive: true, force: true })
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
