import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Separate processes keep the storage binding, SQLite hooks and context LRU private.
const fixture = `
import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
import { readHistoryContexts } from './src/server/services/sessionHistoryContext.ts'
import { recoverBoundedSessionHistory } from './src/server/services/sessionHistoryRecovery.ts'
import { createSearchContentProjector } from './src/server/services/localIndex/searchContentProjector.ts'
import { openSearchContentDatabase } from './src/server/services/localIndex/searchContentDatabase.ts'
import { createSearchContentIndex } from './src/server/services/localIndex/searchContentIndex.ts'

const binding = resolveStorageBinding()
bindStorageRoot(binding)
const scratchRoot = join(binding.internalDir, 'tmp')
const owner = process.env.SCRATCH_OWNER
const failure = process.env.SCRATCH_FAILURE
const filePath = join(binding.root, 'source.jsonl')
mkdirSync(binding.root, { recursive: true })
writeFileSync(filePath, JSON.stringify({ type: 'user', uuid: 'one', message: { role: 'user', content: 'private text' } }) + '\\n')
if (failure === 'link') {
  mkdirSync(binding.internalDir, { recursive: true })
  mkdirSync(process.env.OUTSIDE)
  symlinkSync(process.env.OUTSIDE, scratchRoot, process.platform === 'win32' ? 'junction' : 'dir')
}
const directories = []
let configurations = 0
const exec = Database.prototype.exec
Database.prototype.exec = function(sql, ...args) {
  if (sql.includes('CREATE TABLE') && /parents|usage_keys|documents \\(seq/.test(sql)) {
    const main = this.query('PRAGMA database_list').all().find(row => row.name === 'main')
    directories.push(dirname(main.file))
    if (failure === 'init') throw new Error('injected initialization failure')
    const result = exec.call(this, sql, ...args)
    configurations++
    assert.equal(this.query('PRAGMA temp_store').get().temp_store, 2, 'scratch connection must not spill outside R')
    assert.equal(this.query('PRAGMA cache_size').get().cache_size, -512)
    if (owner === 'recovery') {
      for (const table of ['evidence', 'notices']) {
        const plan = this.query('EXPLAIN QUERY PLAN SELECT json FROM ' + table + ' ORDER BY ordinal DESC').all()
        assert.ok(!plan.some(row => row.detail.includes('TEMP B-TREE')), 'large recovery reads must use disk-backed ordering indexes')
      }
    }
    return result
  }
  return exec.call(this, sql, ...args)
}
const inspect = () => {
  if (failure === 'scan') throw new Error('injected scan failure')
}
let result
let error
let db
try {
  if (owner === 'context') {
    const info = statSync(filePath, { bigint: true })
    result = await readHistoryContexts({ filePath, sourceVersion: info.dev + ':' + info.ino + ':' + info.size + ':' + info.mtimeNs, offsets: [0], agentToolId() { inspect() } })
  } else if (owner === 'recovery') {
    result = await recoverBoundedSessionHistory({ filePath, toMessage() { inspect(); return null }, notifications: () => [] })
  } else {
    db = openSearchContentDatabase({ path: join(binding.internalDir, 'search.sqlite') })
    const index = createSearchContentIndex(db, { scope: binding.root })
    const projector = createSearchContentProjector({ database: db, index, onBatch: inspect })
    result = await projector.projectSource({ path: filePath, projectPath: '-fixture', ownerSessionId: 'one', ownerTranscriptPath: filePath, modifiedAtMs: 1 })
  }
} catch (caught) { error = caught }
finally { db?.close() }
if (failure !== 'link') {
  assert.equal(directories.length, 1, 'operation should open one scratch SQLite')
  assert.equal(dirname(directories[0]), scratchRoot, 'scratch SQLite must live in bound R/I/tmp')
  if (process.platform !== 'win32') {
    if (existsSync(directories[0])) assert.equal(statSync(directories[0]).mode & 0o777, 0o700)
    assert.equal(statSync(scratchRoot).mode & 0o777, 0o700)
  }
}
if (failure === 'none') {
  assert.equal(error, undefined)
  assert.equal(configurations, 1)
  if (owner === 'context') {
    assert.equal(result.contexts.get(0).hidden, false)
    assert.equal(readdirSync(scratchRoot).length, 1, 'successful context is retained only in the bounded LRU')
  } else {
    assert.equal(owner === 'search' ? result.kind : result.status, owner === 'search' ? 'indexed' : 'ready')
    assert.deepEqual(readdirSync(scratchRoot), [])
  }
} else {
  if (owner === 'search') assert.equal(result.kind, 'retry')
  else assert.ok(error, 'failed scratch operation must reject')
  if (failure === 'link') {
    assert.deepEqual(readdirSync(process.env.OUTSIDE), [])
    assert.deepEqual(directories, [])
  } else assert.deepEqual(readdirSync(scratchRoot), [], 'failed operations must clean all scratch files')
}
`

for (const owner of ['context', 'recovery', 'search']) {
  for (const failure of ['none', 'init', 'scan', 'link']) {
    test(`${owner} scratch uses private bound storage and cleans up (${failure})`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'product-scratch-test-'))
      const root = join(directory, 'product')
      try {
        const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
          cwd: new URL('../../../', import.meta.url).pathname,
          env: {
            ...process.env,
            HOME: join(directory, 'home'),
            CLAUDE_CONFIG_DIR: root,
            XDG_CONFIG_HOME: join(directory, 'config'),
            XDG_DATA_HOME: join(directory, 'data'),
            SCRATCH_OWNER: owner,
            SCRATCH_FAILURE: failure,
            OUTSIDE: join(directory, 'outside'),
          },
          encoding: 'utf8',
          timeout: 30_000,
        })
        expect(result.stderr).toBe('')
        expect(result.status).toBe(0)
        if (failure === 'none') {
          // The context cache survives the call but must disappear on normal exit.
          const { readdir } = await import('node:fs/promises')
          const { getEchoFlowInternalDir } = await import('../../utils/echoFlowConfigRoot.js')
          expect(await readdir(join(getEchoFlowInternalDir(root), 'tmp'))).toEqual([])
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
}
