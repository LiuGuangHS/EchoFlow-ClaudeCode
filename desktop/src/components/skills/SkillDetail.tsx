import { useCallback, useMemo, useState } from 'react'
import { useSkillStore } from '../../stores/skillStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { marketApi } from '../../api/market'
import { useMarketStore } from '../../stores/marketStore'
import { SkillDetailView, type SkillDetailMetaItem } from '../market/SkillDetailView'
import type { PreviewFileContent } from '../market/FilePreview'
import { ConfirmDialog } from '../shared/ConfirmDialog'

const META_PRIORITY = [
  'when_to_use',
  'argument-hint',
  'model',
  'effort',
  'allowed-tools',
  'paths',
  'agent',
  'context',
  'user-invocable',
] as const

function formatMetaKey(key: string) {
  return key.replace(/[-_]/g, ' ')
}

function formatMetaValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

export function SkillDetail() {
  const { selectedSkill, selectedSkillReturnTab, isDetailLoading, clearSelection, fetchSkills } = useSkillStore()
  const t = useTranslation()
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)

  const handleBack = useCallback(() => {
    const returnTab = selectedSkillReturnTab
    clearSelection()
    if (returnTab === 'plugins') {
      useUIStore.getState().setPendingSettingsTab('plugins')
    }
  }, [selectedSkillReturnTab, clearSelection])

  const files = selectedSkill?.files ?? []

  const loadFile = useCallback(
    (path: string): Promise<PreviewFileContent> => {
      const file = files.find((f) => f.path === path)
      if (!file) return Promise.reject(new Error(`File not found: ${path}`))
      const content = file.language === 'markdown' ? (file.body ?? file.content) : file.content
      return Promise.resolve({
        path: file.path,
        content,
        language: file.language,
        size: file.content.length,
        truncated: false,
      })
    },
    [files],
  )

  const meta = useMemo<SkillDetailMetaItem[]>(() => {
    if (!selectedSkill) return []
    const skillMeta = selectedSkill.meta
    const items: SkillDetailMetaItem[] = [
      { label: t('settings.skills.summary.source'), value: t(`settings.skills.source.${skillMeta.source}`) },
      { label: t('settings.skills.summary.totalFiles'), value: String(selectedSkill.files.length) },
      {
        label: t('settings.skills.summary.tokens'),
        value: t('settings.skills.tokenEstimateShort', {
          count: String(Math.ceil(skillMeta.contentLength / 4)),
        }),
      },
    ]
    if (selectedSkill.marketMeta?.installedAt) {
      items.push({
        label: t('market.install.state.installed'),
        value: new Date(selectedSkill.marketMeta.installedAt).toLocaleDateString(),
      })
    }
    const entry = selectedSkill.files.find((f) => f.isEntry)
    const frontmatter = entry?.frontmatter
    if (frontmatter) {
      const entries = Object.entries(frontmatter)
        .filter(([key, value]) => {
          if (key === 'name' || key === 'description' || key === 'version') return false
          if (value == null) return false
          if (typeof value === 'string') return value.trim().length > 0
          if (Array.isArray(value)) return value.length > 0
          return true
        })
        .sort((a, b) => {
          const aIndex = META_PRIORITY.indexOf(a[0] as (typeof META_PRIORITY)[number])
          const bIndex = META_PRIORITY.indexOf(b[0] as (typeof META_PRIORITY)[number])
          const normalizedA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex
          const normalizedB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex
          return normalizedA - normalizedB || a[0].localeCompare(b[0])
        })
      for (const [key, value] of entries) {
        items.push({ label: formatMetaKey(key), value: formatMetaValue(value) })
      }
    }
    return items
  }, [selectedSkill, t])

  if (isDetailLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!selectedSkill) return null

  const skillMeta = selectedSkill.meta
  const marketMeta = selectedSkill.marketMeta
  const entryFile = selectedSkill.files.find((f) => f.isEntry)
  const description = entryFile ? (entryFile.body ?? entryFile.content) : ''

  const runUninstall = async () => {
    if (!marketMeta) return
    setUninstalling(true)
    try {
      await marketApi.uninstall(marketMeta.id)
      useUIStore.getState().addToast({
        type: 'success',
        message: t('market.uninstall.success', { name: skillMeta.displayName || skillMeta.name }),
      })
      setConfirmUninstall(false)
      clearSelection()
      void fetchSkills()
      // Keep the market list in sync when it has this skill loaded.
      const market = useMarketStore.getState()
      const detailCache = new Map(market.detailCache)
      detailCache.delete(marketMeta.id)
      useMarketStore.setState({
        detailCache,
        items: market.items.map((item) =>
          item.id === marketMeta.id
            ? { ...item, installState: 'installable', installedInfo: undefined, notInstallableReason: undefined }
            : item,
        ),
      })
    } catch (err) {
      useUIStore.getState().addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setUninstalling(false)
    }
  }

  const actions = marketMeta ? (
    <button
      type="button"
      data-testid="local-skill-uninstall-button"
      disabled={uninstalling}
      onClick={() => setConfirmUninstall(true)}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 text-sm text-[var(--color-error)] transition-colors hover:border-[var(--color-error)]/50 disabled:opacity-50"
    >
      {uninstalling ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" aria-hidden />
      ) : (
        <span className="material-symbols-outlined text-[18px]" aria-hidden>delete</span>
      )}
      {uninstalling ? t('market.uninstall.uninstalling') : t('market.uninstall.action')}
    </button>
  ) : undefined

  return (
    <>
      <SkillDetailView
        name={skillMeta.displayName || skillMeta.name}
        version={skillMeta.version}
        sourceLabel={t(`settings.skills.source.${skillMeta.source}`)}
        summary={skillMeta.description}
        installState={marketMeta ? 'installed' : undefined}
        actions={actions}
        meta={meta}
        description={description}
        files={selectedSkill.files.map((f) => ({
          path: f.path,
          size: f.content.length,
          language: f.language,
        }))}
        loadFile={loadFile}
        onBack={handleBack}
        backLabel={t('settings.skills.back')}
      />

      <ConfirmDialog
        open={confirmUninstall}
        onClose={() => setConfirmUninstall(false)}
        onConfirm={() => void runUninstall()}
        title={t('market.uninstall.confirmTitle')}
        body={t('market.uninstall.confirmMessage', {
          name: skillMeta.displayName || skillMeta.name,
          path: selectedSkill.skillRoot,
        })}
        confirmLabel={t('market.uninstall.action')}
        cancelLabel={t('market.installConfirm.cancel')}
        confirmVariant="danger"
        loading={uninstalling}
      />
    </>
  )
}
