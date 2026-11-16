import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SettingsBlock, SettingsGroup, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { useTranslation } from '@/i18n'
import { getDesktopHost } from '@/lib/desktopHost'
import { PRODUCT_IDENTITY } from '@/lib/productIdentity.generated'
import { mobileAppLinks } from './mobileAppLinks'

type MobileAppInstallProps = {
  connectionMethodsId: string
  onUseBrowser: () => void
}

function openExternal(url: string) {
  void getDesktopHost().shell.open(url).catch(() => window.open(url, '_blank', 'noopener'))
}

export function MobileAppInstall({ connectionMethodsId, onUseBrowser }: MobileAppInstallProps) {
  const t = useTranslation()
  const { android, testFlight, guide } = mobileAppLinks
  const productName = PRODUCT_IDENTITY.name
  return (
    <SettingsSection title={t('mobileApp.title', { productName })} description={t('mobileApp.intro', { productName })}>
      <SettingsGroup>
        <SettingsRow title={t('mobileApp.android')} description={t(android ? 'mobileApp.androidAvailable' : 'mobileApp.androidPending')}>
          <Button size="base" variant="secondary" onClick={() => openExternal(android ?? guide)}>{t(android ? 'mobileApp.downloadAndroid' : 'mobileApp.availabilityGuide')}</Button>
        </SettingsRow>
        <SettingsRow title={t('mobileApp.ios')} description={t(testFlight ? 'mobileApp.iosAvailable' : 'mobileApp.iosPending')}>
          {testFlight
            ? <Button size="base" variant="secondary" onClick={() => openExternal(testFlight)}>{t('mobileApp.joinTestFlight')}</Button>
            : (
              <>
                <Badge tone="neutral" size="sm">{t('mobileApp.invitePending')}</Badge>
                <Button size="base" variant="secondary" disabled>{t('mobileApp.joinTestFlight')}</Button>
              </>
            )}
        </SettingsRow>
        <SettingsRow title={t('mobileApp.browserTitle')} description={t('mobileApp.browserHint', { productName })}>
          <Button size="base" aria-controls={connectionMethodsId} onClick={onUseBrowser}>{t('mobileApp.useBrowser')}</Button>
        </SettingsRow>
        <SettingsBlock>
          <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">{t('mobileApp.connectionHint', { productName })}</p>
        </SettingsBlock>
      </SettingsGroup>
    </SettingsSection>
  )
}
