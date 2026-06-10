import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { defaultDocsNpmCache, docsNpmEnv, npmCommandForPlatform } from './check-docs'

describe('docs check runner', () => {
  test('uses a repo-local npm cache by default', () => {
    const rootDir = join('D:', 'repo')

    expect(defaultDocsNpmCache(rootDir)).toBe(join(rootDir, 'docs', '.vitepress', 'cache', 'npm'))
    expect(docsNpmEnv(rootDir, {}).npm_config_cache).toBe(join(rootDir, 'docs', '.vitepress', 'cache', 'npm'))
  })

  test('preserves an explicit npm cache override', () => {
    expect(docsNpmEnv('repo', { npm_config_cache: 'custom-cache' }).npm_config_cache).toBe('custom-cache')
    expect(docsNpmEnv('repo', { NPM_CONFIG_CACHE: 'upper-cache' }).npm_config_cache).toBe('upper-cache')
  })

  test('uses the npm command name that Bun can spawn on each platform', () => {
    expect(npmCommandForPlatform('win32')).toBe('npm.cmd')
    expect(npmCommandForPlatform('linux')).toBe('npm')
  })
})
