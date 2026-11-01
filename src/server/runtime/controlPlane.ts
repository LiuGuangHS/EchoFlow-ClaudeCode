/**
 * The runtime control plane: the product-facing surface over any engine driver.
 *
 * It owns the maps upper layers should never assemble themselves — which
 * installation is connected, which product session maps to which driver
 * session, and what that session's engine can actually do. Drivers stay
 * interchangeable behind it; nothing here mentions an engine protocol.
 */
import { randomUUID } from 'node:crypto'
import {
  UnsupportedRuntimeCapabilityError,
  type Capability,
  type DriverId,
  type InstallationId,
  type InterruptResult,
  type RuntimeCapabilities,
  type RuntimeConnection,
  type RuntimeDriver,
  type RuntimeEvent,
  type RuntimeExit,
  type RuntimeInstallation,
  type RuntimeSession,
  type UserTurn,
} from './contract.js'

type CapabilityGroup = keyof RuntimeCapabilities

/** Dotted capability paths, e.g. `prompt.text` or `observability.usage`. */
export type CapabilityPath = {
  [G in CapabilityGroup]: `${G}.${keyof RuntimeCapabilities[G] & string}`
}[CapabilityGroup]

export class UnknownRuntimeDriverError extends Error {
  constructor(driverId: string) {
    super(`no driver registered for ${driverId}`)
    this.name = 'UnknownRuntimeDriverError'
  }
}

export class UnknownRuntimeInstallationError extends Error {
  constructor(installationId: string) {
    super(`no live connection for installation ${installationId}`)
    this.name = 'UnknownRuntimeInstallationError'
  }
}

export class UnknownRuntimeSessionError extends Error {
  constructor(sessionId: string) {
    super(`no open session ${sessionId}`)
    this.name = 'UnknownRuntimeSessionError'
  }
}

export class RuntimeHostClosedError extends Error {
  constructor() {
    super('runtime host is closed')
    this.name = 'RuntimeHostClosedError'
  }
}

export class RuntimeSessionAlreadyOpenError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} is already open`)
    this.name = 'RuntimeSessionAlreadyOpenError'
  }
}

export type RuntimeHost = {
  registerDriver(driver: RuntimeDriver): void
  connect(input: {
    installation: RuntimeInstallation
    cwd: string
    env?: Record<string, string | undefined>
  }): Promise<{ runId: string; connection: RuntimeConnection }>
  openSession(input: { installationId: InstallationId; sessionId: string; cwd: string }): Promise<RuntimeSession>
  getSession(sessionId: string): RuntimeSession
  capabilitiesOf(sessionId: string): RuntimeCapabilities
  /** Throws `UnsupportedRuntimeCapabilityError` unless the engine claims the capability natively. */
  requireCapability(sessionId: string, path: CapabilityPath): void
  send(sessionId: string, turn: UserTurn): AsyncIterable<RuntimeEvent>
  respondApproval(sessionId: string, requestId: string, optionId: string): Promise<void>
  interrupt(sessionId: string): Promise<InterruptResult>
  closeSession(sessionId: string): Promise<void>
  onConnectionExit(listener: (event: { installationId: InstallationId; exit: RuntimeExit }) => void): () => void
  close(): Promise<void>
}

export type RuntimeHostOptions = {
  newRunId?: () => string
}

export function createRuntimeHost(options: RuntimeHostOptions = {}): RuntimeHost {
  const newRunId = options.newRunId ?? (() => randomUUID())
  const drivers = new Map<DriverId, RuntimeDriver>()
  const connections = new Map<InstallationId, { connection: RuntimeConnection; runId: string }>()
  const sessions = new Map<string, { session: RuntimeSession; installationId: InstallationId }>()
  const exitListeners = new Set<(event: { installationId: InstallationId; exit: RuntimeExit }) => void>()
  const exitSubscriptions = new Map<InstallationId, () => void>()
  const connecting = new Map<InstallationId, Promise<{ runId: string; connection: RuntimeConnection }>>()
  const openingSessions = new Map<string, Promise<RuntimeSession>>()
  let closing: Promise<void> | null = null

  function forgetSessions(installationId: InstallationId) {
    for (const [sessionId, entry] of sessions) {
      if (entry.installationId === installationId) sessions.delete(sessionId)
    }
  }

  function requireSession(sessionId: string): RuntimeSession {
    const entry = sessions.get(sessionId)
    if (entry === undefined) throw new UnknownRuntimeSessionError(sessionId)
    return entry.session
  }

  return {
    registerDriver(driver) {
      drivers.set(driver.driverId, driver)
    },

    async connect({ installation, cwd, env }) {
      const installationId = installation.installationId
      if (closing !== null) throw new RuntimeHostClosedError()
      const previousConnect = connecting.get(installationId)
      const operation = (async () => {
        if (previousConnect !== undefined) await previousConnect.catch(() => {})
        if (closing !== null) throw new RuntimeHostClosedError()
        const driver = drivers.get(installation.driverId)
        if (driver === undefined) throw new UnknownRuntimeDriverError(installation.driverId)
        const previous = connections.get(installationId)
        if (previous !== undefined) {
          // Replace, don't leak: the old engine's sessions die with it, and its
          // late exit must not touch whatever replaces it.
          exitSubscriptions.get(installationId)?.()
          exitSubscriptions.delete(installationId)
          connections.delete(installationId)
          forgetSessions(installationId)
          await previous.connection.close()
        }
        const runId = newRunId()
        const connection = await driver.start({ installation, runId, cwd, env })
        connections.set(installationId, { connection, runId })
        exitSubscriptions.set(
          installationId,
          connection.onExit((exit) => {
            // A replaced connection can report its exit after this point; its
            // callback must not clear whatever now owns the installation.
            if (connections.get(installationId)?.connection !== connection) return
            connections.delete(installationId)
            exitSubscriptions.get(installationId)?.()
            exitSubscriptions.delete(installationId)
            forgetSessions(installationId)
            for (const listener of exitListeners) listener({ installationId, exit })
          }),
        )
        return { runId, connection }
      })()
      connecting.set(installationId, operation)
      try {
        return await operation
      } finally {
        if (connecting.get(installationId) === operation) connecting.delete(installationId)
      }
    },

    async openSession({ installationId, sessionId, cwd }) {
      if (closing !== null) throw new RuntimeHostClosedError()
      const entry = connections.get(installationId)
      if (entry === undefined) throw new UnknownRuntimeInstallationError(installationId)
      if (sessions.has(sessionId) || openingSessions.has(sessionId)) throw new RuntimeSessionAlreadyOpenError(sessionId)
      const opening = (async () => {
        const session = await entry.connection.openSession({ sessionId, cwd })
        // The connection may have been replaced, or the host may have closed,
        // while the engine was opening: such a session belongs to an engine
        // nobody owns any more, so it is closed instead of registered.
        if (connections.get(installationId)?.connection !== entry.connection || closing !== null) {
          await session.close()
          throw new UnknownRuntimeInstallationError(installationId)
        }
        sessions.set(sessionId, { session, installationId })
        return session
      })()
      openingSessions.set(sessionId, opening)
      try {
        return await opening
      } finally {
        if (openingSessions.get(sessionId) === opening) openingSessions.delete(sessionId)
      }
    },

    getSession: requireSession,

    capabilitiesOf(sessionId) {
      return requireSession(sessionId).capabilities
    },

    requireCapability(sessionId, path) {
      const [group, key] = path.split('.') as [CapabilityGroup, string]
      const capability = (requireSession(sessionId).capabilities[group] as Record<string, Capability>)[key]
      if (capability?.state !== 'native') throw new UnsupportedRuntimeCapabilityError(path)
    },

    send(sessionId, turn) {
      return requireSession(sessionId).send(turn)
    },

    respondApproval(sessionId, requestId, optionId) {
      return requireSession(sessionId).respondApproval(requestId, optionId)
    },

    interrupt(sessionId) {
      return requireSession(sessionId).interrupt()
    },

    async closeSession(sessionId) {
      const entry = sessions.get(sessionId)
      if (entry === undefined) return
      sessions.delete(sessionId)
      await entry.session.close()
    },

    onConnectionExit(listener) {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    },

    close() {
      if (closing !== null) return closing
      closing = (async () => {
        await Promise.all([...connecting.values()].map((operation) => operation.catch(() => {})))
        const live = [...connections.values()]
        sessions.clear()
        // The engines close first: a session open still in flight is only
        // aborted by the connection it waits on, so waiting for it before the
        // close would hang forever on an engine that never answers.
        await Promise.all(live.map(({ connection }) => connection.close()))
        await Promise.all([...openingSessions.values()].map((operation) => operation.catch(() => {})))
      })()
      return closing
    },
  }
}
