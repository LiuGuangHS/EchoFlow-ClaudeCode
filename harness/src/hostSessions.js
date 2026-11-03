import { randomUUID } from 'node:crypto'

/** Remote calls resolve to { ok, value } or { ok: false, error }; the facade hands back the value or throws. */
function valueOf(result) {
  if (result?.ok === false) throw result.error
  return result.value
}

/**
 * Session facade over the mounted `remote.session` namespace. The browser-only
 * session-controller client cannot load under Node, so this supplies the small
 * surface the runtime driver needs: create, retain, and an event source fed by
 * the Host's follow stream.
 */
export function createHostSessions(remote) {
  const references = new Set()
  const known = new Set()

  function retain(sessionId) {
    const entries = []
    const listeners = new Set()
    const abort = new AbortController()
    let released = false
    let settled = false
    let resolveReady
    let rejectReady
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // A reference nobody awaits must not surface as an unhandled rejection.
    ready.catch(() => {})

    const notify = () => {
      for (const listener of [...listeners]) listener()
    }
    const eventSource = {
      getSnapshot: () => ({ entries }),
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
    const session = {
      sessionId,
      beginSubmission: () => ({ requestId: randomUUID(), abandon() {} }),
      prompt: (content, mode, signal, requestId) =>
        remote.session.prompt({ requestId: requestId ?? randomUUID(), sessionId, mode, content }, signal),
      updateQueue: (itemId, action) => remote.session.updateQueue({ sessionId, itemId, action }),
      cancel: () => remote.session.cancel({ sessionId }),
    }
    const binding = { session, eventSource }

    const stream = remote.session.follow({ address: { kind: 'session', sessionId } }, abort.signal)
    void (async () => {
      let failure = new Error('the Host closed the session stream')
      try {
        for await (const frame of stream) {
          if (frame.type === 'snapshot') {
            entries.splice(0, entries.length, ...frame.records)
            if (!settled) {
              settled = true
              resolveReady(binding)
            }
          } else if (frame.type === 'event') {
            entries.push(frame)
          } else {
            continue
          }
          notify()
        }
      } catch (error) {
        failure = error
      }
      if (released) return
      if (!settled) {
        settled = true
        rejectReady(failure)
      }
      notify()
    })()

    const reference = {
      sessionId,
      binding,
      ready,
      release() {
        if (released) return
        released = true
        abort.abort()
        listeners.clear()
        references.delete(reference)
        if (!settled) {
          settled = true
          rejectReady(new Error('the session reference was released before it opened'))
        }
      },
    }
    references.add(reference)
    known.add(sessionId)
    return reference
  }

  return {
    // Synchronous view of the sessions this client created or retained.
    list: { getSnapshot: () => ({ items: [...known].map(sessionId => ({ sessionId })) }) },
    async create(options = {}) {
      const { sessionId } = valueOf(await remote.session.create(options))
      known.add(sessionId)
      return sessionId
    },
    retain,
    dispose() {
      for (const reference of [...references]) reference.release()
    },
  }
}
