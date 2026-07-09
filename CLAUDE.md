# Claude Code Project Notes

Follow [AGENTS.md](AGENTS.md) as the full repository contract. Keep this file concise and focused on the recurring rules Claude Code must apply automatically in this EchoFlow fork.

## Daily EchoFlow fork development

1. Start by identifying the touched surface: `desktop`, `server`, `adapter`, `native`, `docs`, `provider/runtime`, `agent-loop`, or `release`.
2. Keep changes narrow and preserve user work: check `git status --short` before editing, stage only intentional files, and do not reformat unrelated files.
3. Reuse existing stores, services, utilities, test harnesses, and workflow patterns before adding abstractions or dependencies.
4. Preserve EchoFlow fork identity and compatibility:
   - public branding: `EchoFlow Code`
   - local executable/docs: `echoflow-code`
   - upstream terms such as `Claude Code` only when they refer to upstream compatibility or runtime semantics
   - legacy persistence paths such as `cc-haha-*` and `~/.claude/cc-haha/**` unless a migration task explicitly closes them
5. Keep EchoFlowAPI as the default provider surface unless the user approves additional providers.
6. Treat release automation as product code. `desktop/package.json`, `scripts/release.ts`, `release-notes/`, and `.github/workflows/release-desktop.yml` are the desktop release source of truth.
7. Match verification to risk while iterating, but run `bun run verify` before claiming a change is push-ready, merge-ready, or release-ready.

## Safe upstream sync workflow

1. Start from a clean `main` worktree and check remotes.
2. Fetch `origin` normally, but fetch upstream branches without tags using `git fetch upstream +refs/heads/*:refs/remotes/upstream/* --prune`; upstream release tags can share names with fork release tags.
3. Compare `main...origin/main` and `main...upstream/main` before merging.
4. Merge upstream with a merge commit; do not rebase public `main`.
5. Resolve conflicts intentionally. Avoid blanket `--ours` or `--theirs`; protect EchoFlow branding, provider defaults, persistence compatibility, Electron release flow, and quality gates.
6. Run scoped checks first, then `bun run verify` before claiming push-ready.
7. Push `main` before or together with tags; verify remote refs after pushing.

## Release/tag rule

Desktop release tags are plain `vX.Y.Z` and must match `desktop/package.json` plus `release-notes/vX.Y.Z.md`. Use `bun run scripts/release.ts <version> --dry` before creating release commits/tags. If retagging an existing release, push `main` first and verify the remote tag points to the intended commit.