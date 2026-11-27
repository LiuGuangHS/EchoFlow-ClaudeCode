import { create } from 'zustand'
import type { ClaudeCodeRuntimeId } from '../lib/desktopHost'

type CliRuntimeRequestStatus = 'pending' | 'applied' | 'failed'

type SessionCliRuntimeStore = {
  effectiveBySessionId: Record<string, ClaudeCodeRuntimeId>
  requestedBySessionId: Record<string, ClaudeCodeRuntimeId>
  statusBySessionId: Record<string, CliRuntimeRequestStatus>
  apply: (sessionId: string, runtimeId: ClaudeCodeRuntimeId) => void
  request: (sessionId: string, runtimeId: ClaudeCodeRuntimeId) => void
  fail: (sessionId: string) => void
}

export const useSessionCliRuntimeStore = create<SessionCliRuntimeStore>((set, get) => ({
  effectiveBySessionId: {},
  requestedBySessionId: {},
  statusBySessionId: {},

  apply: (sessionId, runtimeId) =>
    set((state) => {
      const requested = state.requestedBySessionId[sessionId]
      const status = requested === runtimeId ? 'applied' : state.statusBySessionId[sessionId]
      return {
        effectiveBySessionId: {
          ...state.effectiveBySessionId,
          [sessionId]: runtimeId,
        },
        ...(status ? {
          statusBySessionId: {
            ...state.statusBySessionId,
            [sessionId]: status,
          },
        } : {}),
      }
    }),

  request: (sessionId, runtimeId) =>
    set((state) => ({
      requestedBySessionId: {
        ...state.requestedBySessionId,
        [sessionId]: runtimeId,
      },
      statusBySessionId: {
        ...state.statusBySessionId,
        [sessionId]: 'pending',
      },
    })),

  fail: (sessionId) => {
    if (get().statusBySessionId[sessionId] !== 'pending') return
    set((state) => ({
      statusBySessionId: {
        ...state.statusBySessionId,
        [sessionId]: 'failed',
      },
    }))
  },
}))
