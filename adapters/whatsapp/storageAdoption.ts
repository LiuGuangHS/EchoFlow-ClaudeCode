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
export async function validateWhatsAppAuthDirectory(directory: string, expectedAccountJid: string): Promise<void> {
  if (!await validateSnapshot(directory, expectedAccountJid).catch(() => false)) {
    throw new Error('WhatsApp authentication directory could not be validated')
  }
}

function hasKeyPair(pair: AuthenticationCreds['noiseKey'] | undefined): boolean {
  return pair?.public instanceof Uint8Array && pair.public.length === 32 &&
    pair.private instanceof Uint8Array && pair.private.length === 32
}

async function validateSnapshot(path: string, expectedAccountJid: string): Promise<boolean> {
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

  // Use the disk reader without loading the socket and optional media dependencies.
  const { useMultiFileAuthState } = await import('@whiskeysockets/baileys/lib/Utils/use-multi-file-auth-state.js')
  const { state } = await useMultiFileAuthState(directory)
  const matchesAccount = async (creds: AuthenticationCreds) => {
    // Baileys also returns fresh credentials on read failure, but these lack me.id.
    if (normalizeAccountJid(creds?.me?.id) !== expected || !hasKeyPair(creds.noiseKey) ||
      !hasKeyPair(creds.signedIdentityKey) || !hasKeyPair(creds.signedPreKey?.keyPair) ||
      !(creds.signedPreKey.signature instanceof Uint8Array) || creds.signedPreKey.signature.length !== 64 ||
      !Number.isSafeInteger(creds.signedPreKey.keyId) || !Number.isSafeInteger(creds.registrationId) ||
      typeof creds.advSecretKey !== 'string' || Buffer.from(creds.advSecretKey, 'base64').length !== 32) return false
    const id = creds.myAppStateKeyId
    if (id === undefined) return true
    if (typeof id !== 'string' || !id) return false
    const name = `app-state-sync-key-${id.replaceAll('/', '__').replaceAll(':', '-')}.json`
    return files.has(name) && Boolean((await state.keys.get('app-state-sync-key', [id]))[id])
  }

  if (!await matchesAccount(state.creds)) return false
  if (files.has(backupFile)) {
    const { BufferJSON } = await import('@whiskeysockets/baileys/lib/Utils/generics.js')
    const backup = JSON.parse(await readFile(join(directory, backupFile), 'utf8'), BufferJSON.reviver)
    if (!await matchesAccount(backup)) return false
  }

  for (const name of files) {
    const key = parseKeyFile(name)
    if (key && (await state.keys.get(key.category, [key.id]))[key.id] == null) return false
  }
  return true
}
