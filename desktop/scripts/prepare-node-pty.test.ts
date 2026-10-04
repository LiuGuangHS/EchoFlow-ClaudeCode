import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { prepareNodePtyPrebuilds } from './prepare-node-pty'

const tempDirs: string[] = []

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echoflow-node-pty-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('prepare-node-pty', () => {
  it('does not chmod Unix spawn helpers while preparing from Windows', () => {
    const prebuildsDir = path.join(tempDir(), 'prebuilds')
    const helperPath = path.join(prebuildsDir, 'darwin-arm64', 'spawn-helper')
    fs.mkdirSync(path.dirname(helperPath), { recursive: true })
    fs.writeFileSync(helperPath, 'helper')
    const chmod = vi.spyOn(fs, 'chmodSync')

    const result = prepareNodePtyPrebuilds({ prebuildsDir, platform: 'win32' })

    expect(result).toEqual({ helpersSeen: 1, helpersChanged: 0 })
    expect(chmod).not.toHaveBeenCalled()
  })
})
