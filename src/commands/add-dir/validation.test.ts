import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { validateDirectoryForWorkspace } from './validation.js'

const cleanupDirs = new Set<string>()

afterEach(async () => {
  await Promise.all([...cleanupDirs].map(dir => rm(dir, { recursive: true, force: true })))
  cleanupDirs.clear()
})

describe('validateDirectoryForWorkspace', () => {
  it('accepts a Linux absolute workspace path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'echoflow-wsl-add-dir-'))
    cleanupDirs.add(workspace)
    await mkdir(join(workspace, 'src'))

    await expect(validateDirectoryForWorkspace(workspace, getEmptyToolPermissionContext()))
      .resolves.toEqual({ resultType: 'success', absolutePath: workspace })
  })
})
