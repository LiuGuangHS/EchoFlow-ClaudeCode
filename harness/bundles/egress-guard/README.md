# @echoflow/egress-guard

EchoFlow's own dsh bundle. It is not part of dsh and carries no dsh code: it is
the first entry in EchoFlow's differentiation layer, and it exists because the
profile's patch file alone cannot stop a later layer from re-opening a row.

## What it guarantees

The profile's `cordis.patch.yml` disables every plugin and route listed in
`harness/egress-blocklist.json`. That file is a static layer. A user home patch
(`$DSH_HOME/cordis.patch.yml`), a `--patch` overlay, or a future reloader is
applied *after* it, so the effective configuration has to be judged by what the
Loader actually runs, not by reading the profile's own patch file.

The guard checks three moments:

| Moment | Owner | Behaviour on violation |
| --- | --- | --- |
| Before `boot()` | EchoFlow launcher | refuses to start |
| After `boot()` settles | EchoFlow launcher | refuses to serve |
| After `app-boot/config-reload` | this bundle | rejects the reload and exits non-zero |

Every check reads structured Loader state — entry ids, effective config, and
`Entry.disabled` (which evaluates `!!js` expressions and accounts for a
disabled parent group). Nothing here parses YAML text or guesses row
boundaries.

Rules:

- Every blocklisted id must exist **and** be effectively disabled. A missing id
  means an upstream rename escaped the audit, which is a violation, not a pass.
- Every id in `requiredPlugins` must exist and stay enabled — the guard cannot
  be switched off by a later layer.
- No enabled entry's config may name a blocked host or route.

## What it does not guarantee

This is a policy check over the plugins EchoFlow declares, not an operating
system network firewall. Code that opens a socket on its own — a stray script,
a dependency with its own telemetry, a browser — is outside its reach. Treat it
as one layer of a defence that also includes review of the pinned dependency
tree and the desktop's own outbound policy.

## Usage

The bundle is a normal dsh bundle: it ships `cordis.patch.yml`, which inserts
the `egress-guard` row, and the profile lists it in `dsh.profile.bundles`.

The pure rule set is exported for tests and for the launcher:

```js
import { verifyEffectiveConfig, snapshotLoaderTree } from '@echoflow/egress-guard/verify'
```
