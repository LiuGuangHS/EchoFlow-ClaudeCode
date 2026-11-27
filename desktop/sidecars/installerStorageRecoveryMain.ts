import { parseInstallerRecoveryArgs, recoverInstallerStorage } from './installerStorageRecovery'

try {
  if (process.platform !== 'win32') throw new Error('Packaged installer recovery requires Windows')
  const result = await recoverInstallerStorage(parseInstallerRecoveryArgs(process.argv.slice(2)))
  console.log(JSON.stringify({ version: 1, ...result }))
} catch (error) {
  console.error(`Installer storage recovery stopped: ${error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ') : 'unknown failure'}`)
  process.exitCode = 20
}
