// desktop/src/stores/echoFlowOAuthStore.ts

import { create } from 'zustand'
import { echoFlowOAuthApi, type EchoFlowOAuthStatus } from '../api/echoFlowOAuth'
import { useSettingsStore } from './settingsStore'

const POLL_INTERVAL_MS = 2_000

type EchoFlowOAuthState = {
  status: EchoFlowOAuthStatus | null
  isPolling: boolean
  isLoading: boolean
  error: string | null

  fetchStatus: () => Promise<void>
  login: () => Promise<{ authorizeUrl: string }>
  logout: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

export const useEchoFlowOAuthStore = create<EchoFlowOAuthState>((set, get) => {
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  return {
    status: null,
    isPolling: false,
    isLoading: false,
    error: null,

    fetchStatus: async () => {
      try {
        const previous = get().status
        const status = await echoFlowOAuthApi.status()
        set({ status, error: null })
        if (
          status.loggedIn &&
          (
            previous?.loggedIn !== true ||
            previous.expiresAt !== status.expiresAt ||
            previous.subscriptionType !== status.subscriptionType
          )
        ) {
          await useSettingsStore.getState().fetchAll()
        }
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    },

    login: async () => {
      set({ isLoading: true, error: null })
      try {
        const res = await echoFlowOAuthApi.start()
        set({ isLoading: false })
        return { authorizeUrl: res.authorizeUrl }
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },

    logout: async () => {
      get().stopPolling()
      set({ isLoading: true })
      try {
        await echoFlowOAuthApi.logout()
        set({ status: { loggedIn: false }, isLoading: false })
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },

    startPolling: () => {
      if (pollTimer) return
      set({ isPolling: true })

      const scheduleNext = () => {
        pollTimer = setTimeout(async () => {
          await get().fetchStatus()
          const cur = get().status
          if (cur && cur.loggedIn) {
            get().stopPolling()
            return
          }
          if (get().isPolling) {
            scheduleNext()
          }
        }, POLL_INTERVAL_MS)
      }
      scheduleNext()
    },

    stopPolling: () => {
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      set({ isPolling: false })
    },
  }
})
