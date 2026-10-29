import { describe, expect, test } from 'bun:test'
import { createFakeDshShapedDriver, createFakeMinimalDriver } from '../__fixtures__/fakeDrivers.js'
import { runRuntimeContractSuite, runScriptedTurn } from '../__fixtures__/contractSuite.js'

runRuntimeContractSuite('fake dsh-shaped', createFakeDshShapedDriver)
runRuntimeContractSuite('fake minimal', createFakeMinimalDriver)

describe('the two fakes are interchangeable', () => {
  test('produce the same contract events for the same script', async () => {
    const streams = []
    for (const makeDriver of [createFakeDshShapedDriver, createFakeMinimalDriver]) {
      const connection = await makeDriver().start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
      const session = await connection.openSession({ sessionId: 'session-1', cwd: '/tmp' })
      streams.push((await runScriptedTurn(session, 'hello')).map(stripVolatile))
      await connection.close()
    }
    expect(streams[0]).toEqual(streams[1])
  })
})

function stripVolatile(event) {
  const { eventId, at, native, ...rest } = event
  return rest
}
