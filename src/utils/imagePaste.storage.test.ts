import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { quote } from './src/utils/bash/shellQuote.ts'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
const external = process.env.CLAUDE_CODE_TMPDIR
mkdirSync(external, { recursive: true })
const outcome = process.env.OUTCOME
const platform = process.env.CLIPBOARD_PLATFORM
Object.defineProperty(process, 'platform', { value: platform })
const paths = []
let calls = 0
const actualExeca = await import('execa')
mock.module('execa', () => ({ ...actualExeca, execa: async command => {
  calls++
  if (outcome === 'path') return { exitCode: 0, stdout: '/fixture/user image.png' }
  assert.equal(existsSync(temporary), true)
  const directories = readdirSync(temporary)
  assert.equal(directories.length, 1)
  const directory = join(temporary, directories[0])
  assert.equal(lstatSync(directory).isDirectory(), true)
  if (platform !== 'win32') assert.equal(lstatSync(directory).mode & 0o777, 0o700)
  const screenshot = join(directory, 'clipboard.png')
  if (calls % 2 === 1) {
    paths.push(screenshot)
    if (outcome === 'check-throw') throw new Error('fixture check failed')
    return { exitCode: outcome === 'no-image' ? 1 : 0 }
  }
  if (platform === 'linux') assert.ok(command.includes(quote([screenshot])))
  if (platform === 'darwin') {
    assert.ok(command.includes(quote(['set fp to open for access POSIX file ' + JSON.stringify(screenshot) + ' with write permission'])))
  }
  if (platform === 'win32') {
    const script = Buffer.from(command.split(' ').at(-1), 'base64').toString('utf16le')
    assert.ok(script.includes(screenshot.replace(/['\\u2018-\\u201B]/g, '$&$&')))
    assert.ok(script.includes('Get-Clipboard -Format Image'))
  }
  if (outcome === 'save-throw') throw new Error('fixture save failed')
  if (outcome === 'save-error') return { exitCode: 1 }
  if (outcome !== 'read-error') writeFileSync(screenshot, Buffer.from([137, 80, 78, 71]))
  return { exitCode: 0 }
} }))
mock.module('./src/utils/imageResizer.ts', () => ({
  maybeResizeAndDownsampleImageBuffer: async buffer => {
    if (outcome === 'resize-error') throw new Error('fixture resize failed')
    return { buffer, mediaType: 'png' }
  },
  detectImageFormatFromBase64: () => 'image/png',
}))
const { getImageFromClipboard, getImagePathFromClipboard } = await import('./src/utils/imagePaste.ts')
if (outcome === 'path') {
  assert.equal(await getImagePathFromClipboard(), '/fixture/user image.png')
  assert.equal(existsSync(temporary), false)
} else {
  for (let attempt = 0; attempt < 2; attempt++) {
    calls = 0
    const result = await getImageFromClipboard()
    assert.equal(result?.mediaType ?? null, outcome === 'success' ? 'image/png' : null)
    assert.deepEqual(readdirSync(temporary), [])
  }
  assert.equal(paths.length, 2)
  assert.notEqual(paths[0], paths[1])
}
assert.deepEqual(readdirSync(external), [])
`

for (const platform of ['linux', 'darwin', 'win32']) {
  for (const outcome of ['success', 'no-image', 'check-throw', 'save-error', 'save-throw', 'read-error', 'resize-error', 'path']) {
    test(`image paste scratch is private and cleaned (${platform}, ${outcome})`, async () => {
      const home = await mkdtemp(join(tmpdir(), 'image-paste-storage-test-'))
      try {
        const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
          cwd: new URL('../../', import.meta.url).pathname,
          env: createSandboxedTestEnvironment(home, {
            OUTCOME: outcome, CLIPBOARD_PLATFORM: platform,
            CLAUDE_CONFIG_DIR: join(home, process.platform === 'win32' ? "product spaces '$`中文’" : 'product spaces \'"$`中文’'),
            CLAUDE_CODE_TMPDIR: join(home, 'legacy-scratch'),
          }),
          encoding: 'utf8', timeout: 30_000,
        })
        expect(result.status, result.stderr || result.stdout).toBe(0)
      } finally { await rm(home, { recursive: true, force: true }) }
    })
  }
}
