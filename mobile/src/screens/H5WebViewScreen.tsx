import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebViewNavigation } from 'react-native-webview'
import { ConnectionSnackbar } from '../components/ConnectionSnackbar'
import { ErrorBanner } from '../components/ErrorBanner'
import { PermissionModal } from '../components/PermissionModal'
import { PermissionClient } from '../lib/permissionClient'
import type { PermissionRequest } from '../lib/permissionClient'
import { createFilePickerScript, isFilePickRequest, launchNativeFilePicker } from '../lib/filePickerBridge'
import { createWsMonitorScript, isWsBridgeMessage } from '../lib/webViewBridge'
import type { Credentials } from '../lib/types'
import type { WsConnectionStatus } from '../lib/webViewBridge'

type H5WebViewScreenProps = {
  credentials: Credentials
  onDisconnect: () => Promise<void>
}

function buildLaunchUrl({ serverUrl, h5Token }: Credentials): string {
  return `${serverUrl}/?serverUrl=${encodeURIComponent(serverUrl)}&h5Token=${encodeURIComponent(h5Token)}`
}

export function H5WebViewScreen({ credentials, onDisconnect }: H5WebViewScreenProps) {
  const webViewRef = useRef<WebView>(null)
  const permissionClientRef = useRef<PermissionClient | null>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [pendingRequests, setPendingRequests] = useState<PermissionRequest[]>([])
  const launchUrl = useMemo(() => buildLaunchUrl(credentials), [credentials])
  const wsMonitorScript = useMemo(() => createWsMonitorScript(), [])
  const filePickerScript = useMemo(() => createFilePickerScript(), [])
  const combinedInjectedScript = useMemo(
    () => `${wsMonitorScript}\n${filePickerScript}`,
    [wsMonitorScript, filePickerScript],
  )

  // Cleanup permission client on unmount or disconnect
  const disconnectPermissionClient = useCallback(() => {
    permissionClientRef.current?.disconnect()
    permissionClientRef.current = null
    setPendingRequests([])
    setSessionId(null)
  }, [])

  // Connect permission client when sessionId is available
  useEffect(() => {
    if (!sessionId) {
      disconnectPermissionClient()
      return
    }

    // Avoid duplicate connections for the same session
    if (permissionClientRef.current) {
      disconnectPermissionClient()
    }

    const client = new PermissionClient(
      credentials.serverUrl,
      credentials.h5Token,
      sessionId,
      {
        onPermissionRequest: (req) => {
          setPendingRequests((prev) => [...prev, req])
        },
        onPermissionCancelled: (requestId) => {
          setPendingRequests((prev) => prev.filter((r) => r.requestId !== requestId))
        },
        onDisconnect: () => {
          // The server-side WebSocket closed — no cleanup needed here,
          // a new sessionId will trigger reconnection.
        },
      },
    )

    client.connect()
    permissionClientRef.current = client

    return () => {
      client.disconnect()
    }
  }, [sessionId, credentials, disconnectPermissionClient])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      permissionClientRef.current?.disconnect()
    }
  }, [])

  const handleNavigationStateChange = (state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack)
  }

  const handleBack = () => {
    if (canGoBack) {
      webViewRef.current?.goBack()
      return
    }

    webViewRef.current?.reload()
  }

  const handleBridgeMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data)
      if (isWsBridgeMessage(msg)) {
        setWsStatus(msg.status)
        if (msg.sessionId && msg.status === 'connected') {
          setSessionId(msg.sessionId)
        }
        if (msg.status === 'disconnected') {
          disconnectPermissionClient()
        }
        return
      }
      if (isFilePickRequest(msg)) {
        launchNativeFilePicker().then((result) => {
          if (result) {
            webViewRef.current?.injectJavaScript(result.injectScript)
          }
        })
      }
    } catch {
      // Ignore non-JSON or malformed messages
    }
  }

  const handleDisconnect = async () => {
    disconnectPermissionClient()
    await onDisconnect()
  }

  const handlePermissionAllow = useCallback((request: PermissionRequest) => {
    permissionClientRef.current?.respond(request.requestId, true)
    setPendingRequests((prev) => prev.filter((r) => r.requestId !== request.requestId))
  }, [])

  const handlePermissionDeny = useCallback((request: PermissionRequest) => {
    permissionClientRef.current?.respond(request.requestId, false)
    setPendingRequests((prev) => prev.filter((r) => r.requestId !== request.requestId))
  }, [])

  // Show the first pending permission request
  const activeRequest = pendingRequests.length > 0 ? pendingRequests[0] : null

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <ConnectionSnackbar status={wsStatus} />

      <View style={styles.toolbar}>
        <View style={styles.toolbarTextGroup}>
          <Text style={styles.title}>CodeMobile</Text>
          <Text numberOfLines={1} style={styles.subtitle}>{credentials.serverUrl}</Text>
        </View>
        <Pressable accessibilityLabel={canGoBack ? '返回' : '重新加载'} onPress={handleBack} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{canGoBack ? '返回' : '重载'}</Text>
        </Pressable>
        <Pressable accessibilityLabel="断开连接" onPress={handleDisconnect} style={styles.dangerButton}>
          <Text style={styles.dangerButtonText}>断开</Text>
        </Pressable>
      </View>

      {error ? (
        <ErrorBanner
          message={error}
          onRetry={() => webViewRef.current?.reload()}
        />
      ) : null}

      <View style={styles.webViewWrap}>
        <WebView
          ref={webViewRef}
          source={{ uri: launchUrl }}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['http://*', 'https://*']}
          mixedContentMode="always"
          onLoadStart={() => {
            setLoading(true)
            setError('')
            setWsStatus(null)
            disconnectPermissionClient()
          }}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={handleNavigationStateChange}
          onError={(event) => {
            setLoading(false)
            setError(event.nativeEvent.description || '无法加载 EchoFlow H5。')
          }}
          onHttpError={(event) => {
            setLoading(false)
            setError(`H5 返回 HTTP ${event.nativeEvent.statusCode}。`)
          }}
          style={styles.webView}
          injectedJavaScript={combinedInjectedScript}
          onMessage={handleBridgeMessage}
        />
        {loading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>正在加载 EchoFlow H5...</Text>
          </View>
        ) : null}
      </View>

      {activeRequest ? (
        <PermissionModal
          request={activeRequest}
          onAllow={() => handlePermissionAllow(activeRequest)}
          onDeny={() => handlePermissionDeny(activeRequest)}
        />
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
  },
  toolbar: {
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderBottomColor: '#1e293b',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  toolbarTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#7f1d1d',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dangerButtonText: {
    color: '#fee2e2',
    fontSize: 12,
    fontWeight: '700',
  },
  webViewWrap: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  loadingText: {
    color: '#334155',
    fontSize: 14,
    marginTop: 12,
  },
})