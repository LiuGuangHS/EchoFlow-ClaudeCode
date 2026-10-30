/**
 * The EchoFlow runtime contract.
 *
 * Product code and drivers meet here and nowhere else: engine-native payloads
 * travel inside `native`, and no engine SDK type appears in this file. Shapes
 * follow docs/superpowers/specs/2026-10-29-multi-runtime-deconstruction.md
 * §3.2-3.8; the blocks marked "Wave 1" fill gaps the spec leaves open.
 */

export type EngineId = 'echoflow-agent' | 'dsh' | 'claude-code' | 'codex'

export type DriverId = 'dsh-acp' | 'claude-agent-sdk' | 'codex-app-server' | 'legacy-echoflow-runtime'

export type RuntimeLocation = { kind: 'local' } | { kind: 'wsl'; distro: string }

export type RuntimeDistribution = 'bundled' | 'managed' | 'system' | 'custom'

export type InstallationId = string

export type RuntimeInstallation = {
  installationId: InstallationId
  engineId: EngineId
  driverId: DriverId
  distribution: RuntimeDistribution
  location: RuntimeLocation
  executablePath: string
  version: string | null
}

export type CapabilityState = 'native' | 'unsupported'

export type CapabilitySource = 'handshake' | 'protocol-baseline' | 'version-assumption' | 'extension'

export type Capability = {
  state: CapabilityState
  source: CapabilitySource
  note?: string
}

export type RuntimeCapabilities = {
  session: {
    list: Capability
    resume: Capability
    fork: Capability
    close: Capability
    delete: Capability
  }
  prompt: {
    text: Capability
    image: Capability
    embeddedResource: Capability
    steer: Capability
    queue: Capability
  }
  config: {
    model: Capability
    reasoningEffort: Capability
    permissionMode: Capability
  }
  approval: {
    tool: Capability
    command: Capability
    fileChange: Capability
    userInput: Capability
    network: Capability
  }
  commands: {
    catalog: Capability
    execute: Capability
  }
  subagent: {
    delegate: Capability
    control: Capability
  }
  jobs: {
    list: Capability
    output: Capability
    kill: Capability
  }
  checkpoints: {
    session: Capability
    files: Capability
  }
  extensions: {
    mcpStdio: Capability
    mcpHttp: Capability
    hooks: Capability
    skills: Capability
    plugins: Capability
    schedule: Capability
    teams: Capability
  }
  observability: {
    usage: Capability
    cost: Capability
    diffs: Capability
    contextPressure: Capability
    stats: Capability
  }
}

// --- Wave 1: inputs the spec names but does not define ---

export type RuntimeStartInput = {
  installation: RuntimeInstallation
  runId: string
  cwd: string
  env?: Record<string, string | undefined>
  startupTimeoutMs?: number
}

export type RuntimeProbe = {
  ok: boolean
  version: string | null
  protocolVersion: number | null
  error: string | null
}

export type SessionModelRef = { provider: string; model: string }

export type McpServerSpec =
  | { kind: 'stdio'; name: string; command: string; args?: string[]; env?: Record<string, string> }
  | { kind: 'http'; name: string; url: string; headers?: Record<string, string> }

export type NewSessionInput = {
  sessionId: string
  cwd: string
  mcpServers?: McpServerSpec[]
  model?: SessionModelRef
  reasoningEffort?: string
}

export type ResumeSessionInput = { sessionId: string; nativeSessionId: string; cwd: string }

export type ListSessionsQuery = { cwd?: string }

export type NativeSessionSummary = { nativeSessionId: string; cwd?: string; updatedAt?: number }

export type RuntimeExit = { code: number | null; signal: string | null }

export type UserTurn = { text: string }

// --- Approvals (spec §3.7) ---

export type ApprovalRequest = {
  requestId: string
  kind: 'tool' | 'command' | 'file-change' | 'user-input' | 'network' | 'permission-profile' | 'mcp-elicitation' | 'other'
  title: string
  details: unknown
  options: Array<{
    id: string
    label: string
    effect: 'allow-once' | 'allow-session' | 'allow-always' | 'deny' | 'other'
    scope?: string
  }>
  defaultOptionId?: string
  native: unknown
}

export type ApprovalDecision = {
  requestId: string
  /** `null` when the engine's request was cancelled: ACP's cancel outcome has no option. */
  optionId: string | null
  decidedBy: 'user' | 'policy' | 'engine-auto' | 'timeout' | 'cancelled'
  policyId?: string
  at: number
}

export type InterruptResult = {
  status: 'cancelled' | 'cancelling' | 'not-running' | 'unsupported'
  residualWork?: string[]
  forcedTerminate: boolean
}

// --- Events (spec §3.6) ---

export type RuntimeEventSource = 'engine' | 'echoflow'

export type RuntimeEventEnvelope = {
  eventId: string
  sessionId: string
  runId: string
  seq: number
  at: number
  source: RuntimeEventSource
}

export type RuntimeEventBody =
  | { kind: 'session.state'; state: 'idle' | 'running' | 'awaiting_approval' | 'closed' }
  | { kind: 'assistant.delta'; text: string }
  | { kind: 'assistant.message'; text: string; native: unknown }
  | { kind: 'tool.started'; toolCallId: string; name: string; input: unknown; native: unknown }
  | { kind: 'tool.updated'; toolCallId: string; native: unknown }
  | { kind: 'tool.completed'; toolCallId: string; output: unknown; isError: boolean; native: unknown }
  | { kind: 'plan'; entries: unknown[]; native: unknown }
  | { kind: 'approval.requested'; request: ApprovalRequest }
  | { kind: 'approval.resolved'; requestId: string; decision: ApprovalDecision }
  | { kind: 'file.changed'; paths: string[]; patch?: string; native: unknown }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number; cost?: number; native: unknown }
  | { kind: 'turn.completed'; reason: 'end_turn' | 'cancelled' | 'error' | 'max_tokens' | 'refusal'; native: unknown }
  | { kind: 'engine.exited'; code: number | null; signal: string | null }
  | { kind: 'diagnostic'; level: 'info' | 'warn' | 'error'; code: string; message: string; native?: unknown }

export type RuntimeEvent = RuntimeEventEnvelope & RuntimeEventBody

// --- Driver interfaces (spec §3.3) ---

export type RuntimeDriver = {
  readonly engineId: EngineId
  readonly driverId: DriverId

  probe(installation: RuntimeInstallation): Promise<RuntimeProbe>
  start(input: RuntimeStartInput): Promise<RuntimeConnection>
}

export type RuntimeConnection = {
  readonly capabilities: RuntimeCapabilities
  openSession(input: NewSessionInput): Promise<RuntimeSession>
  resumeSession(input: ResumeSessionInput): Promise<RuntimeSession>
  listSessions(query: ListSessionsQuery): AsyncIterable<NativeSessionSummary>
  close(): Promise<void>
  onExit(listener: (exit: RuntimeExit) => void): () => void
}

export type RuntimeSession = {
  readonly nativeSessionId: string
  readonly capabilities: RuntimeCapabilities

  send(input: UserTurn): AsyncIterable<RuntimeEvent>
  respondApproval(requestId: string, optionId: string): Promise<void>
  interrupt(): Promise<InterruptResult>
  close(): Promise<void>
}

// --- Errors ---

export class RuntimeBusyError extends Error {
  constructor(message = 'the session already has an active turn') {
    super(message)
    this.name = 'RuntimeBusyError'
  }
}

export class UnsupportedRuntimeCapabilityError extends Error {
  constructor(capability: string) {
    super(`the runtime does not support ${capability}`)
    this.name = 'UnsupportedRuntimeCapabilityError'
  }
}

export class RuntimeStartupError extends Error {
  readonly stderr: string

  constructor(message: string, stderr: string) {
    super(message)
    this.name = 'RuntimeStartupError'
    this.stderr = stderr
  }
}
