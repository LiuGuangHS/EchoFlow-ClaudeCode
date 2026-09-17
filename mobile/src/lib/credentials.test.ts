import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const store = new Map<string, string>()
const secureStoreMock = {
  getItemAsync: mock(async (key: string) => store.get(key) ?? null),
  setItemAsync: mock(async (key: string, value: string) => {
    store.set(key, value)
  }),
  deleteItemAsync: mock(async (key: string) => {
    store.delete(key)
  }),
}

mock.module('expo-secure-store', () => secureStoreMock)

let credentialsModule: typeof import('./credentials')

beforeEach(async () => {
  store.clear()
  secureStoreMock.getItemAsync.mockClear()
  secureStoreMock.setItemAsync.mockClear()
  secureStoreMock.deleteItemAsync.mockClear()
  credentialsModule = await import('./credentials')
})

afterEach(() => {
  store.clear()
})

describe('credentials', () => {
  test('returns null when either saved value is missing', async () => {
    const { loadCredentials } = credentialsModule

    expect(await loadCredentials()).toBeNull()
    store.set('codemobile.serverUrl', 'http://192.168.1.10:3456')
    expect(await loadCredentials()).toBeNull()
  })

  test('saves and loads credentials through SecureStore', async () => {
    const { loadCredentials, saveCredentials } = credentialsModule

    await saveCredentials({ serverUrl: 'http://192.168.1.10:3456', h5Token: 'h5_good' })

    expect(secureStoreMock.setItemAsync).toHaveBeenCalledWith(
      'codemobile.serverUrl',
      'http://192.168.1.10:3456',
    )
    expect(secureStoreMock.setItemAsync).toHaveBeenCalledWith('codemobile.h5Token', 'h5_good')
    await expect(loadCredentials()).resolves.toEqual({
      serverUrl: 'http://192.168.1.10:3456',
      h5Token: 'h5_good',
    })
  })

  test('clears both saved credential values', async () => {
    const { clearCredentials, saveCredentials, loadCredentials } = credentialsModule
    await saveCredentials({ serverUrl: 'http://192.168.1.10:3456', h5Token: 'h5_good' })

    await clearCredentials()

    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith('codemobile.serverUrl')
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith('codemobile.h5Token')
    await expect(loadCredentials()).resolves.toBeNull()
  })
})
