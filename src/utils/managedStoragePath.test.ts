import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveManagedStoragePath } from './managedStoragePath.js'

let directory: string
let root: string
let savedRoot: string | undefined

beforeEach(async () => {
  savedRoot = process.env.CLAUDE_CONFIG_DIR
  directory = await mkdtemp(join(tmpdir(), 'managed-storage-'))
  root = join(directory, 'root')
  await mkdir(root)
  process.env.CLAUDE_CONFIG_DIR = root
})

afterEach(async () => {
  if (savedRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedRoot
  await rm(directory, { recursive: true, force: true })
})

test('accepts a missing descendant without creating directories', async () => {
  const path = join(root, 'new', 'state')
  expect(resolveManagedStoragePath(path, 'fixture')).toBe(path)
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('rejects relative, NUL and sibling-prefix paths', () => {
  for (const path of ['relative', `${root}\0`, `${root}-outside/state`, join(root, '..', 'outside')]) {
    expect(() => resolveManagedStoragePath(path, 'fixture')).toThrow()
  }
})

test('rejects a physical escape without changing outside data', async () => {
  const outside = join(directory, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'state'), 'foreign')
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => resolveManagedStoragePath(join(root, 'linked', 'state'), 'fixture')).toThrow('outside')
  expect(await readFile(join(outside, 'state'), 'utf8')).toBe('foreign')
})

test('rejects dangling symlinks, including before a missing final component', async () => {
  await symlink(join(directory, 'missing'), join(root, 'dangling'), process.platform === 'win32' ? 'junction' : 'dir')
  for (const path of [join(root, 'dangling'), join(root, 'dangling', 'state')]) {
    expect(() => resolveManagedStoragePath(path, 'fixture')).toThrow('dangling symlink')
  }
})

async function relocations(mappings: { from: string; to: string }[], version = 2) {
  await mkdir(join(root, 'echoflow-code'), { recursive: true })
  await writeFile(join(root, 'echoflow-code', 'storage-relocations.json'), JSON.stringify({
    version, previousRoots: [join(directory, 'old')], mappings,
  }))
}

test('resolves retired configured paths using the longest centralized mapping without opening the old root', async () => {
  const old = join(directory, 'old')
  await relocations([{ from: old, to: '.' }, { from: join(old, 'cc-haha'), to: 'echoflow-code' }])
  const destination = join(root, 'echoflow-code', 'café', 'state')
  await mkdir(join(root, 'echoflow-code', 'café'))
  await writeFile(destination, 'retained')
  await symlink(join(directory, 'missing'), old, process.platform === 'win32' ? 'junction' : 'dir')
  expect(resolveManagedStoragePath(join(old, 'cc-haha', 'café', 'state'), 'fixture')).toBe(destination)
  expect(resolveManagedStoragePath(join(old, 'cc-haha'), 'fixture')).toBe(join(root, 'echoflow-code'))
  expect(resolveManagedStoragePath(old, 'fixture')).toBe(root)
  expect(await readFile(destination, 'utf8')).toBe('retained')
})

test('does not infer general overrides from v1 roots or sibling-prefix and Unicode-equivalent paths', async () => {
  const old = join(directory, 'old-café')
  await relocations([{ from: old, to: '.' }])
  for (const path of [join(`${old}-outside`, 'state'), join(old.normalize('NFC'), 'state')]) {
    expect(() => resolveManagedStoragePath(path, 'fixture')).toThrow('outside')
  }
  await relocations([], 1)
  expect(() => resolveManagedStoragePath(join(directory, 'old', 'state'), 'fixture')).toThrow('outside')
})

test('rejects ambiguous or invalid mappings and physical escapes at the mapped destination', async () => {
  const old = join(directory, 'old')
  await relocations([{ from: old, to: '.' }, { from: old, to: 'other' }])
  expect(() => resolveManagedStoragePath(join(old, 'state'), 'fixture')).toThrow()
  await relocations([{ from: old, to: '../outside' }])
  expect(() => resolveManagedStoragePath(join(old, 'state'), 'fixture')).toThrow()
  await relocations([{ from: old, to: 'linked' }])
  const outside = join(directory, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'state'), 'foreign')
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => resolveManagedStoragePath(join(old, 'state'), 'fixture')).toThrow('outside')
  expect(await readFile(join(outside, 'state'), 'utf8')).toBe('foreign')
})

test('accepts the configured root itself as a physical alias', async () => {
  const alias = join(directory, 'alias')
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  process.env.CLAUDE_CONFIG_DIR = alias
  expect(resolveManagedStoragePath(join(alias, 'state'), 'fixture')).toBe(join(alias, 'state'))
})
