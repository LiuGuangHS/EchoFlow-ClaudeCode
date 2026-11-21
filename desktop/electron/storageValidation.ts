import { app, BrowserWindow, session } from 'electron'
import fs from 'node:fs/promises'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import { ECHOFLOW_LOGIN_PROFILES } from './services/echoFlowLogin'
import type { NativeStorageSnapshot, StorageValidationRequest } from './services/desktopStorageValidation'

// Packaged Electron always loads package.main, regardless of the script argv.
// Dispatch before ordinary bootstrap; restricted mode never imports business code.
const argument = process.argv.find(value => value.startsWith('--echoflow-storage-validation-request='))
if (!process.argv.some(value => value.startsWith('--echoflow-storage-validation'))) {
  createRequire(__filename)('./main.cjs')
} else {
  let window: BrowserWindow | undefined
  const timeout = setTimeout(() => app.exit(1), 55_000)

  void (async () => {
    if (!argument) throw new Error('Restricted validation request is required')
    const file = argument.slice('--echoflow-storage-validation-request='.length)
    if (!path.isAbsolute(file)) throw new Error('Invalid validation request path')
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid validation request file')
    const request = JSON.parse(readFileSync(file, 'utf8')) as StorageValidationRequest
    if (request.version !== 1 || request.directory !== path.dirname(file) || request.profile !== path.join(request.directory, 'profile') ||
      !/^native-validation-/.test(path.basename(path.dirname(request.directory))) || !/^[a-f0-9-]{36}$/.test(path.basename(path.dirname(path.dirname(request.directory)))) ||
      path.basename(path.dirname(path.dirname(path.dirname(request.directory)))) !== 'migrations') throw new Error('Profile must be inside a private migration transaction')
    for (let directory = request.profile; ; directory = path.dirname(directory)) {
      const item = lstatSync(directory)
      if (!item.isDirectory() || item.isSymbolicLink()) throw new Error('Linked validation directory')
      if (path.dirname(directory) === directory) break
    }
    const url = new URL(request.url)
    const endpoint = request.login?.endpoint
    const login = endpoint && Object.hasOwn(ECHOFLOW_LOGIN_PROFILES, endpoint) ? ECHOFLOW_LOGIN_PROFILES[endpoint] : undefined
    if (request.login !== undefined && (!login || url.href !== login.url ||
      typeof request.login.proofKey !== 'string' || !/^[a-f0-9]{64}$/.test(request.login.proofKey))) throw new Error('Invalid login storage request')
    if (!login && url.protocol !== 'file:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Invalid renderer origin')
    app.setPath('userData', request.profile)
    app.setPath('sessionData', request.profile)
    app.setPath('crashDumps', path.join(request.directory, 'crashes'))
    app.setAppLogsPath(path.join(request.directory, 'logs'))
    app.commandLine.appendSwitch('disable-background-networking')
    app.commandLine.appendSwitch('disable-component-update')
    app.commandLine.appendSwitch('disable-sync')
    app.commandLine.appendSwitch('disable-features', 'ServiceWorker,SharedWorker')
    await app.whenReady()
    const storage = login ? session.fromPartition(login.partition) : session.defaultSession
    storage.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    storage.setPermissionCheckHandler(() => false)
    storage.on('will-download', event => event.preventDefault())
    // Serve only a constant blank document at the REAL origin. Never fetch a dev
    // server or execute the app's renderer, even when the URL is a packaged file.
    storage.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== request.url }))
    await storage.protocol.handle(url.protocol.slice(0, -1), incoming => incoming.url === request.url
      ? new Response('<!doctype html><meta charset="utf-8"><title>Storage validation</title>', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; connect-src 'none'; worker-src 'none'; script-src 'none'" } })
      : new Response(null, { status: 403 }))
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, partition: login?.partition } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, target) => { if (target !== request.url) event.preventDefault() })
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.on('render-process-gone', () => app.exit(1))
    await window.loadURL(request.url)
    const snapshot = await window.webContents.executeJavaScript(`(${readNativeStorage.toString()})()`) as NativeStorageSnapshot
    if (window.webContents.getURL() !== request.url) throw new Error('Unexpected validation origin')
    let result = snapshot
    if (login && request.login) {
      const proofKey = Buffer.from(request.login.proofKey, 'hex')
      const saved = Object.entries(snapshot.localStorage).sort(([a], [b]) => a.localeCompare(b))
      const cookies = (await storage.cookies.get({ url: login.origin })).filter(cookie => !cookie.session).map(cookie => JSON.stringify([
        cookie.domain, cookie.path, cookie.name, cookie.value, cookie.secure, cookie.httpOnly, cookie.sameSite, cookie.expirationDate,
      ])).sort()
      const digest = (value: unknown) => createHmac('sha256', proofKey).update(JSON.stringify(value)).digest('hex')
      result = { localStorage: {}, indexedDB: [], login: {
        storageDigest: digest([saved, snapshot.indexedDB]), localCount: saved.length, indexedCount: snapshot.indexedDB.length,
        cookieDigest: digest(cookies), cookieCount: cookies.length,
      } }
    }
    await fs.writeFile(path.join(request.directory, 'result.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 })
    storage.flushStorageData()
    clearTimeout(timeout)
    window.destroy()
    window = undefined
    app.quit()
  })().catch(() => {
    clearTimeout(timeout)
    window?.destroy()
    // Do not expose saved values or credentials in diagnostics.
    app.exit(1)
  })
}

async function readNativeStorage(): Promise<NativeStorageSnapshot> {
  async function encode(value: unknown, seen = new Set<object>()): Promise<unknown> {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value
    if (typeof value === 'undefined') return { type: 'undefined' }
    if (typeof value === 'number') return { type: 'number', value: String(value) }
    if (typeof value === 'bigint') return { type: 'bigint', value: String(value) }
    if (typeof value !== 'object' || seen.has(value!)) throw new Error('Unsupported persistent structured clone')
    seen.add(value!)
    try {
      if (value instanceof Date) return { type: 'Date', value: value.toISOString() }
      if (value instanceof Blob) return { type: 'Blob', mime: value.type, bytes: Array.from(new Uint8Array(await value.arrayBuffer())) }
      if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', bytes: Array.from(new Uint8Array(value)) }
      if (ArrayBuffer.isView(value)) return { type: value.constructor.name, bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) }
      if (Array.isArray(value)) return await Promise.all(value.map(item => encode(item, new Set(seen))))
      if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsupported persistent structured clone')
      return { type: 'Object', entries: await Promise.all(Object.keys(value!).sort().map(async key => [key, await encode((value as Record<string, unknown>)[key], new Set(seen))])) }
    } finally { seen.delete(value!) }
  }
  const local: Record<string, string> = Object.create(null)
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key === null) throw new Error('Local storage changed during validation')
    const value = localStorage.getItem(key)
    if (value === null) throw new Error('Local storage changed during validation')
    local[key] = value
  }
  const databases: NativeStorageSnapshot['indexedDB'] = []
  for (const info of (await indexedDB.databases()).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
    if (!info.name || !info.version) throw new Error('Invalid IndexedDB metadata')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(info.name!, info.version)
      request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Saved IndexedDB unexpectedly needs creation')) }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Saved IndexedDB is blocked'))
    })
    try {
      const stores: NativeStorageSnapshot['indexedDB'][number]['stores'] = []
      for (const name of Array.from(db.objectStoreNames).sort()) {
        const transaction = db.transaction(name, 'readonly')
        const completed = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB validation aborted'))
        })
        // Cursor success alone is not proof that the transaction committed.
        void completed.catch(() => {})
        const store = transaction.objectStore(name)
        const indexes = Array.from(store.indexNames).sort().map(indexName => {
          const index = store.index(indexName)
          return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }
        })
        const raw: { key: unknown; value: unknown }[] = []
        await new Promise<void>((resolve, reject) => {
          const cursor = store.openCursor()
          cursor.onerror = () => reject(cursor.error)
          cursor.onsuccess = () => {
            if (!cursor.result) { resolve(); return }
            raw.push({ key: cursor.result.key, value: cursor.result.value })
            cursor.result.continue()
          }
        })
        await completed
        const records = await Promise.all(raw.map(async record => ({ key: await encode(record.key), value: await encode(record.value) })))
        stores.push({ name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, records })
      }
      databases.push({ name: db.name, version: db.version, stores })
    } finally { db.close() }
  }
  return { localStorage: local, indexedDB: databases }
}
