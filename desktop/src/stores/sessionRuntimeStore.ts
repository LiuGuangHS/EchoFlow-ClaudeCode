import { create } from 'zustand'
import type { RuntimeSelection } from '../types/runtime'
import type { SessionListItem } from '../types/session'
import {
  GROK_OFFICIAL_DEFAULT_MODEL_ID,
  GROK_OFFICIAL_MODELS,
  GROK_OFFICIAL_PROVIDER_ID,
} from '../constants/grokOfficialProvider'
import { normalizeRuntimeSelection } from '../lib/runtimeSelection'

const STORAGE_KEY = 'echoflow-code-session-runtime'
const RETIRED_GROK_MODEL_IDS = new Set([
  'grok-build',
  'grok-build-0.1',
  'grok-4.3',
  'grok-4.20-reasoning',
  'grok-4.20-non-reasoning',
])

export const DRAFT_RUNTIME_SELECTION_KEY = '__draft__'

export type RuntimeRequestStatus = 'pending' | 'unconfirmed' | 'failed'

type SessionRuntimeStore = {
  selections: Record<string, RuntimeSelection>
  runtimeRequestStatusBySessionId: Record<string, RuntimeRequestStatus>
  latestRequestIdBySessionId: Record<string, string>
  setSelection: (key: string, selection: RuntimeSelection) => void
  clearSelection: (key: string) => void
  moveSelection: (fromKey: string, toKey: string) => void
  markRequestPending: (sessionId: string, requestId?: string) => void
  markRequestApplied: (sessionId: string, requestId?: string) => void
  markRequestUnconfirmed: (sessionId: string) => void
  markRequestFailed: (sessionId: string, requestId?: string) => void
  syncFromSessions: (sessions: SessionListItem[]) => void
}

function normalizeSelection(selection: RuntimeSelection): RuntimeSelection | null {
  const normalizedSelection = normalizeRuntimeSelection(selection)
  if (
    normalizedSelection.providerId === null &&
    normalizedSelection.modelId.trim().toLowerCase() === 'opus[1m]'
  ) {
    // Older builds persisted the dynamic Claude default as an explicit model.
    // Drop only that Claude Official sentinel so the OAuth subscription tier
    // can resolve the current default. Third-party `[1m]` model ids stay intact.
    return null
  }
  if (
    normalizedSelection.providerId !== GROK_OFFICIAL_PROVIDER_ID ||
    !RETIRED_GROK_MODEL_IDS.has(normalizedSelection.modelId)
  ) {
    return normalizedSelection
  }

  const fallback = GROK_OFFICIAL_MODELS.find(
    (model) => model.id === GROK_OFFICIAL_DEFAULT_MODEL_ID,
  )
  return {
    providerId: GROK_OFFICIAL_PROVIDER_ID,
    modelId: GROK_OFFICIAL_DEFAULT_MODEL_ID,
    ...(fallback?.defaultReasoningEffort
      ? { effortLevel: fallback.defaultReasoningEffort }
      : {}),
  }
}

function normalizeSelections(
  selections: Record<string, RuntimeSelection>,
): { selections: Record<string, RuntimeSelection>; changed: boolean } {
  let changed = false
  const normalized: Record<string, RuntimeSelection> = {}
  for (const [key, selection] of Object.entries(selections)) {
    const next = normalizeSelection(selection)
    if (!next) {
      changed = true
      continue
    }
    if (next !== selection) changed = true
    normalized[key] = next
  }
  return { selections: normalized, changed }
}

function loadSelections(): Record<string, RuntimeSelection> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, RuntimeSelection>
    if (!parsed || typeof parsed !== 'object') return {}
    const normalized = normalizeSelections(parsed)
    if (normalized.changed) persistSelections(normalized.selections)
    return normalized.selections
  } catch {
    return {}
  }
}

function persistSelections(selections: Record<string, RuntimeSelection>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch {
    // noop
  }
}

export const useSessionRuntimeStore = create<SessionRuntimeStore>((set) => ({
  selections: loadSelections(),
  runtimeRequestStatusBySessionId: {},
  latestRequestIdBySessionId: {},

  setSelection: (key, selection) =>
    set((state) => {
      const normalized = normalizeSelection(selection)
      const selections = { ...state.selections }
      if (normalized) selections[key] = normalized
      else delete selections[key]
      persistSelections(selections)
      return { selections }
    }),

  clearSelection: (key) =>
    set((state) => {
      const hasSelection = key in state.selections
      const hasRequestStatus = key in state.runtimeRequestStatusBySessionId
      if (!hasSelection && !hasRequestStatus) return state

      const { [key]: _removedSelection, ...selections } = state.selections
      const { [key]: _removedRequestStatus, ...runtimeRequestStatusBySessionId } =
        state.runtimeRequestStatusBySessionId
      if (hasSelection) persistSelections(selections)
      return { selections, runtimeRequestStatusBySessionId }
    }),

  moveSelection: (fromKey, toKey) =>
    set((state) => {
      const selection = state.selections[fromKey]
      const hasRequestStatus = fromKey in state.runtimeRequestStatusBySessionId
      const { [fromKey]: _removedRequestStatus, ...runtimeRequestStatusBySessionId } =
        state.runtimeRequestStatusBySessionId
      if (!selection) {
        if (!hasRequestStatus) return state
        return { runtimeRequestStatusBySessionId }
      }
      const { [fromKey]: _removedSelection, ...rest } = state.selections
      const selections = {
        ...rest,
        [toKey]: selection,
      }
      persistSelections(selections)
      return { selections, runtimeRequestStatusBySessionId }
    }),

  markRequestPending: (sessionId, requestId) =>
    set((state) => ({
      runtimeRequestStatusBySessionId: {
        ...state.runtimeRequestStatusBySessionId,
        [sessionId]: 'pending',
      },
      latestRequestIdBySessionId: requestId
        ? { ...state.latestRequestIdBySessionId, [sessionId]: requestId }
        : state.latestRequestIdBySessionId,
    })),

  markRequestApplied: (sessionId, requestId) =>
    set((state) => {
      if (requestId && state.latestRequestIdBySessionId[sessionId] !== requestId) return state
      const { [sessionId]: _status, ...runtimeRequestStatusBySessionId } = state.runtimeRequestStatusBySessionId
      return { runtimeRequestStatusBySessionId }
    }),

  markRequestUnconfirmed: (sessionId) =>
    set((state) => {
      if (state.runtimeRequestStatusBySessionId[sessionId] !== 'pending') return state
      return {
        runtimeRequestStatusBySessionId: {
          ...state.runtimeRequestStatusBySessionId,
          [sessionId]: 'unconfirmed',
        },
      }
    }),

  markRequestFailed: (sessionId, requestId) =>
    set((state) => {
      if (requestId && state.latestRequestIdBySessionId[sessionId] !== requestId) return state
      const currentStatus = state.runtimeRequestStatusBySessionId[sessionId]
      if (currentStatus !== 'pending' && currentStatus !== 'unconfirmed') return state
      return {
        runtimeRequestStatusBySessionId: {
          ...state.runtimeRequestStatusBySessionId,
          [sessionId]: 'failed',
        },
      }
    }),

  syncFromSessions: (sessions) =>
    set((state) => {
      let selections = state.selections
      for (const session of sessions) {
        if (!session.runtimeModelId || session.runtimeProviderId === undefined) continue
        const selection = normalizeSelection({
          providerId: session.runtimeProviderId,
          modelId: session.runtimeModelId,
          ...(session.effortLevel ? { effortLevel: session.effortLevel } : {}),
        })
        if (!selection) {
          if (!(session.id in selections)) continue
          if (selections === state.selections) selections = { ...state.selections }
          delete selections[session.id]
          continue
        }
        const current = selections[session.id]
        if (
          current?.providerId === selection.providerId &&
          current.modelId === selection.modelId &&
          current.effortLevel === selection.effortLevel
        ) {
          continue
        }
        if (selections === state.selections) selections = { ...state.selections }
        selections[session.id] = selection
      }
      if (selections === state.selections) return state
      persistSelections(selections)
      return { selections }
    }),
}))
