import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

type Direction = 'older' | 'newer'
type Anchor = { key: string; top: number; offset: number; identities?: string[] }
type Options = {
  sessionId?: string
  revision: number
  ready: boolean
  loading: boolean
  error?: string | null
  olderCursor?: string | null
  newerCursor?: string | null
  container: RefObject<HTMLDivElement>
  keys: string[]
  offsets: number[]
  identities?: Map<string, string[]>
  load: (direction: Direction) => Promise<void>
  prefetch: (direction: Direction) => Promise<void>
  syncViewport: (container: HTMLElement) => void
  preserveReading: () => void
}

/** Retains a visible row while the bounded transcript window moves underneath it. */
export function useContinuousChatHistory(options: Options) {
  const current = useRef(options)
  current.current = options
  const intentUntil = useRef(0)
  const lastScrollTop = useRef(0)
  const pending = useRef<{ sessionId?: string; anchors: Anchor[]; scrollTop: number } | null>(null)
  const requestInFlight = useRef(false)
  const requestGeneration = useRef(0)
  const lastPrefetch = useRef('')
  const failedDirection = useRef<Direction>('older')
  const previous = useRef({ sessionId: options.sessionId, revision: options.revision })
  const correctionFrame = useRef<number | null>(null)
  const correcting = useRef(false)

  const capture = useCallback(() => {
    const state = current.current
    const container = state.container.current
    if (!container) return null
    const top = container.getBoundingClientRect().top
    const height = container.clientHeight || 800
    const anchors: Anchor[] = []
    for (const node of container.querySelectorAll<HTMLElement>('[data-chat-render-item-key]')) {
      const rect = node.getBoundingClientRect()
      if (rect.bottom <= top || rect.top >= top + height) continue
      const key = node.dataset.chatRenderItemKey!
      const index = state.keys.indexOf(key)
      if (index < 0) continue
      anchors.push({ key, top: rect.top - top, offset: state.offsets[index] ?? 0, identities: state.identities?.get(key) })
      if (anchors.length === 3) break
    }
    return { sessionId: state.sessionId, anchors, scrollTop: container.scrollTop }
  }, [])

  const request = useCallback(async (direction: Direction) => {
    const state = current.current
    if (!state.sessionId || !state.ready || state.loading || requestInFlight.current) return
    const cursor = direction === 'older' ? state.olderCursor : state.newerCursor
    if (!cursor) return
    pending.current = capture()
    requestInFlight.current = true
    const generation = ++requestGeneration.current
    failedDirection.current = direction
    state.preserveReading()
    try {
      await state.load(direction)
    } catch {
      // The store owns the visible retry state.
    } finally {
      if (requestGeneration.current === generation) requestInFlight.current = false
    }
  }, [capture])

  const checkBoundary = useCallback((direction: Direction) => {
    const state = current.current
    const container = state.container.current
    if (!container || !state.ready || state.loading || state.error || requestInFlight.current || correcting.current) return
    const distance = direction === 'older' ? container.scrollTop : container.scrollHeight - container.clientHeight - container.scrollTop
    const height = container.clientHeight || 800
    const cursor = direction === 'older' ? state.olderCursor : state.newerCursor
    if (!cursor) return
    if (distance <= height) {
      void request(direction)
    } else if (distance <= height * 1.5) {
      const key = `${state.sessionId}:${direction}:${cursor}`
      if (lastPrefetch.current !== key) {
        lastPrefetch.current = key
        void state.prefetch(direction).catch(() => {})
      }
    }
  }, [request])

  const onUserIntent = useCallback((direction?: Direction) => {
    intentUntil.current = performance.now() + 1500
    const container = current.current.container.current
    if (container) lastScrollTop.current = container.scrollTop
    if (direction) checkBoundary(direction)
  }, [checkBoundary])

  const onScroll = useCallback(() => {
    const container = current.current.container.current
    if (!container) return
    const delta = container.scrollTop - lastScrollTop.current
    lastScrollTop.current = container.scrollTop
    if (correcting.current || performance.now() > intentUntil.current) return
    if (pending.current && requestInFlight.current) pending.current = capture()
    if (delta !== 0) checkBoundary(delta < 0 ? 'older' : 'newer')
  }, [capture, checkBoundary])

  useLayoutEffect(() => {
    const before = previous.current
    previous.current = { sessionId: options.sessionId, revision: options.revision }
    if (before.sessionId !== options.sessionId) {
      pending.current = null
      intentUntil.current = 0
      requestInFlight.current = false
      requestGeneration.current++
      lastPrefetch.current = ''
      correcting.current = false
      if (correctionFrame.current !== null) cancelAnimationFrame(correctionFrame.current)
      return
    }
    if (before.revision === options.revision) return
    const snapshot = pending.current
    pending.current = null
    const container = options.container.current
    if (!snapshot || snapshot.sessionId !== options.sessionId || !container) return
    const anchor = snapshot.anchors.map((item) => {
      if (options.keys.includes(item.key)) return item
      const key = options.keys.find((candidate) => options.identities?.get(candidate)?.some((id) => item.identities?.includes(id)))
      return key ? { ...item, key } : undefined
    }).find((item) => item !== undefined)
    if (!anchor) return
    options.preserveReading()
    correcting.current = true
    const findAnchor = () => Array.from(container.querySelectorAll<HTMLElement>('[data-chat-render-item-key]'))
      .find((node) => node.dataset.chatRenderItemKey === anchor.key)
    const node = findAnchor()
    const index = options.keys.indexOf(anchor.key)
    container.scrollTop = Math.max(0, node
      ? container.scrollTop + node.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.top
      : snapshot.scrollTop + (options.offsets[index] ?? 0) - anchor.offset)
    lastScrollTop.current = container.scrollTop
    options.syncViewport(container)
    // The offset correction mounts the anchor if virtualization had removed it.
    // One measured correction then includes padding, notices and real row height.
    correctionFrame.current = requestAnimationFrame(() => {
      correctionFrame.current = null
      const mounted = findAnchor()
      if (mounted) {
        const delta = mounted.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.top
        if (Math.abs(delta) > 0.5) container.scrollTop += delta
      }
      lastScrollTop.current = container.scrollTop
      current.current.syncViewport(container)
      correcting.current = false
    })
  }, [options.revision, options.sessionId, options.keys, options.offsets, options.identities, options.container, options.syncViewport, options.preserveReading])

  const cancelAnchor = useCallback(() => {
    pending.current = null
    intentUntil.current = 0
    requestGeneration.current++
    requestInFlight.current = false
    correcting.current = false
    if (correctionFrame.current !== null) cancelAnimationFrame(correctionFrame.current)
    correctionFrame.current = null
  }, [])

  useLayoutEffect(() => () => {
    if (correctionFrame.current !== null) cancelAnimationFrame(correctionFrame.current)
  }, [])

  return { onUserIntent, onScroll, cancelAnchor, retry: () => { void request(failedDirection.current) } }
}
