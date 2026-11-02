import { describe, expect, test } from 'vitest'
import { connectAcp } from '../src/acpClient.js'

const TEST_TIMEOUT = 30_000

describe('connecting the ACP client', () => {
  test('reports a launcher command that cannot be spawned instead of crashing the process', async () => {
    const failure = await connectAcp({ command: '/nonexistent/dsh-binary' }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('launcher')
  }, TEST_TIMEOUT)

  test('a launcher that exits at once fails the handshake instead of hanging', async () => {
    const connection = await connectAcp({ launcherPath: '/nonexistent/dsh-launcher.js' })
    await expect(connection.initialize()).rejects.toThrow()
    await connection.close()
  }, TEST_TIMEOUT)
})
