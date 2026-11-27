import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'

const repository = resolve(import.meta.dir, '../..')

test('unowned external memory and writable plugin overrides are refused without touching their data', async () => {
  const home = await mkdtemp(join(tmpdir(), 'external-storage-override-'))
  try {
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
      import assert from 'node:assert/strict'
      import fs from 'node:fs/promises'
      import path from 'node:path'
      globalThis.fetch = async () => { throw new Error('Unexpected network request') }
      const outside = path.join(process.env.HOME, 'unowned')
      await fs.mkdir(outside)
      await fs.writeFile(path.join(outside, 'state'), 'foreign')
      const { getAutoMemPath, getMemoryBaseDir } = await import(${JSON.stringify(join(repository, 'src/memdir/paths.ts'))})
      process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = outside
      assert.throws(() => getAutoMemPath(), /outside/)
      delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
      process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR = outside
      assert.throws(() => getMemoryBaseDir(), /outside/)
      const { getAgentMemoryDir } = await import(${JSON.stringify(join(repository, 'src/tools/AgentTool/agentMemory.ts'))})
      assert.throws(() => getAgentMemoryDir('fixture', 'local'), /outside/)
      process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = outside
      process.env.CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE = '1'
      const { getPluginsDirectory } = await import(${JSON.stringify(join(repository, 'src/utils/plugins/pluginDirectories.ts'))})
      const { getPluginZipCachePath } = await import(${JSON.stringify(join(repository, 'src/utils/plugins/zipCache.ts'))})
      assert.throws(() => getPluginsDirectory(), /outside/)
      assert.throws(() => getPluginZipCachePath(), /outside/)
      assert.deepEqual(await fs.readdir(outside), ['state'])
      assert.equal(await fs.readFile(path.join(outside, 'state'), 'utf8'), 'foreign')
    `], { cwd: home, env: createSandboxedTestEnvironment(home), stdout: 'pipe', stderr: 'pipe', timeout: 15_000 })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: '', stdout: '' })
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('local agent memory consumes the relocated remote base without recreating the retired root', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agent-memory-relocation-'))
  try {
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
      import assert from 'node:assert/strict'
      import fs from 'node:fs/promises'
      import path from 'node:path'
      globalThis.fetch = async () => { throw new Error('Unexpected network request') }
      const { getEchoFlowInternalDir } = await import(${JSON.stringify(join(repository, 'src/utils/echoFlowConfigRoot.ts'))})
      const internal = getEchoFlowInternalDir()
      const retired = path.join(process.env.HOME, 'retired-café')
      const destination = path.join(process.env.CLAUDE_CONFIG_DIR, 'remote-café')
      await fs.mkdir(internal, { recursive: true })
      await fs.writeFile(path.join(internal, 'storage-relocations.json'), JSON.stringify({
        version: 2, previousRoots: [], mappings: [{ from: retired, to: 'remote-café' }],
      }))
      process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR = retired
      const { getAgentMemoryDir, getAgentMemoryEntrypoint, isAgentMemoryPath } = await import(${JSON.stringify(join(repository, 'src/tools/AgentTool/agentMemory.ts'))})
      const user = getAgentMemoryDir('fixture', 'user')
      const local = getAgentMemoryDir('fixture', 'local')
      assert.equal(user, path.join(destination, 'agent-memory', 'fixture') + path.sep)
      assert.ok(local.startsWith(path.join(destination, 'projects') + path.sep), local)
      const file = getAgentMemoryEntrypoint('fixture', 'local')
      assert.equal(isAgentMemoryPath(file), true)
      assert.equal(isAgentMemoryPath(file.replace(destination, retired)), false)
      assert.equal(isAgentMemoryPath(path.join(local, '..', '..', '..', 'outside.md')), false)
      await fs.mkdir(local, { recursive: true })
      await fs.writeFile(file, 'fixture memory')
      assert.equal(await fs.readFile(file, 'utf8'), 'fixture memory')
      await assert.rejects(fs.stat(retired), { code: 'ENOENT' })
      delete process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
      assert.equal(getAgentMemoryDir('fixture', 'local'), path.join(process.cwd(), '.claude', 'agent-memory-local', 'fixture') + path.sep)
      assert.equal(getAgentMemoryDir('fixture', 'project'), path.join(process.cwd(), '.claude', 'agent-memory', 'fixture') + path.sep)
    `], { cwd: home, env: createSandboxedTestEnvironment(home), stdout: 'pipe', stderr: 'pipe', timeout: 15_000 })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: '', stdout: '' })
  } finally { await rm(home, { recursive: true, force: true }) }
})

for (const selection of ['default-user', 'remote-user', 'remote-local'] as const) {
  test(`agent memory ${selection} refuses an out-of-root descendant without touching it`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-memory-containment-'))
    try {
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
        import assert from 'node:assert/strict'
        import fs from 'node:fs/promises'
        import path from 'node:path'
        globalThis.fetch = async () => { throw new Error('Unexpected network request') }
        const root = process.env.CLAUDE_CONFIG_DIR
        await fs.mkdir(root, { recursive: true })
        const outside = path.join(process.env.HOME, 'outside')
        await fs.mkdir(outside)
        await fs.writeFile(path.join(outside, 'sentinel'), 'unchanged')
        if (${JSON.stringify(selection)} !== 'default-user') {
          process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR = path.join(root, 'remote')
        }
        const scope = ${JSON.stringify(selection === 'remote-local' ? 'local' : 'user')}
        const { getAgentMemoryDir, isAgentMemoryPath } = await import(${JSON.stringify(join(repository, 'src/tools/AgentTool/agentMemory.ts'))})
        const directory = getAgentMemoryDir('fixture', scope).slice(0, -1)
        await fs.mkdir(path.dirname(directory), { recursive: true })
        await fs.symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir')
        assert.equal(isAgentMemoryPath(path.join(directory, 'MEMORY.md')), false)
        assert.throws(() => getAgentMemoryDir('fixture', scope), /outside/)
        await fs.unlink(directory)
        await fs.mkdir(directory)
        assert.equal(isAgentMemoryPath(path.join(directory, 'MEMORY.md')), true)
        const nested = path.join(directory, 'topics')
        await fs.symlink(outside, nested, process.platform === 'win32' ? 'junction' : 'dir')
        assert.equal(isAgentMemoryPath(path.join(nested, 'topic.md')), false)
        await fs.unlink(nested)
        assert.deepEqual(await fs.readdir(outside), ['sentinel'])
        assert.equal(await fs.readFile(path.join(outside, 'sentinel'), 'utf8'), 'unchanged')
      `], { cwd: home, env: createSandboxedTestEnvironment(home), stdout: 'pipe', stderr: 'pipe', timeout: 15_000 })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: '', stdout: '' })
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}

for (const selection of ['default', 'cowork', 'remote'] as const) {
  test(`auto-memory ${selection} preserves the physical spelling of the selected storage root`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'memory-storage-path-'))
    const root = join(home, 'selected-café')
    const env = createSandboxedTestEnvironment(home, {
      CLAUDE_CONFIG_DIR: root,
      ...(selection === 'cowork' ? { CLAUDE_COWORK_MEMORY_PATH_OVERRIDE: join(root, 'memory-café') } : {}),
      ...(selection === 'remote' ? { CLAUDE_CODE_REMOTE_MEMORY_DIR: join(root, 'remote-café') } : {}),
    })
    try {
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
        import assert from 'node:assert/strict'
        import fs from 'node:fs/promises'
        import path from 'node:path'
        globalThis.fetch = async () => { throw new Error('Unexpected network request') }
        const { bindStorageRoot, resolveStorageBinding } = await import(${JSON.stringify(join(repository, 'src/utils/echoFlowConfigRoot.ts'))})
        const binding = resolveStorageBinding()
        bindStorageRoot(binding)
        const { getAutoMemPath, getAutoMemEntrypoint, isAutoMemPath } = await import(${JSON.stringify(join(repository, 'src/memdir/paths.ts'))})
        const directory = getAutoMemPath()
        assert.ok(directory.startsWith(binding.root + path.sep), directory)
        if (${JSON.stringify(selection)} === 'cowork') {
          assert.equal(directory, process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE + path.sep)
        }
        if (${JSON.stringify(selection)} === 'remote') {
          assert.ok(directory.startsWith(process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR + path.sep))
        }
        assert.equal(isAutoMemPath(directory + 'topic.md'), true)
        assert.equal(isAutoMemPath(directory.normalize('NFC') + 'topic.md'), false)
        assert.equal(isAutoMemPath(path.join(directory, '..', 'outside.md')), false)
        await fs.mkdir(directory, { recursive: true })
        await fs.writeFile(getAutoMemEntrypoint(), 'fixture memory')
        assert.equal(await fs.readFile(path.join(directory, 'MEMORY.md'), 'utf8'), 'fixture memory')
        process.env.CLAUDE_CODE_SIMPLE = '1'
        process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
        const { getEmptyToolPermissionContext } = await import(${JSON.stringify(join(repository, 'src/Tool.ts'))})
        const { FileReadTool } = await import(${JSON.stringify(join(repository, 'src/tools/FileReadTool/FileReadTool.ts'))})
        const { FileWriteTool } = await import(${JSON.stringify(join(repository, 'src/tools/FileWriteTool/FileWriteTool.ts'))})
        const context = {
          readFileState: new Map(), abortController: new AbortController(),
          updateFileHistoryState: () => {},
          getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }),
        }
        const file = getAutoMemEntrypoint()
        assert.equal(FileReadTool.getPath({ file_path: file }), file)
        const result = await FileReadTool.call({ file_path: file }, context)
        assert.equal(result.data.file.content, 'fixture memory')
        const input = { file_path: file, content: 'updated memory' }
        assert.deepEqual(await FileWriteTool.validateInput(input, context), { result: true })
        await FileWriteTool.call(input, context, undefined, { uuid: 'unicode-memory-write' })
        assert.equal(await fs.readFile(file, 'utf8'), 'updated memory')
        if (process.platform === 'linux') {
          await assert.rejects(fs.stat(binding.root.normalize('NFC')), { code: 'ENOENT' })
        }
        assert.equal(resolveStorageBinding().root, binding.root)
      `], { cwd: home, env, stdout: 'pipe', stderr: 'pipe', timeout: 15_000 })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: '', stdout: '' })
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
