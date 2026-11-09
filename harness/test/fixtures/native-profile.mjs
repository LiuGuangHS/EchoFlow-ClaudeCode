import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { bootEchoFlowNativeAgent } from '../../src/boot.js'
import { snapshotLoaderTree, verifyEffectiveConfig } from '../../bundles/egress-guard/src/verify.js'

const [root, phase] = process.argv.slice(2)
assert.ok(root && ['create', 'resume'].includes(phase))
assert.equal(process.env.HOME, join(root, 'home'))
assert.equal(process.env.DSH_HOME, join(root, 'dsh'))
assert.equal(process.env.DSH_AGENTS_HOME, join(root, 'agents'))
assert.equal(process.cwd(), join(root, 'workspace'))

const disabledPluginIds = [
  'tool-plugin-manager', 'tool-working-directory', 'tool-bash', 'tool-pwsh',
  'tool-jobs', 'tool-fs', 'tool-fs-search', 'tool-skill', 'tool-subagent-control',
  'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork',
  'tool-workflow', 'tool-todo', 'tool-goal', 'tool-web', 'tool-result-pruner',
  'remote-access', 'typert-gateway', 'hmr', 'plugin-manager', 'commands', 'command-feedback',
  'command-goal', 'command-compact', 'plan-mode', 'goal-round-driver', 'web',
  'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'mcp-resources',
]
const home = process.env.DSH_HOME
const keyName = 'ECHOFLOW_NATIVE_FIXTURE_API_KEY'
const key = process.env[keyName]
assert.equal(key, 'native-profile-offline-fixture')
let mock
let ctx
let handle
let failure
try {
  mkdirSync(home, { recursive: true })
  mock = await startMockLlmServer({
    apiKey: key,
    sequence: ['success'],
    repeatLast: true,
    successText: 'native module reply',
    chunkSize: 5,
    chunkDelayMs: 1,
  })
  writeFileSync(join(home, 'cordis.patch.yml'), [
    ...disabledPluginIds.flatMap(id => [`- id: ${id}`, '  disabled: false']),
    '- id: llm-pi-ai', '  config:', '    providers:', '      echoflow:',
    '        displayName: Offline native profile fixture',
    '        api: anthropic-messages', `        baseURL: ${mock.baseURL}`,
    `        apiKeyEnv: ${keyName}`, '        models:',
    '          - id: fixture-model', '            name: Fixture',
    '            contextWindow: 128000', '',
  ].join('\n'))

  const booted = await bootEchoFlowNativeAgent({ home })
  ctx = booted.ctx
  const entries = snapshotLoaderTree(ctx)
  assert.deepEqual(verifyEffectiveConfig(entries, booted.blocklist), [])
  assert.equal(booted.profile.name, 'native')
  assert.equal(entries.some(entry => entry.id === 'acp'), false)
  assert.equal(ctx.get('webServer'), undefined)
  assert.equal(ctx.get('sessionController'), undefined)
  assert.ok(ctx.get('agentLoop'))
  assert.ok(ctx.get('sessionPersistence'))
  assert.equal(ctx.tools.schemas().length, 0)
  for (const id of disabledPluginIds) {
    assert.equal(entries.find(entry => entry.id === id)?.disabled, true, `${id} must stay disabled`)
  }

  const agentOptions = { provider: 'echoflow', model: 'fixture-model' }
  handle = phase === 'create'
    ? await ctx.agents.create({ sessionId: 'native-profile-fixture', meta: { cwd: process.cwd() }, agentOptions })
    : await ctx.agents.resume({ resumeSessionId: 'native-profile-fixture', agentOptions })
  const texts = phase === 'create' ? ['first turn', 'second turn'] : ['continue the persisted conversation']
  for (const text of texts) {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    // Idle is only a test synchronization point, not a delivery/durability receipt.
    await handle.agent.whenIdle()
  }
  assert.equal(handle.agent.status, 'idle')
  const requests = mock.requests.filter(request =>
    !JSON.stringify(request.body.messages).includes('Generate the session title'),
  )
  assert.equal(requests.length, texts.length)
  if (phase === 'resume') {
    const restored = JSON.stringify(requests.at(-1)?.body)
    for (const text of ['first turn', 'second turn', 'native module reply', ...texts]) {
      assert.ok(restored.includes(text), `missing restored text: ${text}`)
    }
  }
} catch (error) {
  failure = error
} finally {
  const errors = failure === undefined ? [] : [failure]
  for (const cleanup of [() => handle?.dispose(), () => ctx?.fiber.dispose(), () => mock?.close()]) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, 'native fixture or cleanup failed')
}
console.log(`native-profile ${phase} passed (${process.versions.bun ? 'bun' : 'node'})`)
