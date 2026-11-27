import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { resolveStorageBinding, type StorageBinding } from '../utils/echoFlowConfigRoot.js'
import {
  armApprovedFileSource,
  armWhatsAppStorageApproval,
  previewWhatsAppAdoption,
  readApprovedWhatsAppSources,
  WhatsAppAdoptionConfigRequiredError,
  assertImFileSelection,
  previewImAdoption,
  completeStorageMigration,
  executeStorageMigration,
  prepareStorageMigration,
  readStorageMigrationStatus,
  inspectOpenAiOauthFile,
  selectStartupStorage,
  storageLocationFile,
  type StorageMigrationHooks,
  type StorageMigrationResult,
} from './storageMigration.js'
import { createStorageMigrationHooks } from './storageMigrationValidation.js'
import { validateRestrictedHeadlessStorage } from './storageStartupValidation.js'

export type StorageAdoptionArgs = { category: 'openai-oauth'; file: string } | { category: 'im-adapters'; files: string[] } |
  { category: 'whatsapp-auth'; directory: string; config?: string }

type AdoptionInput = NodeJS.ReadableStream & { isTTY?: boolean }
type AdoptionOutput = Pick<NodeJS.WritableStream, 'write'>

const destination = 'echoflow-code'
const oauthFile = 'openai-oauth.json'

export function isStorageAdoptionInvocation(argv: readonly string[]): boolean {
  return argv[0] === 'storage' && argv[1] === 'adopt'
}

export function parseStorageAdoptionArgs(argv: readonly string[]): StorageAdoptionArgs {
  if (isStorageAdoptionInvocation(argv) && argv[2] === 'whatsapp-auth') {
    const directory = argv[4]
    const config = argv[6]
    const absolute = (value: string | undefined): value is string => !!value && !value.includes('\0') && path.isAbsolute(value) && path.resolve(value) === value
    if (!absolute(directory) || argv[3] !== '--directory' || (argv.length !== 5 &&
      (argv.length !== 7 || argv[5] !== '--config' || !absolute(config) || path.basename(config) !== 'adapters.json'))) {
      throw new Error('Usage: storage adopt whatsapp-auth --directory <absolute-path> [--config <absolute-path/adapters.json>]')
    }
    return { category: 'whatsapp-auth', directory, ...(config && { config }) }
  }
  if (isStorageAdoptionInvocation(argv) && argv[2] === 'im-adapters') {
    if ((argv.length !== 5 && argv.length !== 7) || argv[3] !== '--file' || (argv.length === 7 && argv[5] !== '--file')) {
      throw new Error('Usage: storage adopt im-adapters --file <absolute-path> [--file <absolute-path>]')
    }
    const files = argv.filter((_, index) => index === 4 || index === 6)
    assertImFileSelection(files)
    return { category: 'im-adapters', files }
  }
  if (!isStorageAdoptionInvocation(argv) || argv.length !== 5 || argv[2] !== 'openai-oauth' || argv[3] !== '--file') {
    throw new Error('Usage: storage adopt openai-oauth --file /absolute/path/openai-oauth.json')
  }
  const file = argv[4]
  if (!file || file.includes('\0') || !path.isAbsolute(file) || path.resolve(file) !== file || path.basename(file) !== oauthFile) {
    throw new Error('The OAuth source must be an absolute path ending in openai-oauth.json')
  }
  return { category: 'openai-oauth', file }
}

async function confirm(input: AdoptionInput, output: AdoptionOutput, message: string): Promise<boolean> {
  output.write(`${message}\nType y or yes to continue: `)
  const reader = createInterface({ input })
  let line: string | undefined
  for await (const value of reader) {
    line = value.trim().toLowerCase()
    break
  }
  reader.close()
  if (line !== 'y' && line !== 'yes') {
    output.write('Storage adoption cancelled; no files were changed.\n')
    return false
  }
  return true
}

async function adoptStorageFile(
  args: StorageAdoptionArgs,
  input: AdoptionInput,
  output: AdoptionOutput,
  options: { binding?: StorageBinding; hooks?: StorageMigrationHooks } = {},
): Promise<StorageMigrationResult> {
  const binding = options.binding ?? selectStartupStorage(resolveStorageBinding(), storageLocationFile())
  const existing = await readStorageMigrationStatus(binding)
  if (existing && existing.state !== 'ready') throw new Error(`Storage migration is ${existing.state}; recover it before starting adoption`)
  if (input.isTTY !== true) {
    output.write('Storage adoption requires an interactive TTY; no files were changed.\n')
    return { state: 'ready', issues: [] }
  }
  const whatsapp = args.category === 'whatsapp-auth' ? await previewWhatsAppAdoption(binding, args.directory, args.config) : undefined
  const files = args.category === 'im-adapters' ? await previewImAdoption(binding, args.files)
    : args.category === 'openai-oauth' ? [{ file: args.file, target: path.join(binding.internalDir, oauthFile), identity: await inspectOpenAiOauthFile(args.file) }]
      : whatsapp!.files.map(item => ({ file: item.source, identity: item.identity, target: path.join(binding.root,
        item.source === whatsapp!.account.config ? 'adapters.json' : path.join(whatsapp!.account.destination, item.relative)) }))
  const whatsappTarget = whatsapp && path.join(binding.root, whatsapp.account.destination)
  const description = whatsapp
    ? `${whatsapp.account.directory} → ${whatsappTarget}\n${files.length} files (${files.reduce((size, { identity }) => size + identity.size, 0)} bytes)` +
      (args.category === 'whatsapp-auth' && args.config ? `\n${args.config} → ${path.join(binding.root, 'adapters.json')}` : '')
    : files.map(({ file, target, identity }) => `${file} (${identity.size} bytes) → ${target}`).join('\n')
  const message = args.category === 'openai-oauth'
    ? `Adopt ${args.file} (${files[0]!.identity.size} bytes) into ${files[0]!.target}?\nClose apps using this file first. EchoFlow will remove the original only after verifying the copy.`
    : `Move ${whatsapp ? 'this WhatsApp account' : 'these IM files'}?\n${description}\nClose apps using these files first. EchoFlow will remove the originals only after verifying the copies.`
  if (!await confirm(input, output, message)) return { state: 'ready', issues: [] }
  const afterConfirm = await readStorageMigrationStatus(binding)
  if (afterConfirm && afterConfirm.state !== 'ready') throw new Error(`Storage migration is ${afterConfirm.state}; recover it before starting adoption`)

  const selection = { files: files.map(item => item.file), expected: files.map(item => item.identity) }
  const sources = whatsapp
    ? await readApprovedWhatsAppSources(binding, await armWhatsAppStorageApproval(binding, whatsapp))
    : [await armApprovedFileSource(binding, randomUUID(), args.category === 'im-adapters'
      ? { ...selection, approvalCategory: 'im-adapters' } : { ...selection, destination })]
  const hooks = options.hooks ?? createStorageMigrationHooks(binding)
  const plan = await prepareStorageMigration({ binding, sources })
  if (!plan.files) throw new Error('No selected storage files')
  let result = await executeStorageMigration({ binding, sources, hooks })
  if (result.state === 'validation-required') {
    result = await completeStorageMigration(binding, result.id!, hooks, validateRestrictedHeadlessStorage)
  }
  if (result.state !== 'ready') throw new Error(result.issues.join('; ') || `Storage migration is ${result.state}`)
  output.write(`Storage adoption completed: ${whatsappTarget ?? files.map(item => item.target).join(', ')}\n`)
  return result
}

export async function runStorageAdoptionCommand(
  argv: readonly string[],
  options: { input?: AdoptionInput; output?: AdoptionOutput; binding?: StorageBinding; hooks?: StorageMigrationHooks } = {},
): Promise<boolean> {
  if (!isStorageAdoptionInvocation(argv)) return false
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  let args: StorageAdoptionArgs | undefined
  try {
    args = parseStorageAdoptionArgs(argv)
    await adoptStorageFile(args, input, output, options)
  } catch (error) {
    const message = args?.category === 'whatsapp-auth' && !(error instanceof WhatsAppAdoptionConfigRequiredError)
      ? 'Could not move WhatsApp sign-in files'
      : error instanceof Error ? error.message : String(error)
    output.write(`${message}\n`)
    process.exitCode = 1
  }
  return true
}
