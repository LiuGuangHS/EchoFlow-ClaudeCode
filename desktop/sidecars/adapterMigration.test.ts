// @vitest-environment node

import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'
import { ensureEchoFlowConfigRoot } from '../../src/utils/echoFlowConfigRoot'

const run = promisify(execFile)

it('the real adapter launcher confirms inactivity when migration races credential gating', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'haha-adapter-inactive-'))
  const data = path.join(root, 'data')
  // Storage admission precedes credential gating; only its owned scaffolding may exist.
  await ensureEchoFlowConfigRoot(data)
  await mkdir(path.join(data, 'echoflow-code/migrations/writers'), { recursive: true })
  const entries = (await readdir(data, { recursive: true })).sort()
  const marker = await readFile(path.join(data, 'app.json'), 'utf8')
  const repo = path.resolve(import.meta.dirname, '../..')
  // Run from the fixture with env files off: Bun would otherwise load a `.env`
  // from the caller's checkout, and adapter credentials there change the gate.
  const child = spawn('bun', ['--no-env-file', path.join(repo, 'desktop/sidecars/claude-sidecar.ts'), 'adapters', '--app-root', repo, '--feishu', '--telegram', '--wechat', '--dingtalk', '--whatsapp', '--wecom', '--qq', '--slack'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: root,
      USERPROFILE: root,
      TMPDIR: root,
      TMP: root,
      TEMP: root,
      CLAUDE_CONFIG_DIR: data,
      CC_HAHA_MIGRATION_CONTROL: '1',
      CC_HAHA_LOCAL_ACCESS_TOKEN: 'isolated-migration-token',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) })
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  child.stdin.on('error', () => {})
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  try {
    child.stdin.write(JSON.stringify({ type: 'migration_quiesce', requestId: 'early', token: 'isolated-migration-token' }) + '\n')
    expect(await closed, stderr).toBe(0)
    expect(stdout.trim()).toBe('{"type":"migration_adapter_inactive"}')
    expect(stderr.match(/requested but/g)).toHaveLength(8)
    expect((await readdir(data, { recursive: true })).sort()).toEqual(entries)
    expect(await readFile(path.join(data, 'app.json'), 'utf8')).toBe(marker)
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    await closed.catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)

it.each(['telegram', 'whatsapp'] as const)('scopes WhatsApp path validation to the selected %s sidecar', async (platform) => {
  const home = await mkdtemp(path.join(tmpdir(), 'adapter-platform-storage-'))
  const data = path.join(home, 'data')
  const outside = path.join(home, 'old-auth')
  try {
    await ensureEchoFlowConfigRoot(data)
    await mkdir(outside)
    const creds = path.join(outside, 'creds.json')
    const credentials = '{"registered":true,"sentinel":"preserve external bytes"}\n'
    const config = JSON.stringify({
      serverUrl: 'ws://fixture.invalid',
      telegram: { botToken: '12345:fixture-token' },
      whatsapp: { authDir: outside },
    })
    const settings = path.join(data, 'adapters.json')
    await writeFile(creds, credentials)
    await writeFile(settings, config)
    const repo = path.resolve(import.meta.dirname, '../..')
    const entry = path.join(repo, 'desktop/sidecars/claude-sidecar.ts')
    const lifecycle = path.join(repo, 'adapters/common/migration-lifecycle.ts')
    const launch = run('bun', ['--no-env-file', '--eval', `
      import assert from 'node:assert/strict'
      import fs from 'node:fs'
      import { spyOn } from 'bun:test'
      const existsSync = fs.existsSync
      spyOn(fs, 'existsSync').mockImplementation(file => {
        assert.notEqual(file, ${JSON.stringify(creds)}, 'must reject before probing external credentials')
        return existsSync(file)
      })
      globalThis.fetch = async () => { throw new Error('Unexpected network request') }
      const { Api, Bot } = await import(Bun.resolveSync('grammy', ${JSON.stringify(path.join(repo, 'adapters/telegram'))}))
      spyOn(Api.prototype, 'deleteMyCommands').mockResolvedValue(true)
      spyOn(Api.prototype, 'setMyCommands').mockResolvedValue(true)
      spyOn(Bot.prototype, 'start').mockImplementation(async function () {
        assert.equal(this.token, '12345:fixture-token')
        console.log('TELEGRAM_POLLING_STARTED')
      })
      process.argv = [process.execPath, ${JSON.stringify(entry)}, 'adapters', '--app-root', ${JSON.stringify(repo)}, '--${platform}']
      await import(${JSON.stringify(entry)})
      const { quiesceAdapterProcess } = await import(${JSON.stringify(lifecycle)})
      await quiesceAdapterProcess()
    `], {
      cwd: home,
      env: createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: data }),
      timeout: 8_000,
      killSignal: 'SIGKILL',
    })
    if (platform === 'telegram') {
      expect((await launch).stdout).toContain('TELEGRAM_POLLING_STARTED')
    } else {
      await expect(launch).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('outside the selected storage root'),
        stdout: expect.not.stringContaining('starting WhatsApp adapter'),
      })
    }
    expect(await readdir(outside)).toEqual(['creds.json'])
    expect(await readFile(creds, 'utf8')).toBe(credentials)
    expect(await readFile(settings, 'utf8')).toBe(config)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}, 10_000)
