import { H5Settings } from './settings/H5Settings'
import { getDesktopHost } from '@/lib/desktopHost'
import { useEffect, useRef } from 'react'
import { SettingsPageHeader } from '@/components/settings/SettingsSection'
import { AdapterSettings } from './AdapterSettings'
import { useSkillStore } from '../stores/skillStore'
import { SkillList } from '../components/skills/SkillList'
import { SkillDetail } from '../components/skills/SkillDetail'
import { usePluginStore } from '../stores/pluginStore'
import { PluginList } from '../components/plugins/PluginList'
import { PluginDetail } from '../components/plugins/PluginDetail'
import { ComputerUseSettings } from './ComputerUseSettings'
import { McpSettings } from './McpSettings'
import { TerminalSettings } from './TerminalSettings'
import { DiagnosticsSettings } from './DiagnosticsSettings'
import { TraceList } from './TraceList'
import { ActivitySettings } from './ActivitySettings'
import { MemorySettings } from './MemorySettings'
import { PetSettings } from '../features/pets/PetSettings'
import { useUIStore } from '../stores/uiStore'
import { AgentManager } from '../components/settings/AgentManager'
import { H5AccessSettings } from './settings/H5AccessSettings'
import { GeneralSettings } from './settings/GeneralSettings'
import { NetworkSettings } from './settings/NetworkSettings'
import { DataSettings } from './settings/DataSettings'
import { RuntimeSettings } from './settings/RuntimeSettings'
import { VoiceInputSettings } from './settings/VoiceInputSettings'
import { AboutSettings } from './settings/AboutSettings'
import { ProviderSettings } from './settings/ProviderSettings'
import { useTranslation, type TranslationKey } from '../i18n'
import type { SettingsTab } from '../stores/uiStore'

const SETTINGS_NAV = [
  { group: 'settings.navGroup.models', tabs: [{ id: 'providers', icon: 'dns', label: 'settings.tab.providers' }, { id: 'runtime', icon: 'memory', label: 'settings.tab.runtime' }] },
  { group: 'settings.navGroup.preferences', tabs: [{ id: 'general', icon: 'tune', label: 'settings.tab.general' }, { id: 'network', icon: 'lan', label: 'settings.tab.network' }, { id: 'data', icon: 'database', label: 'settings.tab.data' }, { id: 'voice', icon: 'mic', label: 'settings.tab.voice' }, { id: 'pets', icon: 'pets', label: 'settings.tab.pets' }] },
  { group: 'settings.navGroup.capabilities', tabs: [{ id: 'agents', icon: 'smart_toy', label: 'settings.tab.agents' }, { id: 'skills', icon: 'auto_awesome', label: 'settings.tab.skills' }, { id: 'plugins', icon: 'extension', label: 'settings.tab.plugins' }, { id: 'mcp', icon: 'hub', label: 'settings.tab.mcp' }, { id: 'memory', icon: 'history_edu', label: 'settings.tab.memory' }, { id: 'computerUse', icon: 'mouse', label: 'settings.tab.computerUse' }] },
  { group: 'settings.navGroup.access', tabs: [{ id: 'h5Access', icon: 'qr_code_2', label: 'settings.tab.h5Access' }, { id: 'adapters', icon: 'chat', label: 'settings.tab.adapters' }] },
  { group: 'settings.navGroup.tools', tabs: [{ id: 'terminal', icon: 'terminal', label: 'settings.tab.terminal' }, { id: 'activity', icon: 'monitoring', label: 'settings.tab.activity' }, { id: 'trace', icon: 'account_tree', label: 'settings.tab.trace' }, { id: 'diagnostics', icon: 'monitor_heart', label: 'settings.tab.diagnostics' }] },
  { group: null, tabs: [{ id: 'about', icon: 'info', label: 'settings.tab.about' }] },
] as const satisfies ReadonlyArray<{ group: TranslationKey | null; tabs: ReadonlyArray<{ id: SettingsTab; icon: string; label: TranslationKey }> }>

export function Settings() {
  return getDesktopHost().isDesktop ? <DesktopSettings /> : <H5Settings />
}

export function DesktopSettings() {
  const activeTab = useUIStore((s) => s.activeSettingsTab)
  const setActiveTab = useUIStore((s) => s.setActiveSettingsTab)
  const pendingSettingsTab = useUIStore((s) => s.pendingSettingsTab)
  const t = useTranslation()

  useEffect(() => {
    if (!pendingSettingsTab) return
    setActiveTab(pendingSettingsTab)
    useUIStore.getState().setPendingSettingsTab(null)
  }, [pendingSettingsTab, setActiveTab])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
      <div className="flex-1 flex overflow-hidden">
        <div
          data-testid="settings-navigation"
          className="w-[195px] flex-shrink-0 flex flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] py-4 pl-3 pr-1"
        >
          <div className="flex-1 flex flex-col gap-0.5">
            {SETTINGS_NAV.filter((group) => group.group !== null).map(({ group, tabs }, index) => {
              const headingId = `settings-nav-group-${index}`
              return (
                <div key={group} role="group" aria-labelledby={headingId}>
                  <h3 id={headingId} className={`px-3 ${index === 0 ? '' : 'pt-3'} pb-1 text-[11.5px] font-medium text-[var(--color-text-tertiary)]`}>{t(group!)}</h3>
                  {tabs.map((tab) => (
                    <TabButton key={tab.id} icon={tab.icon} label={t(tab.label)} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} tabId={tab.id} />
                  ))}
                </div>
              )
            })}
          </div>
          <div className="mt-2 border-t border-[var(--color-border-separator)] pt-2">
            {SETTINGS_NAV[SETTINGS_NAV.length - 1]!.tabs.map((tab) => (
              <TabButton key={tab.id} icon={tab.icon} label={t(tab.label)} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} tabId={tab.id} />
            ))}
          </div>
        </div>

        <div className={activeTab === 'trace' ? 'flex-1 flex min-h-0 flex-col overflow-hidden' : 'flex-1 overflow-y-auto px-9 py-8'}>
          {activeTab === 'providers' && <ProviderSettings />}
          {activeTab === 'activity' && <ActivitySettings />}
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'network' && <NetworkSettings />}
          {activeTab === 'data' && <DataSettings />}
          {activeTab === 'runtime' && <RuntimeSettings />}
          {activeTab === 'voice' && <VoiceInputSettings />}
          {activeTab === 'h5Access' && <H5AccessSettings />}
          {activeTab === 'adapters' && <AdapterSettings />}
          {activeTab === 'terminal' && <TerminalSettings showPreferences />}
          {activeTab === 'mcp' && <McpSettings />}
          {activeTab === 'agents' && <AgentManager />}
          {activeTab === 'skills' && <SkillSettings />}
          {activeTab === 'memory' && <MemorySettings />}
          {activeTab === 'plugins' && <PluginSettings />}
          {activeTab === 'pets' && <PetSettings />}
          {activeTab === 'computerUse' && <ComputerUseSettings />}
          {activeTab === 'trace' && <TraceList />}
          {activeTab === 'diagnostics' && <DiagnosticsSettings />}
          {activeTab === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function TabButton({ icon, label, active, onClick, tabId }: { icon: string; label: string; active: boolean; onClick: () => void; tabId?: SettingsTab }) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!active) return
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={ref}
      onClick={onClick}
      data-settings-tab={tabId}
      aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center gap-2.5 rounded-[var(--radius-md)] py-2 pl-3 pr-2 text-[13.5px] text-left transition-[background-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] ${
        active
          ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] font-medium'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <span
        className={`material-symbols-outlined text-[18px] ${active ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

function SkillSettings() {
  const selectedSkill = useSkillStore((s) => s.selectedSkill)
  const t = useTranslation()

  if (selectedSkill) {
    return <div className="w-full min-w-0"><SkillDetail /></div>
  }

  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader title={t('settings.skills.title')} description={t('settings.skills.description')} />
      <SkillList />
    </div>
  )
}

function PluginSettings() {
  const selectedPlugin = usePluginStore((s) => s.selectedPlugin)
  const t = useTranslation()

  if (selectedPlugin) {
    return <div className="w-full min-w-0"><PluginDetail /></div>
  }

  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader title={t('settings.plugins.title')} description={t('settings.plugins.description')} />
      <PluginList />
    </div>
  )
}
