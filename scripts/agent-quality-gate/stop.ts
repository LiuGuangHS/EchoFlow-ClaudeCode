import { defaultStateDir, evaluateGate, recordBlock, recordWaiver, readState } from './state.js'

export type StopInput = {
  hook_event_name?: string
  session_id?: string
  stop_hook_active?: boolean
  last_assistant_message?: string
}

export type StopDecision = {
  /** 0 lets the session end, 2 blocks the stop and shows `message` to the model. */
  exit: 0 | 2
  message: string
  /** Whether the model should see `message` at all. A stop that needs nothing stays quiet. */
  report: boolean
}

/**
 * How many times one gap may be refused before the gate stands down. A gate
 * that cannot be satisfied must not hold the session hostage; the refusals stay
 * in state so the gap is still visible afterwards.
 */
const MAX_BLOCKS = 3

export async function acknowledge(
  sessionId: string,
  reason: string,
  dir = defaultStateDir(),
): Promise<void> {
  await recordWaiver(sessionId, reason, dir)
}

export async function decideStop(input: StopInput, dir = defaultStateDir()): Promise<StopDecision> {
  const sessionId = input.session_id
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return { exit: 0, message: 'no session id', report: false }
  }

  const state = await readState(sessionId, dir)
  const verdict = evaluateGate(state)

  if (!verdict.blocked) {
    return verdict.waived
      ? { exit: 0, message: `BLOCKED: ${verdict.reason}`, report: true }
      : { exit: 0, message: verdict.reason, report: false }
  }

  if (state.blockCount >= MAX_BLOCKS) {
    return {
      exit: 0,
      message: `giving up after ${state.blockCount} refusals — ${verdict.reason}`,
      report: true,
    }
  }

  await recordBlock(sessionId, dir)
  return {
    exit: 2,
    report: true,
    message: [
      `this task changed code but ${verdict.missing.join(' and ')} did not run after the last edit.`,
      state.editedFiles.length > 0 ? `edited: ${state.editedFiles.join(', ')}` : '',
      'finish the missing step. A maintainer can waive this gap if the step is genuinely unavailable.',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

/** Read stdin to the end without letting a broken stream take the hook down. */
export async function readAll(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: string[] = []
  try {
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'))
    }
  } catch {
    return chunks.join('')
  }
  return chunks.join('')
}

/**
 * `--ack` has to work when a person runs it by hand, which means no hook payload
 * on stdin — hence `--session`. The session id from stdin still works for the
 * case where the hook invokes this itself.
 */
export async function runCli(
  args: string[],
  rawStdin: string,
  dir = defaultStateDir(),
): Promise<StopDecision> {
  let input: StopInput = {}
  if (rawStdin) {
    try {
      input = JSON.parse(rawStdin) as StopInput
    } catch {
      // A gate that cannot parse its input must let the session end.
    }
  }

  const sessionIndex = args.indexOf('--session')
  const fromFlag = sessionIndex === -1 ? '' : (args[sessionIndex + 1] ?? '')
  const sessionId =
    typeof fromFlag === 'string' && fromFlag.length > 0
      ? fromFlag
      : typeof input.session_id === 'string'
        ? input.session_id
        : ''

  const ackIndex = args.indexOf('--ack')
  if (ackIndex !== -1) {
    const reason = args[ackIndex + 1]
    if (typeof reason === 'string' && reason.length > 0 && sessionId) {
      await recordWaiver(sessionId, reason, dir)
    }
    return { exit: 0, message: '', report: false }
  }

  return decideStop({ ...input, session_id: sessionId }, dir)
}

export async function main(): Promise<void> {
  const decision = await runCli(process.argv.slice(2), await readAll(process.stdin))
  if (decision.report) console.error(decision.message)
  process.exitCode = decision.exit
}

if (import.meta.main) void main()
