# Claude Code Project Notes

[AGENTS.md](AGENTS.md) is the complete and authoritative repository contract. This file contains only the recurring constraints Claude Code should load for every session; if the two files diverge, follow `AGENTS.md`.

## Always

- Start by identifying the touched surface: `desktop`, `server`, `adapter`, `native`, `docs`, `provider/runtime`, `agent-loop`, or `release`.
- Check `git status --short` before editing, preserve unrelated user work, keep the diff narrow, and reuse existing stores, services, utilities, tests, and workflow patterns.
- Prefer the matching ECC workflow for planning, review, architecture decisions, quality gates, and build repair.
- Preserve the EchoFlow identity, built-in provider policy, and persistence compatibility defined in `AGENTS.md`; retain upstream or historical names only for documented compatibility, attribution, or migration contracts.
- Match verification to the changed surface while iterating. Run `bun run verify` before claiming a change push-ready, merge-ready, or release-ready.

## High-Risk Workflows

- For upstream sync, persistence-shape changes, provider-policy changes, or desktop releases, follow the complete workflow in `AGENTS.md` rather than improvising from this summary.
- During upstream conflict resolution, never apply blanket `--ours` or `--theirs`, and never run `git add` or `git commit` without explicit developer confirmation.
