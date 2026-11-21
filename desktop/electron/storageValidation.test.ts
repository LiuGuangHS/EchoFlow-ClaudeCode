// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../../src/utils/echoFlowConfigRoot'
import { completeStorageMigration, executeStorageMigration } from '../../src/services/storageMigration'
import { CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION, DESKTOP_PERSISTENCE_VERSION_KEY } from '../src/lib/persistenceMigrations'
import { createDesktopStorageHooks, validateRestrictedDesktopStorage } from './services/desktopStorageValidation'
import { DEDICATED_LOGIN_PROFILE, MAIN_LOGIN_PROFILE } from './services/echoFlowLogin'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
async function fixture(): Promise<string> {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-native-validation-')))
  directories.push(directory)
  return directory
}
async function tree(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const name of await fs.readdir(directory, { recursive: true })) {
    const file = path.join(directory, name)
    if ((await fs.lstat(file)).isFile()) files[name] = createHash('sha256').update(await fs.readFile(file)).digest('hex')
  }
  return files
}

// Opt-in native evidence: installed Electron + GUI, all state under a disposable HOME.
const native = process.env.ECHOFLOW_RUN_NATIVE_STORAGE_VALIDATION === '1' ? it : it.skip
native.each(['valid', 'package-entry', 'file-origin', 'future-schema', 'corrupt-leveldb', 'missing-idb', 'corrupt-session-log', 'saved-session-data', 'unvalidated-partition', 'login-partitions', 'missing-login-cookie', 'missing-login-token', 'unknown-login-file', 'login-legacy-layout', 'login-transport-policy', 'logged-out-login', 'logged-out-missing-current'])('restricted native profile validation: %s', async variant => {
  const loggedOut = variant === 'logged-out-login' || variant === 'logged-out-missing-current'
  const login = loggedOut || ['login-partitions', 'missing-login-cookie', 'missing-login-token', 'unknown-login-file', 'login-legacy-layout', 'login-transport-policy'].includes(variant)
  const fakeCookie = 'native-fixture-session-not-a-credential'
  const fakeToken = 'native-fixture-token-not-a-credential'
  const directory = await fixture()
  const source = path.join(directory, 'source')
  const root = path.join(directory, 'target')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
  const seed = path.join(directory, 'seed.cjs')
  const childEntry = path.join(directory, 'electron-dist', 'storage-validation.cjs')
  await fs.mkdir(path.dirname(childEntry))
  execFileSync('bun', ['build', path.join(import.meta.dirname, 'storageValidation.ts'), '--target=node', '--format=cjs', '--external=electron', '--outfile', childEntry], { stdio: 'pipe' })
  await fs.writeFile(path.join(path.dirname(childEntry), 'package.json'), JSON.stringify({ main: 'storage-validation.cjs' }))
  const ordinaryMarker = path.join(directory, 'ordinary-started')
  await fs.writeFile(path.join(path.dirname(childEntry), 'main.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(ordinaryMarker)}, 'ordinary writer started'); require('electron').app.exit(0)`)
  const electron = path.join(import.meta.dirname, '..', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
  let requests = 0
  const server = createServer((_request, response) => { requests++; response.writeHead(500); response.end('ordinary renderer must never load') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const url = variant === 'file-origin' ? pathToFileURL(path.join(directory, 'dist', 'index.html')).toString() : `http://127.0.0.1:${address.port}/`
  await fs.writeFile(seed, `
const {app,BrowserWindow,session}=require('electron')
app.setPath('userData',${JSON.stringify(source)})
app.setPath('sessionData',${JSON.stringify(source)})
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND')
// The seed destroys each window in turn and quits only after both partitions flush.
app.on('window-all-closed', () => {})
app.whenReady().then(async()=>{
 await session.defaultSession.protocol.handle(${JSON.stringify(new URL(url).protocol.slice(0, -1))},()=>new Response('<!doctype html>'))
 const w=new BrowserWindow({show:false,webPreferences:{sandbox:true}})
 await w.loadURL(${JSON.stringify(url)})
 await w.webContents.executeJavaScript(\`(async()=>{
  localStorage.setItem('saved-value','retained')
  localStorage.setItem('unknown-json',JSON.stringify({unknown:{nested:[1,2,3]}}))
  localStorage.setItem(${JSON.stringify(DESKTOP_PERSISTENCE_VERSION_KEY)},${JSON.stringify(String(variant === 'future-schema' ? 999 : CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION))})
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('saved-records',3);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
  await new Promise((resolve,reject)=>{const t=db.transaction('records','readwrite');t.objectStore('records').put({id:7,value:'retained',unknown:{keep:true}});t.oncomplete=resolve;t.onerror=()=>reject(t.error)})
  db.close()
 })()\`)
 session.defaultSession.flushStorageData()
 w.destroy()
 ${login ? `
 for (const profile of ${JSON.stringify([MAIN_LOGIN_PROFILE, DEDICATED_LOGIN_PROFILE].map(({ endpoint, origin, partition, url }) => ({ endpoint, origin, partition, url })))}) {
  const storage = session.fromPartition(profile.partition)
  storage.webRequest.onBeforeRequest((details, callback) => callback({cancel:details.url !== profile.url}))
  await storage.protocol.handle('https', () => new Response('<!doctype html>', {headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'"}}))
  const window = new BrowserWindow({show:false,webPreferences:{sandbox:true,partition:profile.partition}})
  await window.loadURL(profile.url)
  if (profile.endpoint === 'main') {
   await storage.cookies.set({url:profile.origin,name:'session',value:${JSON.stringify(fakeCookie)},secure:true,httpOnly:true,expirationDate:Date.UTC(2037,0,1)/1000})
   await storage.cookies.flushStore()
   await window.webContents.executeJavaScript(${JSON.stringify(`localStorage.setItem('user', '{"id":7,"username":"fixture"}')`)})
  } else {
   await window.webContents.executeJavaScript(${JSON.stringify(`
    localStorage.setItem('auth_token', ${JSON.stringify(fakeToken)})
    localStorage.setItem('auth_user', '{"id":7,"username":"fixture"}')
    localStorage.setItem('token_expires_at', '2114380800')
   `)})
   ${loggedOut ? `
   storage.flushStorageData()
   await storage.clearStorageData({ storages: ['localstorage'] })
   const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve))
   window.reload()
   await reloaded
   if (await window.webContents.executeJavaScript('localStorage.length') !== 0) throw new Error('Fixture logout did not clear Local Storage')
   ` : ''}
  }
  storage.flushStorageData()
  window.destroy()
 }` : ''}
 app.quit()
}).catch(()=>app.exit(1))
`)
  const isolatedHome = path.join(directory, 'seed-home')
  await fs.mkdir(isolatedHome)
  const env: NodeJS.ProcessEnv = { HOME: isolatedHome, USERPROFILE: isolatedHome, XDG_CONFIG_HOME: isolatedHome, XDG_CACHE_HOME: isolatedHome, XDG_DATA_HOME: isolatedHome, APPDATA: isolatedHome, LOCALAPPDATA: isolatedHome, TMPDIR: directory }
  for (const name of ['PATH', 'SystemRoot', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) if (process.env[name]) env[name] = process.env[name]
  const previous = process.env.ELECTRON_RENDERER_URL
  let seedStopped = false
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(electron, [seed, '--disable-gpu', '--disable-dev-shm-usage'], { cwd: directory, env, stdio: ['ignore', 'ignore', 'pipe'] })
      let diagnostic = ''
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-8192) })
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Native fixture seed timed out: ${diagnostic}`)) }, 30_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', (code, signal) => { clearTimeout(timer); seedStopped = true; code === 0 ? resolve() : reject(new Error(`Native fixture seed exited ${code ?? signal}: ${diagnostic}`)) })
    })
    if (variant === 'file-origin') delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = url
    const binding = resolveStorageBinding({ env: {}, roots: [root] })
    // Fixture-only exclusion: WSL /proc can contain unreadable foreign processes.
    // Production always uses the full OS inventory and remains blocked in that case.
    const hooks = { ...createDesktopStorageHooks(binding), async assertQuiescent(roots: readonly string[]) {
      if (!seedStopped || roots.some(root => {
        const relative = path.relative(directory, root)
        return !relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      })) throw new Error('Native fixture exclusion does not cover these roots')
    } }
    const result = await executeStorageMigration({ binding, sources: [{ directory: source, markerRoot: source }], hooks })
    expect(result.issues).toEqual([])
    expect(result.state).toBe('validation-required')
    if (variant === 'saved-session-data') {
      // Fixed CRC32C-valid LevelDB WriteBatch containing map-0-key = retained.
      await fs.writeFile(path.join(root, 'Session Storage', '999999.log'), Buffer.from('12c3b1af28000101000000000000000100000001096d61702d302d6b657910720065007400610069006e0065006400', 'hex'))
    }
    if (variant === 'unvalidated-partition') {
      await fs.mkdir(path.join(root, 'Partitions', 'saved'), { recursive: true })
      await fs.writeFile(path.join(root, 'Partitions', 'saved', 'Cookies'), 'saved encrypted partition fixture')
    }
    if (login) {
      const cookiePartition = path.join(root, 'Partitions', MAIN_LOGIN_PROFILE.partition.slice('persist:'.length))
      const tokenStorage = path.join(root, 'Partitions', DEDICATED_LOGIN_PROFILE.partition.slice('persist:'.length), 'Local Storage')
      const cookieStores = (await fs.readdir(cookiePartition, { recursive: true })).filter(name => /^Cookies(?:-wal|-shm|-journal)?$/.test(path.basename(name)))
      expect(cookieStores.some(name => path.basename(name) === 'Cookies')).toBe(true)
      expect((await fs.stat(path.join(tokenStorage, 'leveldb', 'CURRENT'))).isFile()).toBe(true)
      if (variant === 'logged-out-missing-current') await fs.rm(path.join(tokenStorage, 'leveldb', 'CURRENT'))
      if (variant === 'login-legacy-layout') {
        const otherLayout = cookieStores.includes('Cookies') ? path.join(cookiePartition, 'Network') : cookiePartition
        await fs.mkdir(otherLayout, { recursive: true })
        await fs.writeFile(path.join(otherLayout, 'Cookies'), '')
      }
      if (variant === 'login-transport-policy') {
        await fs.writeFile(path.join(cookiePartition, 'TransportSecurity'), '{"version":2,"sts":[]}')
        await fs.mkdir(path.join(cookiePartition, 'Network'), { recursive: true })
        await fs.writeFile(path.join(cookiePartition, 'Network', 'TransportSecurity'), '{"version":2,"sts":[]}')
      }
      if (variant === 'unknown-login-file') await fs.writeFile(path.join(cookiePartition, 'unsupported-store'), 'fixture-only')
      if (variant === 'missing-login-cookie') for (const name of cookieStores) await fs.rm(path.join(cookiePartition, name))
      if (variant === 'missing-login-token') await fs.rm(tokenStorage, { recursive: true })
    }
    if (variant === 'corrupt-leveldb') await fs.writeFile(path.join(root, 'Local Storage', 'leveldb', 'CURRENT'), 'MANIFEST-missing\n')
    if (variant === 'missing-idb') await fs.rm(path.join(root, 'IndexedDB'), { recursive: true })
    if (variant === 'corrupt-session-log') {
      const name = (await fs.readdir(path.join(root, 'Session Storage'))).find(name => name.endsWith('.log'))!
      const file = path.join(root, 'Session Storage', name)
      const bytes = await fs.readFile(file)
      bytes[0] = bytes[0]! ^ 1
      await fs.writeFile(file, bytes)
    }
    const original = await tree(source)
    const published = await tree(root)
    const selectedEntry = variant === 'package-entry' ? path.dirname(childEntry) : childEntry
    const validation = variant === 'valid' ? (async () => {
      const driver = path.join(directory, 'validator-driver.ts')
      const bundled = path.join(path.dirname(childEntry), 'validator-driver.cjs')
      const validator = path.join(import.meta.dirname, 'services', 'desktopStorageValidation.ts')
      await fs.writeFile(driver, `import { validateRestrictedDesktopStorage } from ${JSON.stringify(validator)}
validateRestrictedDesktopStorage(JSON.parse(process.argv[2]), { executable: process.argv[3] }).catch(error => { console.error(error); process.exitCode = 1 })`)
      execFileSync('bun', ['build', driver, '--target=node', '--format=cjs', '--outfile', bundled], { stdio: 'pipe' })
      await promisify(execFile)(process.execPath, [bundled, JSON.stringify(binding), electron], {
        cwd: directory, env: { ...env, ELECTRON_RENDERER_URL: url }, timeout: 120_000,
      })
    })() : validateRestrictedDesktopStorage(binding, { executable: electron, childEntry: selectedEntry })
    const valid = ['valid', 'package-entry', 'file-origin', 'login-partitions', 'login-legacy-layout', 'login-transport-policy', 'logged-out-login'].includes(variant)
    if (valid) await validation
    else if (variant === 'logged-out-missing-current') await expect(validation).rejects.toThrow(/manifest/i)
    else if (login) {
      const error = await validation.then(() => null, (error: unknown) => error)
      expect(error).toBeInstanceOf(Error)
      const message = String(error)
      expect(message).toMatch(variant === 'unknown-login-file' ? /login partition persistence owner/ : variant === 'missing-login-cookie' ? /cookie/i : /localStorage|token/i)
      expect(message.includes(fakeCookie) || message.includes(fakeToken)).toBe(false)
    } else await expect(validation).rejects.toThrow(variant === 'future-schema' ? /schema/ : variant === 'corrupt-leveldb' ? /manifest/ : variant === 'missing-idb' ? /IndexedDB/ : variant === 'saved-session-data' ? /sessionStorage/ : variant === 'unvalidated-partition' ? /Partitions/ : /checksum/)
    expect(await tree(source)).toEqual(original)
    expect(await tree(root)).toEqual(published)
    expect(requests).toBe(0)
    expect(await fs.stat(ordinaryMarker).catch(() => null)).toBeNull()
    if (variant === 'package-entry') {
      execFileSync(electron, [path.dirname(childEntry), '--disable-gpu', '--disable-dev-shm-usage'], { cwd: directory, env, timeout: 30_000, stdio: 'pipe' })
      expect(await fs.readFile(ordinaryMarker, 'utf8')).toBe('ordinary writer started')
    }
    const transaction = path.join(binding.internalDir, 'migrations', result.id!)
    expect((await fs.readdir(transaction)).filter(name => name.startsWith('native-validation-'))).toEqual([])
    if (valid) expect((await completeStorageMigration(binding, result.id!, hooks)).state).toBe('ready')
    else expect(await fs.readFile(path.join(source, 'app.json'), 'utf8')).toBe(JSON.stringify(buildEchoFlowOwnershipMarker()))
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = previous
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}, 180_000)
