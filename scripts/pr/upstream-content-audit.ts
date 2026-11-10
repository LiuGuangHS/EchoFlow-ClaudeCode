#!/usr/bin/env bun

/**
 * Offline, deterministic product-content gate.
 *
 * EchoFlow keeps upstream attribution, licences, dependency names, real build
 * artifact names and compatibility notes on purpose. What must not survive is
 * upstream product identity presented as EchoFlow's own, or an actionable
 * upstream repository / download link in public content.
 *
 * Two surfaces, two strictness levels:
 *  - identity: files that state what this product is. Legacy names and the
 *    upstream brand used as a self-description are violations here.
 *  - links: every public surface, checked only for actionable upstream URLs.
 *    Bare "Claude Code" is legal here (it names the upstream runtime the app
 *    interoperates with) and bare "cc-haha" is often an internal config dir,
 *    bundle name or storage key. Neither is an editorial violation.
 *
 * The manifest is fixed and tested. Internal identifiers (config dirs, test
 * fixtures, native bundle names, temp paths) are deliberately out of scope:
 * renaming those is a migration, not an editorial fix.
 *
 * Exemptions are narrow by construction: (exact path, one rule, one exact
 * snippet). They never skip a whole file or a whole line, so a source link
 * hiding on the same line as an exempted build-artifact name is still reported.
 * An exemption or baseline entry that no longer matches anything fails the
 * audit instead of silently accumulating dead holes. Visible legacy self-names
 * in UI strings are a separate coordinated migration and are listed explicitly
 * in KNOWN_TEXT_GAPS, so CI reports the gap rather than implying full coverage.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export type RuleId =
  | 'legacy-product-identity'
  | 'upstream-brand-as-product'
  | 'upstream-distribution-url'
  | 'upstream-ads-publisher'

export type SurfaceKind = 'identity' | 'links'
export type Rule = { id: RuleId; scope: 'identity' | 'all'; description: string; pattern: RegExp }

export const RULES: Rule[] = [
  {
    id: 'legacy-product-identity',
    scope: 'identity',
    description: 'upstream / legacy fork name used as this product\'s own identity',
    pattern: /cc-haha|claude-haha|Claude[ -]Code[ -]Haha|Claude-Code-Haha/i,
  },
  {
    id: 'upstream-brand-as-product',
    scope: 'identity',
    description: 'upstream product name presented as EchoFlow\'s own product',
    pattern: /Claude Code/,
  },
  {
    id: 'upstream-distribution-url',
    scope: 'all',
    description: 'actionable upstream repository, download or documentation URL',
    pattern: /github\.com\/NanmiCoder\/cc-haha|github\.com\/anthropics\/claude-code|claude\.ai\/code|www\.anthropic\.com\/claude-code|docs\.anthropic\.com\/[^\s)"']*claude-code/i,
  },
  {
    id: 'upstream-ads-publisher',
    scope: 'all',
    description: 'upstream AdSense publisher id in the public ads.txt',
    pattern: /pub-5210914487984731/,
  },
]

/** Files that state what this product is, or carry a download / repo entry. */
export const IDENTITY_SURFACES = [
  'README.md',
  'README.en.md',
  'README.zh-CN.md',
  'THIRD_PARTY_LICENSES.md',
  'package.json',
  'desktop/package.json',
  'docs/public/ads.txt',
  'site/src/components/SiteHeader.jsx',
  'site/src/pages/home/landingContent.ts',
  'site/src/pages/home/HomePage.tsx',
  'desktop/src/pages/settings/AboutSettings.tsx',
  'desktop/src/pages/settings/mobileAppLinks.ts',
  'mobile/src/ui/Logo.tsx',
  'docs/start/install.md',
  'docs/en/start/install.md',
]

/** Public surfaces checked for actionable upstream links only. */
export const LINK_SURFACES = [
  'desktop/src/components/layout/Sidebar.tsx',
  'desktop/src/features/tokenUsage/useActivityProfile.ts',
  'desktop/src/i18n/locales/zh.ts',
  'desktop/src/i18n/locales/en.ts',
  'desktop/src/i18n/locales/zh-TW.ts',
  'desktop/src/i18n/locales/jp.ts',
  'desktop/src/i18n/locales/kr.ts',
  'mobile/src/ui/settings/deliveryModel.ts',
]

export const DOC_ROOT = 'docs'
export const RELEASE_NOTE_DIR = 'release-notes'
export const EXCLUDED_DOC_DIRS = new Set([
  '_internal', 'images', 'public', 'superpowers', 'ui-clone', 'node_modules', 'generated',
])

/**
 * Binary / remote media cannot be proven clean by a text scan. Listed here so
 * the audit reports the gap rather than claiming full coverage.
 */
export const MANUAL_REVIEW_SURFACES = [
  'site/src/pages/home/assets/wandor-poster.webp (hero video poster)',
  'site/src/pages/home/assets/film-poster.webp (film cover)',
  'site/src/pages/home/assets/real/*.webp (product screenshots)',
  'site/src/pages/home/assets/quiet-*.webp (scene stills)',
  'docs/images/app/** (bilingual app screenshots)',
  'docs/images/logo-horizontal*.svg (brand mark)',
  'site/src/pages/home/HomePage.tsx VIDEO (figma.site remote video)',
  'site/src/pages/home/HomePage.tsx FILM (cdn.zizhi1.com remote video)',
]

/**
 * Visual review of shipped landing-page assets (2026-11-09). These are not
 * guesses: the legacy wordmark is readable in the pixels. A text scan cannot
 * see them, so they are REPORTED, not enforced — fixing them means re-shooting
 * every product screenshot after the coordinated rename, not editing a string.
 */
export const CONFIRMED_MEDIA_FINDINGS = [
  'site/src/pages/home/assets/real/hero-desktop.webp — sidebar wordmark reads "cc-haha"; approval copy says "允许 Claude 执行此命令?"',
  'site/src/pages/home/assets/real/models.webp — sidebar wordmark reads "cc-haha"; body copy says "Claude 可以读取项目、修改代码并运行命令。"',
  'site/src/pages/home/assets/real/agent-teams.webp — sidebar wordmark reads "cc-haha"',
  'site/src/pages/home/assets/real/phone-home.webp — mobile header wordmark reads "cc-haha"',
]

/**
 * Remaining visible legacy self-names are TEXT, not binary. They are not fixed
 * here on purpose: a partial rename would leave one app answering to two names.
 * The five locale bundles mix product copy with config dirs, storage keys and
 * native bundle ids, so a coordinated migration must separate those first.
 * Listed so the audit never claims to cover them.
 */
export const KNOWN_TEXT_GAPS = [
  'desktop/src/i18n/locales/*.ts — internal config paths and storage keys intentionally retain legacy ids',
  'desktop/src/components/layout/Sidebar.tsx — wordmark restored; legacy ids remain only in comments',
  'desktop/src/features/tokenUsage/useActivityProfile.ts — default profile display name restored',
  'mobile/src/ui/settings/deliveryModel.ts — notification copy restored',
]

export type Exemption = {
  path: string
  rule: RuleId
  /** Exact snippet the line must contain. Never a whole-file or whole-line pass. */
  match: string
  reason: string
}

const ATTRIBUTION_REASON = 'third-party source attribution and applicable licence notice must be retained'
const ARTIFACT_REASON = 'real published build artifact name; renaming it would send users to a file that does not exist'
const COMPAT_REASON = 'compatibility note naming the upstream runtime the user does not have to install'
const BUILD_ID_REASON = 'real build / bundle identifier; renaming it needs a dedicated migration, not an edit'

export const EXEMPTIONS: Exemption[] = [
  { path: 'README.md', rule: 'legacy-product-identity', match: '[cc-haha](https://github.com/NanmiCoder/cc-haha)', reason: ATTRIBUTION_REASON },
  { path: 'README.md', rule: 'upstream-distribution-url', match: '[cc-haha](https://github.com/NanmiCoder/cc-haha)', reason: ATTRIBUTION_REASON },
  { path: 'README.md', rule: 'upstream-brand-as-product', match: 'local-first desktop workspace for Claude Code and model providers', reason: COMPAT_REASON },
  { path: 'README.en.md', rule: 'legacy-product-identity', match: '[cc-haha](https://github.com/NanmiCoder/cc-haha)', reason: ATTRIBUTION_REASON },
  { path: 'README.en.md', rule: 'upstream-distribution-url', match: '[cc-haha](https://github.com/NanmiCoder/cc-haha)', reason: ATTRIBUTION_REASON },
  { path: 'README.en.md', rule: 'upstream-brand-as-product', match: 'local-first desktop workspace for Claude Code and model providers', reason: COMPAT_REASON },
  { path: 'README.zh-CN.md', rule: 'legacy-product-identity', match: '[cc-haha](https://github.com/NanmiCoder/cc-haha)', reason: ATTRIBUTION_REASON },
  { path: 'README.zh-CN.md', rule: 'upstream-distribution-url', match: '[cc-haha](https://github.com/NanmiCoder/cc-haha)', reason: ATTRIBUTION_REASON },
  { path: 'README.zh-CN.md', rule: 'upstream-brand-as-product', match: '本地优先的 Claude Code 与模型服务商桌面工作台', reason: COMPAT_REASON },
  { path: 'THIRD_PARTY_LICENSES.md', rule: 'legacy-product-identity', match: 'copyright holder (`cc-haha`)', reason: 'provenance record of a third-party licence change' },
  { path: 'THIRD_PARTY_LICENSES.md', rule: 'upstream-brand-as-product', match: '## Claude Code runtime (derived source)', reason: ATTRIBUTION_REASON },
  { path: 'THIRD_PARTY_LICENSES.md', rule: 'upstream-brand-as-product', match: 'based on the Claude Code source code', reason: ATTRIBUTION_REASON },
  { path: 'desktop/package.json', rule: 'legacy-product-identity', match: 'cc-haha-computer-use', reason: BUILD_ID_REASON },
  { path: 'docs/start/install.md', rule: 'legacy-product-identity', match: 'Claude-Code-Haha-', reason: ARTIFACT_REASON },
  { path: 'docs/start/install.md', rule: 'legacy-product-identity', match: 'Claude Code Haha.app', reason: ARTIFACT_REASON },
  { path: 'docs/start/install.md', rule: 'upstream-brand-as-product', match: '无需另装 Node.js 或 Claude Code', reason: COMPAT_REASON },
  { path: 'docs/start/install.md', rule: 'upstream-brand-as-product', match: 'Claude Code Haha.app', reason: ARTIFACT_REASON },
  { path: 'docs/en/start/install.md', rule: 'legacy-product-identity', match: 'Claude-Code-Haha-', reason: ARTIFACT_REASON },
  { path: 'docs/en/start/install.md', rule: 'legacy-product-identity', match: 'Claude Code Haha.app', reason: ARTIFACT_REASON },
  { path: 'docs/en/start/install.md', rule: 'upstream-brand-as-product', match: 'No separate Node.js or Claude Code install needed', reason: COMPAT_REASON },
  { path: 'docs/en/start/install.md', rule: 'upstream-brand-as-product', match: 'Claude Code Haha.app', reason: ARTIFACT_REASON },
  { path: 'site/src/pages/home/HomePage.tsx', rule: 'legacy-product-identity', match: 'cdn.zizhi1.com/cc-haha/site/', reason: 'real hosted media path; changing it breaks the film, tracked as unverified media' },
  { path: 'docs/start/code-signing.md', rule: 'upstream-distribution-url', match: '从 [NanmiCoder/cc-haha]', reason: ATTRIBUTION_REASON },
  { path: 'docs/en/start/code-signing.md', rule: 'upstream-distribution-url', match: 'in [NanmiCoder/cc-haha]', reason: ATTRIBUTION_REASON },
]

/**
 * Temporary, exact tolerances for findings that predate the gate. Empty by
 * policy: every public surface is clean. Each entry is (path, rule, snippet,
 * reason); new findings with different text fail immediately, a stale entry
 * fails the audit, and a baseline never applies to a different rule on a line.
 * Unit tests inject synthetic entries to keep the mechanism covered.
 */
export type BaselineEntry = { path: string; rule: RuleId; match: string; reason: string }

export const BASELINE: BaselineEntry[] = []

export type ScannedFile = { path: string; kind: SurfaceKind; content: string }
export type Finding = { path: string; line: number; rule: RuleId; text: string }
export type SurfacePath = { path: string; kind: SurfaceKind }

export function collectSurfacePaths(root: string): SurfacePath[] {
  const identity = new Set(IDENTITY_SURFACES)
  const paths: SurfacePath[] = [
    ...IDENTITY_SURFACES.map(path => ({ path, kind: 'identity' as const })),
    ...LINK_SURFACES.map(path => ({ path, kind: 'links' as const })),
  ]
  const docsRoot = path.join(root, DOC_ROOT)
  if (!existsSync(docsRoot)) throw new Error(`missing required scan root: ${DOC_ROOT}`)

  const walk = (dir: string, relative: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DOC_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(path.join(dir, entry.name), `${relative}/${entry.name}`)
      } else if (entry.name.endsWith('.md')) {
        const file = `${relative}/${entry.name}`
        if (!identity.has(file)) paths.push({ path: file, kind: 'links' })
      }
    }
  }
  walk(docsRoot, DOC_ROOT)

  const releaseRoot = path.join(root, RELEASE_NOTE_DIR)
  if (!existsSync(releaseRoot)) throw new Error(`missing required scan root: ${RELEASE_NOTE_DIR}`)
  for (const name of readdirSync(releaseRoot).filter(name => name.endsWith('.md'))) {
    paths.push({ path: `${RELEASE_NOTE_DIR}/${name}`, kind: 'links' })
  }

  const unique = new Map<string, SurfacePath>()
  for (const item of paths) {
    if (!unique.has(item.path) || item.kind === 'identity') unique.set(item.path, item)
  }
  return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export type AuditResult = { errors: string[]; findings: Finding[] }
export type AuditOptions = {
  /** Registry staleness is a whole-repo property; unit cases turn it off. */
  validateRegistry?: boolean
}

/** Pure: no filesystem access, so positive/negative cases are cheap to test. */
export function auditUpstreamContent(files: ScannedFile[], options: AuditOptions = {}): AuditResult {
  const validateRegistry = options.validateRegistry ?? true
  const findings: Finding[] = []
  const usedExemptions = new Set<number>()

  for (const file of files) {
    const rules = RULES.filter(rule => rule.scope === 'all' || file.kind === 'identity')
    const lines = file.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index]
      for (const rule of rules) {
        rule.pattern.lastIndex = 0
        if (!rule.pattern.test(text)) continue
        const exemption = EXEMPTIONS.findIndex(entry =>
          entry.path === file.path && entry.rule === rule.id && text.includes(entry.match),
        )
        if (exemption >= 0) {
          usedExemptions.add(exemption)
          continue
        }
        findings.push({ path: file.path, line: index + 1, rule: rule.id, text: text.trim() })
      }
    }
  }

  const errors: string[] = []
  if (validateRegistry) {
    for (let index = 0; index < EXEMPTIONS.length; index += 1) {
      if (!usedExemptions.has(index)) {
        const entry = EXEMPTIONS[index]
        errors.push(`stale exemption (${entry.path}, ${entry.rule}): ${entry.match}`)
      }
    }
  }

  const usedBaseline = new Set<number>()
  for (const finding of findings) {
    const baseline = BASELINE.findIndex((entry, index) =>
      !usedBaseline.has(index)
      && entry.path === finding.path
      && entry.rule === finding.rule
      && finding.text.includes(entry.match),
    )
    if (baseline >= 0) {
      usedBaseline.add(baseline)
      continue
    }
    errors.push(`${finding.path}:${finding.line}: ${finding.rule}: ${finding.text}`)
  }
  if (validateRegistry) {
    for (let index = 0; index < BASELINE.length; index += 1) {
      if (!usedBaseline.has(index)) {
        const entry = BASELINE[index]
        errors.push(`stale baseline (${entry.path}, ${entry.rule}): ${entry.match}`)
      }
    }
  }

  return { errors, findings }
}

export function runUpstreamContentAudit(root: string): string[] {
  let surfaces: SurfacePath[]
  try {
    surfaces = collectSurfacePaths(root)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }

  const files: ScannedFile[] = []
  for (const surface of surfaces) {
    const absolute = path.join(root, surface.path)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      return [`missing required public surface: ${surface.path}`]
    }
    const content = readFileSync(absolute, 'utf8')
    if (content.trim().length === 0) {
      return [`empty required public surface: ${surface.path}`]
    }
    files.push({ ...surface, content })
  }
  return auditUpstreamContent(files).errors
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, '..', '..')
  const errors = runUpstreamContentAudit(root)
  if (errors.length > 0) {
    console.error(['Public content audit failed:', ...errors.map(error => `- ${error}`)].join('\n'))
    process.exit(1)
  }
  console.log('Public content audit passed.')
  console.log('Not verified by a text scan (manual review required):')
  for (const surface of MANUAL_REVIEW_SURFACES) console.log(`- ${surface}`)
  console.log('Confirmed media findings (visual review; reported, not enforced):')
  for (const finding of CONFIRMED_MEDIA_FINDINGS) console.log(`- ${finding}`)
  console.log('Known legacy-name migration gaps (tracked, not blocked by this gate):')
  for (const gap of KNOWN_TEXT_GAPS) console.log(`- ${gap}`)
}
