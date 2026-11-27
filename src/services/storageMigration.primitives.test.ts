import { afterEach, beforeEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  assertMigrationManifest, canonicalPath, copyMigrationFiles, hashFile, migrationManifest, restoreMigrationPermissions,
  scanMigrationFiles, skipMigrationEntry, validateMigrationManifest, verifyMigrationSource,
  type MigrationFile,
} from './storageMigration.js'

let root: string
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'migration-primitives-')))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const sha = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex')
const dir = async (...parts: string[]) => {
  const directory = path.join(root, ...parts)
  await fs.mkdir(directory, { recursive: true })
  return directory
}
const write = async (file: string, text: string) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text)
}

test('skips only regenerable indexes, runtime caches, session pid files and lock files', () => {
  for (const skipped of [
    'cc-haha/db/index-v1.sqlite', 'cc-haha/db/index-v1.sqlite-wal', 'cc-haha/db/search-index-v1.sqlite-shm',
    '.runtime/venv', '.runtime/venv/bin/python', '.runtime/requirements.sha256', '.runtime/venv-base-interpreter.txt',
    '.runtime/cu-helper.daemon.1.sock', '.runtime/cu-helper.daemon.1.sock.pid', 'sessions/123.json',
    '.credentials.json.lock', '.config.json.lock', '.claude.json.lock', '.claude-custom-oauth.json.lock',
  ]) expect(skipMigrationEntry(skipped)).toBe(true)
  for (const kept of [
    'cc-haha/db/other.sqlite', 'cc-haha/db/index-v1.sqlite.bak', '.runtime/venv2', '.runtime/other', 'sessions/abc.json',
    'sessions/1.json.bak', 'notes.txt', '.credentials.json', '.claude.json',
  ]) expect(skipMigrationEntry(kept)).toBe(false)
})

test('canonicalPath resolves links of the nearest existing ancestor and keeps missing tails', async () => {
  const real = await dir('real')
  await fs.symlink(real, path.join(root, 'alias'), 'dir')
  expect(await canonicalPath(path.join(root, 'alias', 'missing', 'child'))).toBe(path.join(real, 'missing', 'child'))
  await write(path.join(root, 'plain'), 'file')
  await expect(canonicalPath(path.join(root, 'plain', 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
})

test('scans in sorted order, records links without following them and omits skipped entries', async () => {
  const source = await dir('source')
  await write(path.join(source, 'b.txt'), 'bb')
  await write(path.join(source, 'a', 'inner.txt'), 'i')
  await write(path.join(source, 'sessions', '7.json'), '{}')
  await fs.symlink('b.txt', path.join(source, 'link'))
  const files = await scanMigrationFiles(source)
  expect(files.map(file => [file.relative, file.kind])).toEqual([
    ['a', 'directory'], [path.join('a', 'inner.txt'), 'file'], ['b.txt', 'file'], ['link', 'link'], ['sessions', 'directory'],
  ])
  expect(files.find(file => file.kind === 'link')!.link).toBe('b.txt')
  expect(files.find(file => file.relative === 'b.txt')!.size).toBe(2)
})

test.skipIf(process.platform === 'win32')('rejects unsupported entries such as fifos', async () => {
  const source = await dir('source')
  expect(Bun.spawnSync(['mkfifo', path.join(source, 'pipe')]).exitCode).toBe(0)
  await expect(scanMigrationFiles(source)).rejects.toThrow('Unsupported data entry: pipe')
})

test('adds global config files from the home directory only when the root has no .config.json', async () => {
  const source = await dir('source')
  const home = await dir('home')
  await write(path.join(home, '.claude.json'), '{}')
  await write(path.join(home, '.claude-custom-oauth.json'), '{}')
  expect((await scanMigrationFiles(source, home)).map(file => file.relative)).toEqual(['.claude.json', '.claude-custom-oauth.json'])
  await write(path.join(source, '.config.json'), '{}')
  expect((await scanMigrationFiles(source, home)).map(file => file.relative)).toEqual(['.config.json'])
})

test('refuses a global config that is not a regular file or collides with a root entry', async () => {
  const source = await dir('source')
  const home = await dir('home')
  await dir('home', '.claude.json')
  await expect(scanMigrationFiles(source, home)).rejects.toThrow('Global configuration is not a regular file: .claude.json')
  await fs.rm(path.join(home, '.claude.json'), { recursive: true })
  await write(path.join(home, '.claude.json'), '{}')
  await write(path.join(source, '.claude.json'), '{"root":true}')
  await expect(scanMigrationFiles(source, home)).rejects.toThrow('Global configuration collision: .claude.json')
})

test('scanning and hashing stop on an aborted signal', async () => {
  const source = await dir('source')
  await write(path.join(source, 'a.txt'), 'a')
  const aborted = AbortSignal.abort()
  await expect(scanMigrationFiles(source, undefined, aborted)).rejects.toThrow()
  await expect(hashFile(path.join(source, 'a.txt'), aborted)).rejects.toThrow()
  expect(await hashFile(path.join(source, 'a.txt'))).toBe(sha('a'))
})

async function sourceTree() {
  const source = await dir('source')
  const target = path.join(root, 'target')
  const staged = await dir('staged')
  await write(path.join(source, 'data', 'a.txt'), 'alpha')
  await fs.chmod(path.join(source, 'data', 'a.txt'), 0o640)
  const stamp = new Date(1_700_000_000_000)
  await fs.utimes(path.join(source, 'data', 'a.txt'), stamp, stamp)
  await fs.symlink(path.join(source, 'data', 'a.txt'), path.join(source, 'absolute-internal'))
  await fs.symlink(path.join('data', 'a.txt'), path.join(source, 'relative-internal'))
  await fs.symlink(path.join(root, 'elsewhere', 'x'), path.join(source, 'external'))
  return { source, target, staged, files: await scanMigrationFiles(source) }
}

test('copies files with verified digests, preserves mode and mtime, and rebases only internal absolute links', async () => {
  const { source, target, staged, files } = await sourceTree()
  const seen: string[] = []
  let checks = 0
  await copyMigrationFiles(files, source, target, staged, new AbortController().signal, file => { seen.push(file.relative) }, async () => { checks++ })
  expect(seen).toEqual(files.map(file => file.relative))
  expect(checks).toBe(files.length)
  const copy = path.join(staged, 'data', 'a.txt')
  expect(await fs.readFile(copy, 'utf8')).toBe('alpha')
  expect(files.find(file => file.relative.endsWith('a.txt'))!.digest).toBe(sha('alpha'))
  expect((await fs.stat(copy)).mode & 0o777).toBe(0o640)
  expect((await fs.stat(copy)).mtimeMs).toBe(1_700_000_000_000)
  expect(await fs.readlink(path.join(staged, 'absolute-internal'))).toBe(path.join(target, 'data', 'a.txt'))
  expect(await fs.readlink(path.join(staged, 'relative-internal'))).toBe(path.join('data', 'a.txt'))
  expect(await fs.readlink(path.join(staged, 'external'))).toBe(path.join(root, 'elsewhere', 'x'))
})

test('refuses entries that would be written outside the staging directory or after an abort', async () => {
  const { source, target, staged } = await sourceTree()
  const escape: MigrationFile = { relative: path.join('..', 'escape'), source, kind: 'directory', size: 0, mode: 0o700, mtime: 0 }
  await expect(copyMigrationFiles([escape], source, target, staged, new AbortController().signal, () => {})).rejects.toThrow('Unsafe migration path')
  await expect(fs.stat(path.join(root, 'escape'))).rejects.toMatchObject({ code: 'ENOENT' })
  const file = (await scanMigrationFiles(source))[0]!
  await expect(copyMigrationFiles([file], source, target, staged, AbortSignal.abort(), () => {})).rejects.toThrow()
})

test('restores recorded permissions after metadata edits and ignores links', async () => {
  const staged = await dir('staged')
  await dir('staged', 'data')
  await write(path.join(staged, 'data', 'a.txt'), 'a')
  const entry = (relative: string, kind: MigrationFile['kind'], mode: number): MigrationFile => ({ relative, source: '', kind, size: 0, mode, mtime: 0 })
  await restoreMigrationPermissions([
    entry('data', 'directory', 0o40750), entry(path.join('data', 'a.txt'), 'file', 0o100600), entry('absent-link', 'link', 0o120777),
  ], staged, new AbortController().signal)
  expect((await fs.stat(path.join(staged, 'data'))).mode & 0o777).toBe(0o750)
  expect((await fs.stat(path.join(staged, 'data', 'a.txt'))).mode & 0o777).toBe(0o600)
  await expect(restoreMigrationPermissions([entry('data', 'directory', 0o700)], staged, AbortSignal.abort())).rejects.toThrow()
})

test('detects source changes by shape and by same-size content rewrites', async () => {
  const { source, target, staged, files } = await sourceTree()
  const signal = new AbortController().signal
  await copyMigrationFiles(files, source, target, staged, signal, () => {})
  await verifyMigrationSource(files, await scanMigrationFiles(source), signal)

  const file = path.join(source, 'data', 'a.txt')
  await write(file, 'omega')
  const stamp = new Date(1_700_000_000_000)
  await fs.utimes(file, stamp, stamp)
  await expect(verifyMigrationSource(files, await scanMigrationFiles(source), signal)).rejects.toThrow('Source data changed: data')

  await write(path.join(source, 'new.txt'), 'n')
  await expect(verifyMigrationSource(files, await scanMigrationFiles(source), signal)).rejects.toThrow('Source data changed during migration')
})

test('builds a manifest and validates the copied tree against it', async () => {
  const tree = await dir('tree')
  await write(path.join(tree, 'd', 'f.txt'), 'content')
  await fs.symlink('f.txt', path.join(tree, 'd', 'l'))
  const manifest = await migrationManifest(tree)
  expect(manifest).toEqual([
    { relative: 'd', kind: 'directory' },
    { relative: path.join('d', 'f.txt'), kind: 'file', digest: sha('content') },
    { relative: path.join('d', 'l'), kind: 'link', link: 'f.txt' },
  ])
  await validateMigrationManifest(tree, manifest)

  await write(path.join(tree, 'd', 'f.txt'), 'tampered')
  await expect(validateMigrationManifest(tree, manifest)).rejects.toThrow('Migration file changed: d')
  await write(path.join(tree, 'd', 'f.txt'), 'content')

  await fs.rm(path.join(tree, 'd', 'l'))
  await fs.symlink('other', path.join(tree, 'd', 'l'))
  await expect(validateMigrationManifest(tree, manifest)).rejects.toThrow('Migration link changed')
  await fs.rm(path.join(tree, 'd', 'l'))
  await write(path.join(tree, 'd', 'l'), 'not a link')
  await expect(validateMigrationManifest(tree, manifest)).rejects.toThrow('Migration link changed')
})

test('manifest validation rejects a replaced parent directory and a replaced directory entry', async () => {
  const tree = await dir('tree')
  await write(path.join(tree, 'd', 'f.txt'), 'content')
  const manifest = await migrationManifest(tree)
  const outside = await dir('outside')
  await write(path.join(outside, 'f.txt'), 'content')
  await fs.rm(path.join(tree, 'd'), { recursive: true })
  await fs.symlink(outside, path.join(tree, 'd'), 'dir')
  await expect(validateMigrationManifest(tree, manifest.filter(entry => entry.kind === 'file'))).rejects.toThrow('Migration manifest parent was replaced')

  await fs.rm(path.join(tree, 'd'))
  await write(path.join(tree, 'd'), 'now a file')
  await expect(validateMigrationManifest(tree, manifest)).rejects.toThrow('Migration directory missing: d')
})

test('rejects malformed, escaping and duplicate manifest entries', () => {
  const digest = 'a'.repeat(64)
  expect(() => assertMigrationManifest('nope')).toThrow('Invalid migration manifest')
  for (const entry of [
    null, { relative: '', kind: 'directory' }, { relative: '/abs', kind: 'directory' }, { relative: 'C:\\abs', kind: 'directory' },
    { relative: 'a/../b', kind: 'directory' }, { relative: 'a//b', kind: 'directory' }, { relative: 'a\0b', kind: 'directory' },
    { relative: 'x', kind: 'socket' }, { relative: 'x', kind: 'file' }, { relative: 'x', kind: 'file', digest: 'short' },
    { relative: 'x', kind: 'link' },
  ]) expect(() => assertMigrationManifest([entry])).toThrow('Invalid migration manifest entry')
  expect(() => assertMigrationManifest([{ relative: 'x', kind: 'file', digest }, { relative: 'x', kind: 'directory' }])).toThrow('Duplicate migration manifest entry')
  expect(() => assertMigrationManifest([{ relative: 'x', kind: 'file', digest }, { relative: 'y', kind: 'link', link: '' }])).not.toThrow()
})
