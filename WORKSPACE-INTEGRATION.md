# Workspace Integration Ledger

## Scope and baseline

- Baseline: `9062989d3f90f0e6a84ac2d26625f48e9b9a3e7a` on `integrate/cc-haha-overlay`.
- Initial frozen inventory: 2,805 tracked modifications and 4,674 untracked files (7,479 paths total); 1,708 tracked files had content diffs, while 1,097 tracked paths were CRLF-only worktree differences against LF index content. No staged changes, unmerged entries, or mode changes were present.
- Full machine-readable path/hash/index/EOL snapshot and original tracked diff are retained under ignored `artifacts/workspace-integration/`. Do not overwrite the initial snapshot. It is local audit material, not a substitute for reviewing each change.
- Work proceeds in the approved batches. Product quality and a clean Git status are separate acceptance criteria. Local commits are authorized; push, release, live-provider usage, dependency installation, branch changes, and real-user-state access are not.

## Batch 0 — inventory and validation prerequisites

| Group | Decision / evidence | State |
| --- | --- | --- |
| Tracked CRLF-only paths | All 1,097 candidates matched their initial hashes, modes, and `i/lf w/crlf attr/text=auto eol=lf` attributes. Guarded normalization produced exactly the current index blob bytes for every file; the complete index was unchanged. Audit: `artifacts/workspace-integration/normalization.json`. | Completed; no source-content changes |
| `src/server/__tests__/proxy-network-settings.test.ts` | Removed the extra blank line at EOF; the full preexisting functional diff remains for the server batch. | Whitespace repaired; repository `git diff --check` passed |
| `.bun/install/cache/` | Added only `/.bun/install/cache/` to `.gitignore`. All 97 initial cache files remain on disk with their initial hashes. | Precisely ignored and preserved |
| Root `package-lock.json` | Stale, untracked npm lock; current root manifest uses Bun and its tracked `bun.lock` is primary. Local history shows this path was removed in `575029383`. Added only `/package-lock.json` to `.gitignore`; file hash unchanged. | Precisely ignored and preserved |
| Root issue notes | `issue-1672-remediation-plan.md` and `issue-triage-after-v0.5.5.md` are untracked local scratch/history notes with no tracked consumers or history. Added only their exact root paths to `.gitignore`; file hashes unchanged. | Precisely ignored and preserved |
| `native/agent-desktop/` | Vendored Rust/C source, lockfiles, patches, and licenses are deliverable source, not generated output. | Retain and review in native batch |
| `desktop/pnpm-lock.yaml` | Tracked but stale and no active install consumer found; do not delete during inventory. Reassess as a tracked change in desktop dependency integration and verify any claim against current scripts. | Pending |
| `desktop/build/check-install-processes.nsh` | Generated-looking but directly included by installer and pinned by test; retain. Do not ignore `desktop/build/` broadly. | Classified; retain |
| Active lockfiles | Root/desktop/adapters/mobile Bun locks and site/harness npm locks serve distinct current install paths; retain. | Classified |
| Existing ignored local output | `artifacts/`, `.research/`, `.superpowers/`, `.workbuddy/`, `.playwright-mcp/` already excluded; do not broaden ignore patterns. | Classified |
| Environment | Bun 1.3.14 vs required 1.4.3; root installed SDK 0.80.0 vs lock 0.128.0 and axios 1.14.0 vs lock 1.15.2; mobile dependencies absent; adapters missing `proxy-agent`; `cargo` and `swift` unavailable; `actionlint` available. Do not install or alter toolchain in this task without authorization. | Confirmed environment blockers; lane-specific validation pending |

## Integration batches

- Batch 1 — identity, path/config migration, provider/API and account contracts: pending.
- Batch 2 — runtime, sessions, agents and scheduling: pending.
- Batch 3 — desktop host, persistence, adapters, native/vendor/signing: pending.
- Batch 4 — Expo mobile app, isolated Android compatibility shell and H5: pending.
- Batch 5 — docs, site, release, CI, licensing and poster: pending.
- Batch 6 — optional enhancements only after batches 0–5: pending.

For each batch, record the exact files and decisions, regression tests, commands and observed results, and resulting local commit. Never record skipped or blocked checks as passed.

## Verification and commits

- Baseline-relative final commands are planned as `PR_BASE_REF=9062989d3f90f0e6a84ac2d26625f48e9b9a3e7a bun run check:impact` and `PR_BASE_REF=9062989d3f90f0e6a84ac2d26625f48e9b9a3e7a bun run verify`; initial impact selection is recorded below, but final validation has not run. The inventory commit preserves the preexisting `.gitignore` additions for `/.issue-router/` and `CLAUDE.md`; no ignored artifacts are staged.
- Batch 0 checks: `python3 artifacts/workspace-integration/normalize-eol.py` completed all 1,097 guarded normalizations; `git -c core.safecrlf=false diff --check` passed; hash assertions and `git check-ignore -q` verified all 100 newly ignored initial files remain unchanged. No product tests were run for mechanical cleanup; no product behavior was changed by these repairs.
- After cleanup: 1,708 tracked modifications and 4,575 untracked files (including this ledger), no staged changes. The original snapshot is unchanged. The EOF repair stays with the server batch; only `.gitignore` and this ledger form the inventory commit.
- Initial baseline-relative `bun --no-env-file run check:impact` exited 0 and selected all 13 listed checks for 6,283 paths. Its report is **policy-blocked**, not passed: CLI core changes require the `allow-cli-core-change` label and maintainer approval. No label override was supplied. `check:docs` invokes dependency installation; `verify` has not been executed because installation remains unauthorized. Full report: `artifacts/workspace-integration/batch0-impact.txt`.
- Editor diagnostics report unresolved Bun/Node globals and a timer comparison in the preexisting proxy test; these are not runtime/typecheck results. Product validation remains pending with the documented dependency/toolchain blockers.
- Remaining acceptance requires reviewing cumulative diffs, explicit-path staging and staged review for each batch, local commits, no unmerged/staged/untracked paths, and a final baseline-relative verification report. A clean status alone is not proof of quality.
