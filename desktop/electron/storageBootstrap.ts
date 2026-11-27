import { app, dialog } from 'electron'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { bindStorageRoot } from '../../src/utils/echoFlowConfigRoot'
import { assertDesktopStorageControls, desktopStorageRelaunchArgs, discoverDesktopStorage, desktopStorageIdentity } from './services/desktopStorageStartup'
import { installStdioWriteFailureGuards } from './services/stdioGuards'
import { recordDesktopStorageLaunch } from './services/desktopStorageProvenance'

installStdioWriteFailureGuards()

export let desktopRelaunchArgs: string[]
try {
  const launch = discoverDesktopStorage(app)
  // Block before ready/defaultSession. The worker resolves the final binding
  // and checks launch controls before the shared transaction touches either root.
  // Resolve the separately built worker relative to the running bundle.
  const workerModule = './storage-bootstrap.cjs'
  const bootstrapFile = require.resolve(workerModule)
  const memory = new SharedArrayBuffer(64 * 1024)
  const state = new Int32Array(memory, 0, 2)
  const worker = new Worker(bootstrapFile, { workerData: { launch, memory } })
  worker.on('error', () => app.exit(1))
  if (Atomics.wait(state, 0, 0, 10 * 60_000) === 'timed-out') throw new Error('Storage bootstrap timed out; no desktop runtime was started')
  const response: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(memory, 8, Atomics.load(state, 1))))
  if (!response || typeof response !== 'object') throw new Error('Invalid storage bootstrap response')
  if ('error' in response) throw new Error(String(response.error))
  if (!('ok' in response) || response.ok !== true || !('binding' in response) || !response.binding || typeof response.binding !== 'object') throw new Error('Invalid admitted storage binding')
  const binding = response.binding as typeof launch.binding
  if (typeof binding.root !== 'string' || desktopStorageIdentity(binding.root) !== binding.root || binding.internalDir !== path.join(binding.root, 'echoflow-code') || !['explicit', 'default'].includes(binding.selection)) throw new Error('Invalid admitted storage binding')
  assertDesktopStorageControls(binding, launch.controls)
  const root = binding.root
  desktopRelaunchArgs = desktopStorageRelaunchArgs(process.argv.slice(1), launch)
  const controls = launch.controls ?? { roots: [] }
  recordDesktopStorageLaunch(binding, launch.move ? { ...controls, roots: controls.environmentRoot ? [controls.environmentRoot] : [] } : controls)
  worker.unref()
  process.env.CLAUDE_CONFIG_DIR = root
  process.env.ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG = path.join(root, 'claude-code-runtime.json')
  bindStorageRoot(binding)
  app.setPath('userData', root)
  app.setPath('sessionData', root)
  app.setAppLogsPath(path.join(binding.internalDir, 'logs'))
  const crashes = path.join(binding.internalDir, 'crashes')
  mkdirSync(crashes, { recursive: true, mode: 0o700 })
  app.setPath('crashDumps', crashes)
  app.commandLine.appendSwitch('disk-cache-dir', path.join(root, 'Cache'))
  app.commandLine.appendSwitch('media-cache-dir', path.join(root, 'Media Cache'))
  // Relaunch, updater and sidecars inherit the complete root, never an old-profile pointer.
  process.env.WEBVIEW2_USER_DATA_FOLDER = path.join(root, 'EBWebView')
} catch (error) {
  // showErrorBox is safe before ready. Waiting for a dialog window here would
  // allow Chromium to initialize the unresolved default profile.
  dialog.showErrorBox('数据目录不可用 / Data directory unavailable', error instanceof Error ? error.message : String(error))
  app.exit(1)
  process.exit(1)
}
