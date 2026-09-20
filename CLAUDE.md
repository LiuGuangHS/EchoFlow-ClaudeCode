# Claude Code Project Notes

[AGENTS.md](AGENTS.md) is the complete and authoritative repository contract. This file contains only the recurring constraints Claude Code should load for every session; if the two files diverge, follow `AGENTS.md`.

## Always

- Start by identifying the touched surface against the `ChangeArea` union in `scripts/pr/change-policy.ts`, rather than inventing a surface name that has no area or check behind it.
- Check `git status --short` before editing, preserve unrelated user work, keep the diff narrow, and reuse existing stores, services, utilities, tests, and workflow patterns.
- Prefer the installed agent toolset over rebuilding a workflow: `/superpowers:brainstorm`, `/superpowers:write-plan`, `/superpowers:execute-plan`, `@code-reviewer`, `ponytail`, `frontend-design`. No plugin replaces `bun run verify` or `bun run check:policy`.
- Preserve the EchoFlow identity, the provider-preset policy, and persistence compatibility defined in `AGENTS.md`; retain upstream or historical names only for documented compatibility, attribution, or migration contracts.
- Match verification to the changed surface while iterating. Run `bun run verify` before claiming a change push-ready, merge-ready, or release-ready.
- Keep procedures out of this file and out of `AGENTS.md`. The repository contract states direction; `docs/internals/contributing.md` holds the step-by-step workflows, examples, and case law.

## High-Risk Workflows

- Upstream sync, persistence-shape changes, provider-policy changes, and desktop releases are high-risk. Follow the full workflow in `docs/internals/contributing.md` plus the non-negotiable constraints in `AGENTS.md`, rather than improvising from this summary.
- During upstream conflict resolution, never apply blanket `--ours` or `--theirs`, and never run `git add` or `git commit` without explicit developer confirmation.
