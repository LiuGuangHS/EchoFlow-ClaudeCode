import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, StyleSheet, Text } from 'react-native'
import { clearCredentials, loadCredentials, saveCredentials } from './src/lib/credentials'
import type { Credentials } from './src/lib/types'
import { useTheme } from './src/lib/theme'
import { ConnectScreen } from './src/screens/ConnectScreen'
import { H5WebViewScreen } from './src/screens/H5WebViewScreen'

type CodeMobileState =
  | { status: 'loading' }
  | { status: 'connect'; initialServerUrl?: string; error?: string }
  | { status: 'webview'; credentials: Credentials }

export default function App() {
  const theme = useTheme()
  const styles = useMemo(() => createStyles(theme), [theme])
  const [state, setState] = useState<CodeMobileState>({ status: 'loading' })

  useEffect(() => {
    let mounted = true

    loadCredentials()
      .then((credentials) => {
        if (!mounted) return
        setState(credentials ? { status: 'webview', credentials } : { status: 'connect' })
      })
      .catch((error) => {
        if (!mounted) return
        setState({
          status: 'connect',
          error: error instanceof Error ? error.message : 'Unable to load saved CodeMobile credentials.',
        })
      })

    return () => {
      mounted = false
    }
  }, [])

  const handleConnected = async (credentials: Credentials) => {
    await saveCredentials(credentials)
    setState({ status: 'webview', credentials })
  }

  const handleDisconnect = async () => {
    const initialServerUrl = state.status === 'webview' ? state.credentials.serverUrl : undefined
    await clearCredentials()
    setState({ status: 'connect', initialServerUrl })
  }

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator color="#2563eb" size="large" />
        <Text style={styles.loadingText}>Loading EchoFlow CodeMobile...</Text>
      </SafeAreaView>
    )
  }

  if (state.status === 'webview') {
    return <H5WebViewScreen credentials={state.credentials} onDisconnect={handleDisconnect} />
  }

  return (
    <ConnectScreen
      error={state.error}
      initialServerUrl={state.initialServerUrl}
      onConnected={handleConnected}
    />
  )
}

function createStyles(t: typeof import('./src/lib/theme').lightColors) {
  return StyleSheet.create({
    loadingContainer: {
      alignItems: 'center',
      backgroundColor: t.background,
      flex: 1,
      justifyContent: 'center',
    },
    loadingText: {
      color: t.textMuted,
      fontSize: 15,
      marginTop: 12,
    },
  })
}
