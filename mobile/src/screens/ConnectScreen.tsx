import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { QrCameraModal } from '../components/QrCameraModal'
import { ServerChipList } from '../components/ServerChipList'
import { isPlainHttp, isPrivateLanHttp, normalizeServerUrl, verifyH5Connection } from '../lib/h5Access'
import { parseLaunchUrl } from '../lib/qrScanner'
import { addRecentServer, getRecentServers } from '../lib/recentServers'
import { useTheme } from '../lib/theme'
import { t } from '../lib/i18n'
import type { Credentials } from '../lib/types'

type ConnectScreenProps = {
  initialServerUrl?: string
  error?: string
  onConnected: (credentials: Credentials) => Promise<void>
}

export function ConnectScreen({ initialServerUrl = '', error: initialError, onConnected }: ConnectScreenProps) {
  const theme = useTheme()
  const styles = useMemo(() => createStyles(theme), [theme])
  const [serverUrl, setServerUrl] = useState(initialServerUrl)
  const [h5Token, setH5Token] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [cameraVisible, setCameraVisible] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [recentServers, setRecentServers] = useState<string[]>([])
  const [clipboardCredentials, setClipboardCredentials] = useState<Credentials | null>(null)

  useEffect(() => {
    let mounted = true
    getRecentServers().then((servers) => {
      if (mounted) setRecentServers(servers)
    })
    return () => { mounted = false }
  }, [])

  // Check clipboard for a CodeMobile launch URL on mount
  useEffect(() => {
    let mounted = true
    Clipboard.getStringAsync().then((text) => {
      if (!mounted) return
      const parsed = parseLaunchUrl(text)
      if (parsed) {
        setClipboardCredentials(parsed)
      }
    }).catch(() => {
      // Clipboard access denied or unavailable — ignore
    })
    return () => { mounted = false }
  }, [])

  const normalizedPreview = useMemo(() => {
    try {
      return normalizeServerUrl(serverUrl)
    } catch {
      return null
    }
  }, [serverUrl])

  const showHttpWarning = normalizedPreview ? isPlainHttp(normalizedPreview) : false
  const showNonLanHttpWarning = normalizedPreview
    ? isPlainHttp(normalizedPreview) && !isPrivateLanHttp(normalizedPreview)
    : false
  const canSubmit = Boolean(normalizedPreview && h5Token.trim()) && !submitting

  const handleConnect = async () => {
    if (!canSubmit) return

    setSubmitting(true)
    setError('')

    try {
      const normalizedServerUrl = await Promise.race([
        verifyH5Connection(serverUrl, h5Token),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(t('connect.timeout'))), 10_000),
        ),
      ])
      await addRecentServer(normalizedServerUrl)
      await onConnected({ serverUrl: normalizedServerUrl, h5Token: h5Token.trim() })
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : t('connect.unableToConnect'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleScan = useCallback((data: string) => {
    const parsed = parseLaunchUrl(data)
    if (!parsed) {
      setCameraError(t('connect.qrInvalid'))
      return
    }
    setCameraVisible(false)
    setCameraError('')
    setServerUrl(parsed.serverUrl)
    setH5Token(parsed.h5Token)
    setError('')
  }, [])

  const handleCloseCamera = useCallback(() => {
    setCameraVisible(false)
    setCameraError('')
  }, [])

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{t('connect.eyebrow')}</Text>
          <Text style={styles.title}>{t('connect.title')}</Text>
          <Text style={styles.description}>
            {t('connect.description')}
          </Text>

          <Pressable
            accessibilityLabel={t('connect.scanQr')}
            onPress={() => { setCameraVisible(true); setCameraError('') }}
            style={styles.scanButton}
          >
            <Text style={styles.scanButtonText}>{t('connect.scanQr')}</Text>
          </Pressable>

          {clipboardCredentials ? (
            <View style={styles.clipboardBanner}>
              <Text style={styles.clipboardBannerText} numberOfLines={1}>
                {t('connect.clipboardDetected')} {clipboardCredentials.serverUrl}
              </Text>
              <Pressable
                accessibilityLabel={t('connect.clipboardFill')}
                onPress={() => {
                  setServerUrl(clipboardCredentials.serverUrl)
                  setH5Token(clipboardCredentials.h5Token)
                  setClipboardCredentials(null)
                  setError('')
                }}
                style={styles.clipboardFillButton}
              >
                <Text style={styles.clipboardFillButtonText}>{t('connect.clipboardFill')}</Text>
              </Pressable>
            </View>
          ) : null}

          <ServerChipList
            servers={recentServers}
            onSelect={(url) => { setServerUrl(url); setError('') }}
          />

          <Text style={styles.label}>{t('connect.serverUrlLabel')}</Text>
          <TextInput
            accessibilityLabel={t('connect.serverUrlLabel')}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            onChangeText={setServerUrl}
            placeholder="http://192.168.1.10:3456"
            style={styles.input}
            value={serverUrl}
          />

          <Text style={styles.label}>{t('connect.h5TokenLabel')}</Text>
          <TextInput
            accessibilityLabel={t('connect.h5TokenLabel')}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setH5Token}
            placeholder="h5_..."
            secureTextEntry
            style={styles.input}
            value={h5Token}
          />

          {showHttpWarning ? (
            <View style={[styles.notice, showNonLanHttpWarning ? styles.dangerNotice : styles.warningNotice]}>
              <Text style={styles.noticeText}>
                {showNonLanHttpWarning
                  ? t('connect.warningNonLan')
                  : t('connect.warningLan')}
              </Text>
            </View>
          ) : null}

          {error ? (
            <View style={[styles.notice, styles.errorNotice]}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityLabel={t('connect.connect')}
            disabled={!canSubmit}
            onPress={handleConnect}
            style={({ pressed }) => [
              styles.button,
              !canSubmit ? styles.buttonDisabled : null,
              pressed && canSubmit ? styles.buttonPressed : null,
            ]}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('connect.connect')}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <QrCameraModal
        visible={cameraVisible}
        onClose={handleCloseCamera}
        onScan={handleScan}
        scanError={cameraError}
      />
    </SafeAreaView>
  )
}

function createStyles(t: typeof import('../lib/theme').lightColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: t.background,
      paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
    },
    container: {
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
    card: {
      borderRadius: 24,
      backgroundColor: t.surface,
      borderColor: t.surfaceBorder,
      borderWidth: t.surfaceBorder !== 'transparent' ? 1 : 0,
      padding: 24,
      shadowColor: t.shadowColor,
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.12,
      shadowRadius: 32,
      elevation: 6,
    },
    eyebrow: {
      color: t.primary,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      marginBottom: 8,
      textTransform: 'uppercase',
    },
    title: {
      color: t.text,
      fontSize: 26,
      fontWeight: '800',
      marginBottom: 10,
    },
    description: {
      color: t.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 24,
    },
    label: {
      color: t.textMuted,
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 14,
      color: t.inputText,
      backgroundColor: t.inputBg,
      fontSize: 16,
      marginBottom: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    notice: {
      borderRadius: 14,
      marginBottom: 16,
      padding: 12,
    },
    warningNotice: {
      backgroundColor: t.warningBg,
      borderColor: t.warningBorder,
      borderWidth: 1,
    },
    dangerNotice: {
      backgroundColor: t.dangerBg,
      borderColor: t.dangerBorder,
      borderWidth: 1,
    },
    errorNotice: {
      backgroundColor: t.dangerBg,
      borderColor: t.dangerBorder,
      borderWidth: 1,
    },
    noticeText: {
      color: t.warningText,
      fontSize: 13,
      lineHeight: 19,
    },
    errorText: {
      color: t.dangerText,
      fontSize: 13,
      lineHeight: 19,
    },
    button: {
      alignItems: 'center',
      backgroundColor: t.primary,
      borderRadius: 14,
      minHeight: 48,
      justifyContent: 'center',
    },
    scanButton: {
      alignItems: 'center',
      backgroundColor: t.scanButtonBg,
      borderColor: t.scanButtonBorder,
      borderRadius: 14,
      borderWidth: 1.5,
      marginBottom: 16,
      paddingVertical: 12,
    },
    scanButtonText: {
      color: t.primary,
      fontSize: 15,
      fontWeight: '700',
    },
    clipboardBanner: {
      alignItems: 'center',
      backgroundColor: t.clipboardBg,
      borderColor: t.clipboardBorder,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
      padding: 10,
    },
    clipboardBannerText: {
      color: t.clipboardText,
      flex: 1,
      fontSize: 12,
      fontWeight: '600',
    },
    clipboardFillButton: {
      backgroundColor: '#16a34a',
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    clipboardFillButtonText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '700',
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    buttonPressed: {
      backgroundColor: t.primaryPressed,
    },
    buttonText: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: '800',
    },
  })
}
