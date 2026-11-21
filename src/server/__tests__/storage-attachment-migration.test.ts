import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'

const repository = resolve(import.meta.dir, '../../..')

test('an IM-produced attachment survives real startup migration and both file-serving consumers without rewriting its transcript', async () => {
  const home = await mkdtemp(join(tmpdir(), 'storage-attachment-chain-'))
  const root = join(home, 'selected-café')
  const env = createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: root })
  const run = async (body: string) => {
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
      import assert from 'node:assert/strict'
      import fs from 'node:fs/promises'
      import path from 'node:path'
      globalThis.fetch = async () => { throw new Error('Unexpected network request') }
      const home = process.env.HOME
      const root = process.env.CLAUDE_CONFIG_DIR
      const oldRoot = path.join(process.env.XDG_CONFIG_HOME, 'claude-code-desktop')
      const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex')
      ${body}
    `], { cwd: repository, env, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: '', stdout: '' })
  }
  try {
    await run(`
      process.env.CLAUDE_CONFIG_DIR = oldRoot
      const { ensureEchoFlowConfigRoot } = await import('./src/utils/echoFlowConfigRoot.ts')
      const { AttachmentStore } = await import('./adapters/common/attachment/attachment-store.ts')
      await ensureEchoFlowConfigRoot(oldRoot)
      const store = new AttachmentStore()
      const original = store.resolvePath('feishu', 'old-session', 'café fixture.png')
      assert.equal(await store.write(original, PNG), original)
      const transcript = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '@"' + original + '"' }] }, unknown: { retain: true } }) + '\\n'
      await fs.mkdir(path.join(oldRoot, 'projects', 'fixture'), { recursive: true })
      await fs.writeFile(path.join(oldRoot, 'projects', 'fixture', 'session.jsonl'), transcript)
      await fs.writeFile(path.join(home, 'expected-transcript'), transcript)
    `)
    await run(`
      const { mock } = await import('bun:test')
      // Replace only OS inventory: the producer has exited and all roots are private fixtures.
      mock.module('./src/server/migrationInventory.ts', () => ({
        assertMigrationQuiescent: async (roots, owned) => {
          assert.ok(roots.length > 0)
          assert.ok(roots.every(value => value.startsWith(home + path.sep)))
          assert.deepEqual(owned, [process.pid])
        },
      }))
      const { initializeProcessStorage, releaseProcessStorage } = await import('./src/services/storageStartup.ts')
      await initializeProcessStorage()
      try {
        const raw = await fs.readFile(path.join(home, 'expected-transcript'))
        assert.deepEqual(await fs.readFile(path.join(root, 'projects', 'fixture', 'session.jsonl')), raw)
        await assert.rejects(fs.lstat(oldRoot), { code: 'ENOENT' })
        const mention = JSON.parse(raw.toString('utf8')).message.content[0].text
        const original = mention.slice(2, -1)
        const { handleFilesystemRoute } = await import('./src/server/api/filesystem.ts')
        const { handleLocalFile } = await import('./src/server/api/localFile.ts')
        const image = new URL('http://fixture.invalid/api/filesystem/file')
        image.searchParams.set('path', original)
        const local = new URL('http://fixture.invalid/local-file/' + original.replace(/^[\\/]+/, '').split(/[\\/]/).map(encodeURIComponent).join('/'))
        for (const response of [await handleFilesystemRoute(image.pathname, image), await handleLocalFile(local)]) {
          assert.equal(response.status, 200)
          assert.equal(response.headers.get('Content-Type'), 'image/png')
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG)
        }
        const { getEmptyToolPermissionContext } = await import('./src/Tool.ts')
        const { getAttachmentsForTesting } = await import('./src/utils/attachments.ts')
        const { isUserProvidedImage } = await import('./src/utils/userProvidedImages.ts')
        const permissionContext = getEmptyToolPermissionContext()
        const context = {
          readFileState: new Map(),
          abortController: new AbortController(),
          getAppState: () => ({ toolPermissionContext: permissionContext }),
        }
        const relocated = path.join(root, path.relative(oldRoot, original))
        const imagePath = await fs.realpath(relocated)
        for (const dir of [oldRoot, root]) {
          const denied = path.relative(home, path.join(dir, 'im-downloads')).split(path.sep).join('/')
          permissionContext.alwaysDenyRules.session = ['Read(~/' + denied + '/**)']
          assert.deepEqual(await getAttachmentsForTesting.atMentionedFiles(mention, context), [])
          assert.equal(isUserProvidedImage(imagePath), false)
        }
        delete permissionContext.alwaysDenyRules.session
        const [attachment] = await getAttachmentsForTesting.atMentionedFiles(mention, context)
        assert.equal(attachment?.content.type, 'image')
        assert.equal(isUserProvidedImage(imagePath), true)
        const { AttachmentStore } = await import('./adapters/common/attachment/attachment-store.ts')
        const current = new AttachmentStore().resolvePath('feishu', 'current-session', 'next.png')
        assert.equal(current, path.join(root, 'im-downloads', 'feishu', 'current-session', 'next.png'))
        assert.deepEqual(await fs.readFile(path.join(root, 'projects', 'fixture', 'session.jsonl')), raw)
      } finally { await releaseProcessStorage() }
    `)
  } finally { await rm(home, { recursive: true, force: true }) }
})
