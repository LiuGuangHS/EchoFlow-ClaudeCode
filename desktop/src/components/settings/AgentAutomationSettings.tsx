import { useState } from 'react'

import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import type { AutoQuestionSettings } from '../../../../src/shared/autoQuestionSettings'
import { AUTO_QUESTION_TIMEOUT_OPTIONS } from '../../../../src/shared/autoQuestionSettings'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SelectField } from '@/components/ui/SelectField'
import { Switch } from '@/components/ui/Switch'
import { SettingsSection } from '@/components/settings/SettingsSection'

export function AgentAutomationSettings() {
  const t = useTranslation()
  const addToast = useUIStore((state) => state.addToast)
  const workflowKeywordTriggerEnabled = useSettingsStore((state) => state.workflowKeywordTriggerEnabled)
  const setWorkflowKeywordTriggerEnabled = useSettingsStore((state) => state.setWorkflowKeywordTriggerEnabled)
  const agentTeamsEnabled = useSettingsStore((state) => state.agentTeamsEnabled)
  const setAgentTeamsEnabled = useSettingsStore((state) => state.setAgentTeamsEnabled)
  const autoQuestion = useSettingsStore((state) => state.autoQuestion)
  const setAutoQuestion = useSettingsStore((state) => state.setAutoQuestion)
  const autoDreamEnabled = useSettingsStore((state) => state.autoDreamEnabled)
  const setAutoDreamEnabled = useSettingsStore((state) => state.setAutoDreamEnabled)
  const [agentTeamsSaving, setAgentTeamsSaving] = useState(false)
  const [autoDreamConfirmOpen, setAutoDreamConfirmOpen] = useState(false)
  const [autoDreamActionRunning, setAutoDreamActionRunning] = useState(false)

  const handleAgentTeamsChange = async (enabled: boolean) => {
    if (agentTeamsSaving) return
    setAgentTeamsSaving(true)
    try {
      await setAgentTeamsEnabled(enabled)
    } catch {
      addToast({ type: 'error', message: t('settings.general.agentTeamsSaveFailed') })
    } finally {
      setAgentTeamsSaving(false)
    }
  }

  const updateAutoQuestion = (next: AutoQuestionSettings) => {
    void setAutoQuestion(next).catch(() => {
      addToast({ type: 'error', message: t('settings.general.autoQuestionSaveFailed') })
    })
  }

  const handleAutoDreamToggle = (enabled: boolean) => {
    if (enabled) {
      setAutoDreamConfirmOpen(true)
      return
    }
    void setAutoDreamEnabled(false)
  }

  const confirmAutoDreamEnable = async () => {
    setAutoDreamActionRunning(true)
    try {
      await setAutoDreamEnabled(true)
      setAutoDreamConfirmOpen(false)
    } finally {
      setAutoDreamActionRunning(false)
    }
  }

  return (
    <>
      <div className="mb-8 grid min-w-0 gap-6 xl:grid-cols-2">
        <SettingsSection
          title={t('settings.general.workflowKeywordTitle')}
          description={t('settings.general.workflowKeywordDescription')}
        >
          <Switch
            checked={workflowKeywordTriggerEnabled}
            onChange={(enabled) => void setWorkflowKeywordTriggerEnabled(enabled)}
            label={t('settings.general.workflowKeywordEnabled')}
            description={t('settings.general.workflowKeywordHint')}
          />
        </SettingsSection>
        <SettingsSection
          title={t('settings.general.agentTeamsTitle')}
          description={t('settings.general.agentTeamsDescription')}
        >
          <Switch
            checked={agentTeamsEnabled}
            onChange={(enabled) => void handleAgentTeamsChange(enabled)}
            disabled={agentTeamsSaving}
            label={t('settings.general.agentTeamsEnabled')}
            description={t('settings.general.agentTeamsHint')}
          />
        </SettingsSection>
        <SettingsSection
          title={t('settings.general.autoQuestionTitle')}
          description={t('settings.general.autoQuestionDescription')}
        >
          <Switch
            checked={autoQuestion.enabled}
            onChange={(enabled) => updateAutoQuestion({ ...autoQuestion, enabled })}
            label={t('settings.general.autoQuestionEnabled')}
            description={t('settings.general.autoQuestionHint')}
          />
          {autoQuestion.enabled && (
            <div className="mt-4">
              <SelectField
                label={t('settings.general.autoQuestionTimeout')}
                value={String(autoQuestion.timeoutMinutes)}
                options={AUTO_QUESTION_TIMEOUT_OPTIONS.map((minutes) => ({
                  value: String(minutes),
                  label: t('settings.general.autoQuestionMinutes', { count: minutes }),
                }))}
                onChange={(value) => updateAutoQuestion({ ...autoQuestion, timeoutMinutes: Number(value) })}
              />
            </div>
          )}
        </SettingsSection>
        <SettingsSection
          title={t('settings.general.autoDreamTitle')}
          description={t('settings.general.autoDreamDescription')}
        >
          <Switch
            checked={autoDreamEnabled}
            onChange={handleAutoDreamToggle}
            label={t('settings.general.autoDreamEnabled')}
            description={autoDreamEnabled
              ? t('settings.general.autoDreamHintOn')
              : t('settings.general.autoDreamHintOff')}
          />
        </SettingsSection>
      </div>
      <ConfirmDialog
        open={autoDreamConfirmOpen}
        onClose={() => {
          if (!autoDreamActionRunning) setAutoDreamConfirmOpen(false)
        }}
        onConfirm={() => void confirmAutoDreamEnable()}
        title={t('settings.general.autoDreamConfirmTitle')}
        body={(
          <div className="space-y-2">
            <p>{t('settings.general.autoDreamConfirmKeepRunning')}</p>
            <p>{t('settings.general.autoDreamConfirmTokenCost')}</p>
          </div>
        )}
        confirmLabel={t('settings.general.autoDreamConfirmEnable')}
        cancelLabel={t('common.cancel')}
        confirmVariant="primary"
        loading={autoDreamActionRunning}
      />
    </>
  )
}
