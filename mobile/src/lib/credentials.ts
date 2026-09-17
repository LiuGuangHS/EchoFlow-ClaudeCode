import * as SecureStore from 'expo-secure-store'
import type { Credentials } from './types'

const SERVER_URL_KEY = 'codemobile.serverUrl'
const H5_TOKEN_KEY = 'codemobile.h5Token'

export async function loadCredentials(): Promise<Credentials | null> {
  const [serverUrl, h5Token] = await Promise.all([
    SecureStore.getItemAsync(SERVER_URL_KEY),
    SecureStore.getItemAsync(H5_TOKEN_KEY),
  ])

  if (!serverUrl || !h5Token) {
    return null
  }

  return { serverUrl, h5Token }
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SERVER_URL_KEY, credentials.serverUrl),
    SecureStore.setItemAsync(H5_TOKEN_KEY, credentials.h5Token),
  ])
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SERVER_URL_KEY),
    SecureStore.deleteItemAsync(H5_TOKEN_KEY),
  ])
}
