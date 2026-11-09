import { expect, test } from 'bun:test'
import { createFakeDshShapedDriver } from '../__fixtures__/fakeDrivers.js'
import { RuntimeSessionAlreadyOpenError, UnknownRuntimeSessionError, createRuntimeHost } from '../controlPlane.js'
import type { ResumeSessionInput, RuntimeDriver, RuntimeInstallation } from '../contract.js'

const installation: RuntimeInstallation = {
  installationId: 'resume-installation', engineId: 'dsh', driverId: 'dsh-acp',
  distribution: 'bundled', location: { kind: 'local' }, executablePath: '/unused', version: null,
}

test('the host routes resume through its lifecycle and prevents duplicate product sessions', async () => {
  const received: ResumeSessionInput[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const base = createFakeDshShapedDriver()
  const driver: RuntimeDriver = {
    ...base,
    async start(input) {
      const connection = await base.start(input)
      return {
        ...connection,
        async resumeSession(request) {
          received.push(request)
          await gate
          const session = await connection.openSession({ sessionId: request.sessionId, cwd: request.cwd })
          return session
        },
      }
    },
  }
  const host = createRuntimeHost()
  host.registerDriver(driver)
  try {
    await host.connect({ installation, cwd: '/tmp' })
    const request = { installationId: installation.installationId, sessionId: 'resumed', nativeSessionId: 'native-1', cwd: '/tmp/project' }
    const resuming = host.resumeSession(request)
    await expect(host.openSession({ installationId: installation.installationId, sessionId: 'resumed', cwd: '/tmp' }))
      .rejects.toBeInstanceOf(RuntimeSessionAlreadyOpenError)
    release()
    const session = await resuming
    expect(received).toEqual([{ sessionId: request.sessionId, nativeSessionId: request.nativeSessionId, cwd: request.cwd }])
    expect(host.getSession('resumed')).toBe(session)
    await expect(host.resumeSession(request)).rejects.toBeInstanceOf(RuntimeSessionAlreadyOpenError)
    await host.close()
    expect(() => host.getSession('resumed')).toThrow(UnknownRuntimeSessionError)
  } finally {
    release()
    await host.close()
  }
})

test('a resume finishing after host close is closed and never registered', async () => {
  const base = createFakeDshShapedDriver()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let sessionClosed = 0
  const host = createRuntimeHost()
  host.registerDriver({
    ...base,
    async start(input) {
      const connection = await base.start(input)
      return {
        ...connection,
        async resumeSession(request) {
          await gate
          const session = await connection.openSession({ sessionId: request.sessionId, cwd: request.cwd })
          return {
            ...session,
            async close() {
              sessionClosed += 1
              await session.close()
            },
          }
        },
      }
    },
  })
  await host.connect({ installation, cwd: '/tmp' })
  const resuming = host.resumeSession({
    installationId: installation.installationId, sessionId: 'late-resume', nativeSessionId: 'native-1', cwd: '/tmp',
  })
  const closing = host.close()
  release()
  const [result] = await Promise.allSettled([resuming, closing])
  expect(result?.status).toBe('rejected')
  expect(sessionClosed).toBe(1)
  expect(() => host.getSession('late-resume')).toThrow(UnknownRuntimeSessionError)
})
