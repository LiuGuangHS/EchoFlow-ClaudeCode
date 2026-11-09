import * as fs from 'node:fs/promises'
import { getEchoFlowConfigDir, getEchoFlowInternalDir } from './echoFlowConfigRoot.js'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { ApiError } from '../middleware/errorHandler.js'
import { normalizeJsonObject, readRecoverableJsonFile } from './recoverableJsonFile.js'
import { ensurePersistentStorageUpgraded } from './persistentStorageMigrations.js'

export class ManagedSettingsService {
  private static writeLocks = new Map<string, Promise<void>>()

  static async drainForMigration(): Promise<void> {
    await Promise.all([...this.writeLocks.values()])
  }

  private getConfigDir(): string {
    return getEchoFlowConfigDir()
  }

  private getSettingsPath(): string {
    return path.join(getEchoFlowInternalDir(this.getConfigDir()), 'settings.json')
  }

  private async withWriteLock<T>(
    filePath: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previousWrite = ManagedSettingsService.writeLocks.get(filePath) ?? Promise.resolve()
    const nextWrite = previousWrite.catch(() => {}).then(task)
    const trackedWrite = nextWrite.then(() => {}, () => {})

    ManagedSettingsService.writeLocks.set(filePath, trackedWrite)

    try {
      return await nextWrite
    } finally {
      if (ManagedSettingsService.writeLocks.get(filePath) === trackedWrite) {
        ManagedSettingsService.writeLocks.delete(filePath)
      }
    }
  }

  private async writeSettings(settings: Record<string, unknown>, filePath: string): Promise<void> {
    const dir = path.dirname(filePath)
    const contents = JSON.stringify(settings, null, 2) + '\n'
    const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}`

    await fs.mkdir(dir, { recursive: true })

    try {
      await fs.writeFile(tmpFile, contents, 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (error) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write settings.json: ${error}`)
    }
  }

  async readSettings(filePath = this.getSettingsPath()): Promise<Record<string, unknown>> {
    await ensurePersistentStorageUpgraded()
    return readRecoverableJsonFile({
      filePath,
      label: 'EchoFlow managed settings',
      defaultValue: {},
      normalize: normalizeJsonObject,
    })
  }

  async updateSettings<T>(
    updater: (current: Record<string, unknown>) => Promise<{
      settings: Record<string, unknown>
      result: T
    }> | {
      settings: Record<string, unknown>
      result: T
    },
    onCommitted?: (previous: Record<string, unknown>, next: Record<string, unknown>) => void,
  ): Promise<T> {
    const filePath = this.getSettingsPath()
    return this.withWriteLock(filePath, async () => {
      const current = await this.readSettings(filePath)
      const { settings, result } = await updater(current)
      await this.writeSettings(settings, filePath)
      // Notify before releasing the lock: later mutations must not overtake revocation.
      onCommitted?.(current, settings)
      return result
    })
  }
}
