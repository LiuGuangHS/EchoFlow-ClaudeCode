import { defaultStateDir, recordTest } from './state.js'

export type PostToolInput = {
  hook_event_name?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  session_id?: string
}

const VERIFICATION_PREFIXES = [
  'bun test',
  'bun run test',
  'bun run check:',
  'bun run verify',
  'bun run quality:',
  'npm test',
  'npm run test',
  'npx vitest',
  'vitest run',
  'jest',
]

// check:impact prints a report and always exits 0. Counting it as verification
// would let a task end without a single test having run.
const NOT_VERIFICATION = ['bun run check:impact']

// A verification piped into a truncating command loses the exit status and the
// failing lines, so nothing in what the model saw proves the run. Refusing it
// here is what makes "don't hide the evidence behind | tail" a machine rule
// rather than a request. `git log | head` is unaffected: it is not a
// verification command in the first place.
const TRUNCATING_PIPE = /\|\s*(?:tail|head)\b/

/**
 * A command that opens a heredoc cannot be classified. The body is arbitrary
 * text and can contain a line that reads exactly like a verification run, so
 * treating it as commands invents proof that never existed. Refusing is the
 * only honest answer, and it can only ever cost a miss.
 */
function opensHeredoc(command: string): boolean {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '\\') {
      i++
      continue
    }
    if (char === '<' && command[i + 1] === '<') return true
  }
  return false
}

/**
 * Split a shell command at top-level `&&`, `||`, `;` and newlines, ignoring
 * separators inside quotes and after a backslash. A plain split would let
 * `git commit -m "x && bun test"` pass itself off as a verification run.
 */
export function splitCommand(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  // `&&` and `||` need a right-hand side. A trailing `;` or newline does not,
  // so only an empty segment left behind by those is suppressed.
  let lastSep: 'start' | 'chain' | 'punct' = 'start'
  const push = (sep: typeof lastSep) => {
    segments.push(current)
    current = ''
    lastSep = sep
  }
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (quote) {
      current += char
      // Conservative on purpose: an escaped quote does not close the string, so
      // we split less often and only ever miss a run rather than invent one.
      if (char === '\\' && i + 1 < command.length) {
        current += command[i + 1]
        i++
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '\\') {
      // An escaped separator is literal text, not a command boundary.
      current += char
      if (i + 1 < command.length) {
        current += command[i + 1]
        i++
      }
      continue
    }
    const pair = command.slice(i, i + 2)
    if (pair === '&&' || pair === '||') {
      push('chain')
      i++
      continue
    }
    if (char === ';' || char === '\n') {
      push('punct')
      continue
    }
    current += char
  }
  if (current.trim() !== '' || lastSep === 'chain') segments.push(current)
  return segments
}

/**
 * `check:` and `quality:` name a whole family of subcommands, so there the
 * prefix really is the word. Everywhere else the prefix has to end at a word
 * edge, or `bun test-utils.ts` would pass for `bun test`.
 */
function matchesPrefix(segment: string, prefix: string): boolean {
  if (!segment.startsWith(prefix)) return false
  return (
    prefix.endsWith(':') ||
    segment.length === prefix.length ||
    /\s/.test(segment[prefix.length])
  )
}

export function isTestCommand(command: string): boolean {
  if (opensHeredoc(command)) return false
  const segments = splitCommand(command).map(segment => segment.trim())
  // An empty segment means a chain operator with nothing after it: the whole
  // command is a syntax error and nothing ran at all.
  if (segments.some(segment => segment.length === 0)) return false
  return segments.some(
    segment =>
      !TRUNCATING_PIPE.test(segment) &&
      VERIFICATION_PREFIXES.some(prefix => matchesPrefix(segment, prefix)) &&
      !NOT_VERIFICATION.some(prefix => matchesPrefix(segment, prefix)),
  )
}

/**
 * PostToolUse fires only once the tool has actually run. A command that was
 * denied, interrupted or never started produces no PostToolUse at all, which is
 * why verification is credited here and not in PreToolUse. A run that finished
 * counts even when the tests themselves failed: the gate asks whether
 * verification ran, not whether it passed.
 */
export async function handlePostTool(
  input: PostToolInput,
  dir = defaultStateDir(),
): Promise<void> {
  const sessionId = input.session_id
  if (typeof sessionId !== 'string' || sessionId.length === 0) return
  if (input.tool_name !== 'Bash') return
  const command = input.tool_input?.command
  if (typeof command !== 'string' || !isTestCommand(command)) return
  await recordTest(sessionId, dir)
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
    await handlePostTool(JSON.parse(raw) as PostToolInput)
  } catch {
    // A recording hook must never take the session down with it.
  }
}

if (import.meta.main) void main()
