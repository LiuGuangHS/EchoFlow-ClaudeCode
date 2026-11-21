import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveStorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { getAppMode } from './appMode'
import { clearDesktopStorageInjections, hasExternalDesktopStorageControls, recordDesktopStorageLaunch } from './desktopStorageProvenance'

const root = path.resolve('/fixture/managed-profile')
const binding = resolveStorageBinding({ env: {}, roots: [root] })
const injected = () => ({ CLAUDE_CONFIG_DIR: root, ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: path.join(root, 'claude-code-runtime.json'), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'EBWebView') })

describe('desktop launch provenance', () => {
  it('recognizes only the captured environment object and immutable original controls', () => {
    const env: NodeJS.ProcessEnv = {}
    const controls = { roots: [] as string[] }
    recordDesktopStorageLaunch(binding, controls, env)
    controls.roots.push(root)
    Object.assign(env, injected())
    expect(hasExternalDesktopStorageControls(env, root)).toBe(false)
    expect(hasExternalDesktopStorageControls({ ...env }, root)).toBe(true)
    expect(getAppMode({ getPath: name => name === 'home' ? path.resolve('/fixture/home') : root }, env).configDirSource).toBe('portable')
    expect(hasExternalDesktopStorageControls(env, path.resolve('/other'))).toBe(true)
    env.WEBVIEW2_USER_DATA_FOLDER = path.join(root, 'unexpected')
    expect(hasExternalDesktopStorageControls(env, root)).toBe(true)
    expect(() => clearDesktopStorageInjections(root, env)).toThrow('launch environment')
  })

  it.each(['roots', 'runtimeConfig', 'webView', 'diskCache', 'mediaCache'])('retains genuine aligned %s controls rather than authorizing them as injections', control => {
    const env: NodeJS.ProcessEnv = injected()
    recordDesktopStorageLaunch(binding, { roots: control === 'roots' ? [root] : [], ...(control === 'roots' ? {} : { [control]: root }) }, env)
    expect(hasExternalDesktopStorageControls(env, root)).toBe(true)
    expect(() => clearDesktopStorageInjections(root, env)).toThrow('launch environment')
    expect(env).toEqual(injected())
  })

  it('scrubs only captured injections for relaunch and restores exact values on synchronous failure', () => {
    const env: NodeJS.ProcessEnv = { ...injected(), OTHER: 'keep', ECHOFLOW_APP_PORTABLE_DIR: 'untrusted flag' }
    recordDesktopStorageLaunch(binding, { roots: [] }, env)
    const restore = clearDesktopStorageInjections(root, env)
    expect(env).toEqual({ OTHER: 'keep', ECHOFLOW_APP_PORTABLE_DIR: 'untrusted flag' })
    restore()
    expect(env).toEqual({ ...injected(), OTHER: 'keep', ECHOFLOW_APP_PORTABLE_DIR: 'untrusted flag' })
    const sparse: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: root }
    recordDesktopStorageLaunch(binding, { roots: [] }, sparse)
    clearDesktopStorageInjections(root, sparse)()
    expect(sparse).toEqual({ CLAUDE_CONFIG_DIR: root })
    expect(() => clearDesktopStorageInjections(root, { ...injected(), ECHOFLOW_APP_PORTABLE_DIR: '1' })).toThrow('launch environment')
  })
})
