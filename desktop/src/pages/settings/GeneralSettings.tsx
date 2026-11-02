import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { RotateCw } from 'lucide-react'
import {
  useSettingsStore,
  UI_ZOOM_DEFAULT,
  UI_ZOOM_MIN,
  UI_ZOOM_MAX,
  UI_ZOOM_STEP,
} from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SettingsPill, SettingsSection } from '@/components/settings/SettingsSection'
import { Dropdown } from '@/components/ui/Dropdown'
import { Switch } from '@/components/ui/Switch'
import { isDarkThemeMode, isLightThemeMode } from '../../types/settings'
import type { ThemeMode, ChatSendBehavior } from '../../types/settings'
import type { Locale } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { useOpenTargetStore } from '../../stores/openTargetStore'
import { getDesktopNotificationPermission, notifyDesktop, getDesktopNotificationPlatform, openDesktopNotificationSettings, requestDesktopNotificationPermission, type DesktopNotificationPermission } from '../../lib/desktopNotifications'
import { SETTINGS_CHECKBOX_INPUT_CLASS, SettingsCheckboxMark } from '../settings/shared'
import { ChatAppearanceSettings } from './ChatAppearanceSettings'



export function GeneralSettings() {
  const {
    locale,
    setLocale,
    setTheme,
    chatSendBehavior,
    setChatSendBehavior,
    desktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    responseLanguage,
    setResponseLanguage,
    uiZoom,
    setUiZoom,
    proxyManagedSettingsWarning,
  } = useSettingsStore()
  // Read the theme from the store that owns it. settingsStore keeps a copy for
  // its own consumers, but that copy is only refreshed on an explicit setTheme
  // — an OS flip updates uiStore alone and would leave this picker highlighting
  // a theme that is no longer on screen.
  const theme = useUIStore((s) => s.theme)
  const followSystemTheme = useUIStore((s) => s.followSystemTheme)
  const lightTheme = useUIStore((s) => s.lightTheme)
  const darkTheme = useUIStore((s) => s.darkTheme)
  const setFollowSystemTheme = useUIStore((s) => s.setFollowSystemTheme)
  const t = useTranslation()
  const [notificationPermission, setNotificationPermission] = useState<DesktopNotificationPermission>('default')
  const [notificationActionRunning, setNotificationActionRunning] = useState(false)
  const [uiZoomDraft, setUiZoomDraft] = useState(uiZoom)
  /**
   * The value the open dialog is asking about. Pinned when the dialog opens so
   * a failed save (which rolls the store back and resets the input) cannot
   * silently change what the user is about to confirm.
   */
  const [isUiZoomDragging, setIsUiZoomDragging] = useState(false)
  const isUiZoomDraggingRef = useRef(false)
  const openTargets = useOpenTargetStore((s) => s.targets)
  const ensureOpenTargets = useOpenTargetStore((s) => s.ensureTargets)
  const editorTargetId = useOpenTargetStore((s) => s.editorTargetId)
  const setEditorTargetId = useOpenTargetStore((s) => s.setEditorTargetId)
  const detectedEditors = useMemo(
    () => openTargets.filter((target) => target.kind === 'ide'),
    [openTargets],
  )
  const uiZoomPercent = Math.round(uiZoomDraft * 100)
  const uiZoomRangeProgress = `${Math.round(((uiZoomDraft - UI_ZOOM_MIN) / (UI_ZOOM_MAX - UI_ZOOM_MIN)) * 1000) / 10}%`
  useEffect(() => {
    void ensureOpenTargets()
  }, [ensureOpenTargets])

  useEffect(() => {
    if (!isUiZoomDragging) {
      setUiZoomDraft(uiZoom)
    }
  }, [isUiZoomDragging, uiZoom])

  useEffect(() => {
    let cancelled = false
    getDesktopNotificationPermission().then((permission) => {
      if (!cancelled) setNotificationPermission(permission)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const LANGUAGES: Array<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '简体中文' },
    { value: 'zh-TW', label: '繁體中文' },
    { value: 'jp', label: '日本語' },
    { value: 'kr', label: '한국어' },
  ]

  const RESPONSE_LANGUAGES: Array<{ value: string; label: string }> = [
    { value: '', label: t('settings.general.responseLangDefault') },
    { value: 'english', label: 'English' },
    { value: 'chinese', label: '中文 (Chinese)' },
    { value: 'japanese', label: '日本語 (Japanese)' },
    { value: 'korean', label: '한국어 (Korean)' },
    { value: 'spanish', label: 'Español (Spanish)' },
    { value: 'french', label: 'Français (French)' },
    { value: 'german', label: 'Deutsch (German)' },
    { value: 'portuguese', label: 'Português (Portuguese)' },
    { value: 'italian', label: 'Italiano (Italian)' },
    { value: 'russian', label: 'Русский (Russian)' },
    { value: 'dutch', label: 'Nederlands (Dutch)' },
    { value: 'polish', label: 'Polski (Polish)' },
    { value: 'turkish', label: 'Türkçe (Turkish)' },
    { value: 'hindi', label: 'हिन्दी (Hindi)' },
    { value: 'indonesian', label: 'Bahasa Indonesia' },
    { value: 'ukrainian', label: 'Українська (Ukrainian)' },
    { value: 'greek', label: 'Ελληνικά (Greek)' },
    { value: 'czech', label: 'Čeština (Czech)' },
    { value: 'danish', label: 'Dansk (Danish)' },
    { value: 'swedish', label: 'Svenska (Swedish)' },
    { value: 'norwegian', label: 'Norsk (Norwegian)' },
  ]
  const selectedResponseLanguageLabel =
    RESPONSE_LANGUAGES.find(({ value }) => value === responseLanguage)?.label ?? RESPONSE_LANGUAGES[0]!.label
  const THEMES: Array<{ value: ThemeMode; label: string }> = [
    { value: 'white', label: t('settings.general.appearance.white') },
    { value: 'paper', label: t('settings.general.appearance.paper') },
    { value: 'warm-classic', label: t('settings.general.appearance.warmClassic') },
    { value: 'celadon', label: t('settings.general.appearance.celadon') },
    { value: 'dark', label: t('settings.general.appearance.dark') },
    { value: 'ink-blue', label: t('settings.general.appearance.inkBlue') },
  ]
  // Split by ground, in the order THEMES already lists them, so the two rows
  // shown while following the system stay consistent with the flat picker.
  const LIGHT_THEMES = THEMES.filter(({ value }) => isLightThemeMode(value))
  const DARK_THEMES = THEMES.filter(({ value }) => isDarkThemeMode(value))

  const CHAT_SEND_BEHAVIORS: Array<{ value: ChatSendBehavior; label: string; description: string }> = [
    {
      value: 'enter',
      label: t('settings.general.chatSendBehaviorEnter'),
      description: t('settings.general.chatSendBehaviorEnterDescription'),
    },
    {
      value: 'modifierEnter',
      label: t('settings.general.chatSendBehaviorModifier'),
      description: t('settings.general.chatSendBehaviorModifierDescription'),
    },
  ]

  const notificationStatusLabel: Record<DesktopNotificationPermission, string> = {
    granted: t('settings.general.notificationsStatusGranted'),
    denied: t('settings.general.notificationsStatusDenied'),
    default: t('settings.general.notificationsStatusDefault'),
    unsupported: t('settings.general.notificationsStatusUnsupported'),
  }

  const handleDesktopNotificationsToggle = async (enabled: boolean) => {
    await setDesktopNotificationsEnabled(enabled)
    if (!enabled) return

    setNotificationActionRunning(true)
    try {
      const permission = await requestDesktopNotificationPermission()
      setNotificationPermission(permission)
      if (permission === 'granted' && getDesktopNotificationPlatform() !== 'win32') {
        void notifyDesktop({
          title: t('settings.general.notificationsTestTitle'),
          body: t('settings.general.notificationsTestBody'),
        })
      }
    } finally {
      setNotificationActionRunning(false)
    }
  }

  const handleNotificationPermissionAction = async () => {
    setNotificationActionRunning(true)
    try {
      if (notificationPermission === 'denied') {
        await openDesktopNotificationSettings()
      } else {
        const permission = await requestDesktopNotificationPermission()
        setNotificationPermission(permission)
        if (permission === 'granted') {
          void notifyDesktop({
            title: t('settings.general.notificationsTestTitle'),
            body: t('settings.general.notificationsTestBody'),
          })
        }
        if (permission === 'denied') {
          await openDesktopNotificationSettings()
        }
      }
    } finally {
      setNotificationActionRunning(false)
    }
  }

  const setUiZoomDraggingState = (dragging: boolean) => {
    isUiZoomDraggingRef.current = dragging
    setIsUiZoomDragging(dragging)
  }

  const commitUiZoom = (value: number) => {
    const nextZoom = Number.isFinite(value) ? value : UI_ZOOM_DEFAULT
    setUiZoomDraggingState(false)
    setUiZoomDraft(nextZoom)
    setUiZoom(nextZoom)
  }

  const uiZoomSection = (
    <div className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16.5px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.uiZoom')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)]">{t('settings.general.uiZoomDescription')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
            <span>{t('settings.general.uiZoomShortcutHint')}</span>
            <span className="inline-flex items-center gap-1">
              <span className="font-medium text-[var(--color-text-secondary)]">{t('settings.general.uiZoomShortcutMac')}</span>
              <kbd className="settings-zoom-kbd">⌘</kbd>
              <kbd className="settings-zoom-kbd">+</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">⌘</kbd>
              <kbd className="settings-zoom-kbd">-</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">⌘</kbd>
              <kbd className="settings-zoom-kbd">0</kbd>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="font-medium text-[var(--color-text-secondary)]">{t('settings.general.uiZoomShortcutWindows')}</span>
              <kbd className="settings-zoom-kbd">Ctrl</kbd>
              <kbd className="settings-zoom-kbd">+</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">Ctrl</kbd>
              <kbd className="settings-zoom-kbd">-</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">Ctrl</kbd>
              <kbd className="settings-zoom-kbd">0</kbd>
            </span>
            <span>{t('settings.general.uiZoomShortcutResetHint')}</span>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="min-w-[48px] rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] px-2 py-1 text-center text-sm font-medium text-[var(--color-text-secondary)]">
            {uiZoomPercent}%
          </span>
          <Button
            variant="secondary"
            size="base"
            aria-label={t('settings.general.uiZoomReset')}
            title={t('settings.general.uiZoomReset')}
            onClick={() => {
              setIsUiZoomDragging(false)
              setUiZoomDraft(UI_ZOOM_DEFAULT)
              setUiZoom(UI_ZOOM_DEFAULT)
            }}
            icon={<RotateCw className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            100%
          </Button>
        </div>
      </div>
      <div
        className={`settings-zoom-control flex items-center gap-3 ${isUiZoomDragging ? 'is-dragging' : ''}`}
        style={{ '--settings-zoom-range-progress': uiZoomRangeProgress } as CSSProperties}
      >
        <span className="w-9 text-right text-xs text-[var(--color-text-tertiary)]">{Math.round(UI_ZOOM_MIN * 100)}%</span>
        <div className="settings-zoom-range-wrap flex-1">
          <div className="settings-zoom-preview" aria-hidden="true">
            {uiZoomPercent}%
          </div>
          <input
            type="range"
            aria-label={t('settings.general.uiZoom')}
            min={UI_ZOOM_MIN}
            max={UI_ZOOM_MAX}
            step={UI_ZOOM_STEP}
            value={uiZoomDraft}
            onPointerDown={() => {
              setUiZoomDraggingState(true)
            }}
            onPointerUp={(e) => commitUiZoom(e.currentTarget.valueAsNumber)}
            onPointerCancel={() => {
              setUiZoomDraggingState(false)
              setUiZoomDraft(uiZoom)
            }}
            onChange={(e) => {
              const nextZoom = Number.isFinite(e.currentTarget.valueAsNumber)
                ? e.currentTarget.valueAsNumber
                : UI_ZOOM_DEFAULT
              setUiZoomDraft(nextZoom)
              if (!isUiZoomDraggingRef.current) {
                setUiZoom(nextZoom)
              }
            }}
            onBlur={(e) => {
              if (uiZoomDraft !== uiZoom) {
                commitUiZoom(e.currentTarget.valueAsNumber)
              } else {
                setUiZoomDraggingState(false)
              }
            }}
            className="settings-zoom-range w-full"
          />
        </div>
        <span className="w-9 text-xs text-[var(--color-text-tertiary)]">{Math.round(UI_ZOOM_MAX * 100)}%</span>
      </div>
    </div>
  )

  return (
    <div className="w-full min-w-0">
      {proxyManagedSettingsWarning && (
        <div
          role="alert"
          className="mb-5 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-container)] px-3 py-2 text-xs leading-5 text-[var(--color-on-warning-container)]"
        >
          {t('settings.general.proxyManagedSettingsWarning')}
        </div>
      )}
      {/* No page header here on purpose: the only title it could carry is the nav
          label verbatim, with no description to add. The pane opens on its first
          section instead. */}
      {/* Appearance selector */}
      <SettingsSection
        title={t('settings.general.appearanceTitle')}
        description={t('settings.general.appearanceDescription')}
      >
        <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
          <Switch
            checked={followSystemTheme}
            onChange={setFollowSystemTheme}
            label={t('settings.general.appearance.followSystem')}
            description={t('settings.general.appearance.followSystemHint')}
          />
        </div>
        {followSystemTheme ? (
          // The OS decides which ground; what is left to choose is the palette
          // on each one, so the picker splits into the two grounds.
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-[12.5px] text-[var(--color-text-tertiary)]">
                {t('settings.general.appearance.lightThemeLabel')}
              </p>
              <div className="flex flex-wrap gap-2">
                {LIGHT_THEMES.map(({ value, label }) => (
                  <SettingsPill
                    key={value}
                    selected={lightTheme === value}
                    onClick={() => void setTheme(value)}
                  >
                    {label}
                  </SettingsPill>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[12.5px] text-[var(--color-text-tertiary)]">
                {t('settings.general.appearance.darkThemeLabel')}
              </p>
              <div className="flex flex-wrap gap-2">
                {DARK_THEMES.map(({ value, label }) => (
                  <SettingsPill
                    key={value}
                    selected={darkTheme === value}
                    onClick={() => void setTheme(value)}
                  >
                    {label}
                  </SettingsPill>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {THEMES.map(({ value, label }) => (
              <SettingsPill
                key={value}
                selected={theme === value}
                onClick={() => void setTheme(value)}
              >
                {label}
              </SettingsPill>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* Language selector */}
      <SettingsSection
        title={t('settings.general.languageTitle')}
        description={t('settings.general.languageDescription')}
      >
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map(({ value, label }) => (
            <SettingsPill
              key={value}
              selected={locale === value}
              onClick={() => setLocale(value)}
            >
              {label}
            </SettingsPill>
          ))}
        </div>
      </SettingsSection>

      {/* Response Language */}
      <h2
        className="text-[16.5px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1"
        style={{ fontFamily: 'var(--font-headline)' }}
      >
        {t('settings.general.responseLangTitle')}
      </h2>
      <p className="text-[13px] leading-5 text-[var(--color-text-tertiary)] mb-3">{t('settings.general.responseLangDescription')}</p>
      <Dropdown<string>
        items={RESPONSE_LANGUAGES}
        value={responseLanguage}
        onChange={(value) => void setResponseLanguage(value)}
        width="100%"
        maxHeight={320}
        className="mb-8 block w-full"
        trigger={
          <Button
            variant="secondary"
            size="md"
            block
            className="h-10 gap-3"
            aria-label={t('settings.general.responseLangTitle')}
          >
            <span className="min-w-0 flex-1 truncate text-left">{selectedResponseLanguageLabel}</span>
            <span className="material-symbols-outlined flex-shrink-0 text-[18px] text-[var(--color-text-secondary)]">expand_more</span>
          </Button>
        }
      />

      {/*
        Only the editors we detect, never every installed application: the menu
        offers one editor slot, and this chooses which. Hidden entirely when none
        are installed — there is nothing to pick between.
      */}
      {detectedEditors.length > 0 && (
        <SettingsSection
          className="mt-8"
          title={t('settings.general.defaultEditorTitle')}
          description={t('settings.general.defaultEditorDescription')}
        >
          <div className="flex flex-wrap gap-2">
            <SettingsPill
              selected={editorTargetId === null}
              onClick={() => setEditorTargetId(null)}
            >
              {t('settings.general.defaultEditorAuto')}
            </SettingsPill>
            {detectedEditors.map((target) => (
              <SettingsPill
                key={target.id}
                selected={editorTargetId === target.id}
                onClick={() => setEditorTargetId(target.id)}
              >
                {target.label}
              </SettingsPill>
            ))}
          </div>
        </SettingsSection>
      )}

      <div className="mt-8">
        <h2 className="text-[16.5px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.notificationsTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.notificationsDescription')}</p>
        <Card radius="xl" surface="low" padding="none" className="px-4 py-3">
          <label className="relative flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              aria-label={t('settings.general.notificationsEnabled')}
              checked={desktopNotificationsEnabled}
              onChange={(e) => void handleDesktopNotificationsToggle(e.target.checked)}
              className={SETTINGS_CHECKBOX_INPUT_CLASS}
            />
            <SettingsCheckboxMark checked={desktopNotificationsEnabled} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.general.notificationsEnabled')}
              </div>
              <div className="text-xs text-[var(--color-text-tertiary)] mt-1 leading-5">
                {desktopNotificationsEnabled
                  ? t('settings.general.notificationsHintOn')
                  : t('settings.general.notificationsHintOff')}
              </div>
            </div>
          </label>
          {desktopNotificationsEnabled && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-border-separator)] pt-3">
              <div className="min-w-0 text-xs text-[var(--color-text-tertiary)]">
                {t('settings.general.notificationsStatus')}: {notificationStatusLabel[notificationPermission]}
              </div>
              {notificationPermission !== 'granted' && notificationPermission !== 'unsupported' && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="px-3 whitespace-nowrap"
                  disabled={notificationActionRunning}
                  onClick={() => void handleNotificationPermissionAction()}
                >
                  {notificationPermission === 'denied'
                    ? t('settings.general.notificationsOpenSettings')
                    : t('settings.general.notificationsAuthorize')}
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="text-[16.5px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.chatSendBehaviorTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.chatSendBehaviorDescription')}</p>
        <Card radius="xl" surface="low" padding="none" className="grid grid-cols-2 gap-2 p-2">
          {CHAT_SEND_BEHAVIORS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => void setChatSendBehavior(option.value)}
              aria-pressed={chatSendBehavior === option.value}
              className={`rounded-[var(--radius-lg)] border px-3 py-2 text-left transition-colors ${
                chatSendBehavior === option.value
                  ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <div className="text-xs font-semibold">{option.label}</div>
              <div className="mt-1 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
                {option.description}
              </div>
            </button>
          ))}
        </Card>
      </div>

      {uiZoomSection}

      <ChatAppearanceSettings />
    </div>
  )
}
