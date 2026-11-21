import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../utils/echoFlowConfigRoot'
import { acquireStorageWriter, armApprovedFileSource, cancelApprovedFileSource, cancelColdStorageApproval, completeStorageMigration, executeStorageMigration, prepareStorageMigration, recordColdStorageApproval, recoverStorageMigration, type StorageMigrationHooks } from './storageMigration'

const homes: string[] = []
afterEach(async () => { for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true }) })

async function fixture() {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'storage-external-source-')))
  homes.push(home)
  const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'selected')] })
  const external = path.join(home, 'mixed', 'material')
  const put = async (file: string, bytes: string) => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, bytes)
  }
  const hooks: StorageMigrationHooks = { platform: 'linux', assertQuiescent: async roots => {
    expect(roots.every(root => root.startsWith(home + path.sep))).toBe(true)
  } }
  return { home, binding, external, put, hooks }
}

for (const [consumer, relative] of [
  ['trace', 'capture.jsonl'],
  ['oauth', 'oauth.json'],
  ['plugin', 'installed_plugins.json'],
  ['zip', 'fixture.zip'],
  ['cowork', 'MEMORY.md'],
  ['remote', 'project-a/MEMORY.md'],
  ['setting', 'topics.md'],
  ['whatsapp', 'creds.json'],
]) {
  test(`${consumer} external filenames and readable bytes do not prove directory ownership`, async () => {
    const f = await fixture()
    const file = path.join(f.external, relative!)
    const raw = '{ "fixture":true, "future":{"keep":[1,2]} }\n'
    const sentinel = path.join(f.home, 'mixed', 'unrelated.json')
    await f.put(file, raw)
    await f.put(sentinel, '{"foreign":true}')
    const source = { directory: f.external, markerRoot: f.external, destination: 'echoflow-code/external-fixture' }
    await expect(prepareStorageMigration({ binding: f.binding, sources: [source] })).rejects.toThrow('Unproven or future storage ownership')
    const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
    expect(result.state).toBe('blocked')
    expect(result.id).toBeUndefined()
    expect(result.issues.join()).toContain('Unproven or future storage ownership')
    expect(await fs.readFile(file, 'utf8')).toBe(raw)
    expect(await fs.readFile(sentinel, 'utf8')).toBe('{"foreign":true}')
    expect(await fs.exists(path.join(f.external, 'app.json'))).toBe(false)
    expect(await fs.exists(path.join(f.binding.internalDir, 'external-fixture'))).toBe(false)
  })
}

test('an owned profile marker cannot be borrowed to authorize an external OAuth parent', async () => {
  const f = await fixture()
  const profile = path.join(f.home, 'owned-profile')
  await f.put(path.join(profile, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
  await f.put(path.join(f.external, 'oauth.json'), '{"accessToken":"fixture-only","future":7}')
  await expect(prepareStorageMigration({ binding: f.binding, sources: [{ directory: f.external, markerRoot: profile }] })).rejects.toThrow('Invalid source ownership scope')
  expect(await fs.readFile(path.join(f.external, 'oauth.json'), 'utf8')).toBe('{"accessToken":"fixture-only","future":7}')
  expect(await fs.exists(f.binding.root)).toBe(false)
})

test('a pre-existing owned external directory retains its whole auth cohort, backup and narrow relocation', async () => {
  const f = await fixture()
  // This models an already-owned dedicated root, not adoption of an override or its shared parent.
  const material = {
    'app.json': JSON.stringify(buildEchoFlowOwnershipMarker()),
    'creds.json': '{ "fixture":true, "unknown":{"keep":[1,2]} }\n',
    'session-peer.json': '{"fixtureSession":"not-a-real-key","future":7}\n',
    'keys/app-state.json': '{"fixtureKey":"not-a-real-key","extension":true}\n',
  }
  for (const [relative, raw] of Object.entries(material)) await f.put(path.join(f.external, relative), raw)
  const sentinel = path.join(f.home, 'mixed', 'unrelated.json')
  await f.put(sentinel, '{"foreign":true}')
  const destination = 'echoflow-code/external-fixture'
  const source = { directory: f.external, markerRoot: f.external, destination }
  const plan = await prepareStorageMigration({ binding: f.binding, sources: [source] })
  expect(plan.files).toBe(Object.keys(material).length)
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  const transaction = path.join(f.binding.internalDir, 'migrations', result.id!)
  const journal = JSON.parse(await fs.readFile(path.join(transaction, 'journal.json'), 'utf8'))
  expect(journal.sources).toHaveLength(1)
  expect(journal.sources[0]).toMatchObject({ ...source, identity: plan.sourceIdentities[0] })
  expect(journal.entries.map((entry: { relative: string }) => entry.relative).sort()).toEqual(Object.keys(material).sort())
  for (const [relative, raw] of Object.entries(material)) {
    expect(await fs.readFile(path.join(transaction, 'sources/0', relative), 'utf8')).toBe(raw)
    expect(await fs.readFile(path.join(f.binding.root, destination, relative), 'utf8')).toBe(raw)
    expect(await fs.readFile(path.join(f.external, relative), 'utf8')).toBe(raw)
  }
  await fs.writeFile(path.join(f.external, 'creds.json'), 'late fixture write')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('cleanup-pending')
  expect(await fs.readFile(path.join(f.external, 'creds.json'), 'utf8')).toBe('late fixture write')
  expect(await fs.readFile(path.join(transaction, 'sources/0/creds.json'), 'utf8')).toBe(material['creds.json'])
  await expect(acquireStorageWriter(f.binding)).rejects.toThrow('cleanup-pending')
  await fs.writeFile(path.join(f.external, 'creds.json'), material['creds.json'])
  expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
  expect(await fs.exists(f.external)).toBe(false)
  expect(await fs.readFile(sentinel, 'utf8')).toBe('{"foreign":true}')
  const relocations = JSON.parse(await fs.readFile(path.join(f.binding.internalDir, 'storage-relocations.json'), 'utf8'))
  expect(relocations.previousRoots).toEqual([])
  expect(relocations.mappings).toEqual([{ from: f.external, to: destination }])
  expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
  const lease = await acquireStorageWriter(f.binding)
  await lease.release()
})

test('duplicate files cannot be armed in one approval', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-555555555561'
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  await expect(armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [file, file] })).rejects.toThrow('Duplicate storage approval file')
  expect(await fs.readFile(file, 'utf8')).toBe('{"fixture":true}')
})

test('an approval receipt missing a required file identity fails closed', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-555555555560'
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  const source = await armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [file] })
  const receiptFile = path.join(f.binding.internalDir, 'storage-approvals', `${id}.json`)
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'))
  delete receipt.files[0].identity.digest
  await fs.writeFile(receiptFile, JSON.stringify(receipt))
  await expect(prepareStorageMigration({ binding: f.binding, sources: [source] })).rejects.toThrow('Invalid storage approval receipt')
  expect(await fs.readFile(file, 'utf8')).toBe('{"fixture":true}')
})

test('an approval minted for another root fails closed', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-555555555555'
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  const source = await armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [file] })
  const receiptFile = path.join(f.binding.internalDir, 'storage-approvals', `${id}.json`)
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'))
  receipt.root = path.join(f.home, 'another-root')
  await fs.writeFile(receiptFile, JSON.stringify(receipt))
  await expect(prepareStorageMigration({ binding: f.binding, sources: [source] })).rejects.toThrow('Invalid storage approval receipt')
  expect(await fs.readFile(file, 'utf8')).toBe('{"fixture":true}')
})

test('a cancelled approval is rejected', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-555555555556'
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  const source = await armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [file] })
  await cancelApprovedFileSource(f.binding, id)
  await expect(prepareStorageMigration({ binding: f.binding, sources: [source] })).rejects.toThrow('Approved storage source is not pending')
  expect(await fs.readFile(file, 'utf8')).toBe('{"fixture":true}')
})

test('the running desktop can record and cancel consent while holding a writer lease', async () => {
  const f = await fixture()
  const file = path.join(f.external, 'openai-oauth.json')
  const bytes = '{"access_token":"fixture-only"}'
  await f.put(file, bytes)
  const lease = await acquireStorageWriter(f.binding)
  try {
    const source = await recordColdStorageApproval(f.binding, { destination: 'echoflow-code', files: [file] })
    await cancelColdStorageApproval(f.binding, source.approval!)
    await expect(prepareStorageMigration({ binding: f.binding, sources: [source] })).rejects.toThrow('Approved storage source is not pending')
    expect(await fs.readFile(file, 'utf8')).toBe(bytes)
  } finally { await lease.release() }
})

test('an approved source cannot change its destination', async () => {
  const f = await fixture()
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  const source = await armApprovedFileSource(f.binding, '11111111-2222-4333-8444-555555555562', { destination: 'echoflow-code/adopted', files: [file] })
  await expect(prepareStorageMigration({ binding: f.binding, sources: [{ ...source, destination: 'echoflow-code/other' }] })).rejects.toThrow('does not match its approval')
})

test('cancellation cannot revoke an approval already owned by a transaction', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-555555555563'
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  const source = await armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [file] })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  await expect(cancelApprovedFileSource(f.binding, id)).rejects.toThrow('Transaction-owned storage approval cannot be cancelled')
  expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('validation-required')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
})

test('recovery requires the complete approved cohort in the journal', async () => {
  const f = await fixture()
  const files = [path.join(f.external, 'first.json'), path.join(f.external, 'second.json')]
  for (const file of files) await f.put(file, '{"fixture":true}')
  const source = await armApprovedFileSource(f.binding, '11111111-2222-4333-8444-555555555564', { destination: 'echoflow-code/adopted', files })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  const journalPath = path.join(f.binding.internalDir, 'migrations', result.id!, 'journal.json')
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'))
  const first = journal.entries[0]
  for (const entries of [journal.entries.slice(1), [{ ...first, original: { ...first.original, mode: first.original.mode ^ 1 } }, journal.entries[1]]]) {
    await fs.writeFile(journalPath, JSON.stringify({ ...journal, entries }))
    const recovered = await recoverStorageMigration(f.binding, f.hooks)
    expect(recovered.state).toBe('blocked')
    expect(recovered.issues.join()).toContain('Storage operations do not match their approval')
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('blocked')
    for (const file of files) expect(await fs.readFile(file, 'utf8')).toBe('{"fixture":true}')
  }
})

test('the selected root parent cannot be armed as an approved-external source', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-555555555557'
  await f.put(path.join(path.dirname(f.binding.root), 'oauth.json'), '{"fixture":true}')
  await expect(armApprovedFileSource(f.binding, id, {
    destination: 'echoflow-code/adopted',
    files: [path.join(path.dirname(f.binding.root), 'oauth.json')],
  })).rejects.toThrow('approved source cannot contain the selected root')
  expect(await fs.readFile(path.join(path.dirname(f.binding.root), 'oauth.json'), 'utf8')).toBe('{"fixture":true}')
})

test('an approved exact file from an unowned parent is adopted with backup, narrow relocation and parent preserved', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-555555555558'
  const file = path.join(f.external, 'oauth.json')
  const raw = '{ "fixture":true, "future":{"keep":[1,2]} }\n'
  const sentinel = path.join(f.external, 'unrelated.json')
  await f.put(file, raw)
  await f.put(sentinel, '{"foreign":true}')
  const source = await armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [file] })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  const transaction = path.join(f.binding.internalDir, 'migrations', result.id!)
  expect(await fs.readFile(path.join(transaction, 'sources/0/oauth.json'), 'utf8')).toBe(raw)
  expect(await fs.readFile(path.join(f.binding.root, 'echoflow-code/adopted/oauth.json'), 'utf8')).toBe(raw)
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  expect(await fs.exists(file)).toBe(false)
  expect(await fs.readFile(sentinel, 'utf8')).toBe('{"foreign":true}')
  const relocations = JSON.parse(await fs.readFile(path.join(f.binding.internalDir, 'storage-relocations.json'), 'utf8'))
  expect(relocations.previousRoots).toEqual([])
  expect(relocations.mappings).toEqual([{ from: file, to: 'echoflow-code/adopted/oauth.json' }])
})

test('a later root move preserves approvals as history rather than activating them on the new root', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-555555555565'
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  const source = await armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [file] })
  const imported = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect((await completeStorageMigration(f.binding, imported.id!, f.hooks)).state).toBe('ready')
  const receipt = await fs.readFile(path.join(f.binding.internalDir, 'storage-approvals', `${id}.json`), 'utf8')

  const binding = resolveStorageBinding({ env: {}, roots: [path.join(f.home, 'moved')] })
  const moved = await executeStorageMigration({ binding, sources: [{ directory: f.binding.root, markerRoot: f.binding.root }], hooks: f.hooks })
  expect(moved.state).toBe('validation-required')
  expect((await completeStorageMigration(binding, moved.id!, f.hooks)).state).toBe('ready')
  expect(await fs.exists(f.binding.root)).toBe(false)
  expect(await fs.exists(path.join(binding.internalDir, 'storage-approvals'))).toBe(false)
  const history = await fs.readdir(path.join(binding.internalDir, 'migration-history'))
  expect(history).toHaveLength(1)
  expect(await fs.readFile(path.join(binding.internalDir, 'migration-history', history[0]!, 'storage-approvals', `${id}.json`), 'utf8')).toBe(receipt)
  expect(await fs.readFile(path.join(binding.internalDir, 'adopted', 'oauth.json'), 'utf8')).toBe('{"fixture":true}')
})

test('changed approved bytes block adoption and preserve the original', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-555555555559'
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  const source = await armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [file] })
  await f.put(file, '{"fixture":true,"changed":true}')
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state).toBe('blocked')
  expect(result.issues.join()).toContain('re-approve')
  expect(await fs.readFile(file, 'utf8')).toBe('{"fixture":true,"changed":true}')
  expect(await fs.exists(path.join(f.binding.root, 'echoflow-code/adopted/oauth.json'))).toBe(false)
})

test('a named cohort with a missing member is blocked atomically', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-55555555555a'
  const first = path.join(f.external, 'creds.json')
  const second = path.join(f.external, 'session.json')
  await f.put(first, '{"fixture":"creds"}')
  await f.put(second, '{"fixture":"session"}')
  const source = await armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [first, second], cohort: 'auth' })
  await fs.unlink(second)
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state).toBe('blocked')
  expect(await fs.readFile(first, 'utf8')).toBe('{"fixture":"creds"}')
  expect(await fs.exists(path.join(f.binding.root, 'echoflow-code/adopted/creds.json'))).toBe(false)
})

test('two approvals from one parent are both adopted', async () => {
  const f = await fixture()
  const firstId = '11111111-2222-4333-8444-55555555555b'
  const secondId = '11111111-2222-4333-8444-55555555555c'
  const first = path.join(f.external, 'first.json')
  const second = path.join(f.external, 'second.json')
  await f.put(first, '{"fixture":1}')
  await f.put(second, '{"fixture":2}')
  const firstSource = await armApprovedFileSource(f.binding, firstId, { destination: 'echoflow-code/adopted', files: [first], cohort: 'first' })
  const secondSource = await armApprovedFileSource(f.binding, secondId, { destination: 'echoflow-code/adopted', files: [second], cohort: 'second' })
  const result = await executeStorageMigration({ binding: f.binding, sources: [firstSource, secondSource], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  const journal = JSON.parse(await fs.readFile(path.join(f.binding.internalDir, 'migrations', result.id!, 'journal.json'), 'utf8'))
  expect(journal.sources).toHaveLength(2)
  expect(await fs.readFile(path.join(f.binding.root, 'echoflow-code/adopted/first.json'), 'utf8')).toBe('{"fixture":1}')
  expect(await fs.readFile(path.join(f.binding.root, 'echoflow-code/adopted/second.json'), 'utf8')).toBe('{"fixture":2}')
})

test('duplicate file selection is rejected', async () => {
  const f = await fixture()
  const firstId = '11111111-2222-4333-8444-55555555555d'
  const secondId = '11111111-2222-4333-8444-55555555555e'
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  const firstSource = await armApprovedFileSource(f.binding, firstId, { destination: 'echoflow-code/first', files: [file] })
  const secondSource = await armApprovedFileSource(f.binding, secondId, { destination: 'echoflow-code/second', files: [file] })
  const result = await executeStorageMigration({ binding: f.binding, sources: [firstSource, secondSource], hooks: f.hooks })
  expect(result.state).toBe('blocked')
  expect(result.issues.join()).toContain('Overlapping migration files')
  expect(await fs.readFile(file, 'utf8')).toBe('{"fixture":true}')
})

test('a recreated approved file blocks writer admission after completion', async () => {
  const f = await fixture()
  const id = '11111111-2222-4333-8444-55555555555f'
  const file = path.join(f.external, 'oauth.json')
  await f.put(file, '{"fixture":true}')
  const source = await armApprovedFileSource(f.binding, id, { destination: 'echoflow-code/adopted', files: [file] })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  await f.put(file, '{"fixture":true}')
  await expect(acquireStorageWriter(f.binding)).rejects.toThrow('Retired approved file was recreated')
})
