# Documentation Instructions

These rules apply to `docs/` changes in addition to the root instructions.

## Who the docs are for

Two audiences, nothing else. If a page serves neither, it does not belong here.

- **People using the app** — `start/`, `cases/`, `desktop/`, `mobile/`, `im/`. No prior code knowledge assumed.
- **People reading the source** — `internals/`, `cli/`. Architecture, implementation, contributing.

## Where documentation lives

Public pages explain the product or source; they are not task logs. Keep reusable architecture and boundary rules in `internals/`, contributor workflow in `internals/contributing.md`, and code-entry rules in the applicable `AGENTS.md`. State requirements separately from verified implementation; an audit finding, plan, or passing unit test is not proof that a whole feature works.

Maintainer-only migration lists, validation records, design proposals, and release runbooks belong in `docs/_internal/`, not public sections. The site generator must exclude `_internal` from every publication output. Do not link to it from public pages or treat it as a place to store secrets. Keep active records in its index; archive completed or superseded records under `_internal/archive/` after extracting durable guidance. Do not move or delete existing records as incidental cleanup.

## Structure

Seven top-level sections: `start/`, `cases/`, `desktop/`, `mobile/`, `im/`, `cli/`, `internals/`. Register any added section in the `sections` array of `site/scripts/generate-docs-manifest.mjs`.

`docs/en/` mirrors the Chinese tree file for file. Keep Chinese pages and their `docs/en/` counterparts aligned.

## Frontmatter (required on every page)

```yaml
---
title: 连接模型服务
nav_title: 连接模型      # sidebar label, ≤12 CJK characters
description: 一句话说明这篇讲什么。       # feeds search and SEO meta
order: 2                # position inside the section; index.md uses 0
---
```

The site renders the first paragraph after the H1 as a lede — write it as a normal paragraph, not a blockquote.

## Chinese typography

Put a space between Chinese characters and adjacent Latin letters or digits: 「一枚 6 位码」, 「回填 App ID」. Nothing in the render pipeline inserts it for you, so it has to be in the source. Punctuation needs no space.

## Screenshots

Product screenshots live in `docs/images/app/` as WebP at 2000px wide, captured from a real build. Never ship a screenshot from an older UI generation; re-capture instead. Redact tokens, QR codes, API keys and paired account names before committing. Cap feature pages at roughly three screenshots.

Step-by-step setup walkthroughs are the exception: `docs/im/` embeds console screenshots from `docs/images/im/<platform>/` and needs one per step. Judge those by whether a reader could follow along without them.

## Routes are file paths

`docs/start/install.md` publishes to `/start/install`. Renaming a file changes a public URL, so add the old path to `LEGACY_ROUTES` in `site/src/content/docs.js` and to `legacyRoutes` in `site/scripts/prepare-static-output.mjs`.

`/im/` is linked from inside the desktop app (`desktop/src/pages/AdapterSettings.tsx`). That route cannot move.

## Checks

- Run `bun run check:docs` when selected by `bun run check:impact`. It installs the isolated `site/` dependency tree, builds the React site, then validates every local link and image.
- Release instructions must stay consistent with `scripts/release.ts`, `.github/workflows/release-desktop.yml`, and the versioned release-notes convention.
