#!/usr/bin/env bun

import { spawnSync } from 'node:child_process'
import { lstatSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment, removeTestSandbox } from './test-environment'

type SwiftCheckRunner = (
  command: string[],
  options: { cwd: string; env: Record<string, string> },
) => Promise<number>

export async function runSwiftChecks(options: {
  platform?: NodeJS.Platform
  run?: SwiftCheckRunner
} = {}): Promise<number> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    console.log(`[swift-checks] not applicable on ${platform}: cu-helper targets macOS; PR CI requires the macOS Swift job separately`)
    return 0
  }

  const root = resolve(import.meta.dir, '../..')
  const sandboxHome = mkdtempSync(join(tmpdir(), 'cc-haha-swift-checks-'))
  const sandboxIdentity = lstatSync(sandboxHome)
  const run = options.run ?? (async (command, spawnOptions) => {
    const child = Bun.spawn(command, { ...spawnOptions, stdout: 'inherit', stderr: 'inherit' })
    return await child.exited
  })
  try {
    const env = createSandboxedTestEnvironment(sandboxHome, { CFFIXED_USER_HOME: sandboxHome })
    const swiftExit = await run([
      'swift', 'test',
      '--package-path', join(root, 'native/cu-helper'),
      '--scratch-path', join(sandboxHome, 'build'),
      '--enable-xctest',
    ], { cwd: root, env })
    if (swiftExit !== 0) return swiftExit
    // The macOS PR job and local check:native share this entrypoint. Keep the
    // shell packaging/probe regressions here so they cannot silently remain
    // unexecuted while Swift XCTest alone reports the native lane green.
    return await run([
      'bun', 'test', join(root, 'native/cu-helper/build.test.ts'),
    ], { cwd: root, env })
  } finally {
    // The tests already reported. A leftover the runner refuses to delete must not
    // turn a passing Swift lane red (seen as EROFS on GitHub macOS runners).
    let cleanupWarning = ''
    const failure = removeTestSandbox(sandboxHome, 'swift-checks', message => { cleanupWarning = message })
    if (failure && (failure.error as NodeJS.ErrnoException)?.code === 'EROFS') {
      try {
        // Only retry this invocation's mkdtemp directory, never a caller-supplied
        // path or a replacement symlink. /bin/rm does not follow child symlinks.
        const current = lstatSync(sandboxHome)
        if (!current.isDirectory() || current.dev !== sandboxIdentity.dev || current.ino !== sandboxIdentity.ino) {
          throw new Error('sandbox identity changed; refusing system cleanup')
        }
        // Bun reports only the root path for this macOS recursive-rm failure.
        // Use the OS implementation once; keep its stderr if it also fails.
        const result = spawnSync('/bin/rm', ['-rf', '--', sandboxHome], {
          env: {}, timeout: 10_000, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'],
        })
        if (result.error || result.status !== 0) {
          throw new Error(`system rm failed: ${result.error?.message ?? `status=${result.status} signal=${result.signal}`}; ${result.stderr?.trim() ?? ''}`)
        }
        try {
          lstatSync(sandboxHome)
          throw new Error('system rm returned success but sandbox remains')
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
        }
        console.log(`[swift-checks] recovered sandbox cleanup with /bin/rm after Bun EROFS: ${sandboxHome}`)
        cleanupWarning = ''
      } catch (error) {
        cleanupWarning += `; system-cleanup=${error instanceof Error ? error.message : String(error)}`
      }
    }
    if (cleanupWarning) console.warn(cleanupWarning)
  }
}

if (import.meta.main) process.exit(await runSwiftChecks())
