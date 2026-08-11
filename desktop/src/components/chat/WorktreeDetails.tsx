import { useTranslation } from '../../i18n'
import { getFileNameFromPath } from '../../lib/composerAttachments'

export function getWorktreeDisplayName(
  slug: string | null | undefined,
  path: string | null | undefined,
): string | null {
  return slug || (path ? getFileNameFromPath(path) : null)
}

export function WorktreeDetails({ name, path }: { name: string; path?: string | null }) {
  const t = useTranslation()

  return (
    <dl className="grid max-w-[280px] grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
      <dt className="opacity-70">{t('sidebar.worktree')}</dt>
      <dd className="min-w-0 break-all font-mono text-[11px]">{name}</dd>
      {path ? (
        <>
          <dt className="opacity-70">{t('dirPicker.directory')}</dt>
          <dd className="min-w-0 break-all font-mono text-[11px]">{path}</dd>
        </>
      ) : null}
    </dl>
  )
}
