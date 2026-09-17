import { useEffect, useRef } from 'react'
import { Animated, Platform, StatusBar, StyleSheet, Text } from 'react-native'
import type { WsConnectionStatus } from '../lib/webViewBridge'

type ConnectionSnackbarProps = {
  status: WsConnectionStatus | null
}

export function ConnectionSnackbar({ status }: ConnectionSnackbarProps) {
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
          ? '与服务器连接已断开，请重新加载页面。'
          : '正在重新连接...'}
      </Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
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
    backgroundColor: '#dc2626',
  },
  reconnecting: {
    backgroundColor: '#d97706',
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
})
