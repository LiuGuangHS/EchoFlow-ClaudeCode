import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  applyDefaultEchoFlowDataRoot,
  defaultEchoFlowDataRoot,
  ECHOFLOW_DEFAULT_CONFIG_ENV,
} from './echoFlowDataRoot'

describe('Electron EchoFlow data root', () => {
  it('keeps Electron userData separate without changing Claude config storage', () => {
    const homeDir = path.join('C:', 'Users', 'tester')
    const env: NodeJS.ProcessEnv = {
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    }

    expect(defaultEchoFlowDataRoot(env, 'win32', homeDir)).toBe(
      path.join(env.LOCALAPPDATA!, 'EchoFlow Code'),
    )
    expect(applyDefaultEchoFlowDataRoot(env)).toBe(defaultEchoFlowDataRoot(env))
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(env[ECHOFLOW_DEFAULT_CONFIG_ENV]).toBeUndefined()
  })
})
