import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import * as realChildProcess from 'node:child_process'

type FakeResponse = { code?: number | null; output?: string; failure?: 'spawn' | 'stdin' }
type Call = { command: string; args: string[]; input: string | undefined }

const calls: Call[] = []
let respond: (call: Call) => FakeResponse = () => ({ code: 0 })

// The real macOS `security` binary is replaced by an in-memory child process.
function fakeSpawn(command: string, args: string[]) {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stdin: EventEmitter & { end(input?: string): void } }
  child.stdout = new EventEmitter()
  child.stdin = Object.assign(new EventEmitter(), {
    end(input?: string) {
      const call = { command, args, input }
      calls.push(call)
      queueMicrotask(() => {
        const response = respond(call)
        if (response.failure === 'spawn') return void child.emit('error', new Error('spawn failed'))
        if (response.failure === 'stdin') return void child.stdin.emit('error', new Error('pipe closed'))
        if (response.output !== undefined) child.stdout.emit('data', Buffer.from(`${response.output}\n`))
        child.emit('close', response.code ?? 0)
      })
    },
  })
  return child
}

const originalChildProcess = { ...realChildProcess }
mock.module('node:child_process', () => ({ ...originalChildProcess, spawn: fakeSpawn }))
const { removeMigrationCredentials, systemMigrationCredentialStore } = await import('./storageMigrationCredentials.js')

afterAll(() => { mock.module('node:child_process', () => originalChildProcess) })
beforeEach(() => {
  calls.length = 0
  respond = () => ({ code: 0 })
})

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

test('reads a credential through security and strips only the trailing newline', async () => {
  const value = '  fake-token\n'
  respond = () => ({ code: 0, output: value })
  const store = systemMigrationCredentialStore('fixture-user')
  expect(await store.read('Claude Code-credentials-abcd1234')).toBe(value)
  expect(calls).toEqual([{
    command: '/usr/bin/security',
    args: ['find-generic-password', '-a', 'fixture-user', '-s', 'Claude Code-credentials-abcd1234', '-w'],
    input: undefined,
  }])
})

test('treats security exit 44 as a missing item and any other failure as an unavailable keychain', async () => {
  const store = systemMigrationCredentialStore('fixture-user')
  respond = () => ({ code: 44 })
  expect(await store.read('missing')).toBeNull()
  respond = () => ({ code: 36 })
  await expect(store.read('locked')).rejects.toThrow('keychain is unavailable')
})

test('maps spawn and stdin failures to credential-safe errors', async () => {
  const store = systemMigrationCredentialStore('fixture-user')
  respond = () => ({ failure: 'spawn' })
  await expect(store.read('service')).rejects.toThrow('Cannot access macOS migration credentials')
  respond = () => ({ failure: 'stdin' })
  await expect(store.write('service', 'fake-token')).rejects.toThrow('Cannot write macOS migration credentials')
})

test('writes small credentials over stdin with escaped names and a hex payload', async () => {
  const store = systemMigrationCredentialStore('user"name\\x')
  await store.write('svc"1', 'fake-token')
  expect(calls).toHaveLength(1)
  expect(calls[0]!.args).toEqual(['-i'])
  expect(calls[0]!.input).toBe(`add-generic-password -a "user\\"name\\\\x" -s "svc\\"1" -X "${Buffer.from('fake-token').toString('hex')}"\n`)
})

test('writes records above the security -i line limit through the hex argument instead', async () => {
  const value = 'x'.repeat(3000)
  const store = systemMigrationCredentialStore('fixture-user')
  await store.write('service', value)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.args).toEqual(['add-generic-password', '-a', 'fixture-user', '-s', 'service', '-X', Buffer.from(value).toString('hex')])
  expect(calls[0]!.input).toBeUndefined()
})

test('reports failed writes and removals without echoing the credential', async () => {
  const store = systemMigrationCredentialStore('fixture-user')
  respond = () => ({ code: 1 })
  await expect(store.write('service', 'fake-secret-value')).rejects.toThrow(/^Could not copy macOS migration credentials$/)
  await expect(store.remove('service')).rejects.toThrow('Could not remove migration-created credential')
  respond = () => ({ code: 0 })
  await store.remove('service')
  expect(calls.at(-1)!.args).toEqual(['delete-generic-password', '-a', 'fixture-user', '-s', 'service'])
})

test('removes only receipts whose stored value still matches the recorded digest', async () => {
  const values = new Map([['unchanged', 'a'], ['rotated', 'user-changed-this']])
  const removed: string[] = []
  const store = {
    read: async (service: string) => values.get(service) ?? null,
    write: async () => {},
    remove: async (service: string) => { removed.push(service) },
  }
  await removeMigrationCredentials([
    { service: 'unchanged', digest: sha256('a') },
    { service: 'rotated', digest: sha256('original') },
    { service: 'absent', digest: sha256('a') },
  ], store)
  expect(removed).toEqual(['unchanged'])
})
