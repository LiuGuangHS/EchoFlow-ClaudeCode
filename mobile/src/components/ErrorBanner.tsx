import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../lib/i18n'

type ErrorBannerProps = {
  message: string
  onRetry?: () => void
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
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

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderBottomColor: '#fecaca',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  message: {
    color: '#991b1b',
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  retryButton: {
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  retryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
})
