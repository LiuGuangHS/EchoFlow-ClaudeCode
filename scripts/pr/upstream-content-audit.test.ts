import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  auditUpstreamContent,
  BASELINE,
  collectSurfacePaths,
  CONFIRMED_MEDIA_FINDINGS,
  EXEMPTIONS,
  IDENTITY_SURFACES,
  KNOWN_TEXT_GAPS,
  LINK_SURFACES,
  MANUAL_REVIEW_SURFACES,
  runUpstreamContentAudit,
  type BaselineEntry,
  type ScannedFile,
} from './upstream-content-audit'

/** Rule-level cases do not carry the whole repository, so skip registry checks. */
const rules = (files: ScannedFile[]) => auditUpstreamContent(files, { validateRegistry: false })

/** The real registry is empty; registry behaviour is covered with synthetic entries. */
const withBaseline = (entry: BaselineEntry, run: () => void) => {
  BASELINE.push(entry)
  try {
    run()
  } finally {
    BASELINE.splice(BASELINE.indexOf(entry), 1)
  }
}

const syntheticBaseline = (match: string): BaselineEntry => ({
  path: 'desktop/src/i18n/locales/en.ts',
  rule: 'upstream-distribution-url',
  match,
  reason: 'synthetic fixture used to cover the baseline mechanism',
})
const identity = (path: string, content: string): ScannedFile[] => [{ path, kind: 'identity', content }]
const links = (path: string, content: string): ScannedFile[] => [{ path, kind: 'links', content }]

describe('public content rules', () => {
  test('accepts required third-party attribution and licence notices', () => {
    expect(rules(identity('README.md',
      '- [cc-haha](https://github.com/NanmiCoder/cc-haha) by NanmiCoder: upstream source; its attribution and applicable license terms remain in place.',
    )).errors).toEqual([])
    expect(rules(identity('THIRD_PARTY_LICENSES.md',
      'Replaced the disclaimer with an MIT licence under a different copyright holder (`cc-haha`).',
    )).errors).toEqual([])
    expect(rules(identity('THIRD_PARTY_LICENSES.md',
      '## Claude Code runtime (derived source)',
    )).errors).toEqual([])
  })

  test('accepts real build artifact names and compatibility notes', () => {
    const content = [
      '| macOS | `Claude-Code-Haha-<版本>-macOS-Apple-Silicon.dmg` |',
      '装完就能用，无需另装 Node.js 或 Claude Code——CLI 内核已经打进安装包里了。',
      'xattr -dr com.apple.quarantine "/Applications/Claude Code Haha.app"',
    ].join('\n')
    expect(rules(identity('docs/start/install.md', content)).errors).toEqual([])
  })

  test('accepts the fork publisher id and rejects the upstream one', () => {
    expect(rules(identity('docs/public/ads.txt', 'google.com, pub-1962125033823297, DIRECT, f08c47fec0942fa0')).errors).toEqual([])
    expect(rules(identity('docs/public/ads.txt', 'google.com, pub-5210914487984731, DIRECT, f08c47fec0942fa0')).errors)
      .toEqual(['docs/public/ads.txt:1: upstream-ads-publisher: google.com, pub-5210914487984731, DIRECT, f08c47fec0942fa0'])
  })

  test.each([
    ["headline: ['把 Claude Code 装进桌面，', '也装进'],", 'site/src/pages/home/landingContent.ts', 'upstream-brand-as-product'],
    ['<div>Claude Code Haha</div>', 'desktop/src/pages/settings/AboutSettings.tsx', 'legacy-product-identity'],
    ["label = 'cc-haha 标志'", 'mobile/src/ui/Logo.tsx', 'legacy-product-identity'],
    ['The product is now called **cc-haha**.', 'docs/en/start/install.md', 'legacy-product-identity'],
  ])('rejects upstream identity used as the product itself: %s', (content, path, rule) => {
    const errors = rules(identity(path, content)).errors
    expect(errors.some(error => error.includes(rule)), errors.join('\n')).toBe(true)
    expect(errors[0]).toContain(`${path}:1:`)
  })

  test.each([
    ["const GITHUB_REPO = 'https://github.com/NanmiCoder/cc-haha'", 'desktop/src/pages/settings/AboutSettings.tsx', 'identity'],
    ['[私密安全报告](https://github.com/NanmiCoder/cc-haha/security/advisories/new)', 'docs/start/privacy.md', 'links'],
    ['See https://claude.ai/code for the upstream CLI.', 'docs/en/start/install.md', 'links'],
    ['Source: https://github.com/anthropics/claude-code', 'README.en.md', 'identity'],
    ['<https://docs.anthropic.com/en/docs/claude-code/overview>', 'docs/start/troubleshooting.md', 'links'],
  ])('rejects actionable upstream distribution links on any surface: %s', (content, path, kind) => {
    const files = kind === 'identity' ? identity(path, content) : links(path, content)
    expect(rules(files).errors.some(error => error.includes('upstream-distribution-url')),
      rules(files).errors.join('\n')).toBe(true)
  })

  test('an exemption for one rule never hides another rule on the same line', () => {
    const errors = rules(identity('docs/start/install.md',
      '`Claude-Code-Haha-0.5.5.dmg` and https://github.com/anthropics/claude-code',
    )).errors
    expect(errors.some(error => error.includes('legacy-product-identity'))).toBe(false)
    expect(errors.some(error => error.includes('upstream-distribution-url'))).toBe(true)
  })

  test('a baseline entry never hides a different rule on its line', () => {
    const line = "'settings.example.repo': 'https://github.com/NanmiCoder/cc-haha', pub-5210914487984731"
    withBaseline(syntheticBaseline(line), () => {
      const errors = rules(links('desktop/src/i18n/locales/en.ts', line)).errors
      expect(errors.some(error => error.includes('upstream-distribution-url'))).toBe(false)
      expect(errors.some(error => error.includes('upstream-ads-publisher'))).toBe(true)
    })
  })

  test('a new upstream link with different text is not swallowed by the baseline', () => {
    const content = [
      "'settings.example.repo': 'https://github.com/NanmiCoder/cc-haha'",
      "'settings.other.repo': 'https://github.com/anthropics/claude-code'",
    ].join('\n')
    withBaseline(syntheticBaseline('settings.example.repo'), () => {
      const errors = rules(links('desktop/src/i18n/locales/en.ts', content)).errors
      expect(errors.filter(error => error.includes('upstream-distribution-url'))).toHaveLength(1)
      expect(errors[0]).toContain(':2:')
    })
  })

  test('internal identifiers and upstream runtime names are legal on link-only surfaces', () => {
    const content = [
      "'settings.diagnostics.doctorSafeKeys': 'Reset removes only: cc-haha-open-tabs, cc-haha-theme'",
      "'settings.runtime.external': 'Claude Code on this computer'",
      "'settings.general.storageSystemDescription': \"Use Claude Code's standard user directory: ~/.claude\"",
      "'settings.pets.folderDescription': '${CLAUDE_CONFIG_DIR}/cc-haha/pets'",
    ].join('\n')
    expect(rules(links('desktop/src/i18n/locales/en.ts', content)).errors).toEqual([])
  })

  test('diagnostics name the file, line and rule', () => {
    expect(rules(identity('site/src/pages/home/landingContent.ts',
      "headline: ['把 Claude Code 装进桌面，', '也装进'],",
    )).errors[0]).toBe(
      "site/src/pages/home/landingContent.ts:1: upstream-brand-as-product: headline: ['把 Claude Code 装进桌面，', '也装进'],",
    )
  })
})

describe('content audit registry', () => {
  test('every exemption and baseline entry is exact and carries a reason', () => {
    for (const entry of [...EXEMPTIONS, ...BASELINE]) {
      expect(entry.path.startsWith('/')).toBe(false)
      expect(entry.match.length).toBeGreaterThan(0)
      expect(entry.match).not.toBe('*')
      expect(entry.reason.length).toBeGreaterThan(10)
    }
    expect(EXEMPTIONS.some(entry => entry.rule === ('*' as never))).toBe(false)
  })

  test('no known upstream content violations remain in the public surfaces', () => {
    expect(BASELINE).toEqual([])
  })

  test('stale exemptions and stale baselines fail the full audit', () => {
    withBaseline(syntheticBaseline('never-present-in-any-surface'), () => {
      const errors = auditUpstreamContent([]).errors
      expect(errors.some(error => error.startsWith('stale exemption'))).toBe(true)
      expect(errors.some(error => error.startsWith('stale baseline'))).toBe(true)
    })
  })

  test('confirmed media findings name the asset and the visible legacy mark', () => {
    expect(CONFIRMED_MEDIA_FINDINGS.length).toBeGreaterThan(0)
    for (const finding of CONFIRMED_MEDIA_FINDINGS) {
      expect(finding).toContain('site/src/pages/home/assets/')
      expect(finding).toContain('cc-haha')
      expect(finding).toContain(' — ')
    }
  })

  test('remaining legacy self-names are reported as gaps, not silently ignored', () => {
    expect(KNOWN_TEXT_GAPS.length).toBeGreaterThanOrEqual(4)
    expect(KNOWN_TEXT_GAPS.some(gap => gap.includes('i18n/locales'))).toBe(true)
    expect(KNOWN_TEXT_GAPS.some(gap => gap.includes('wordmark'))).toBe(true)
    expect(KNOWN_TEXT_GAPS.every(gap => gap.includes('—'))).toBe(true)
  })

  test('a fixed manifest covers product identity, public docs and release notes', () => {
    const root = join(import.meta.dir, '..', '..')
    const surfaces = collectSurfacePaths(root)
    const byPath = new Map(surfaces.map(surface => [surface.path, surface.kind]))

    for (const path of IDENTITY_SURFACES) expect(byPath.get(path), path).toBe('identity')
    for (const path of LINK_SURFACES) expect(byPath.get(path), path).toBe('links')
    expect(byPath.get('docs/start/install.md')).toBe('identity')
    expect(byPath.get('docs/en/start/install.md')).toBe('identity')
    expect(byPath.get('docs/start/troubleshooting.md')).toBe('links')
    expect(byPath.get('release-notes/v0.5.5.md')).toBe('links')
    expect(surfaces.some(surface => surface.path.includes('_internal'))).toBe(false)
    expect(surfaces.some(surface => surface.path.includes('docs/images/'))).toBe(false)
    expect(MANUAL_REVIEW_SURFACES.length).toBeGreaterThan(4)
    expect(MANUAL_REVIEW_SURFACES.some(surface => surface.includes('film'))).toBe(true)
  })

  test('fails instead of passing when a required input is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'public-content-audit-'))
    try {
      expect(runUpstreamContentAudit(root)).toEqual(['missing required scan root: docs'])
      mkdirSync(join(root, 'docs'))
      expect(runUpstreamContentAudit(root)).toEqual(['missing required scan root: release-notes'])
      mkdirSync(join(root, 'release-notes'))
      expect(runUpstreamContentAudit(root)[0]).toMatch(/^missing required public surface: /)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
