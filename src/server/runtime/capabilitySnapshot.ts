/**
 * What dsh actually offers through ACP, as far as this driver exercises it.
 *
 * The default is `unsupported`: a capability is claimed only after a test
 * drives it. "Try it and see" turns an unsupported request into a silent
 * downgrade, which the contract forbids.
 */
import type { Capability, CapabilityState, RuntimeCapabilities } from './contract.js'

function cap(state: CapabilityState, note?: string): Capability {
  return { state, source: 'protocol-baseline', ...(note === undefined ? {} : { note }) }
}

const native = (note?: string) => cap('native', note)
const unsupported = (note?: string) => cap('unsupported', note)

export function dshBaselineCapabilities(): RuntimeCapabilities {
  return {
    session: {
      list: unsupported(),
      resume: unsupported(),
      fork: unsupported(),
      close: native('ACP session/close; product restart path untested'),
      delete: unsupported(),
    },
    prompt: {
      text: native(),
      image: unsupported(),
      embeddedResource: unsupported(),
      steer: unsupported(),
      queue: native('ACP inbox queues the next turn'),
    },
    config: {
      model: native('session/set_config_option, configId "model"'),
      reasoningEffort: native('session/set_config_option, configId "reasoning_effort"'),
      permissionMode: unsupported(),
    },
    approval: {
      tool: native(),
      command: unsupported(),
      fileChange: unsupported(),
      userInput: unsupported(),
      network: unsupported(),
    },
    commands: {
      catalog: unsupported(),
      execute: unsupported(),
    },
    subagent: {
      delegate: unsupported(),
      control: unsupported(),
    },
    jobs: {
      list: unsupported(),
      output: unsupported(),
      kill: unsupported(),
    },
    checkpoints: {
      session: unsupported(),
      files: unsupported(),
    },
    extensions: {
      mcpStdio: native('session/new mcpServers; ACP requires stdio support'),
      mcpHttp: unsupported('claimed only when the handshake advertises mcpCapabilities.http'),
      hooks: unsupported(),
      skills: unsupported(),
      plugins: unsupported(),
      schedule: unsupported(),
      teams: unsupported(),
    },
    observability: {
      usage: native('dsh emits usage_update only when the provider reports usage'),
      cost: unsupported(),
      diffs: unsupported(),
      contextPressure: native('usage_update carries the used/size context window'),
      stats: unsupported(),
    },
  }
}
