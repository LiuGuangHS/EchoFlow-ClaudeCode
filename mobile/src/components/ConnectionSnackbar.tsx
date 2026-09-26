import { useEffect, useRef } from 'react'
import { Animated, Platform, StatusBar, StyleSheet, Text } from 'react-native'
import type { WsConnectionStatus } from '../lib/webViewBridge'
import { useTheme } from '../lib/theme'
import { t } from '../lib/i18n'

type ConnectionSnackbarProps = {
  status: WsConnectionStatus | null
}

export function ConnectionSnackbar({ status }: ConnectionSnackbarProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const translateY = useRef(new Animated.Value(-100)).current

  useEffect(() => {
    const visible = status === 'disconnected' || status === 'reconnecting'
    Animated.spring(translateY, {
      toValue: visible ? 0 : -100,
      useNativeDriver: true,
      tension: 80,
      friction: 11,
    }).start()
  }, [status, translateY])

  if (!status || status === 'connected') return null

  const isDisconnected = status === 'disconnected'

  return (
    <Animated.View
      style={[
        styles.container,
        isDisconnected ? styles.disconnected : styles.reconnecting,
        { transform: [{ translateY }] },
      ]}
      accessibilityLabel={isDisconnected ? 'WebSocket 已断开' : 'WebSocket 正在重连'}
    >
      <Text style={styles.text}>
        {isDisconnected
          ? t('snackbar.disconnected')
          : t('snackbar.reconnecting')}
      </Text>
    </Animated.View>
  )
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
  container: {
    alignItems: 'center',
    left: 0,
    paddingHorizontal: 16,
    paddingVertical: 10,
    position: 'absolute',
    right: 0,
    top: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
    zIndex: 100,
  },
  disconnected: {
    backgroundColor: theme.dangerText,
  },
  reconnecting: {
    backgroundColor: theme.warningText,
  },
  text: {
    color: theme.toolbarText,
    fontSize: 13,
    fontWeight: '700',
  },
  })
}
