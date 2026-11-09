import { expect, test } from 'bun:test'
import { createFakeDshShapedDriver } from '../__fixtures__/fakeDrivers.js'
import { createRuntimeHost } from '../controlPlane.js'
import type { NewSessionInput, RuntimeDriver, RuntimeInstallation } from '../contract.js'

const installation: RuntimeInstallation = {
  installationId: 'options-installation', engineId: 'dsh', driverId: 'dsh-acp',
  distribution: 'bundled', location: { kind: 'local' }, executablePath: '/unused', version: null,
}

test('the control plane preserves session configuration and does not forward installation routing', async () => {
  const received: NewSessionInput[] = []
  const base = createFakeDshShapedDriver()
  const driver: RuntimeDriver = {
    ...base,
    async start(input) {
      const connection = await base.start(input)
      return {
        ...connection,
        async openSession(options) {
          received.push(options)
          return connection.openSession(options)
        },
      }
    },
  }
  const host = createRuntimeHost()
  host.registerDriver(driver)
  try {
    await host.connect({ installation, cwd: '/tmp' })
    const options: NewSessionInput = {
      sessionId: 'configured-session', cwd: '/tmp/project',
      model: { provider: 'fixture-provider', model: 'fixture-model' },
      reasoningEffort: 'high',
      mcpServers: [{ kind: 'stdio', name: 'fixture', command: '/unused/mcp', args: ['--fixture'], env: { FIXTURE: 'true' } }],
    }
    await host.openSession({ installationId: installation.installationId, ...options })
    expect(received).toEqual([options])
    expect(received[0]).not.toHaveProperty('installationId')
    expect(host.getSession(options.sessionId)).toBeDefined()
  } finally {
    await host.close()
  }
})
