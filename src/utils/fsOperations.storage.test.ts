import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getFsImplementation, safeResolvePath } from './fsOperations.js'
import { readFileSync } from './fileRead.js'

test('settings reads use the physical Unicode spelling returned by the filesystem', async () => {
  const home = await mkdtemp(join(tmpdir(), 'physical-storage-read-'))
  try {
    const root = join(home, 'selected-café')
    await mkdir(root)
    const file = join(root, 'settings.json')
    const raw = JSON.stringify({ unknown: { preserve: true }, autoMemoryDirectory: join(root, 'memory') })
    await writeFile(file, raw)
    const physical = await realpath(file)
    expect(getFsImplementation().realpathSync(file)).toBe(physical)
    expect(safeResolvePath(getFsImplementation(), file).resolvedPath).toBe(physical)
    expect(readFileSync(file)).toBe(raw)
    expect(await readFile(file, 'utf8')).toBe(raw)
  } finally { await rm(home, { recursive: true, force: true }) }
})
