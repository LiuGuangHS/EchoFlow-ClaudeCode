import fs from 'node:fs'
import path from 'node:path'

const desktopDir = path.resolve(import.meta.dirname, '..')
const prebuildsDir = path.join(desktopDir, 'node_modules', 'node-pty', 'prebuilds')

type PrepareNodePtyPrebuildsOptions = {
  prebuildsDir?: string
  platform?: NodeJS.Platform
}

type PrepareNodePtyPrebuildsResult = {
  helpersSeen: number
  helpersChanged: number
}

function ensureExecutable(filePath: string, platform: NodeJS.Platform): boolean {
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return false
  if (platform === 'win32') return false

  const executableMode = stat.mode | 0o755
  if ((stat.mode & 0o777) !== (executableMode & 0o777)) {
    fs.chmodSync(filePath, executableMode)
    return true
  }

  return false
}

export function prepareNodePtyPrebuilds(
  options: PrepareNodePtyPrebuildsOptions = {},
): PrepareNodePtyPrebuildsResult {
  const resolvedPrebuildsDir = options.prebuildsDir ?? prebuildsDir
  const platform = options.platform ?? process.platform

  if (!fs.existsSync(resolvedPrebuildsDir)) {
    throw new Error(`node-pty prebuilds directory is missing: ${resolvedPrebuildsDir}`)
  }

  let helpersSeen = 0
  let helpersChanged = 0

  for (const platformDir of fs.readdirSync(resolvedPrebuildsDir)) {
    const helperPath = path.join(resolvedPrebuildsDir, platformDir, 'spawn-helper')
    if (!fs.existsSync(helperPath)) continue

    helpersSeen += 1
    if (ensureExecutable(helperPath, platform)) {
      helpersChanged += 1
    }
  }

  if (platform === 'darwin' && helpersSeen === 0) {
    throw new Error(`node-pty spawn-helper is missing under ${resolvedPrebuildsDir}`)
  }

  return { helpersSeen, helpersChanged }
}

if (import.meta.main) {
  const result = prepareNodePtyPrebuilds()
  console.log(`[prepare-node-pty] spawn-helper executable bits verified (${result.helpersChanged}/${result.helpersSeen} updated)`)
}
