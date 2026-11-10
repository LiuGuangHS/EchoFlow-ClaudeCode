import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const desktopDir = path.resolve(import.meta.dirname, '..')

function ensureExecutable(filePath: string): boolean {
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return false

  const executableMode = stat.mode | 0o755
  if ((stat.mode & 0o777) !== (executableMode & 0o777)) {
    fs.chmodSync(filePath, executableMode)
    return true
  }

  return false
}

export function prepareNodePtyPrebuilds({
  prebuildsDir = path.join(desktopDir, 'node_modules', 'node-pty', 'prebuilds'),
  platform = process.platform,
}: { prebuildsDir?: string; platform?: NodeJS.Platform } = {}) {
  if (!fs.existsSync(prebuildsDir)) {
    throw new Error(`node-pty prebuilds directory is missing: ${prebuildsDir}`)
  }

  let helpersSeen = 0
  let helpersChanged = 0
  for (const platformDir of fs.readdirSync(prebuildsDir)) {
    const helperPath = path.join(prebuildsDir, platformDir, 'spawn-helper')
    if (!fs.existsSync(helperPath)) continue

    helpersSeen += 1
    if (platform !== 'win32' && ensureExecutable(helperPath)) {
      helpersChanged += 1
    }
  }

  if (platform === 'darwin' && helpersSeen === 0) {
    throw new Error(`node-pty spawn-helper is missing under ${prebuildsDir}`)
  }

  return { helpersSeen, helpersChanged }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { helpersSeen, helpersChanged } = prepareNodePtyPrebuilds()
  console.log(`[prepare-node-pty] spawn-helper executable bits verified (${helpersChanged}/${helpersSeen} updated)`)
}
