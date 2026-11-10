import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultVoiceDataRoot, senseVoiceLayout } from './layout.js'

const originalConfig = process.env.CLAUDE_CONFIG_DIR
const directories: string[] = []

afterEach(async () => {
  if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfig
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

test('keeps existing voice installs in the EchoFlow directory and resolves the config lazily', async () => {
  for (let i = 0; i < 2; i++) {
    const config = await mkdtemp(join(tmpdir(), 'voice-layout-'))
    directories.push(config)
    const legacyRoot = join(config, 'echoflow-code', 'voice')
    const layout = senseVoiceLayout(legacyRoot)
    await mkdir(layout.base, { recursive: true })
    await writeFile(layout.manifest, '{"existing":"fixture"}')

    process.env.CLAUDE_CONFIG_DIR = config
    expect(defaultVoiceDataRoot()).toBe(legacyRoot)
    expect(await readFile(senseVoiceLayout(defaultVoiceDataRoot()).manifest, 'utf8')).toBe('{"existing":"fixture"}')
  }
})
