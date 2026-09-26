import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../lib/i18n'
import { useTheme } from '../lib/theme'

type ErrorBannerProps = {
  message: string
  onRetry?: () => void
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityLabel={t('error.retry')}
          onPress={onRetry}
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>{t('error.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: theme.dangerBg,
    borderBottomColor: theme.dangerBorder,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  message: {
    color: theme.dangerText,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  retryButton: {
    backgroundColor: theme.dangerButtonBg,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  retryText: {
    color: theme.dangerButtonText,
    fontSize: 12,
    fontWeight: '700',
  },
  })
}
