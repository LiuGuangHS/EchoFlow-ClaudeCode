import { defaultStateDir, recordReview } from './state.js'

export type SubagentStopInput = {
  hook_event_name?: string
  session_id?: string
  agent_id?: string
  agent_type?: string
  last_assistant_message?: string
}

/**
 * A subagent is a separate context from the one that made the edits, so its
 * completion is the only real event available that says "someone other than the
 * author looked at this". It proves independence, not review quality — that is
 * the evals layer's job.
 *
 * A fork inherits the author's whole conversation, so it is the same pair of
 * eyes in a second hat; the relay-only subagents ("hand the report back") are
 * forks. An unnamed subagent proves nothing about who looked. Neither may
 * satisfy the review requirement.
 */
const NOT_INDEPENDENT = new Set(['fork'])

export async function handleSubagentStop(
  input: SubagentStopInput,
  dir = defaultStateDir(),
): Promise<void> {
  const sessionId = input.session_id
  if (typeof sessionId !== 'string' || sessionId.length === 0) return
  const reviewer = input.agent_type
  if (typeof reviewer !== 'string' || reviewer.length === 0) return
  if (NOT_INDEPENDENT.has(reviewer)) return
  await recordReview(sessionId, dir, reviewer)
}

export async function main(): Promise<void> {
  const chunks: Buffer[] = []
  try {
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  } catch {
    return
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return
  try {
    await handleSubagentStop(JSON.parse(raw) as SubagentStopInput)
  } catch {
    // A recording hook must never take the session down with it.
  }
}

if (import.meta.main) void main()
