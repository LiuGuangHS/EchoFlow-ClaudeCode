import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type RootModule = typeof import('./echoFlowConfigRoot.js')

let directory: string
let savedRoot: string | undefined
let instance = 0

// The bound root is process-wide and cannot be released, so each test loads a fresh module copy.
const freshModule = (): Promise<RootModule> => import(`./echoFlowConfigRoot.js?binding-${++instance}`)

beforeEach(async () => {
  savedRoot = process.env.CLAUDE_CONFIG_DIR
  delete process.env.CLAUDE_CONFIG_DIR
  directory = await realpath(await mkdtemp(join(tmpdir(), 'echoflow-root-binding-')))
})

afterEach(async () => {
  if (savedRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedRoot
  await rm(directory, { recursive: true, force: true })
})

test('binding publishes the root and makes later lookups independent of caller options', async () => {
  const root = await freshModule()
  const binding = root.resolveStorageBinding({ roots: [directory] })
  root.bindStorageRoot(binding)
  expect(process.env.CLAUDE_CONFIG_DIR).toBe(directory)
  expect(root.getEchoFlowConfigDir()).toBe(directory)
  // An explicit resolution request still bypasses the bound root.
  const other = join(directory, 'other')
  expect(root.getEchoFlowConfigDir({ env: { CLAUDE_CONFIG_DIR: other } })).toBe(other)
  root.bindStorageRoot(binding)
})

test('binding rejects a forged internal directory, a second root and a conflicting launch environment', async () => {
  const root = await freshModule()
  const binding = root.resolveStorageBinding({ roots: [directory] })
  expect(() => root.bindStorageRoot({ ...binding, internalDir: join(directory, 'forged') })).toThrow('Invalid storage binding')

  process.env.CLAUDE_CONFIG_DIR = join(directory, 'launch-selected')
  expect(() => root.bindStorageRoot(binding)).toThrow('conflicts with launch environment')
  delete process.env.CLAUDE_CONFIG_DIR

  root.bindStorageRoot(binding)
  expect(() => root.bindStorageRoot(root.resolveStorageBinding({ env: {}, roots: [join(directory, 'second')] }))).toThrow('already bound')
  expect(root.getEchoFlowConfigDir()).toBe(directory)
})

test('lookups fail closed when the environment root changes after binding', async () => {
  const root = await freshModule()
  root.bindStorageRoot(root.resolveStorageBinding({ roots: [directory] }))
  process.env.CLAUDE_CONFIG_DIR = join(directory, 'changed')
  expect(() => root.getEchoFlowConfigDir()).toThrow('Storage root changed after binding')
})

test('ownership marker creation is idempotent and foreign or future markers are never overwritten', async () => {
  const root = await freshModule()
  await root.ensureEchoFlowConfigRoot(directory)
  const marker = join(directory, root.ECHOFLOW_MARKER_FILE)
  const created = await readFile(marker, 'utf8')
  expect(JSON.parse(created)).toEqual(root.buildEchoFlowOwnershipMarker())
  await root.ensureEchoFlowConfigRoot(directory)
  expect(await readFile(marker, 'utf8')).toBe(created)

  for (const foreign of [{ owner: 'other-app', appId: 'x', schemaVersion: 1 }, { ...root.buildEchoFlowOwnershipMarker(), schemaVersion: 2 }]) {
    const text = JSON.stringify(foreign)
    await writeFile(marker, text)
    await expect(root.ensureEchoFlowConfigRoot(directory)).rejects.toThrow('foreign, invalid, or from a future version')
    expect(await readFile(marker, 'utf8')).toBe(text)
  }
})
