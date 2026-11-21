import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { resolveStorageBinding, type StorageBinding } from '../utils/echoFlowConfigRoot.js'
import {
  armApprovedFileSource,
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

export type StorageAdoptionArgs = { category: 'openai-oauth'; file: string } | { category: 'im-adapters'; files: string[] }

type AdoptionInput = NodeJS.ReadableStream & { isTTY?: boolean }
type AdoptionOutput = Pick<NodeJS.WritableStream, 'write'>

const destination = 'echoflow-code'
const oauthFile = 'openai-oauth.json'

export function isStorageAdoptionInvocation(argv: readonly string[]): boolean {
  return argv[0] === 'storage' && argv[1] === 'adopt'
}

export function parseStorageAdoptionArgs(argv: readonly string[]): StorageAdoptionArgs {
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

async function confirm(input: AdoptionInput, output: AdoptionOutput, args: StorageAdoptionArgs, binding: StorageBinding) {
  if (input.isTTY !== true) {
    output.write('Storage adoption requires an interactive TTY; no files were changed.\n')
    return
  }
  const files = args.category === 'im-adapters'
    ? await previewImAdoption(binding, args.files)
    : [{ file: args.file, target: path.join(binding.internalDir, oauthFile), identity: await inspectOpenAiOauthFile(args.file) }]
  const description = files.map(({ file, target, identity }) => `${file} (${identity.size} bytes) → ${target}`).join('\n')
  if (args.category === 'openai-oauth') {
    output.write(`Adopt ${args.file} (${files[0]!.identity.size} bytes) into ${files[0]!.target}?\nClose apps using this file first. EchoFlow will remove the original only after verifying the copy.\nType y or yes to continue: `)
  } else {
    output.write(`Move these IM files?\n${description}\nClose apps using these files first. EchoFlow will remove the originals only after verifying the copies.\nType y or yes to continue: `)
  }
  const reader = createInterface({ input })
  let line: string | undefined
  for await (const value of reader) {
    line = value.trim().toLowerCase()
    break
  }
  reader.close()
  if (line !== 'y' && line !== 'yes') {
    output.write('Storage adoption cancelled; no files were changed.\n')
    return
  }
  return files
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
  const files = await confirm(input, output, args, binding)
  if (!files) return { state: 'ready', issues: [] }
  const afterConfirm = await readStorageMigrationStatus(binding)
  if (afterConfirm && afterConfirm.state !== 'ready') throw new Error(`Storage migration is ${afterConfirm.state}; recover it before starting adoption`)

  const approval = randomUUID()
  const selection = { files: files.map(item => item.file), expected: files.map(item => item.identity) }
  const source = await armApprovedFileSource(binding, approval, args.category === 'im-adapters'
    ? { ...selection, approvalCategory: 'im-adapters' }
    : { ...selection, destination })
  const hooks = options.hooks ?? createStorageMigrationHooks(binding)
  const plan = await prepareStorageMigration({ binding, sources: [source] })
  if (!plan.files) throw new Error('No selected storage files')
  let result = await executeStorageMigration({ binding, sources: [source], hooks })
  if (result.state === 'validation-required') {
    result = await completeStorageMigration(binding, result.id!, hooks, validateRestrictedHeadlessStorage)
  }
  if (result.state !== 'ready') throw new Error(result.issues.join('; ') || `Storage migration is ${result.state}`)
  output.write(`Storage adoption completed: ${files.map(item => item.target).join(', ')}\n`)
  return result
}

export async function runStorageAdoptionCommand(
  argv: readonly string[],
  options: { input?: AdoptionInput; output?: AdoptionOutput; binding?: StorageBinding; hooks?: StorageMigrationHooks } = {},
): Promise<boolean> {
  if (!isStorageAdoptionInvocation(argv)) return false
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  try {
    const args = parseStorageAdoptionArgs(argv)
    await adoptStorageFile(args, input, output, options)
  } catch (error) {
    output.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
  return true
}
