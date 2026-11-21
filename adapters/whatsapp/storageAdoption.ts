import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys'
import { jidNormalizedUser } from '@whiskeysockets/baileys/lib/WABinary/jid-utils.js'

const credsFile = 'creds.json'
const backupFile = `${credsFile}.bak`
// Baileys 7.0.0-rc.9 SignalDataTypeMap. Match sender-key-memory before sender-key.
const keyCategories: readonly (keyof SignalDataTypeMap)[] = [
  'pre-key', 'session', 'sender-key-memory', 'sender-key', 'app-state-sync-key',
  'app-state-sync-version', 'lid-mapping', 'device-list', 'tctoken',
]

function parseKeyFile(name: string) {
  if (name.length > 255 || !name.endsWith('.json')) return
  const category = keyCategories.find(category => name.startsWith(`${category}-`))
  if (!category) return
  const id = name.slice(category.length + 1, -'.json'.length)
  if (id && id !== '__proto__' && !/[^A-Za-z0-9_.@+=-]/.test(id)) return { category, id }
}

export function isWhatsAppAuthFile(name: string): boolean {
  return name === credsFile || name === backupFile || parseKeyFile(name) !== undefined
}

function normalizeAccountJid(jid: unknown) {
  if (typeof jid !== 'string' || !/^[A-Za-z0-9]+(?:_\d+)?(?::\d+)?@(?:s\.whatsapp\.net|c\.us|lid|hosted(?:\.lid)?)$/.test(jid)) return
  return jidNormalizedUser(jid)
}

// The caller supplies a stopped, bounded snapshot and verifies its ancestors and byte identities.
export async function validateWhatsAppAuthDirectory(directory: string, expectedAccountJid: string, { readOnly = false } = {}): Promise<void> {
  if (!await validateSnapshot(directory, expectedAccountJid, readOnly).catch(() => false)) {
    throw new Error('WhatsApp authentication directory could not be validated')
  }
}

function hasKeyPair(pair: AuthenticationCreds['noiseKey'] | undefined): boolean {
  return pair?.public instanceof Uint8Array && pair.public.length === 32 &&
    pair.private instanceof Uint8Array && pair.private.length === 32
}

function hasSyncKeyBytes(value: unknown): boolean {
  if (value instanceof Uint8Array) return value.length > 0
  return Array.isArray(value) && value.length > 0 &&
    value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
}

async function validateSnapshot(path: string, expectedAccountJid: string, readOnly: boolean): Promise<boolean> {
  const directory = resolve(path)
  const expected = normalizeAccountJid(expectedAccountJid)
  if (!expected || !(await lstat(directory)).isDirectory()) return false

  const files = new Set(await readdir(directory))
  if (!files.has(credsFile)) return false
  for (const name of files) {
    if (!isWhatsAppAuthFile(name)) return false
    const stat = await lstat(join(directory, name))
    if (!stat.isFile() || stat.nlink !== 1) return false
  }

  const { BufferJSON } = await import('@whiskeysockets/baileys/lib/Utils/generics.js')
  const readJson = async (name: string) => JSON.parse(await readFile(join(directory, name), 'utf8'), BufferJSON.reviver)
  // Baileys can create a missing auth directory. Only use its disk reader on copies.
  const diskReader = readOnly ? undefined : await import('@whiskeysockets/baileys/lib/Utils/use-multi-file-auth-state.js')
  const state = (await diskReader?.useMultiFileAuthState(directory))?.state
  const keyFileName = (category: keyof SignalDataTypeMap, id: string) => `${category}-${id.replaceAll('/', '__').replaceAll(':', '-')}.json`
  const getKey = async (category: keyof SignalDataTypeMap, id: string) => {
    if (state) return (await state.keys.get(category, [id]))[id]
    const value = await readJson(keyFileName(category, id))
    if (category !== 'app-state-sync-key' || !value) return value
    const { proto } = await import('@whiskeysockets/baileys/WAProto/index.js')
    return proto.Message.AppStateSyncKeyData.fromObject(value)
  }
  const matchesAccount = (creds: AuthenticationCreds) => {
    // Baileys also returns fresh credentials on read failure, but these lack me.id.
    if (normalizeAccountJid(creds?.me?.id) !== expected || !hasKeyPair(creds.noiseKey) ||
      !hasKeyPair(creds.signedIdentityKey) || !hasKeyPair(creds.signedPreKey?.keyPair) ||
      !(creds.signedPreKey.signature instanceof Uint8Array) || creds.signedPreKey.signature.length !== 64 ||
      !Number.isSafeInteger(creds.signedPreKey.keyId) || !Number.isSafeInteger(creds.registrationId) ||
      typeof creds.advSecretKey !== 'string' || Buffer.from(creds.advSecretKey, 'base64').length !== 32) return false
    const id = creds.myAppStateKeyId
    return id === undefined || (typeof id === 'string' && id.length > 0 && files.has(keyFileName('app-state-sync-key', id)))
  }

  if (!matchesAccount(state ? state.creds : await readJson(credsFile))) return false
  if (files.has(backupFile) && !matchesAccount(await readJson(backupFile))) return false

  for (const name of files) {
    const key = parseKeyFile(name)
    if (!key) continue
    const value = await getKey(key.category, key.id)
    if (value == null) return false
    if (key.category === 'app-state-sync-key' && !hasSyncKeyBytes(value.keyData)) return false
  }
  return true
}
