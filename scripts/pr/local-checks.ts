import type { ChangePolicyResult } from './change-policy'

const orderedCommands: Array<[keyof ChangePolicyResult['checks'], string[]]> = [
  ['policy', ['bun', 'run', 'check:policy']],
  ['desktop', ['bun', 'run', 'check:desktop']],
  ['mobile', ['bun', 'run', 'check:mobile']],
  ['server', ['bun', 'run', 'check:server']],
  ['providerContract', ['bun', 'run', 'check:provider-contract']],
  ['chatContract', ['bun', 'run', 'check:chat-contract']],
  ['agentFlow', ['bun', 'run', 'check:agent-flow']],
  ['agentE2e', ['bun', 'run', 'check:agent-e2e']],
  ['harness', ['bun', 'run', '--cwd', 'harness', 'test']],
  ['harness', ['bun', 'run', 'audit:harness']],
  ['adapters', ['bun', 'run', 'check:adapters']],
  ['desktopNative', ['bun', 'run', 'check:native']],
  ['persistence', ['bun', 'run', 'check:persistence-upgrade']],
  ['docs', ['bun', 'run', 'check:docs']],
  ['coverage', ['bun', 'run', 'check:coverage']],
]

export function localCheckCommands(checks: ChangePolicyResult['checks']): string[][] {
  return orderedCommands.filter(([check]) => checks[check]).map(([, command]) => command)
}
