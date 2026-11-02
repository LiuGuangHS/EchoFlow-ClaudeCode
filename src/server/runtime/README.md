# Runtime layer

The EchoFlow-owned layer between the product and whatever engine actually runs a
session. Product code talks to `RuntimeHost`; drivers talk ACP, an SDK, or
JSON-RPC. Nothing above a driver may import an engine protocol type.

```
product / desktop / server features
  └─ RuntimeHost            controlPlane.ts   installations, sessions, capabilities
      └─ RuntimeDriver      dshDriver.ts      one engine protocol per file
          └─ engine process fixtureAcpAgent.ts is the test stand-in
```

## What this layer provides

| Capability | Guarantee | Where |
| --- | --- | --- |
| Engine-agnostic contract | Product code sees one event union, one session shape, one error set; engine payloads travel only inside `native`. | `contract.ts` |
| Capability negotiation | Every capability defaults to `unsupported`; `RuntimeHost.requireCapability()` throws instead of degrading silently. | `capabilitySnapshot.ts`, `controlPlane.ts` |
| Event envelope | Every event carries `eventId`, `sessionId`, `runId`, a per-session `seq`, `at`, and `source` (`engine` or `echoflow`). dsh has no session-state event, so the driver derives `session.state` and marks it `echoflow`. | `eventStamp.ts` |
| Update normalization | ACP session updates become contract events. An update kind this driver does not know becomes a `diagnostic` carrying the native payload — never a dropped event, never a thrown error. | `acpProjection.ts` |
| Approval bridge | The engine's permission request gets a product-side `requestId`; the UI answers by that id; an approval arriving with no live turn is answered `cancelled` so the engine never waits forever. | `dshDriver.ts` |
| Turn lifecycle | One active turn per session; a second `send()` throws `RuntimeBusyError` (no implicit queue, so `prompt.queue` is `unsupported`). `interrupt()` returns `cancelled` only after the engine confirms it; if the engine ignores the cancel it returns `cancelling` and the turn stays active. If the engine dies mid-stream the turn closes as `turn.completed(reason: 'error')`, and the next `send()` does not throw. A consumer that abandons the stream cancels its own turn — and only its own. A consumer that stalls keeps at most `turnBufferLimit` events (2000); older ones are dropped behind one warning diagnostic. | `dshDriver.ts` |
| Engine-initiated turns | One session-level pump reads the update cursor for the session's whole life, so updates the engine emits between user turns reach `onEngineTurn` instead of the next `send()`. ACP has no end-of-turn for them, so such a turn closes after a quiet period (`engineTurnIdleMs`, 1 s) or as soon as the user sends. One listener at a time per session — a second registration throws — and a listener that throws or rejects becomes a `runtime.engine_listener_failed` diagnostic without stopping the pump. | `dshDriver.ts` |
| Session routing | `RuntimeHost` owns the installation → connection → product-session maps, rejects unknown ids with typed errors, and forgets a dead connection's sessions. Reconnecting an installation closes the connection it replaces, and a replaced connection's late exit cannot clear its successor. Concurrent connects and opens are serialized per installation and per session id. `close()` closes the engines first and then waits for the connects and session opens still in flight, so no connection or session outlives it and an engine that never answers `session/new` cannot hold the close; a session that finishes opening after its connection was replaced is closed instead of registered. Using a closed host throws `RuntimeHostClosedError`. | `controlPlane.ts` |
| Config catalog | `config.changed` carries the engine's whole option table: select values with their candidates (flat or grouped) and booleans as real booleans. The model wire value is `JSON.stringify([provider, model])`, the shape dsh's own catalog publishes. | `acpProjection.ts` |
| Startup diagnostics | A launcher that dies during the handshake rejects with `RuntimeStartupError` carrying the process's stderr, before the startup timeout. A handshake answering a different ACP protocol version is rejected the same way. | `dshDriver.ts` |

## Public surface

- `createRuntimeHost()` — the product-facing API: `registerDriver`, `connect`,
  `openSession`, `getSession`, `capabilitiesOf`, `requireCapability`, `send`,
  `respondApproval`, `interrupt`, `closeSession`, `onConnectionExit`, `close`.
- `createDshDriver()` — the dsh driver; `resolveCommand`, `spawn`, `now`,
  `newApprovalId`, `interruptTimeoutMs`, `closeTimeoutMs`, `sessionCloseTimeoutMs`,
  `sessionOpenTimeoutMs` are injectable. `sessionCloseTimeoutMs` (default 2000)
  bounds a single session's close; `closeTimeoutMs` (default 10000) bounds the
  connection's; `sessionOpenTimeoutMs` (default 15000) bounds the whole open —
  `session/new` and the config options share one budget — so an engine that
  never answers `session/new` fails the open instead of hanging the caller
  and the host's close. Once that budget is gone no further request is sent,
  and the failure names the budget instead of the option that happened to be
  in flight. A session the engine opens after that budget expired is
  closed instead of left half-open.
- `createEventStamper()`, `projectSessionUpdate()`, `dshBaselineCapabilities()` —
  the pieces another driver reuses.

## Deliberate gaps

These are declared, not forgotten. Each one is `unsupported` in the capability
snapshot or absent from the API:

- Native session list / resume / fork / delete. `listSessions()` and
  `resumeSession()` throw `UnsupportedRuntimeCapabilityError`.
- Embedded resources, steering, hooks, skills, plugins. Stdio MCP servers work
  everywhere; images and HTTP MCP servers only when the handshake advertises
  them (`promptCapabilities.image`, `mcpCapabilities.http`).
- `probe()` runs in the process cwd and reports the engine version the handshake
  answered with, falling back to the installation version it was given.
- No desktop, WebSocket, or session-store wiring yet — this layer has no product
  consumer.
- The dsh driver is tested against `__fixtures__/fixtureAcpAgent.ts`, not against
  a real launcher; the real handshake is covered separately by
  `bun run check:harness`.

## Adding an engine

1. Implement `RuntimeDriver` in a new file: `probe()` must not throw, `start()`
   returns a `RuntimeConnection` with an honest capability snapshot.
2. Derive events with `createEventStamper()`; put engine payloads under `native`.
3. Run the shared behavioral suite: `runRuntimeContractSuite('<label>', factory)`
   from `__fixtures__/contractSuite.ts`, then add driver-specific tests.
4. Register it with `RuntimeHost` by `driverId`; no product code changes.

## Verification

```bash
bun test src/server/runtime
bun run check:server
```
