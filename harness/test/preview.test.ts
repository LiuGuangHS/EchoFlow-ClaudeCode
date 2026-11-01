import { describe, expect, test } from 'vitest'
import { agent, client } from '@agentclientprotocol/sdk'
import { registerPermissionHandler } from '../src/acpClient.js'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_TIMEOUT = 120_000
const harnessRoot = join(fileURLToPath(new URL('..', import.meta.url)))

function runPreview(): Promise<{ status: number | null, output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(harnessRoot, 'preview.mjs')], {
      cwd: harnessRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.once('error', reject)
    child.once('close', (status) => resolve({ status, output }))
  })
}

describe('the ACP permission handler', () => {
  test('passes request params to policy and returns its selected allow option', async () => {
    const seen = []
    const app = client({ name: 'permission-test' })
    registerPermissionHandler(app, params => {
      seen.push(params)
      return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    })
    const fakeAgent = agent()
    const params = {
      sessionId: 'session-test',
      toolCall: { toolCallId: 'tool-test', title: 'run', kind: 'execute', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    }

    const result = await fakeAgent.connectWith(app, context => context.request('session/request_permission', params))

    expect(seen).toEqual([params])
    expect(result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
  })
})

describe('the real local preview', () => {
  test('preview runs the real tool loop against the official mock', async () => {
    const result = await runPreview()
    expect(result.status).toBe(0)
    expect(result.output.match(/请求数\s+(\d+)/)?.[1]).toBeDefined()
    expect(Number(result.output.match(/请求数\s+(\d+)/)?.[1])).toBeGreaterThanOrEqual(2)
    expect(result.output).toContain('工具调用')
    expect(result.output).toContain('工具状态')
    expect(result.output).toContain('stopReason end_turn')
    expect(result.output).toContain('DeepSeek 路由 已移除')
    expect(result.output).toContain('hello from the echoflow agent')
    expect(result.output).not.toContain('echoflow-preview-key')
  }, TEST_TIMEOUT)
})
