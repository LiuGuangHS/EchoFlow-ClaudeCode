#!/usr/bin/env bun
/**
 * Release script for EchoFlow Code Desktop
 *
 * Usage:
 *   bun run scripts/release.ts patch       # 0.1.0 → 0.1.1
 *   bun run scripts/release.ts minor       # 0.1.0 → 0.2.0
 *   bun run scripts/release.ts major       # 0.1.0 → 1.0.0
 *   bun run scripts/release.ts 2.0.0       # explicit version
 *   bun run scripts/release.ts patch --dry  # preview without changes
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')

const VERSION_FILES = [
  {
    path: path.join(root, 'desktop/package.json'),
    update(content: string, version: string) {
      return content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
    },
  },
  {
    path: path.join(root, 'mobile/package.json'),
    update(content: string, version: string) {
      return content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
    },
  },
  {
    path: path.join(root, 'mobile/app.json'),
    update(content: string, version: string) {
      return content.replace(/("expo"\s*:\s*\{[\s\S]*?"version":\s*)"[^"]*"/, `$1"${version}"`)
    },
  },
]

function getCurrentVersion(): string {
  const desktopPackage = JSON.parse(
    readFileSync(path.join(root, 'desktop/package.json'), 'utf-8'),
  )
  return desktopPackage.version
}

function getReleaseNotesPath(version: string): string {
  return path.join(root, 'release-notes', `v${version}.md`)
}

function bumpVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump
  }

  const [major, minor, patch] = current.split('.').map(Number)

  switch (bump) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'major':
      return `${major + 1}.0.0`
    default:
      console.error(`Invalid bump type: ${bump}`)
      console.error('Usage: bun run scripts/release.ts <patch|minor|major|x.y.z> [--dry]')
      process.exit(1)
  }
}

async function run(cmd: string[], cwd = root) {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`Command failed: ${cmd.join(' ')}\n${stderr || stdout}`)
  }
  return stdout.trim()
}

function updateVersionFiles(next: string): string[] {
  const changed: string[] = []
  for (const file of VERSION_FILES) {
    const content = readFileSync(file.path, 'utf-8')
    const updated = file.update(content, next)
    if (updated === content) continue
    writeFileSync(file.path, updated)
    changed.push(file.path)
    console.log(`  Updated: ${path.relative(root, file.path)}`)
  }
  return changed
}

// ── Main ──────────────────────────────────────────────

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const bumpArg = args.find((a) => a !== '--dry')

if (!bumpArg) {
  console.error('Usage: bun run scripts/release.ts <patch|minor|major|x.y.z> [--dry]')
  process.exit(1)
}

const current = getCurrentVersion()
const next = bumpVersion(current, bumpArg)
const releaseNotesPath = getReleaseNotesPath(next)

console.log(`\n  Version: ${current} → ${next}`)
console.log(`  Tag:     v${next}`)
console.log(`  Notes:   ${path.relative(root, releaseNotesPath)}`)
console.log(`  Dry run: ${dryRun}\n`)

if (dryRun) {
  console.log('Files that would be updated:')
  for (const file of VERSION_FILES) {
    console.log(`  - ${path.relative(root, file.path)}`)
  }
  console.log(`  - ${path.relative(root, releaseNotesPath)} ${existsSync(releaseNotesPath) ? '(present)' : '(missing)'}`)
  process.exit(0)
}

if (!existsSync(releaseNotesPath)) {
  console.error(`Missing release notes file: ${path.relative(root, releaseNotesPath)}`)
  console.error(`Create it before releasing so GitHub Release can use it automatically.`)
  process.exit(1)
}

const changedVersionFiles = updateVersionFiles(next)

if (changedVersionFiles.length > 0) {
  console.log('  Creating git commit...')
  await run([
    'git',
    'add',
    ...changedVersionFiles.map(file => path.relative(root, file)),
    path.relative(root, releaseNotesPath),
  ])
  await run(['git', 'commit', '-m', `release: v${next}`])
} else {
  console.log('  Version files already match; creating tag from current HEAD.')
}

await run(['git', 'tag', '-a', `v${next}`, '-m', `Release v${next}`])

console.log(`\n  Done! Created commit and tag v${next}`)
console.log(`\n  To trigger the build:\n    git push origin main --tags\n`)
