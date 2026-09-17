#!/usr/bin/env node
/**
 * Bundle DeepSeek Harness into desktop app resources
 *
 * This script downloads and prepares a specific version of @deepseek-ai/dsh
 * to be bundled with the desktop app, enabling offline usage.
 *
 * Run: bun run desktop/scripts/bundle-deepseek-harness.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const DSH_VERSION = '0.1.5-rc.2'
const DSH_PACKAGE = '@deepseek-ai/dsh'

const desktopRoot = path.resolve(__dirname, '..')
const bundleRoot = path.join(desktopRoot, 'resources', 'deepseek-harness')
const bundleDir = path.join(bundleRoot, DSH_VERSION)

async function main() {
  console.log(`[bundle-dsh] Bundling ${DSH_PACKAGE}@${DSH_VERSION}`)

  // Clean existing bundle
  if (existsSync(bundleDir)) {
    console.log(`[bundle-dsh] Cleaning existing bundle at ${bundleDir}`)
    rmSync(bundleDir, { recursive: true, force: true })
  }

  await mkdir(bundleDir, { recursive: true })

  // Install dsh to bundle directory
  console.log(`[bundle-dsh] Installing to ${bundleDir}`)
  try {
    execSync(`npm install --prefix ${bundleDir} --no-audit --no-fund --ignore-scripts ${DSH_PACKAGE}@${DSH_VERSION}`, {
      stdio: 'inherit',
      cwd: desktopRoot,
    })
  } catch (error) {
    console.error(`[bundle-dsh] Installation failed:`, error)
    process.exit(1)
  }

  // Verify installation
  const executable = path.join(bundleDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(executable)) {
    console.error(`[bundle-dsh] Verification failed: ${executable} does not exist`)
    process.exit(1)
  }

  console.log(`[bundle-dsh] ✓ Successfully bundled ${DSH_PACKAGE}@${DSH_VERSION}`)
  console.log(`[bundle-dsh]   Executable: ${executable}`)
}

main().catch(error => {
  console.error('[bundle-dsh] Fatal error:', error)
  process.exit(1)
})
