import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const store = new Map<string, string>()
const asyncStorageMock = {
  getItem: mock(async (key: string) => store.get(key) ?? null),
  setItem: mock(async (key: string, value: string) => {
    store.set(key, value)
  }),
  removeItem: mock(async (key: string) => {
    store.delete(key)
  }),
}

mock.module('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock,
}))

let recentServersModule: typeof import('./recentServers')

beforeEach(async () => {
  store.clear()
  asyncStorageMock.getItem.mockClear()
  asyncStorageMock.setItem.mockClear()
  asyncStorageMock.removeItem.mockClear()
  recentServersModule = await import('./recentServers')
})

afterEach(() => {
  store.clear()
})

describe('recentServers', () => {
  test('returns an empty list when nothing is stored', async () => {
    const { getRecentServers } = recentServersModule
    expect(await getRecentServers()).toEqual([])
  })

  test('adds a server and returns it at the front', async () => {
    const { addRecentServer, getRecentServers } = recentServersModule
    await addRecentServer('http://192.168.1.10:3456')
    expect(await getRecentServers()).toEqual(['http://192.168.1.10:3456'])
  })

  test('deduplicates when the same server is added again', async () => {
    const { addRecentServer, getRecentServers } = recentServersModule
    await addRecentServer('http://192.168.1.10:3456')
    await addRecentServer('http://10.0.0.4:3456')
    await addRecentServer('http://192.168.1.10:3456')
    expect(await getRecentServers()).toEqual([
      'http://192.168.1.10:3456',
      'http://10.0.0.4:3456',
    ])
  })

  test('caps the list at 5 servers', async () => {
    const { addRecentServer, getRecentServers } = recentServersModule
    for (let i = 1; i <= 7; i++) {
      await addRecentServer(`http://192.168.1.${i}:3456`)
    }
    const servers = await getRecentServers()
    expect(servers).toHaveLength(5)
    expect(servers[0]).toBe('http://192.168.1.7:3456')
    expect(servers[4]).toBe('http://192.168.1.3:3456')
  })

  test('ignores empty strings', async () => {
    const { addRecentServer, getRecentServers } = recentServersModule
    await addRecentServer('')
    await addRecentServer('   ')
    expect(await getRecentServers()).toEqual([])
  })

  test('removes a server', async () => {
    const { addRecentServer, getRecentServers, removeRecentServer } = recentServersModule
    await addRecentServer('http://a:3456')
    await addRecentServer('http://b:3456')
    await addRecentServer('http://c:3456')
    await removeRecentServer('http://b:3456')
    expect(await getRecentServers()).toEqual([
      'http://c:3456',
      'http://a:3456',
    ])
  })

  test('removeRecentServer is a no-op for unknown URLs', async () => {
    const { addRecentServer, getRecentServers, removeRecentServer } = recentServersModule
    await addRecentServer('http://a:3456')
    await removeRecentServer('http://unknown:3456')
    expect(await getRecentServers()).toEqual(['http://a:3456'])
  })

  test('survives corrupt storage', async () => {
    store.set('codemobile.recentServers', 'not-json')
    const { getRecentServers } = recentServersModule
    expect(await getRecentServers()).toEqual([])
  })
})
