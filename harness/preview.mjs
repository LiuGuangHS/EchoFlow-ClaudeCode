#!/usr/bin/env node
/**
 * Local preview of the EchoFlow Agent launcher.
 *
 * Boots the real launcher with the real EchoFlow profile, but points the model
 * provider at dsh's own mock Messages server, scripted to call the real `bash`
 * tool once. The turn therefore exercises the whole loop — model -> tool call
 * -> permission -> process -> tool result -> answer — with no provider
 * credential and no network beyond 127.0.0.1.
 *
 * Usage: npm run preview
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectAcp } from './src/acpClient.js'

const harnessRoot = dirname(fileURLToPath(import.meta.url))
const MODEL = 'echoflow-mock'
const API_KEY = 'echoflow-preview-key'
const TOOL_COMMAND = "printf 'hello from the echoflow agent\\n' > hello.txt && cat hello.txt"
const TOOL_ARGUMENTS = JSON.stringify({
  description: 'Write and read back a file',
  command: TOOL_COMMAND,
})
const FINAL_REPLY = '我已经用 bash 写好并读回了 hello.txt，内容就在上面那行。'

const line = () => console.log('─'.repeat(64))
const step = (index, text) => console.log(`\n[${index}/5] ${text}`)

function writeHomePatch(dshHome, baseURL) {
  writeFileSync(join(dshHome, 'cordis.patch.yml'), [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      echoflow:',
    '        displayName: EchoFlow preview (loopback mock)',
    '        api: anthropic-messages',
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

/** Show the agent's own tool activity as it happens, not after the fact. */
function reportUpdate(update) {
  if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
    process.stdout.write(update.content.text)
    return
  }
  if (update?.sessionUpdate === 'tool_call') {
    console.log(`  工具调用   ${update.title ?? update.kind ?? 'tool'} [${update.status ?? 'pending'}]`)
    return
  }
  if (update?.sessionUpdate === 'tool_call_update') {
    const text = (update.content ?? [])
      .filter(part => part?.type === 'content' && part.content?.type === 'text')
      .map(part => part.content.text.trim())
      .join('\n')
    console.log(`  工具状态   ${update.status ?? 'update'}${text ? ` · ${text}` : ''}`)
  }
}

async function main() {
  const blocklist = JSON.parse(readFileSync(join(harnessRoot, 'egress-blocklist.json'), 'utf8'))
  const sandbox = mkdtempSync(join(tmpdir(), 'echoflow-preview-'))
  const home = join(sandbox, 'home')
  const dshHome = join(sandbox, 'dsh-home')
  const agentsHome = join(sandbox, 'agents-home')
  const workspace = join(sandbox, 'workspace')
  for (const dir of [home, dshHome, agentsHome, workspace]) mkdirSync(dir, { recursive: true })

  // One scripted tool call, then ordinary answers. The mock speaks the
  // Anthropic Messages wire shape, and every request is recorded.
  const mock = await startMockLlmServer({
    apiKey: API_KEY,
    sequence: ['tool_call_success', 'success'],
    repeatLast: true,
    toolName: 'bash',
    toolArguments: TOOL_ARGUMENTS,
    successText: FINAL_REPLY,
    chunkSize: 10,
    chunkDelayMs: 20,
  })
  let session
  try {
    writeHomePatch(dshHome, mock.baseURL)

  line()
  console.log('EchoFlow Agent · 本地预览')
  line()
  console.log(`启动器     ${join(harnessRoot, 'src', 'dshProcess.js')}`)
  console.log(`沙箱       ${sandbox}`)
  console.log(`模型网关   ${mock.baseURL}/v1/messages  (官方 dsh mock，127.0.0.1 回环)`)
  console.log(`出网封锁   ${blocklist.plugins.length} 个插件 · ${blocklist.hosts.length} 个域名`)
  console.log(`运行时守卫 ${blocklist.requiredPlugins?.join(', ') ?? '无'}（启动前后 + 重载时复检）`)

  session = await connectAcp({
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
    // The preview has no permission UI; take the first allow the engine offers.
    onPermission: (request) => {
      const allow = request.options?.find(option =>
        option.kind === 'allow_once' || option.kind === 'allow_always')
      return allow === undefined
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId: allow.optionId } }
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

  step(2, '发一轮需要动手的 prompt，观察 agent 自己调工具')
  const result = await session.prompt('在沙箱里创建 hello.txt，把内容读回来告诉我。', {
    onUpdate: reportUpdate,
  })
  console.log(`\n  stopReason ${result.stopReason}`)

  step(3, '官方 mock 网关收到的请求')
  console.log(`  请求数     ${mock.requests.length}`)
  for (const request of mock.requests) {
    const body = request.body ?? {}
    const tools = Array.isArray(body.tools) ? body.tools.length : 0
    console.log(`  #${request.attempt} ${request.path} · ${request.behavior} · model ${body.model ?? '?'} · tools ${tools} · chunks ${request.chunksSent}`)
  }

  step(4, '沙箱里真的多了一个文件')
  try {
    console.log(`  hello.txt  ${JSON.stringify(readFileSync(join(workspace, 'hello.txt'), 'utf8'))}`)
  } catch {
    console.log('  hello.txt  没有生成（工具调用未执行）')
  }

  step(5, '关闭连接，观察有界退出')
  const exit = await session.close()
  console.log(`  退出码     ${exit.code}`)
  if (exit.stderr.trim()) {
    console.log('  stderr:')
    console.log(exit.stderr.trim().split('\n').map(text => `    ${text}`).join('\n'))
  }
  line()

  process.exitCode = exit.code === 0 ? 0 : 1
  } finally {
    await session?.close().catch(() => {})
    await mock.close()
    rmSync(sandbox, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('\n预览失败:')
  console.error(error)
  process.exitCode = 1
})
