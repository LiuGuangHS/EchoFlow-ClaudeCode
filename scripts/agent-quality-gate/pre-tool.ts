import path from 'node:path'
import { defaultStateDir, recordEdit } from './state.js'

export type PreToolInput = {
  hook_event_name?: string
  cwd?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  session_id?: string
}

export type Classification = { kind: 'edit'; file: string } | { kind: 'ignore' }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')
}

function normalizePathForComparison(value: string, windowsSemantics: boolean): string {
  const slashPath = value.replaceAll('\\', '/')
  const drivePath = slashPath.match(/^([A-Za-z]):(?:\/(.*))?$/)
  if (drivePath) {
    return `/${drivePath[1].toLowerCase()}${drivePath[2] ? `/${drivePath[2]}` : ''}`.toLowerCase()
  }
  const gitBashPath = slashPath.match(/^\/([A-Za-z])(?:\/(.*))?$/)
  if (gitBashPath && windowsSemantics) {
    return `/${gitBashPath[1].toLowerCase()}${gitBashPath[2] ? `/${gitBashPath[2]}` : ''}`.toLowerCase()
  }
  return windowsSemantics ? slashPath.toLowerCase() : slashPath
}

function isWithinProject(file: string, cwd: string, root: string): boolean {
  const windowsSemantics = [file, cwd, root].some(isWindowsPath)
  const normalizedCwd = normalizePathForComparison(cwd, windowsSemantics)
  const normalizedRoot = normalizePathForComparison(root, windowsSemantics)
  const normalizedFile = normalizePathForComparison(file, windowsSemantics)
  const target = path.posix.resolve(normalizedCwd, normalizedFile)
  const relative = path.posix.relative(path.posix.resolve(normalizedCwd, normalizedRoot), target)
  return relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative)
}

export function classify(input: PreToolInput, projectDir?: string): Classification {
  const tool = input.tool_name
  if (!tool || !EDIT_TOOLS.has(tool)) return { kind: 'ignore' }
  // NotebookEdit names the file notebook_path; every other editing tool uses
  // file_path. Reading only file_path would make notebook edits invisible.
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path
  if (typeof file !== 'string' || file.length === 0) return { kind: 'ignore' }
  // Ignore scratch files outside the project while allowing edits above a nested cwd.
  const cwd = input.cwd ?? process.cwd()
  const root =
    projectDir ?? process.env.AGENT_QUALITY_GATE_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR
  if (root && !isWithinProject(file, cwd, root)) {
    return { kind: 'ignore' }
  }
  return { kind: 'edit', file }
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
