# Harness — the dsh execution seam

This directory holds EchoFlow's seam to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh). dsh is the execution runtime; EchoFlow keeps its own product shell, UI,
session store, and provider routing.

Nothing in this directory is vendored dsh source. dsh is consumed as pinned npm
packages, and every line under this directory is EchoFlow's own code.

## What lives here

| Path | Role |
| --- | --- |
| `profile/` | The `echoflow` dsh profile: bundles, patches, and the zero-egress overrides |
| `bundles/` | EchoFlow-owned dsh plugins that dsh does not ship (currently `egress-guard`) |
| `src/` | The boot sequence (`boot.js`) and the ACP seam client that drives dsh |
| `egress-blocklist.json` | The plugins and hosts the profile must never use |
| `test/` | The `check:harness` lane |

## Toolchain

This directory uses npm and Node, not bun. The root repository uses bun; the two
trees do not share a dependency install, and a root `bun install` never reaches
into `harness/`.

dsh requires Node `>= 24.9.0` and its own packages assume a modern Node. The
root repository's own Node floor is lower, so the two floors differ on purpose.

```bash
npm --prefix harness ci      # install exactly the locked tree
npm --prefix harness test    # the check:harness lane
npm --prefix harness run preview
```

`preview` boots the real launcher with a temporary `HOME`/`DSH_HOME` and points
the model provider at a loopback gateway on `127.0.0.1`. It needs no
credentials and no network, so it is the quickest way to see a full turn:
handshake, `session/new`, one streamed prompt, and a bounded exit.

## Why the versions are pinned exactly

dsh is a developer preview, and its npm `latest` tag points at `0.1.0-rc.6` —
older than the newest published release. A caret or tilde range would silently
resolve to that older build and produce failures that look like dsh bugs.

Every `@deepseek-ai/*` dependency is therefore pinned to an exact version.

### Upgrade procedure

dsh's upgrade guide warns that preview releases can carry breaking changes, so
an upgrade is a deliberate, reviewed step — never an automatic one.

1. Edit the exact versions in `package.json`.
2. Run `npm --prefix harness install` to refresh `package-lock.json`.
3. Run `npm --prefix harness test`.
4. **Review `egress-blocklist.json` by hand.** dsh may add a new outbound
   plugin or rename an existing one. A `cordis.patch.yml` entry for a plugin id
   that no longer exists is not an error — it is silently ignored, with only a
   line in the log to show for it. This is the one failure mode the automated
   lane cannot catch, so a human reads the dsh release notes against the
   blocklist on every upgrade.
5. Record the upgrade in the commit message.

## Wave handoff

The next plan is `docs/superpowers/plans/2026-10-29-dsh-wave1-runtime-contract-driver.md`:
it builds the runtime contract and the dsh ACP driver in `src/server/runtime/`. It
does **not** swap the desktop's `npx` sidecar for this seam. That sidecar serves a
dsh web UI window, which an ACP driver deliberately does not provide; it stays as
the transitional implementation until the readiness work and the optional
native-dsh engine decide its fate.

Three things carry into later waves:

- `desktop/electron/services/nodeRuntime.ts` raises the desktop Node floor to
  `24.9.0` and uses `checkNodeFloor` from `src/nodeFloor.js`. The readiness wave
  owns that switch.
- The driver takes its launcher command from
  `RuntimeInstallation.executablePath`, so where the launcher ships from is a
  packaging decision for the release wave, not a driver change.
- The desktop's own product analytics joins `egress-blocklist.json`.
