#!/usr/bin/env bun

import { spawnSync } from 'node:child_process'
import { lstatSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createSandboxedTestEnvironment, removeTestSandbox } from './test-environment'

type SwiftCheckRunner = (
  command: string[],
  options: { cwd: string; env: Record<string, string> },
) => Promise<number>

function cleanupCommand(command: string, args: string[], env: Record<string, string>, input?: string) {
  const result = spawnSync(command, args, {
    env, input, timeout: 10_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? `status=${result.status} signal=${result.signal}`}; ${result.stderr?.trim().slice(0, 2000) ?? ''}`)
  }
  return result.stdout
}

function sandboxImageDevices(sandboxHome: string, env: Record<string, string>) {
  const plist = cleanupCommand('/usr/bin/hdiutil', ['info', '-plist'], env)
  // hdiutil includes data/date values which plutil cannot convert to JSON.
  // Python's isolated stdlib parser extracts only the mounted-device metadata.
  const images: unknown = JSON.parse(cleanupCommand('/usr/bin/python3', ['-I', '-c',
    'import json, plistlib, sys; p = plistlib.load(sys.stdin.buffer); json.dump([i["system-entities"] for i in p["images"]], sys.stdout)',
  ], {}, plist))
  if (!Array.isArray(images)) throw new Error('invalid hdiutil image list')
  const canonicalHome = realpathSync(sandboxHome)
  const within = (parent: string, child: string) => {
    const path = relative(parent, child)
    return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
  }
  const devices: string[] = []
  for (const entities of images) {
    if (!Array.isArray(entities)) throw new Error('invalid hdiutil system-entities')
    const mounted = entities.filter(entity => {
      if (!entity || typeof entity !== 'object') throw new Error('invalid hdiutil entity')
      return 'mount-point' in entity
    })
    const owned = mounted.filter(entity => {
      const point = entity['mount-point']
      if (typeof point !== 'string' || !isAbsolute(point)) throw new Error('invalid hdiutil mount-point')
      if (!within(resolve(sandboxHome), resolve(point)) && !within(canonicalHome, resolve(point))) return false
      if (!within(canonicalHome, realpathSync(point))) throw new Error('sandbox mount-point resolves outside sandbox')
      return true
    })
    if (owned.length === 0) continue
    // detach operates on an entire image: never detach an image with another
    // mounted volume outside this invocation's sandbox.
    if (owned.length !== mounted.length) throw new Error('disk image also has a mount outside sandbox; refusing detach')
    const device = owned[0]['dev-entry']
    if (typeof device !== 'string' || !/^\/dev\/disk\d+(?:s\d+)*$/.test(device)) throw new Error('invalid hdiutil device entry')
    devices.push(device)
  }
  return [...new Set(devices)]
}

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
        const assertOwnedSandbox = () => {
          const current = lstatSync(sandboxHome)
          if (!current.isDirectory() || current.dev !== sandboxIdentity.dev || current.ino !== sandboxIdentity.ino) {
            throw new Error('sandbox identity changed; refusing image cleanup')
          }
        }
        assertOwnedSandbox()
        // Xcode mounts MetalToolchain images beneath its sandboxed HOME. rm and
        // chmod cannot clean a mounted read-only filesystem: release it first.
        const env = createSandboxedTestEnvironment(sandboxHome, { CFFIXED_USER_HOME: sandboxHome }, {})
        const devices = sandboxImageDevices(sandboxHome, env)
        if (devices.length === 0) throw new Error('no owned disk image found; retaining sandbox')
        for (const device of devices) {
          assertOwnedSandbox()
          cleanupCommand('/usr/bin/hdiutil', ['detach', device], env)
        }
        assertOwnedSandbox()
        if (sandboxImageDevices(sandboxHome, env).length !== 0) throw new Error('sandbox disk image remains mounted after detach')
        const retry = removeTestSandbox(sandboxHome, 'swift-checks', message => { cleanupWarning += `; after-detach=${message}` })
        if (retry) throw new Error('sandbox removal still failed after detach')
        console.log(`[swift-checks] detached ${devices.length} sandbox disk image(s) and removed sandbox after EROFS`)
        cleanupWarning = ''
      } catch (error) {
        cleanupWarning += `; image-cleanup=${error instanceof Error ? error.message : String(error)}`
      }
    }
    if (cleanupWarning) console.warn(cleanupWarning)
  }
}

if (import.meta.main) process.exit(await runSwiftChecks())
