#!/usr/bin/env bun

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function defaultDocsNpmCache(rootDir = process.cwd()) {
  return join(rootDir, 'docs', '.vitepress', 'cache', 'npm')
}

export function docsNpmEnv(
  rootDir = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    ...env,
    npm_config_cache: env.npm_config_cache || env.NPM_CONFIG_CACHE || defaultDocsNpmCache(rootDir),
  }
}

export function npmCommandForPlatform(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm'
}

async function run(command: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
  console.log(`$ ${command.join(' ')}`)
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}

export async function runDocsCheck(rootDir = process.cwd(), env = docsNpmEnv(rootDir)) {
  mkdirSync(env.npm_config_cache ?? defaultDocsNpmCache(rootDir), { recursive: true })
  const npmBin = npmCommandForPlatform()
  await run([npmBin, 'ci', '--loglevel=error'], { cwd: rootDir, env })
  await run([npmBin, 'run', '--loglevel=error', 'docs:build'], { cwd: rootDir, env })
}

if (import.meta.main) {
  await runDocsCheck()
}
