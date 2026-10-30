import { defaultStateDir, recordEdit } from './state.js'

export type PreToolInput = {
  hook_event_name?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  session_id?: string
}

export type Classification = { kind: 'edit'; file: string } | { kind: 'ignore' }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export function classify(input: PreToolInput): Classification {
  const tool = input.tool_name
  if (!tool || !EDIT_TOOLS.has(tool)) return { kind: 'ignore' }
  // NotebookEdit names the file notebook_path; every other editing tool uses
  // file_path. Reading only file_path would make notebook edits invisible.
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path
  if (typeof file === 'string' && file.length > 0) return { kind: 'edit', file }
  return { kind: 'ignore' }
}

/**
 * Records what changed. Verification is deliberately not credited here: this
 * hook fires before the command runs, so a denied or interrupted command would
 * still look like proof. post-tool.ts does that once the run has completed.
 */
export async function handlePreTool(input: PreToolInput, dir = defaultStateDir()): Promise<void> {
  const sessionId = input.session_id
  if (typeof sessionId !== 'string' || sessionId.length === 0) return
  const verdict = classify(input)
  if (verdict.kind === 'edit') await recordEdit(sessionId, verdict.file, dir)
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
    await handlePreTool(JSON.parse(raw) as PreToolInput)
  } catch {
    // A recording hook must never take the session down with it.
  }
}

if (import.meta.main) void main()
