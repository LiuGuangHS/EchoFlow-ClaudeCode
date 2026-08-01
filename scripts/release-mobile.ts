#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const mobilePackagePath = path.join(root, 'mobile', 'package.json')
const mobileAppPath = path.join(root, 'mobile', 'app.json')

type MobileAppConfig = {
  expo?: {
    version?: string
  }
}

function bumpVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump

  const [major, minor, patch] = current.split('.').map(Number)
  switch (bump) {
    case 'patch': return `${major}.${minor}.${patch + 1}`
    case 'minor': return `${major}.${minor + 1}.0`
    case 'major': return `${major + 1}.0.0`
    default: throw new Error('Usage: bun run scripts/release-mobile.ts <patch|minor|major|x.y.z> [--dry]')
  }
}

async function run(command: string[]): Promise<void> {
  const process = Bun.spawn(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (exitCode !== 0) throw new Error(`Command failed: ${command.join(' ')}\n${stderr || stdout}`)
}

const arguments_ = process.argv.slice(2)
const dryRun = arguments_.includes('--dry')
const bump = arguments_.find((argument) => argument !== '--dry')
if (!bump) throw new Error('Usage: bun run scripts/release-mobile.ts <patch|minor|major|x.y.z> [--dry]')

const mobilePackage = JSON.parse(readFileSync(mobilePackagePath, 'utf-8')) as { version?: string }
const mobileApp = JSON.parse(readFileSync(mobileAppPath, 'utf-8')) as MobileAppConfig
const currentVersion = mobilePackage.version
if (!currentVersion || mobileApp.expo?.version !== currentVersion) {
  throw new Error('mobile/package.json and mobile/app.json versions must match before release')
}

const nextVersion = bumpVersion(currentVersion, bump)
const tag = `mobile-v${nextVersion}`
console.log(`Mobile version: ${currentVersion} → ${nextVersion}`)
console.log(`Mobile tag: ${tag}`)
console.log(`Dry run: ${dryRun}`)

if (dryRun) process.exit(0)

mobilePackage.version = nextVersion
mobileApp.expo!.version = nextVersion
writeFileSync(mobilePackagePath, `${JSON.stringify(mobilePackage, null, 2)}\n`)
writeFileSync(mobileAppPath, `${JSON.stringify(mobileApp, null, 2)}\n`)

await run(['git', 'add', 'mobile/package.json', 'mobile/app.json'])
await run(['git', 'commit', '-m', `release: mobile v${nextVersion}`])
await run(['git', 'tag', '-a', tag, '-m', `Mobile release ${tag}`])
console.log(`Created ${tag}`)
