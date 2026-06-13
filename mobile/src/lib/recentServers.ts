import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'codemobile.recentServers'
const MAX_SERVERS = 5

export async function getRecentServers(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
  } catch {
    return []
  }
}

export async function addRecentServer(serverUrl: string): Promise<void> {
  const trimmed = serverUrl.trim()
  if (!trimmed) return

  const current = await getRecentServers()
  // Move to front if already present, otherwise prepend
  const filtered = current.filter((u) => u !== trimmed)
  const updated = [trimmed, ...filtered].slice(0, MAX_SERVERS)

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch {
    // Silently ignore storage failures — this is non-critical
  }
}

export async function removeRecentServer(serverUrl: string): Promise<void> {
  try {
    const current = await getRecentServers()
    const updated = current.filter((u) => u !== serverUrl)
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch {
    // Silently ignore
  }
}
