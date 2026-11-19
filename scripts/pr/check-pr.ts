#!/usr/bin/env bun

import { evaluateChangePolicy } from './change-policy'
import { changedFilesForLocalPrCheck } from './changed-files'
import { localCheckCommands } from './local-checks'
import { dependentFilesForChangeSet } from './module-graph'

async function run(cmd: string[], options: { optional?: boolean } = {}) {
  console.log(`\n$ ${cmd.join(' ')}`)
  const proc = Bun.spawn(cmd, {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited

  if (code !== 0 && !options.optional) {
    process.exit(code)
  }

  return code
}

async function changedFiles() {
  const explicit = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  return changedFilesForLocalPrCheck(explicit)
}

const files = await changedFiles()
const labels = process.env.PR_LABELS?.split(',').map((label) => label.trim()).filter(Boolean) ?? []
if (process.env.ALLOW_CLI_CORE_CHANGE === '1' && !labels.includes('allow-cli-core-change')) {
  labels.push('allow-cli-core-change')
}
if (process.env.ALLOW_MISSING_TESTS === '1' && !labels.includes('allow-missing-tests')) {
  labels.push('allow-missing-tests')
}
if (process.env.ALLOW_COVERAGE_BASELINE_CHANGE === '1' && !labels.includes('allow-coverage-baseline-change')) {
  labels.push('allow-coverage-baseline-change')
}

const dependency = dependentFilesForChangeSet(process.cwd(), files)
if (dependency.degraded) {
  console.warn(`[check:pr] dependency graph unavailable (${dependency.reason}); selecting every surface check.`)
}
const result = evaluateChangePolicy(files, labels, dependency.dependents)

console.log('PR local check plan')
console.log(`  Files: ${files.length}`)
console.log(`  Areas: ${result.areas.length ? result.areas.join(', ') : 'none'}`)

if (result.blockingReason) {
  console.error('\nBlocked:')
  for (const reason of result.blockingReasons) {
    console.error(`- ${reason}`)
  }
  console.error('Use ALLOW_CLI_CORE_CHANGE=1, ALLOW_MISSING_TESTS=1, or ALLOW_COVERAGE_BASELINE_CHANGE=1 only after maintainer approval.')
  process.exit(1)
}

// Keep the legacy check:pr coverage exclusion; impact still reports that lane.
for (const command of localCheckCommands({ ...result.checks, coverage: false })) {
  await run(command)
}

console.log('\nPR local checks completed.')
