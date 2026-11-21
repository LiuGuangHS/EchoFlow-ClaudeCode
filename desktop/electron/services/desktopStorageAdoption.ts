import path from 'node:path'
import { completeStorageMigration, executeStorageMigration, inspectOpenAiOauthFile, isWithin, prepareStorageMigration, readApprovedFileSource, readApprovedStorageTransaction, recordColdStorageApproval, recoverStorageMigration, regularIdentity, type FileIdentity, type StorageMigrationHooks, type StorageMigrationResult } from '../../../src/services/storageMigration'
import type { StorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import type { Locale } from '../../src/i18n/locale'

export const openAiOauthDialogText = {
  en: { choose: 'Choose openai-oauth.json', message: 'Move OpenAI sign-in and restart?', detail: 'Close apps using this file first. EchoFlow will remove the original only after verifying the copy.', cancel: 'Cancel', confirm: 'Move and Restart' },
  zh: { choose: '选择 openai-oauth.json', message: '迁移 OpenAI 登录并重启？', detail: '请先关闭使用此文件的应用。EchoFlow 验证副本后才会删除原文件。', cancel: '取消', confirm: '迁移并重启' },
  'zh-TW': { choose: '選擇 openai-oauth.json', message: '遷移 OpenAI 登入並重新啟動？', detail: '請先關閉使用此檔案的應用程式。EchoFlow 驗證副本後才會刪除原檔。', cancel: '取消', confirm: '遷移並重新啟動' },
  jp: { choose: 'openai-oauth.json を選択', message: 'OpenAI のログイン情報を移行して再起動しますか？', detail: 'このファイルを使用するアプリを先に終了してください。EchoFlow はコピーを検証した後、元のファイルを削除します。', cancel: 'キャンセル', confirm: '移行して再起動' },
  kr: { choose: 'openai-oauth.json 선택', message: 'OpenAI 로그인 정보를 이전하고 다시 시작할까요?', detail: '이 파일을 사용하는 앱을 먼저 종료하세요. EchoFlow는 사본을 확인한 후에만 원본을 삭제합니다.', cancel: '취소', confirm: '이전 후 다시 시작' },
} satisfies Record<Locale, { choose: string; message: string; detail: string; cancel: string; confirm: string }>

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const switchNames = ['echoflow-openai-oauth-source', 'echoflow-openai-oauth-id', 'echoflow-openai-oauth-proof'] as const
const basename = 'openai-oauth.json'
export const OPENAI_OAUTH_DESTINATION = 'echoflow-code'

export type DesktopOpenAiOauthLaunch = { kind: 'openai-oauth'; source: string; id: string; proof: string }
type CommandLine = { hasSwitch(name: string): boolean; getSwitchValue(name: string): string }

const absolute = (value: unknown): value is string => typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && !value.includes('\0')

function oauthProof(identity: FileIdentity): string {
  return `${identity.digest}:${identity.dev}:${identity.ino}:${identity.size}`
}

export async function previewOpenAiOauth(binding: StorageBinding, file: string) {
  if (!absolute(file) || path.basename(file) !== basename) throw new Error('Choose an openai-oauth.json file')
  const directory = path.dirname(file)
  if (isWithin(directory, binding.root) || isWithin(binding.root, directory)) throw new Error('Choose a file in a separate source directory')
  const identity = await inspectOpenAiOauthFile(file)
  const target = path.join(binding.internalDir, basename)
  const existing = await regularIdentity(target).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
  if (existing && existing.digest !== identity.digest) throw new Error('The active directory already has a different OpenAI sign-in file')
  return { file, target, identity }
}

export async function approveOpenAiOauth(binding: StorageBinding, preview: Awaited<ReturnType<typeof previewOpenAiOauth>>): Promise<DesktopOpenAiOauthLaunch> {
  const { file, identity } = preview
  const approval = await recordColdStorageApproval(binding, { destination: OPENAI_OAUTH_DESTINATION, files: [file], expected: [identity] })
  return { kind: 'openai-oauth', source: file, id: approval.approval!, proof: oauthProof(identity) }
}

export function desktopOpenAiOauthLaunch(commandLine: CommandLine): DesktopOpenAiOauthLaunch | undefined {
  if (!switchNames.some(name => commandLine.hasSwitch(name))) return undefined
  const source = commandLine.getSwitchValue(switchNames[0])
  const id = commandLine.getSwitchValue(switchNames[1])
  const proof = commandLine.getSwitchValue(switchNames[2])
  if (!absolute(source) || path.basename(source) !== basename || !uuid.test(id) || !/^[a-f0-9]{64}:\d+:\d+:\d+$/.test(proof)) throw new Error('Incomplete or invalid OpenAI OAuth adoption launch')
  return { kind: 'openai-oauth', source, id, proof }
}

export function desktopOpenAiOauthRelaunchArgs(argv: readonly string[], launch: DesktopOpenAiOauthLaunch): string[] {
  const controls = [`--${switchNames[0]}=${launch.source}`, `--${switchNames[1]}=${launch.id}`, `--${switchNames[2]}=${launch.proof}`]
  const separator = argv.indexOf('--')
  return separator < 0 ? [...argv, ...controls] : [...argv.slice(0, separator), ...controls, ...argv.slice(separator)]
}

export async function executeDesktopOpenAiOauth(
  binding: StorageBinding,
  launch: DesktopOpenAiOauthLaunch,
  hooks: StorageMigrationHooks,
  validate: (binding: StorageBinding) => Promise<void>,
): Promise<StorageMigrationResult> {
  let result: StorageMigrationResult
  try {
    const source = await readApprovedFileSource(binding, launch.id, {
      file: launch.source, destination: OPENAI_OAUTH_DESTINATION, proof: launch.proof,
    })
    const existing = await readApprovedStorageTransaction(binding, launch.id)
    if (existing?.state === 'ready') return existing
    if (existing) {
      result = await recoverStorageMigration(binding, hooks, existing.id!)
    } else {
      await prepareStorageMigration({ binding, sources: [source] })
      result = await executeStorageMigration({ binding, sources: [source], hooks })
    }
    if (result.state === 'validation-required' && (await readApprovedStorageTransaction(binding, launch.id))?.id !== result.id) {
      throw new Error('Conflicting storage transaction and cold approval')
    }
  } catch (error) {
    return { state: 'blocked', issues: [error instanceof Error ? error.message : String(error)] }
  }
  if (result.state === 'validation-required') {
    await validate(binding)
    return await completeStorageMigration(binding, result.id!, hooks)
  }
  return result
}
