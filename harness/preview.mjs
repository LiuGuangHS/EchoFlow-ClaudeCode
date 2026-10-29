#!/usr/bin/env node
/**
 * Local preview of the EchoFlow Agent launcher.
 *
 * Boots the real launcher with the real EchoFlow profile, but points the model
 * provider at a loopback gateway that speaks the OpenAI completions SSE shape.
 * No provider credential and no network beyond 127.0.0.1, so this runs on any
 * machine and every contributor sees the same output.
 *
 * Usage: npm run preview
 */
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectAcp } from './src/acpClient.js'

const harnessRoot = dirname(fileURLToPath(import.meta.url))
const MODEL = 'echoflow-mock'
const API_KEY = 'echoflow-preview-key'
const REPLY = [
  '我是运行在 EchoFlow 自有启动器上的 agent。',
  '这一轮回复没有经过任何外网模型，',
  '全部来自本地回环网关的测试数据。',
]

const line = () => console.log('─'.repeat(64))
const step = (index, text) => console.log(`\n[${index}/4] ${text}`)

function startGateway(requests) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        requests.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        })
        if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        const send = (delta, finishReason) => {
          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-echoflow-preview',
            object: 'chat.completion.chunk',
            created: 1,
            model: MODEL,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`)
        }
        send({ role: 'assistant', content: '' }, null)
        let index = 0
        const tick = () => {
          if (index >= REPLY.length) {
            send({}, 'stop')
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
          const text = REPLY[index++]
          send({ content: text }, null)
          setTimeout(tick, 120)
        }
        tick()
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('gateway did not bind')
      resolve({ server, url: `http://127.0.0.1:${address.port}/v1` })
    })
  })
}

function writeHomePatch(dshHome, baseURL) {
  writeFileSync(join(dshHome, 'cordis.patch.yml'), [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      echoflow:',
    '        displayName: EchoFlow preview (loopback)',
    '        api: openai-completions',
    `        baseURL: ${baseURL}`,
    '        apiKeyEnv: ECHOFLOW_API_KEY',
    '        models:',
    `          - id: ${MODEL}`,
    '            name: EchoFlow Mock',
    '            contextWindow: 128000',
    '- id: agent-default-model',
    '  config:',
    '    provider: echoflow',
    `    model: ${MODEL}`,
    '- id: acp',
    '  config:',
    '    provider: echoflow',
    `    model: ${MODEL}`,
    '',
  ].join('\n'))
}

async function main() {
  const blocklist = JSON.parse(readFileSync(join(harnessRoot, 'egress-blocklist.json'), 'utf8'))
  const sandbox = mkdtempSync(join(tmpdir(), 'echoflow-preview-'))
  const home = join(sandbox, 'home')
  const dshHome = join(sandbox, 'dsh-home')
  const agentsHome = join(sandbox, 'agents-home')
  const workspace = join(sandbox, 'workspace')
  for (const dir of [home, dshHome, agentsHome, workspace]) mkdirSync(dir, { recursive: true })

  const requests = []
  const gateway = await startGateway(requests)
  writeHomePatch(dshHome, gateway.url)

  line()
  console.log('EchoFlow Agent · 本地预览')
  line()
  console.log(`启动器     ${join(harnessRoot, 'src', 'dshProcess.js')}`)
  console.log(`沙箱       ${sandbox}`)
  console.log(`模型网关   ${gateway.url}  (127.0.0.1 回环，无外网)`)
  console.log(`出网封锁   ${blocklist.plugins.length} 个插件 · ${blocklist.hosts.length} 个域名`)
  console.log(`运行时守卫 ${blocklist.requiredPlugins?.join(', ') ?? '无'}（启动前后 + 重载时复检）`)

  const session = await connectAcp({
    cwd: workspace,
    env: {
      HOME: home,
      DSH_HOME: dshHome,
      DSH_AGENTS_HOME: agentsHome,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_CACHE_HOME: join(home, '.cache'),
      PATH: process.env.PATH ?? '',
      LANG: process.env.LANG ?? 'C.UTF-8',
      ECHOFLOW_API_KEY: API_KEY,
    },
  })

  step(1, '启动自有启动器并握手')
  const init = await session.initialize()
  console.log(`  agent      ${init.agentInfo?.name} ${init.agentInfo?.version ?? ''}`.trimEnd())
  console.log(`  协议       ACP v${init.protocolVersion}`)

  const created = await session.newSession({ cwd: workspace, mcpServers: [] })
  console.log(`  session    ${created.sessionId}`)
  const configText = JSON.stringify(created.configOptions ?? {})
  console.log(`  DeepSeek 路由 ${configText.includes('deepseek-') ? '仍存在（异常）' : '已移除'}`)

  step(2, '发送一轮 prompt，流式读取回复')
  process.stdout.write('  模型 → ')
  const result = await session.prompt('用一句话介绍你自己', {
    onUpdate: (update) => {
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
        process.stdout.write(update.content.text)
      }
    },
  })
  console.log(`\n  stopReason ${result.stopReason}`)

  step(3, '回环网关收到的请求')
  console.log(`  请求数     ${requests.length}`)
  for (const request of requests) {
    const body = JSON.parse(request.body || '{}')
    console.log(`  ${request.method} ${request.url}`)
    console.log(`  model      ${body.model}`)
    console.log(`  stream     ${body.stream}`)
    console.log(`  鉴权       ${request.authorization === `Bearer ${API_KEY}` ? 'Bearer *** (匹配)' : '缺失'}`)
  }

  step(4, '关闭连接，观察有界退出')
  const exit = await session.close()
  console.log(`  退出码     ${exit.code}`)
  if (exit.stderr.trim()) {
    console.log('  stderr:')
    console.log(exit.stderr.trim().split('\n').map(text => `    ${text}`).join('\n'))
  }
  line()

  rmSync(sandbox, { recursive: true, force: true })
  await new Promise(resolve => gateway.server.close(resolve))
  process.exitCode = exit.code === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('\n预览失败:')
  console.error(error)
  process.exitCode = 1
})
