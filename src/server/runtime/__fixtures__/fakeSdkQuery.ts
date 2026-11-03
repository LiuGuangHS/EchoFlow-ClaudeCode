/**
 * A scripted stand-in for the Claude Agent SDK's query(). It speaks the SDK's
 * message shapes as declared in @anthropic-ai/claude-agent-sdk 0.3.317 and lets
 * a test inject a fault at an exact point. No process, network, or credential.
 */
import type { SdkQuery } from '../claudeAgentSdkDriver.js'

const SESSION_ID = '00000000-0000-4000-8000-000000000001'

export const sdkDelta = (text: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  parent_tool_use_id: null,
  session_id: SESSION_ID,
})

const sdkThinking = (thinking: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } },
  parent_tool_use_id: null,
  session_id: SESSION_ID,
})

const sdkResult = (extra: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  stop_reason: 'end_turn',
  result: '',
  session_id: SESSION_ID,
  ...extra,
})

type Call = { options: Record<string, any>; prompts: string[]; interrupts: number; aborted: boolean }
type Waiter = { resolve(result: IteratorResult<unknown>): void; reject(error: unknown): void }

export type FakeSdk = {
  query: SdkQuery
  calls: Call[]
  /** Faults the script really injected; a fault test asserts this before it asserts behavior. */
  faults: string[]
  permissionResults: unknown[]
  /** Messages pushed after the consumer detached from the stream (aborted or returned). */
  readonly lateOutput: number
  emit(message: unknown): void
}

export function createFakeSdk(): FakeSdk {
  const calls: Call[] = []
  const faults: string[] = []
  const permissionResults: unknown[] = []
  let lateOutput = 0
  let current: ((message: unknown) => void) | null = null

  const query: SdkQuery = ({ prompt, options }) => {
    const call: Call = { options: options as Record<string, any>, prompts: [], interrupts: 0, aborted: false }
    calls.push(call)
    const buffer: unknown[] = []
    const waiters: Waiter[] = []
    let finished = false
    let failure: Error | null = null
    let detached = false
    let interruptRequested = false
    let wakeInterrupt: (() => void) | null = null

    function settle() {
      while (waiters.length > 0) {
        const waiter = waiters[0]!
        if (buffer.length > 0) {
          waiters.shift()
          waiter.resolve({ done: false, value: buffer.shift() })
        } else if (failure !== null) {
          const error = failure
          failure = null
          finished = true
          waiters.shift()
          waiter.reject(error)
        } else if (finished) {
          waiters.shift()
          waiter.resolve({ done: true, value: undefined })
        } else {
          return
        }
      }
    }
    function emit(message: unknown) {
      if (detached) {
        lateOutput += 1
        return
      }
      buffer.push(message)
      settle()
    }
    function end() {
      finished = true
      settle()
    }
    function fail(error: Error) {
      failure = error
      settle()
    }
    current = emit
    options.abortController?.signal.addEventListener('abort', () => {
      call.aborted = true
      end()
      detached = true
    })

    const handle = {
      next: () =>
        new Promise<IteratorResult<unknown>>((resolve, reject) => {
          waiters.push({ resolve, reject })
          settle()
        }),
      return: async () => {
        end()
        detached = true
        return { done: true as const, value: undefined }
      },
      throw: async (error: unknown) => {
        throw error
      },
      [Symbol.asyncIterator]() {
        return handle
      },
      interrupt: async () => {
        call.interrupts += 1
        interruptRequested = true
        wakeInterrupt?.()
      },
    }

    async function run(text: string) {
      if (text === 'hello') {
        emit(sdkDelta('one'))
        emit(sdkDelta('two'))
        emit(sdkResult())
      } else if (text === 'think') {
        emit(sdkThinking('planning'))
        emit(sdkDelta('answer'))
        emit(sdkResult())
      } else if (text === 'usage') {
        emit(sdkResult({ usage: { input_tokens: 10, output_tokens: 2 }, modelUsage: { fake: { contextWindow: 100 } }, total_cost_usd: 0.01 }))
      } else if (text === 'schedule') {
        emit(sdkResult())
        // Speak after the user's turn, the way an armed job would.
        setTimeout(() => {
          emit(sdkDelta('engine note'))
          emit(sdkResult())
        }, 20)
      } else if (text === 'ask') {
        const verdict = await options.canUseTool?.('Bash', { command: 'ls' }, { signal: new AbortController().signal, toolUseID: 'tool-1', title: 'Run ls' })
        permissionResults.push(verdict)
        emit(sdkDelta(verdict?.behavior === 'allow' ? 'ran' : 'denied'))
        emit(sdkResult())
      } else if (text === 'slow') {
        if (!interruptRequested) {
          await new Promise<void>((resolve) => {
            wakeInterrupt = resolve
          })
        }
        interruptRequested = false
        emit(sdkResult({ subtype: 'error_during_execution', is_error: true, stop_reason: null }))
      } else if (text === 'stuck') {
        // An engine that never answers, and ignores the interrupt.
        await new Promise<void>(() => {})
      } else if (text === 'refuse') {
        faults.push('refuse')
        emit(sdkResult({ is_error: true, stop_reason: null, result: 'API Error: 401 invalid x-api-key' }))
      } else if (text === 'crash') {
        emit(sdkDelta('partial'))
        faults.push('crash')
        fail(new Error('write EPIPE'))
      } else if (text === 'vanish') {
        emit(sdkDelta('partial'))
        faults.push('vanish')
        end()
      } else {
        emit(sdkResult())
      }
    }

    void (async () => {
      for await (const message of prompt) {
        const content = (message as any).message.content
        const text = typeof content === 'string' ? content : content.map((block: any) => block.text ?? '').join('')
        call.prompts.push(text)
        await run(text)
      }
    })()

    return handle as unknown as ReturnType<SdkQuery>
  }

  return {
    query,
    calls,
    faults,
    permissionResults,
    get lateOutput() {
      return lateOutput
    },
    emit: (message) => current?.(message),
  }
}
