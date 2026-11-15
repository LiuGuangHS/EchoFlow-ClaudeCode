import type { App, Dialog } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UserDataProfileConflictError } from './echoFlowDataRoot'

export function prepareProfileRecovery(app: Pick<App, 'setPath'>): () => void {
  const directory = mkdtempSync(join(tmpdir(), 'echoflow-profile-recovery-'))
  const cleanup = () => {
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch (error) {
      // Chromium may still hold cache files on Windows; never touch the original profiles.
      console.warn('[profile-recovery] Temporary recovery directory retained:', directory, error)
    }
  }
  try {
    app.setPath('userData', directory)
    app.setPath('sessionData', directory)
  } catch (error) {
    cleanup()
    throw error
  }
  return cleanup
}

export async function recoverProfileConflict(
  app: Pick<App, 'relaunch' | 'exit'>,
  dialog: Pick<Dialog, 'showMessageBox' | 'showErrorBox'>,
  conflict: UserDataProfileConflictError,
  args: string[] = process.argv.slice(1),
  cleanup: () => void = () => {},
): Promise<void> {
  try {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '选择已有配置 / Select an existing profile',
      message: '检测到多份用户状态；请先备份全部目录，再明确选择本次启动使用的配置。',
      detail: `${conflict.directories.map((directory, index) => `${index + 1}. ${directory}`).join('\n')}\n\nBack up ALL listed directories before selecting a profile for this launch. No files will be merged, moved or deleted. This selects Electron preferences only; external and portable data-directory settings remain in effect.\n\n本次选择不会合并、移动或删除文件，也不改变外部或便携数据目录设置。下次正常启动仍会询问，直到手动解决目录冲突。`,
      buttons: ['退出 / Exit', ...conflict.directories.map((_, index) => `使用配置 ${index + 1} / Use profile ${index + 1}`)],
      defaultId: 0,
      cancelId: 0,
      checkboxLabel: '我已备份全部上述目录 / I have backed up every listed directory',
      checkboxChecked: false,
      noLink: true,
    })
    const selected = conflict.directories[result.response - 1]
    if (!result.checkboxChecked || !selected) {
      cleanup()
      app.exit(1)
      return
    }
    // One-launch override: never persist a choice or rewrite protected user state here.
    app.relaunch({ args: [...args, `--user-data-dir=${selected}`] })
    cleanup()
    app.exit(0)
  } catch (error) {
    dialog.showErrorBox('数据目录不可用 / Data directory unavailable', error instanceof Error ? error.message : String(error))
    cleanup()
    app.exit(1)
  }
}
