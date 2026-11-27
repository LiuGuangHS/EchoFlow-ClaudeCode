import path from 'node:path'
import { armWhatsAppStorageApproval, completeStorageMigration, executeStorageMigration, imStorageApprovalProof, inspectOpenAiOauthFile, isWithin, prepareStorageMigration, readApprovedFileSource, readApprovedStorageTransaction, readApprovedWhatsAppSources, recordColdStorageApproval, recoverStorageMigration, regularIdentity, previewImAdoption, type FileIdentity, type StorageMigrationHooks, type StorageMigrationResult, type WhatsAppAdoptionPreview } from '../../../src/services/storageMigration'
import type { StorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import type { Locale } from '../../src/i18n/locale'

export const openAiOauthDialogText = {
  en: { choose: 'Choose openai-oauth.json', message: 'Move OpenAI sign-in and restart?', detail: 'Close apps using this file first. EchoFlow will remove the original only after verifying the copy.', cancel: 'Cancel', confirm: 'Move and Restart' },
  zh: { choose: '选择 openai-oauth.json', message: '迁移 OpenAI 登录并重启？', detail: '请先关闭使用此文件的应用。EchoFlow 验证副本后才会删除原文件。', cancel: '取消', confirm: '迁移并重启' },
  'zh-TW': { choose: '選擇 openai-oauth.json', message: '遷移 OpenAI 登入並重新啟動？', detail: '請先關閉使用此檔案的應用程式。EchoFlow 驗證副本後才會刪除原檔。', cancel: '取消', confirm: '遷移並重新啟動' },
  jp: { choose: 'openai-oauth.json を選択', message: 'OpenAI のログイン情報を移行して再起動しますか？', detail: 'このファイルを使用するアプリを先に終了してください。EchoFlow はコピーを検証した後、元のファイルを削除します。', cancel: 'キャンセル', confirm: '移行して再起動' },
  kr: { choose: 'openai-oauth.json 선택', message: 'OpenAI 로그인 정보를 이전하고 다시 시작할까요?', detail: '이 파일을 사용하는 앱을 먼저 종료하세요. EchoFlow는 사본을 확인한 후에만 원본을 삭제합니다.', cancel: '취소', confirm: '이전 후 다시 시작' },
} satisfies Record<Locale, { choose: string; message: string; detail: string; cancel: string; confirm: string }>

export { previewImAdoption }

export const imAdoptionDialogText = {
  en: { choose: 'Choose adapters.json or adapter-sessions.json', message: 'Move IM data and restart?', detail: 'Close apps using these files first. EchoFlow will remove the originals only after verifying the copies.' },
  zh: { choose: '选择 adapters.json 或 adapter-sessions.json', message: '迁移 IM 数据并重启？', detail: '请先关闭使用这些文件的应用。EchoFlow 验证副本后才会删除原文件。' },
  'zh-TW': { choose: '選擇 adapters.json 或 adapter-sessions.json', message: '遷移 IM 資料並重新啟動？', detail: '請先關閉使用這些檔案的應用程式。EchoFlow 驗證副本後才會刪除原檔。' },
  jp: { choose: 'adapters.json または adapter-sessions.json を選択', message: 'IM データを移行して再起動しますか？', detail: '対象ファイルを使うアプリを先に終了してください。EchoFlow はコピーを確認した後で元のファイルを削除します。' },
  kr: { choose: 'adapters.json 또는 adapter-sessions.json 선택', message: 'IM 데이터를 이전하고 다시 시작할까요?', detail: '해당 파일을 사용하는 앱을 먼저 종료하세요. EchoFlow는 사본을 확인한 후에만 원본을 삭제합니다.' },
} satisfies Record<Locale, { choose: string; message: string; detail: string }>

export const whatsAppAdoptionDialogText = {
  en: { choose: 'Choose the old WhatsApp account folder', config: 'Choose the saved adapters.json for this account', message: 'Move WhatsApp sign-in and restart?', detail: 'Close other apps using these files first. EchoFlow will remove the originals only after verifying the copies.', summary: (count, size) => `${count} ${count === 1 ? 'file' : 'files'} · ${size}` },
  zh: { choose: '选择旧 WhatsApp 账号文件夹', config: '选择此账号已保存的 adapters.json', message: '迁移 WhatsApp 登录并重启？', detail: '请先关闭其他正在使用这些文件的应用。EchoFlow 验证副本后才会删除原文件。', summary: (count, size) => `${count} 个文件 · ${size}` },
  'zh-TW': { choose: '選擇舊 WhatsApp 帳號資料夾', config: '選擇此帳號已儲存的 adapters.json', message: '遷移 WhatsApp 登入並重新啟動？', detail: '請先關閉其他正在使用這些檔案的應用程式。EchoFlow 驗證副本後才會刪除原檔。', summary: (count, size) => `${count} 個檔案 · ${size}` },
  jp: { choose: '以前の WhatsApp アカウントのフォルダーを選択', config: 'このアカウントの保存済み adapters.json を選択', message: 'WhatsApp のログイン情報を移行して再起動しますか？', detail: '対象ファイルを使う他のアプリを先に終了してください。EchoFlow はコピーを確認した後で元のファイルを削除します。', summary: (count, size) => `${count} 個のファイル · ${size}` },
  kr: { choose: '이전 WhatsApp 계정 폴더 선택', config: '이 계정에 저장된 adapters.json 선택', message: 'WhatsApp 로그인 정보를 이전하고 다시 시작할까요?', detail: '해당 파일을 사용하는 다른 앱을 먼저 종료하세요. EchoFlow는 사본을 확인한 후에만 원본을 삭제합니다.', summary: (count, size) => `파일 ${count}개 · ${size}` },
} satisfies Record<Locale, { choose: string; config: string; message: string; detail: string; summary(count: number, size: string): string }>

export const whatsAppAdoptionError = 'Could not move WhatsApp sign-in files'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const switchNames = ['echoflow-openai-oauth-source', 'echoflow-openai-oauth-id', 'echoflow-openai-oauth-proof'] as const
const imSwitchNames = ['echoflow-im-adoption-id', 'echoflow-im-adoption-proof'] as const
const whatsAppSwitchNames = ['echoflow-whatsapp-adoption-id', 'echoflow-whatsapp-adoption-proof'] as const
const basename = 'openai-oauth.json'
export const OPENAI_OAUTH_DESTINATION = 'echoflow-code'

export type DesktopOpenAiOauthLaunch = { kind: 'openai-oauth'; source: string; id: string; proof: string }
type DesktopImAdoptionLaunch = { kind: 'im-adapters'; id: string; proof: string }
type DesktopWhatsAppAdoptionLaunch = { kind: 'whatsapp-auth'; id: string; proof: string }
export type DesktopStorageAdoptionLaunch = DesktopOpenAiOauthLaunch | DesktopImAdoptionLaunch | DesktopWhatsAppAdoptionLaunch
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

export async function approveImAdoption(binding: StorageBinding, preview: Awaited<ReturnType<typeof previewImAdoption>>): Promise<DesktopImAdoptionLaunch> {
  const approval = await recordColdStorageApproval(binding, {
    approvalCategory: 'im-adapters', files: preview.map(item => item.file), expected: preview.map(item => item.identity),
  })
  return { kind: 'im-adapters', id: approval.approval!, proof: imStorageApprovalProof(preview) }
}

export async function approveWhatsAppAdoption(binding: StorageBinding, preview: WhatsAppAdoptionPreview): Promise<DesktopWhatsAppAdoptionLaunch> {
  return { kind: 'whatsapp-auth', ...await armWhatsAppStorageApproval(binding, preview, true) }
}

const accountAdoptionSwitches = { 'im-adapters': imSwitchNames, 'whatsapp-auth': whatsAppSwitchNames } as const

export function desktopStorageAdoptionSwitches(launch: DesktopStorageAdoptionLaunch): readonly string[] {
  return launch.kind === 'openai-oauth' ? switchNames : accountAdoptionSwitches[launch.kind]
}

export function desktopStorageAdoptionLaunch(commandLine: CommandLine): DesktopStorageAdoptionLaunch | undefined {
  let launch: DesktopStorageAdoptionLaunch | undefined = desktopOpenAiOauthLaunch(commandLine)
  for (const kind of ['im-adapters', 'whatsapp-auth'] as const) {
    const names = accountAdoptionSwitches[kind]
    if (!names.some(name => commandLine.hasSwitch(name))) continue
    const id = commandLine.getSwitchValue(names[0])
    const proof = commandLine.getSwitchValue(names[1])
    if (launch || !uuid.test(id) || !/^[a-f0-9]{64}$/.test(proof)) throw new Error(`Conflicting or invalid ${kind} adoption launch`)
    launch = { kind, id, proof }
  }
  return launch
}

function desktopOpenAiOauthLaunch(commandLine: CommandLine): DesktopOpenAiOauthLaunch | undefined {
  if (!switchNames.some(name => commandLine.hasSwitch(name))) return undefined
  const source = commandLine.getSwitchValue(switchNames[0])
  const id = commandLine.getSwitchValue(switchNames[1])
  const proof = commandLine.getSwitchValue(switchNames[2])
  if (!absolute(source) || path.basename(source) !== basename || !uuid.test(id) || !/^[a-f0-9]{64}:\d+:\d+:\d+$/.test(proof)) throw new Error('Incomplete or invalid OpenAI OAuth adoption launch')
  return { kind: 'openai-oauth', source, id, proof }
}

export function desktopStorageAdoptionRelaunchArgs(argv: readonly string[], launch: DesktopStorageAdoptionLaunch): string[] {
  const values = launch.kind === 'openai-oauth' ? [launch.source, launch.id, launch.proof] : [launch.id, launch.proof]
  const controls = desktopStorageAdoptionSwitches(launch).map((name, index) => `--${name}=${values[index]}`)
  const separator = argv.indexOf('--')
  return separator < 0 ? [...argv, ...controls] : [...argv.slice(0, separator), ...controls, ...argv.slice(separator)]
}

export async function executeDesktopStorageAdoption(
  binding: StorageBinding,
  launch: DesktopStorageAdoptionLaunch,
  hooks: StorageMigrationHooks,
  validate: (binding: StorageBinding) => Promise<void>,
): Promise<StorageMigrationResult> {
  let result: StorageMigrationResult
  try {
    const sources = launch.kind === 'whatsapp-auth' ? await readApprovedWhatsAppSources(binding, launch)
      : [await readApprovedFileSource(binding, launch.id, launch.kind === 'im-adapters'
        ? { approvalCategory: 'im-adapters', proof: launch.proof }
        : { file: launch.source, destination: OPENAI_OAUTH_DESTINATION, proof: launch.proof })]
    const existing = await readApprovedStorageTransaction(binding, launch.id)
    if (existing?.state === 'ready') return existing
    if (existing) {
      result = await recoverStorageMigration(binding, hooks, existing.id!)
    } else {
      await prepareStorageMigration({ binding, sources })
      result = await executeStorageMigration({ binding, sources, hooks })
    }
    if (result.state === 'validation-required' && (await readApprovedStorageTransaction(binding, launch.id))?.id !== result.id) {
      throw new Error('Conflicting storage transaction and cold approval')
    }
  } catch (error) {
    result = { state: 'blocked', issues: [error instanceof Error ? error.message : String(error)] }
  }
  if (result.state === 'validation-required') {
    result = await completeStorageMigration(binding, result.id!, hooks, validate)
  }
  return launch.kind === 'whatsapp-auth' && result.issues.length
    ? { ...result, issues: [whatsAppAdoptionError] }
    : result
}
