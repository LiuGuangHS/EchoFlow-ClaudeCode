import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import {
  createWindowsMigrationPermissionsRunner,
  preflightWindowsMigrationPermissions,
  preserveWindowsMigrationPermissions,
  restrictWindowsMigrationStaging,
  type MigrationPermissionsRunner,
} from './storageMigrationPermissions.js'

const roots: string[] = []

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-migration-acl-')))
  roots.push(root)
  const sourceDir = path.join(root, 'source')
  const targetDir = path.join(root, 'target')
  await fs.mkdir(sourceDir)
  await fs.mkdir(targetDir)
  const sourceFile = path.join(sourceDir, 'file.txt')
  const targetFile = path.join(targetDir, 'file.txt')
  await fs.writeFile(sourceFile, 'source fixture bytes')
  await fs.copyFile(sourceFile, targetFile)
  return { root, sourceDir, targetDir, sourceFile, targetFile }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

function fakeChild() {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdin, stdout, kill: mock(() => true) })
  return { child, stdin, stdout, spawnProcess: (() => child) as unknown as typeof spawn }
}

describe('Windows migration permission runner', () => {
  test('refuses to run on other platforms', async () => {
    const runner = createWindowsMigrationPermissionsRunner((() => { throw new Error('must not spawn') }) as unknown as typeof spawn, 'linux')
    await expect(runner('script', '{}')).rejects.toThrow('unavailable on this platform')
  })

  test('spawns the system PowerShell without a shell and sends the payload on stdin', async () => {
    const { child, stdin, stdout } = fakeChild()
    const calls: unknown[][] = []
    const runner = createWindowsMigrationPermissionsRunner(((...args: unknown[]) => { calls.push(args); return child }) as unknown as typeof spawn, 'win32')
    const received: Buffer[] = []
    stdin.on('data', chunk => received.push(chunk))
    const operation = runner('Write-Output 1', '{"payload":true}')
    stdout.write('{"version":1,"ok":true}')
    child.emit('close', 0)
    await expect(operation).resolves.toBeUndefined()
    const [executable, args, options] = calls[0]!
    expect(String(executable).toLowerCase()).toContain('powershell.exe')
    expect(args).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from('Write-Output 1', 'utf16le').toString('base64')])
    expect(options).toMatchObject({ windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'], timeout: 60_000 })
    expect(Buffer.concat(received).toString('utf8')).toBe('{"payload":true}')
  })

  test('rejects a pre-aborted signal before spawning', async () => {
    let spawned = false
    const runner = createWindowsMigrationPermissionsRunner((() => { spawned = true }) as unknown as typeof spawn, 'win32')
    const abort = new AbortController()
    abort.abort(new Error('cancelled early'))
    await expect(runner('script', '{}', abort.signal)).rejects.toThrow('cancelled early')
    expect(spawned).toBe(false)
  })

  test('maps a synchronous spawn failure to a bounded process-error', async () => {
    const runner = createWindowsMigrationPermissionsRunner((() => { throw new Error('C:\\Users\\secret spawn failure') }) as unknown as typeof spawn, 'win32')
    const failure = await runner('script', '{}').catch((error: Error) => error)
    expect((failure as Error).message).toBe('Could not preserve Windows data permissions; migration was stopped [win-acl/v1 process-error]')
  })

  test('kills the child on process error and settles only after close', async () => {
    const { child, spawnProcess } = fakeChild()
    const runner = createWindowsMigrationPermissionsRunner(spawnProcess, 'win32')
    let settled = false
    const operation = runner('script', '{}')
    void operation.then(() => { settled = true }, () => { settled = true })
    child.emit('error', new Error('private diagnostic'))
    await new Promise(resolve => setImmediate(resolve))
    expect(child.kill).toHaveBeenCalled()
    expect(settled).toBe(false)
    child.emit('close', null)
    await expect(operation).rejects.toThrow('[win-acl/v1 process-error]')
  })

  test('reports stdin and stdout stream errors as bounded reasons', async () => {
    for (const [stream, reason] of [['stdin', 'input-error'], ['stdout', 'output-error']] as const) {
      const { child, stdin, stdout, spawnProcess } = fakeChild()
      const operation = createWindowsMigrationPermissionsRunner(spawnProcess, 'win32')('script', '{}')
      ;(stream === 'stdin' ? stdin : stdout).emit('error', new Error('C:\\Users\\secret'))
      child.emit('close', 1)
      const failure = await operation.catch((error: Error) => error)
      expect((failure as Error).message).toEndWith(`[win-acl/v1 ${reason}]`)
      expect(child.kill).toHaveBeenCalled()
    }
  })

  test('maps a throwing stdin.end to input-error', async () => {
    const { child, stdin, spawnProcess } = fakeChild()
    stdin.end = (() => { throw new Error('write after end') }) as unknown as typeof stdin.end
    const operation = createWindowsMigrationPermissionsRunner(spawnProcess, 'win32')('script', '{}')
    child.emit('close', 1)
    await expect(operation).rejects.toThrow('[win-acl/v1 input-error]')
  })

  test('reports cancelled, ignoring a late success reply after abort', async () => {
    const { child, stdout, spawnProcess } = fakeChild()
    const abort = new AbortController()
    const operation = createWindowsMigrationPermissionsRunner(spawnProcess, 'win32')('script', '{}', abort.signal)
    abort.abort()
    stdout.write('{"version":1,"ok":true}')
    child.emit('close', 0)
    await expect(operation).rejects.toThrow('[win-acl/v1 cancelled]')
  })

  const failure = { version: 1, ok: false, phase: 'preserve', operation: 'write-acl', entry: 128, kind: 'directory', type: 'UnauthorizedAccessException', hresult: '0x80070005' }

  test('surfaces only a fully allowlisted structured failure', async () => {
    const { child, stdout, spawnProcess } = fakeChild()
    const operation = createWindowsMigrationPermissionsRunner(spawnProcess, 'win32')('script', '{}')
    stdout.write(JSON.stringify(failure))
    child.emit('close', 1)
    await expect(operation).rejects.toThrow('phase=preserve operation=write-acl entry=128 kind=directory type=UnauthorizedAccessException hresult=0x80070005 exit=1')
  })

  const invalid: Array<[string, string, number | null, string]> = [
    ['empty output with exit 0', '', 0, 'invalid-response'],
    ['empty output with exit 1', '', 1, 'process-failed'],
    ['not JSON', 'raw private path C:\\Users\\secret', 1, 'process-failed'],
    ['a JSON array', '[1]', 1, 'process-failed'],
    ['null', 'null', 1, 'process-failed'],
    ['wrong version', JSON.stringify({ ...failure, version: 2 }), 1, 'process-failed'],
    ['success with a non-zero exit', '{"version":1,"ok":true}', 1, 'process-failed'],
    ['success with a signal exit', '{"version":1,"ok":true}', null, 'process-failed'],
    ['success with extra fields', '{"version":1,"ok":true,"private":"x"}', 0, 'invalid-response'],
    ['failure with exit 0', JSON.stringify(failure), 0, 'invalid-response'],
    ['failure with extra field', JSON.stringify({ ...failure, extra: 'x' }), 1, 'process-failed'],
    ['unknown phase', JSON.stringify({ ...failure, phase: 'other' }), 1, 'process-failed'],
    ['unknown operation', JSON.stringify({ ...failure, operation: 'other' }), 1, 'process-failed'],
    ['unknown kind', JSON.stringify({ ...failure, kind: 'other' }), 1, 'process-failed'],
    ['unknown type', JSON.stringify({ ...failure, type: 'Custom' }), 1, 'process-failed'],
    ['entry below range', JSON.stringify({ ...failure, entry: -2 }), 1, 'process-failed'],
    ['entry above range', JSON.stringify({ ...failure, entry: 10_000_001 }), 1, 'process-failed'],
    ['fractional entry', JSON.stringify({ ...failure, entry: 1.5 }), 1, 'process-failed'],
    ['string entry', JSON.stringify({ ...failure, entry: '1' }), 1, 'process-failed'],
    ['lowercase hresult', JSON.stringify({ ...failure, hresult: '0x8007000a' }), 1, 'process-failed'],
  ]
  for (const [label, output, code, reason] of invalid) {
    test(`fails closed on ${label}`, async () => {
      const { child, stdout, spawnProcess } = fakeChild()
      const operation = createWindowsMigrationPermissionsRunner(spawnProcess, 'win32')('script', '{}')
      stdout.write(output)
      child.emit('close', code)
      const error = await operation.catch((caught: Error) => caught)
      expect((error as Error).message).toBe(`Could not preserve Windows data permissions; migration was stopped [win-acl/v1 ${reason}]`)
    })
  }
})

describe('Windows migration permission preconditions', () => {
  test('restrict validates the staging directory then sends only JSON, never interpolating the path', async () => {
    const f = await fixture()
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    await restrictWindowsMigrationStaging(f.targetDir, undefined, runner)
    const [script, input] = runner.mock.calls[0]!
    expect(JSON.parse(input)).toEqual({ directory: f.targetDir })
    expect(script).not.toContain(f.targetDir)
    expect(script).toContain('FileSystemRights]::FullControl')
  })

  test('restrict rejects relative, NUL, file, missing and symlinked staging without running ACL code', async () => {
    const f = await fixture()
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    const link = path.join(f.root, 'link')
    await fs.symlink(f.targetDir, link)
    await expect(restrictWindowsMigrationStaging('relative/path', undefined, runner)).rejects.toThrow('Invalid migration permission path')
    await expect(restrictWindowsMigrationStaging(`${f.targetDir}\0x`, undefined, runner)).rejects.toThrow('Invalid migration permission path')
    await expect(restrictWindowsMigrationStaging(f.targetFile, undefined, runner)).rejects.toThrow('links or special entries')
    await expect(restrictWindowsMigrationStaging(link, undefined, runner)).rejects.toThrow('links or special entries')
    await expect(restrictWindowsMigrationStaging(path.join(f.root, 'missing'), undefined, runner)).rejects.toThrow()
    await expect(restrictWindowsMigrationStaging(path.join(link, 'child'), undefined, runner)).rejects.toThrow()
    expect(runner).not.toHaveBeenCalled()
  })

  test('restrict rejects a staging path whose parent is a symlink', async () => {
    const f = await fixture()
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    const link = path.join(f.root, 'parent-link')
    await fs.symlink(f.root, link)
    await expect(restrictWindowsMigrationStaging(path.join(link, 'target'), undefined, runner)).rejects.toThrow('links or special entries')
    expect(runner).not.toHaveBeenCalled()
  })

  test('restrict honours cancellation before and after the runner', async () => {
    const f = await fixture()
    const abort = new AbortController()
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    abort.abort(new Error('cancel before'))
    await expect(restrictWindowsMigrationStaging(f.targetDir, abort.signal, runner)).rejects.toThrow('cancel before')
    expect(runner).not.toHaveBeenCalled()
    const during = new AbortController()
    await expect(restrictWindowsMigrationStaging(f.targetDir, during.signal, async () => { during.abort(new Error('cancel after')) })).rejects.toThrow('cancel after')
  })

  test('preserve sends each entry with its original index, deepest targets first', async () => {
    const f = await fixture()
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    await preserveWindowsMigrationPermissions([{ source: f.sourceDir, target: f.targetDir }, { source: f.sourceFile, target: f.targetFile }], undefined, runner)
    expect(runner).toHaveBeenCalledTimes(1)
    const [script, input] = runner.mock.calls[0]!
    expect(JSON.parse(input)).toEqual({ entries: [{ source: f.sourceFile, target: f.targetFile, index: 1 }, { source: f.sourceDir, target: f.targetDir, index: 0 }] })
    expect(script).not.toContain(f.sourceFile)
  })

  test('preserve batches 128 entries per process and stops after a failing batch', async () => {
    const f = await fixture()
    const entries = Array.from({ length: 129 }, () => ({ source: f.sourceFile, target: f.targetFile }))
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    await preserveWindowsMigrationPermissions(entries, undefined, runner)
    expect(runner.mock.calls.map(call => JSON.parse(call[1]).entries.length)).toEqual([128, 1])
    const failing = mock<MigrationPermissionsRunner>(async () => { throw new Error('ACL unavailable') })
    await expect(preserveWindowsMigrationPermissions(entries, undefined, failing)).rejects.toThrow('ACL unavailable')
    expect(failing).toHaveBeenCalledTimes(1)
  })

  test('preserve refuses a target that is also a source, any case', async () => {
    const f = await fixture()
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    await expect(preserveWindowsMigrationPermissions([{ source: f.sourceFile, target: f.sourceFile }], undefined, runner)).rejects.toThrow('must not modify a source entry')
    await expect(preserveWindowsMigrationPermissions([{ source: f.sourceFile, target: f.sourceFile.toUpperCase() }], undefined, runner)).rejects.toThrow('must not modify a source entry')
    expect(runner).not.toHaveBeenCalled()
  })

  test('preserve refuses hardlinked, kind-mismatched and symlinked copies', async () => {
    const f = await fixture()
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    const hardlink = path.join(f.targetDir, 'hardlink')
    await fs.link(f.sourceFile, hardlink)
    await expect(preserveWindowsMigrationPermissions([{ source: f.sourceFile, target: hardlink }], undefined, runner)).rejects.toThrow('independent copy')
    await expect(preserveWindowsMigrationPermissions([{ source: f.sourceDir, target: f.targetFile }], undefined, runner)).rejects.toThrow('independent copy')
    const link = path.join(f.root, 'link')
    await fs.symlink(f.targetDir, link)
    await expect(preserveWindowsMigrationPermissions([{ source: f.sourceDir, target: link }], undefined, runner)).rejects.toThrow('links or special entries')
    await expect(preserveWindowsMigrationPermissions([{ source: link, target: f.targetDir }], undefined, runner)).rejects.toThrow('links or special entries')
    expect(runner).not.toHaveBeenCalled()
  })

  test('preserve honours cancellation before the batch and after the runner', async () => {
    const f = await fixture()
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    const abort = new AbortController()
    abort.abort(new Error('cancel before'))
    await expect(preserveWindowsMigrationPermissions([{ source: f.sourceFile, target: f.targetFile }], abort.signal, runner)).rejects.toThrow('cancel before')
    expect(runner).not.toHaveBeenCalled()
    const during = new AbortController()
    await expect(preserveWindowsMigrationPermissions([{ source: f.sourceFile, target: f.targetFile }], during.signal, async () => { during.abort(new Error('cancel after')) })).rejects.toThrow('cancel after')
  })
})

describe('Windows migration permission preflight', () => {
  async function stage(f: Awaited<ReturnType<typeof fixture>>) {
    const directory = path.join(f.targetDir, 'private-stage')
    await fs.mkdir(directory)
    return directory
  }

  test('probes sources in 128-entry batches with stable indices and leaves staging empty', async () => {
    const f = await fixture()
    const directory = await stage(f)
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    await preflightWindowsMigrationPermissions([f.sourceDir, ...Array.from({ length: 128 }, () => f.sourceFile)], directory, undefined, runner)
    expect(runner.mock.calls.map(call => JSON.parse(call[1]).entries.length)).toEqual([128, 1])
    expect(JSON.parse(runner.mock.calls[0]![1]).directory).toBe(directory)
    expect(JSON.parse(runner.mock.calls[1]![1]).entries).toEqual([{ source: f.sourceFile, index: 128 }])
    expect(await fs.readdir(directory)).toEqual([])
  })

  test('requires an empty private staging directory', async () => {
    const f = await fixture()
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    await expect(preflightWindowsMigrationPermissions([f.sourceFile], f.targetDir, undefined, runner)).rejects.toThrow('empty private staging')
    expect(runner).not.toHaveBeenCalled()
  })

  test('rejects staging that overlaps a source or sits inside a source directory', async () => {
    const f = await fixture()
    const directory = await stage(f)
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    await expect(preflightWindowsMigrationPermissions([directory], directory, undefined, runner)).rejects.toThrow('independent of source entries')
    await expect(preflightWindowsMigrationPermissions([f.targetDir], directory, undefined, runner)).rejects.toThrow('independent of source entries')
    await expect(preflightWindowsMigrationPermissions([f.root], directory, undefined, runner)).rejects.toThrow('independent of source entries')
    expect(runner).not.toHaveBeenCalled()
  })

  test('rejects linked staging and linked sources', async () => {
    const f = await fixture()
    const directory = await stage(f)
    const runner = mock<MigrationPermissionsRunner>(async () => {})
    const link = path.join(f.root, 'linked-stage')
    await fs.symlink(directory, link)
    await expect(preflightWindowsMigrationPermissions([f.sourceFile], link, undefined, runner)).rejects.toThrow('links or special entries')
    const sourceLink = path.join(f.root, 'linked-source')
    await fs.symlink(f.sourceFile, sourceLink)
    await expect(preflightWindowsMigrationPermissions([sourceLink], directory, undefined, runner)).rejects.toThrow('links or special entries')
    expect(runner).not.toHaveBeenCalled()
  })

  test('fails when a probe is left behind', async () => {
    const f = await fixture()
    const directory = await stage(f)
    await expect(preflightWindowsMigrationPermissions([f.sourceFile], directory, undefined, async () => {
      await fs.writeFile(path.join(directory, 'leftover-probe'), '')
    })).rejects.toThrow('did not clean up its probes')
  })

  test('fails when the staging directory is swapped for another directory during the runner', async () => {
    const f = await fixture()
    const directory = await stage(f)
    await expect(preflightWindowsMigrationPermissions([f.sourceFile], directory, undefined, async () => {
      // Moving (not deleting) keeps the original inode alive, so the replacement cannot reuse it.
      await fs.rename(directory, path.join(f.root, 'moved-stage'))
      await fs.mkdir(directory)
    })).rejects.toThrow('Migration staging directory changed')
  })

  test('stops batches on failure or cancellation', async () => {
    const f = await fixture()
    const directory = await stage(f)
    const sources = Array.from({ length: 129 }, () => f.sourceFile)
    const failing = mock<MigrationPermissionsRunner>(async () => { throw new Error('preflight denied') })
    await expect(preflightWindowsMigrationPermissions(sources, directory, undefined, failing)).rejects.toThrow('preflight denied')
    expect(failing).toHaveBeenCalledTimes(1)
    const abort = new AbortController()
    const cancelling = mock<MigrationPermissionsRunner>(async () => { abort.abort(new Error('cancel preflight')) })
    await expect(preflightWindowsMigrationPermissions(sources, directory, abort.signal, cancelling)).rejects.toThrow('cancel preflight')
    expect(cancelling).toHaveBeenCalledTimes(1)
    const early = new AbortController()
    early.abort(new Error('cancel early'))
    await expect(preflightWindowsMigrationPermissions(sources, directory, early.signal, failing)).rejects.toThrow('cancel early')
  })
})
