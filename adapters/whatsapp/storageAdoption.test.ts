import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useMultiFileAuthState } from '@whiskeysockets/baileys/lib/Utils/use-multi-file-auth-state.js'
import { isWhatsAppAuthFile, validateWhatsAppAuthDirectory } from './storageAdoption.js'

const accountJid = '15550100001@s.whatsapp.net'
const deviceJid = '15550100001:7@c.us'
const otherAccount = '15550100002@s.whatsapp.net'
const appKeyId = '/+8='
const appKeyFile = 'app-state-sync-key-__+8=.json'
const invalidAuth = 'WhatsApp authentication directory could not be validated'

let root: string
let directory: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'whatsapp-adoption-'))
  directory = join(root, 'auth')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeLinkedCredentials(id = deviceJid, keyId?: string) {
  const auth = await useMultiFileAuthState(directory)
  auth.state.creds.me = { id }
  auth.state.creds.myAppStateKeyId = keyId
  await auth.saveCreds()
  return auth
}

describe('isWhatsAppAuthFile', () => {
  test('recognizes flat files from the locked reader', () => {
    for (const name of [
      'creds.json', 'creds.json.bak', 'pre-key-17.json', 'session-15550100001.7.json',
      'sender-key-123@g.us--15550100001--7.json', 'sender-key-memory-123@g.us.json',
      appKeyFile, 'app-state-sync-version-critical_block.json', 'lid-mapping-123_reverse.json',
      'device-list-15550100001.json', 'tctoken-15550100001@s.whatsapp.net.json',
    ]) expect(isWhatsAppAuthFile(name)).toBe(true)
  })

  test('rejects unknown files and unsafe key names', () => {
    for (const name of [
      'creds.json.tmp', 'CREDS.JSON', 'unknown-17.json', 'identity-key-17.json', 'pre-key-.json',
      '../creds.json', '/creds.json', 'session-../other.json', 'session-..\\other.json',
      'session-123:7.json', 'session-123\0.json', 'session-123\n.json', 'session-__proto__.json',
      `pre-key-${'a'.repeat(250)}.json`,
    ]) expect(isWhatsAppAuthFile(name)).toBe(false)
  })
})

describe('validateWhatsAppAuthDirectory', () => {
  test('reads Baileys-written credentials, backup and keys without changing bytes', async () => {
    const auth = await writeLinkedCredentials(deviceJid, appKeyId)
    await copyFile(join(directory, 'creds.json'), join(directory, 'creds.json.bak'))
    Object.assign(auth.state.creds, { futureField: 'preserve me' })
    await auth.saveCreds()
    const bytes = Buffer.alloc(32, 42)
    await auth.state.keys.set({
      'app-state-sync-key': { [appKeyId]: { keyData: bytes } },
      'pre-key': { '17': { public: bytes, private: bytes } },
      session: { '15550100001.7': bytes },
      'sender-key': { '123@g.us::15550100001::7': bytes },
      'sender-key-memory': { '123@g.us': { [deviceJid]: true } },
      'app-state-sync-version': { critical_block: { version: 0, hash: bytes, indexValueMap: {} } },
      'lid-mapping': { '123_reverse': '15550100001' },
      'device-list': { '15550100001': ['7'] },
      tctoken: { [accountJid]: { token: bytes } },
    })
    const snapshot = async () => Promise.all((await readdir(directory)).sort().map(async name => [
      name, await readFile(join(directory, name)),
    ]))
    const before = await snapshot()
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).resolves.toBeUndefined()
    expect(await snapshot()).toEqual(before)
  })

  test('accepts a linked account with neither an optional backup nor an app-state reference', async () => {
    await writeLinkedCredentials()
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).resolves.toBeUndefined()
  })

  test('rejects missing or fallback credentials without creating or restoring files', async () => {
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    expect(await readdir(root)).toEqual([])
    await writeLinkedCredentials()
    await copyFile(join(directory, 'creds.json'), join(directory, 'creds.json.bak'))
    await rm(join(directory, 'creds.json'))
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    expect(await readdir(directory)).toEqual(['creds.json.bak'])
    await writeFile(join(directory, 'creds.json'), '{fake secret')
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    expect(await readFile(join(directory, 'creds.json'), 'utf8')).toBe('{fake secret')
  })

  test('rejects unlinked credentials, a mismatched account and malformed account JIDs', async () => {
    const auth = await useMultiFileAuthState(directory)
    await auth.saveCreds()
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    await writeLinkedCredentials(otherAccount)
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    await writeLinkedCredentials('15550100001:invalid@s.whatsapp.net')
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    await writeLinkedCredentials('15550100001@g.us')
    await expect(validateWhatsAppAuthDirectory(directory, '15550100001@g.us')).rejects.toThrow(invalidAuth)
  })

  test('rejects linked-looking credentials that lack the keys needed by the adapter', async () => {
    await mkdir(directory)
    await writeFile(join(directory, 'creds.json'), JSON.stringify({ me: { id: accountJid } }))
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
  })

  test('requires a present backup to parse and match the linked account', async () => {
    await writeLinkedCredentials(otherAccount)
    await copyFile(join(directory, 'creds.json'), join(directory, 'creds.json.bak'))
    await writeLinkedCredentials()
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    await writeFile(join(directory, 'creds.json.bak'), `{fake secret ${accountJid}`)
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toEqual(new Error(invalidAuth))
  })

  test('rejects a missing directly referenced key in either credential file', async () => {
    await writeLinkedCredentials(deviceJid, appKeyId)
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    await copyFile(join(directory, 'creds.json'), join(directory, 'creds.json.bak'))
    await writeLinkedCredentials()
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
  })

  test('accepts a linked account whose sync key uses a JSON byte array', async () => {
    await writeLinkedCredentials(deviceJid, appKeyId)
    await writeFile(join(directory, appKeyFile), JSON.stringify({ keyData: Array(32).fill(42) }))
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).resolves.toBeUndefined()
    await expect(validateWhatsAppAuthDirectory(directory, accountJid, { readOnly: true })).resolves.toBeUndefined()
  })

  test.each(['{}', '{"keyData":[]}', '{"keyData":[-1,256]}'])('rejects unusable unreferenced sync key %s', async contents => {
    await writeLinkedCredentials()
    await writeFile(join(directory, appKeyFile), contents)
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
  })

  test('rejects any companion the reader cannot parse, including unreferenced keys', async () => {
    await writeLinkedCredentials()
    for (const contents of ['{fake secret', 'null']) {
      await writeFile(join(directory, 'session-15550100001.7.json'), contents)
      await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    }
    await rm(join(directory, 'session-15550100001.7.json'))
    await writeFile(join(directory, appKeyFile), '{"fingerprint":"fake secret"}')
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toEqual(new Error(invalidAuth))
  })

  test('rejects unknown files, non-regular entries, and hard links', async () => {
    await writeLinkedCredentials()
    const unknown = join(directory, 'unrelated.json')
    await writeFile(unknown, '{}')
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    await rm(unknown)
    const known = join(directory, 'pre-key-17.json')
    await mkdir(known)
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
    await rm(known, { recursive: true })
    const outside = join(root, 'external.json')
    await writeFile(outside, '{}')
    await link(outside, known)
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
  })

  test.skipIf(process.platform === 'win32')('rejects symbolic links at the directory or file boundary', async () => {
    await writeLinkedCredentials()
    const alias = join(root, 'alias')
    await symlink(directory, alias, 'dir')
    await expect(validateWhatsAppAuthDirectory(alias, accountJid)).rejects.toThrow(invalidAuth)
    const outside = join(root, 'external.json')
    await writeFile(outside, '{}')
    await symlink(outside, join(directory, 'pre-key-17.json'))
    await expect(validateWhatsAppAuthDirectory(directory, accountJid)).rejects.toThrow(invalidAuth)
  })
})
