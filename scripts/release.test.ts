import { describe, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function git(cwd: string, args: string[]) {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString() || result.stdout.toString()}`)
  }
  return result.stdout.toString().trim()
}

function runRelease(cwd: string, args: string[]) {
  return Bun.spawnSync(['bun', 'run', 'scripts/release.ts', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

function makeReleaseRepo() {
  const root = mkdtempSync(join(tmpdir(), 'echoflow-release-test-'))
  mkdirSync(join(root, 'desktop'), { recursive: true })
  mkdirSync(join(root, 'release-notes'), { recursive: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  copyFileSync(join(process.cwd(), 'scripts', 'release.ts'), join(root, 'scripts', 'release.ts'))
  writeFileSync(
    join(root, 'desktop', 'package.json'),
    JSON.stringify({ version: '0.4.1' }, null, 2) + '\n',
  )
  writeFileSync(join(root, 'mobile', 'package.json'), JSON.stringify({ version: '0.4.1' }, null, 2) + '\n')
  writeFileSync(join(root, 'mobile', 'app.json'), JSON.stringify({ expo: { version: '0.4.1' } }, null, 2) + '\n')
  writeFileSync(join(root, 'release-notes', 'v0.4.1.md'), '# EchoFlow Code v0.4.1\n')
  git(root, ['init'])
  git(root, ['config', 'user.email', 'release-test@example.com'])
  git(root, ['config', 'user.name', 'Release Test'])
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'initial'])
  return root
}

describe('release script', () => {
  test('creates a tag without an empty release commit when the requested version already matches', () => {
    const root = makeReleaseRepo()
    try {
      const before = git(root, ['rev-parse', 'HEAD'])

      const result = runRelease(root, ['0.4.1'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain('Version files already match')
      expect(git(root, ['rev-parse', 'HEAD'])).toBe(before)
      expect(git(root, ['tag', '--list', 'v0.4.1'])).toBe('v0.4.1')
      expect(readFileSync(join(root, 'desktop', 'package.json'), 'utf8')).toContain('"version": "0.4.1"')
      expect(readFileSync(join(root, 'mobile', 'package.json'), 'utf8')).toContain('"version": "0.4.1"')
      expect(readFileSync(join(root, 'mobile', 'app.json'), 'utf8')).toContain('"version": "0.4.1"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('updates desktop and mobile version sources together', () => {
    const root = makeReleaseRepo()
    try {
      writeFileSync(join(root, 'release-notes', 'v0.5.1.md'), '# EchoFlow Code v0.5.1\n')

      const result = runRelease(root, ['0.5.1'])

      expect(result.exitCode).toBe(0)
      expect(readFileSync(join(root, 'desktop', 'package.json'), 'utf8')).toContain('"version": "0.5.1"')
      expect(readFileSync(join(root, 'mobile', 'package.json'), 'utf8')).toContain('"version": "0.5.1"')
      expect(readFileSync(join(root, 'mobile', 'app.json'), 'utf8')).toContain('"version": "0.5.1"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
