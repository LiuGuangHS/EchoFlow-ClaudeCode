import { describe, expect, spyOn, test } from 'bun:test'
import { Lexer } from 'marked'
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
  stripNonProse,
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

  test('exemptions mask only approved snippets and retain original diagnostics', () => {
    const attribution = '[cc-haha](https://github.com/NanmiCoder/cc-haha)'
    const text = `  ${attribution} and https://github.com/anthropics/claude-code  `
    const result = rules(identity('README.md', `Clean line\n${text}`))
    expect(result.findings).toEqual([{
      path: 'README.md', line: 2, rule: 'upstream-distribution-url', text: text.trim(),
    }])
    expect(result.errors).toEqual([`README.md:2: upstream-distribution-url: ${text.trim()}`])
    expect(rules(identity('README.md', `${attribution} cc-haha`)).findings)
      .toEqual([{ path: 'README.md', line: 1, rule: 'legacy-product-identity', text: `${attribution} cc-haha` }])
  })

  test('all occurrences of multiple approved snippets on one line are masked', () => {
    expect(rules(identity('THIRD_PARTY_LICENSES.md', [
      '## Claude Code runtime (derived source)',
      'based on the Claude Code source code',
      '## Claude Code runtime (derived source)',
    ].join(' and '))).errors).toEqual([])
    const attribution = '[cc-haha](https://github.com/NanmiCoder/cc-haha)'
    expect(rules(identity('README.md', `${attribution} and ${attribution}`)).errors).toEqual([])
  })

  test.each([
    ['docs/start/code-signing.md', '从'],
    ['docs/en/start/code-signing.md', 'in'],
  ])('code-signing attribution exempts only the complete approved link: %s', (path, prefix) => {
    const attribution = `${prefix} [NanmiCoder/cc-haha](https://github.com/NanmiCoder/cc-haha)`
    expect(rules(links(path, attribution)).errors).toEqual([])
    const changedTarget = `${prefix} [NanmiCoder/cc-haha](https://github.com/NanmiCoder/cc-haha/releases)`
    expect(rules(links(path, changedTarget)).findings).toEqual([{
      path, line: 1, rule: 'upstream-distribution-url', text: changedTarget,
    }])
    expect(rules(links(path, `${attribution} https://claude.ai/code`)).findings).toHaveLength(1)
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

  test('public doc prose reports legacy self-descriptions without touching technical identifiers', () => {
    const content = [
      'CLI 是 cc-haha 的内核，桌面端每个会话背后跑的都是它。',
      '源码仓库中的命令是 `./bin/claude-haha`；配置文件见 `~/.claude/cc-haha/providers.json`。',
      '| `CC_HAHA_TRACE_DIR` | 为空时仍使用配置目录下的 `cc-haha/traces` |',
      '```bash',
      './bin/claude-haha --print "hello"',
      '```',
      '归属说明见 [NanmiCoder/cc-haha](./attribution.md)。',
      '已安装版本的进程可能仍显示旧名称 `Claude Code Haha`。',
    ].join('\n')
    const errors = rules(links('docs/start/fixture.md', content)).errors
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('docs/start/fixture.md:1: legacy-self-description')
  })

  test('visible link labels remain prose while qualified attribution stays legal', () => {
    const errors = rules(links('docs/start/fixture.md', [
      '打开 [cc-haha](./install.md) 开始使用。',
      '来源：[NanmiCoder/cc-haha](./attribution.md)。',
    ].join('\n'))).errors
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('docs/start/fixture.md:1: legacy-self-description')
  })

  test('code spans and fenced examples support matching delimiters', () => {
    const errors = rules(links('docs/start/fixture.md', [
      '``配置 `cc-haha` 路径``',
      '~~~~text',
      'cc-haha',
      '~~~',
      '```',
      'cc-haha',
      '~~~~',
      '````text',
      'cc-haha',
      '```',
      'cc-haha',
      '````',
      '现在使用 cc-haha。',
    ].join('\n'))).errors
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('docs/start/fixture.md:13: legacy-self-description')
  })

  test('escaped backticks remain visible prose while escaped backslashes allow code spans', () => {
    const content = [
      String.raw`Visible \`cc-haha\` name.`,
      String.raw`Technical \\` + '`cc-haha` path.',
      '`cc-haha\\` is a code span with a trailing backslash.',
    ].join('\n')
    const result = rules(links('docs/start/fixture.md', content))
    expect(result.findings).toEqual([{
      path: 'docs/start/fixture.md', line: 1, rule: 'legacy-self-description',
      text: String.raw`Visible \`cc-haha\` name.`,
    }])
  })

  test('multiline code spans exclude code but preserve prose on their closing line', () => {
    const result = rules(links('docs/start/fixture.md', [
      'Technical ``config',
      'cc-haha and `internal`',
      'path``; now use cc-haha.',
      '',
      'An unmatched ` delimiter is prose.',
      '',
      'cc-haha remains prose before another unmatched `.',
    ].join('\n')))
    expect(result.findings.map(finding => [finding.line, finding.text])).toEqual([
      [3, 'path``; now use cc-haha.'],
      [7, 'cc-haha remains prose before another unmatched `.'],
    ])
  })

  test('blockquote fenced examples exclude prose names but still scan upstream URLs', () => {
    const result = rules(links('docs/start/fixture.md', [
      '> ````text',
      '> cc-haha',
      '> ```',
      '> https://github.com/anthropics/claude-code',
      '> ````',
      '> Now use cc-haha.',
      '',
      '> ~~~text',
      '> claude-haha',
      '> ~~~',
      'Now use cc-haha.',
    ].join('\n')))
    expect(result.findings.map(finding => [finding.line, finding.rule])).toEqual([
      [4, 'upstream-distribution-url'],
      [6, 'legacy-self-description'],
      [11, 'legacy-self-description'],
    ])
  })

  test('nested inline code is masked without hiding visible labels or losing line numbers', () => {
    const result = rules(links('docs/start/fixture.md', [
      '**Technical `cc-haha`** and [technical `claude-haha`](./config.md).',
      'A multiline `config',
      'cc-haha',
      'path` ends here.',
      'Open [cc-haha](./install.md).',
    ].join('\r\n')))
    expect(result.findings).toEqual([{
      path: 'docs/start/fixture.md', line: 5, rule: 'legacy-self-description',
      text: 'Open [cc-haha](./install.md).',
    }])
  })

  test('fence state ends with its quote container and never disables URL rules', () => {
    const result = rules(links('docs/start/fixture.md', [
      '> > ```',
      '> > cc-haha',
      '> cc-haha is visible outside the nested quote.',
      '```text',
      'cc-haha https://claude.ai/code',
      '```',
      'Now use cc-haha.',
    ].join('\n')))
    expect(result.findings.map(finding => [finding.line, finding.rule])).toEqual([
      [3, 'legacy-self-description'],
      [5, 'upstream-distribution-url'],
      [7, 'legacy-self-description'],
    ])
  })

  test('list tilde fences exclude code without hiding the following paragraph', () => {
    const result = rules(links('docs/start/fixture.md', '- ~~~text\n  cc-haha\n  ~~~\n\nNow use cc-haha.'))
    expect(result.errors).toEqual([
      'docs/start/fixture.md:5: legacy-self-description: Now use cc-haha.',
    ])
  })

  test('unmatched heading backticks never pair across a paragraph boundary', () => {
    const result = rules(links('docs/start/fixture.md', '# Heading `\ncc-haha is the product.\n## Next `'))
    expect(result.errors).toEqual([
      'docs/start/fixture.md:2: legacy-self-description: cc-haha is the product.',
    ])
  })

  test('CRLF nested quotes and task lists retain original lines for repeated prose and code URLs', () => {
    const result = rules(links('docs/start/fixture.md', [
      '> - [x] Now use cc-haha.',
      '>   - [ ] Technical ``config',
      '>     cc-haha',
      '>     path``; now use cc-haha.',
      '>',
      '>   - ~~~text',
      '>     Now use cc-haha.',
      '>     https://claude.ai/code',
      '>     ~~~',
      '>',
      '>     Now use cc-haha.',
      '',
      'Now use cc-haha.',
    ].join('\r\n')))
    expect(result.errors).toEqual([
      'docs/start/fixture.md:1: legacy-self-description: > - [x] Now use cc-haha.',
      'docs/start/fixture.md:4: legacy-self-description: >     path``; now use cc-haha.',
      'docs/start/fixture.md:8: upstream-distribution-url: >     https://claude.ai/code',
      'docs/start/fixture.md:11: legacy-self-description: >     Now use cc-haha.',
      'docs/start/fixture.md:13: legacy-self-description: Now use cc-haha.',
    ])
  })

  test('table and link labels retain repeated source rows while code and link metadata stay excluded', () => {
    const result = rules(links('docs/start/fixture.md', [
      '| [cc-haha](./install.md) | Code |',
      '| --- | --- |',
      '| `cc-haha\\|config` | [technical `cc-haha`](./cc-haha.md "cc-haha") |',
      '| [cc-haha](./install.md) | `cc-haha` |',
      '| [cc-haha](./install.md) | `cc-haha` |',
      '| cc-`config`haha | [technical `cc-haha`](./cc-haha.md "cc-haha") |',
      '| `https://claude.ai/code` | `cc-haha` |',
      '',
      '[technical `cc-haha`](./cc-haha.md "cc-haha")',
      '',
      '[cc-haha](./install.md)',
    ].join('\r\n')))
    expect(result.errors).toEqual([
      'docs/start/fixture.md:1: legacy-self-description: | [cc-haha](./install.md) | Code |',
      'docs/start/fixture.md:4: legacy-self-description: | [cc-haha](./install.md) | `cc-haha` |',
      'docs/start/fixture.md:5: legacy-self-description: | [cc-haha](./install.md) | `cc-haha` |',
      'docs/start/fixture.md:7: upstream-distribution-url: | `https://claude.ai/code` | `cc-haha` |',
      'docs/start/fixture.md:11: legacy-self-description: [cc-haha](./install.md)',
    ])
  })

  test('top-level and list-indented code exclude prose names without disabling URL scans', () => {
    const result = rules(links('docs/start/fixture.md', [
      '    cc-haha https://claude.ai/code',
      '',
      '- Example',
      '',
      '      cc-haha',
      '',
      '  Now use cc-haha.',
    ].join('\n')))
    expect(result.errors).toEqual([
      'docs/start/fixture.md:1: upstream-distribution-url: cc-haha https://claude.ai/code',
      'docs/start/fixture.md:7: legacy-self-description: Now use cc-haha.',
    ])
  })

  test('loose task checkboxes and trailing blank lines keep repeated nested prose on its own line', () => {
    const content = [
      '> - [X]   `cc-haha`',
      '>',
      '>   Now use cc-haha.',
      '>',
      '> - [ ]   Now use cc-haha.',
      '>',
      '>   ~~~',
      '>   Now use cc-haha.',
      '>   ~~~',
      '>',
      '>   Now use cc-haha.',
      '>',
      '> - Plain',
      '>',
      '>       Now use cc-haha.',
      '>',
      '>   Now use cc-haha.',
      '>',
      '',
      '',
    ].join('\n')
    expect(rules(links('docs/start/fixture.md', content)).findings.map(finding => finding.line))
      .toEqual([3, 5, 11, 17])
    expect(stripNonProse(content).split('\n')).toHaveLength(content.split('\n').length)
  })

  test('nested table cells use row positions, never repeated-cell searches or pipe splitting', () => {
    const result = rules(links('docs/start/fixture.md', [
      '> - Table',
      '>',
      '>   | `cc-haha` | cc-haha |',
      '>   | --- | --- |',
      '>   | `cc-haha\\|config` | cc-haha |',
      '>   | cc- | haha |',
      '>   | `cc-haha` | `cc-haha` |',
      '>   | `cc-haha` | cc-haha |',
    ].join('\n')))
    expect(result.findings.map(finding => finding.line)).toEqual([3, 5, 8])
  })

  test('multiline destinations and repeated reference definitions do not hide later visible labels', () => {
    const result = rules(links('docs/start/fixture.md', [
      '[technical `cc-haha`](',
      '  ./cc-haha.md',
      '  "cc-haha"',
      ')',
      '',
      '[technical `cc-haha`][same]',
      '',
      '[cc-haha][same]',
      '',
      '[same]: ./cc-haha.md "cc-haha"',
      '[same]: ./cc-haha.md "cc-haha"',
      '',
      '[cc-haha][same]',
    ].join('\n')))
    expect(result.findings.map(finding => [finding.line, finding.text])).toEqual([
      [8, '[cc-haha][same]'],
      [13, '[cc-haha][same]'],
    ])
  })

  test.each([
    ['[ref]: ./safe\n[ref]: ./safe "Now use cc-haha."\nNow use cc-haha.', 3, 'Now use cc-haha.'],
    ['- intro\n      config\n\n  cc-haha', 4, 'cc-haha'],
    ['> > A\n> > B\ncc-haha', 3, 'cc-haha'],
    ['> [ref]: ./safe\n> [ref]: ./safe "Now use cc-haha."\n> Now use cc-haha.', 3, '> Now use cc-haha.'],
    ['- intro\n      config\n\n\n  cc-haha', 5, 'cc-haha'],
    ['> > > A\n> > > B\ncc-haha', 3, 'cc-haha'],
    ['> > A\n> > B\nC\ncc-haha', 4, 'cc-haha'],
    ['[cc-haha]: ./safe\n[cc-haha]: ./safe\n[cc-haha]', 3, '[cc-haha]'],
    ['[cc-haha]: ./safe\n[cc-haha]: ./safe\n[cc-haha]\n\nFollowing block.', 3, '[cc-haha]'],
    ['> > A\nB\n> > cc-haha', 3, '> > cc-haha'],
    ['[ref]: ./safe\n[ref]: ./safe\n[other]: ./safe\n\n[cc-haha][other]', 5, '[cc-haha][other]'],
  ])('maps lexer-normalized prose back to its source line: %j', (content, line, text) => {
    expect(rules(links('docs/start/fixture.md', content)).findings).toEqual([{
      path: 'docs/start/fixture.md', line, rule: 'legacy-self-description', text,
    }])
    expect(stripNonProse(content).split('\n')).toHaveLength(content.split('\n').length)
  })

  test('literal HTML block backticks and indented paragraph continuations remain prose', () => {
    const result = rules(links('docs/start/fixture.md', [
      '<div>',
      '`cc-haha`',
      '</div>',
      '',
      '<kbd>`cc-haha`</kbd>',
      '',
      'Paragraph',
      '    cc-haha is still paragraph text.',
    ].join('\n')))
    expect(result.findings.map(finding => finding.line)).toEqual([2, 8])
  })

  test.each(['\n', '\r\n', '\r'])('normalizes parser newlines without joining words or moving diagnostics: %j', newline => {
    const content = [
      '# Heading `',
      'cc-haha is the product.',
      '## Next `',
      '',
      'cc-`config`haha',
      'cc-[`config`](./cc-haha.md "cc-haha")haha',
      '',
    ].join(newline)
    expect(rules(links('docs/start/fixture.md', content)).errors).toEqual([
      'docs/start/fixture.md:2: legacy-self-description: cc-haha is the product.',
    ])
    expect(stripNonProse(content).split('\n')).toHaveLength(7)
  })

  test('unmappable lexer output fails explicitly rather than dropping prose', () => {
    const tokens = Lexer.lex('cc-haha')
    tokens[0].raw = 'not present in the source'
    const lex = spyOn(Lexer, 'lex').mockReturnValue(tokens)
    try {
      expect(() => stripNonProse('cc-haha')).toThrow('Cannot map Markdown paragraph near line 1')
    } finally {
      lex.mockRestore()
    }
  })

  test('a cleaned public doc page has no prose self-name findings', () => {
    expect(rules(links('docs/start/fixture.md',
      'CLI 是 EchoFlow Code 的内核，命令是 `./bin/claude-haha`。',
    )).errors).toEqual([])
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

  test('every matching exemption is used, and removing its snippet makes it stale', () => {
    const files: ScannedFile[] = [...new Set(EXEMPTIONS.map(entry => entry.path))].map(path => ({
      path,
      kind: IDENTITY_SURFACES.includes(path) ? 'identity' : 'links',
      content: [...new Set(EXEMPTIONS.filter(entry => entry.path === path).map(entry => entry.match))].join(' and '),
    }))
    expect(auditUpstreamContent(files).errors).toEqual([])
    const removed = EXEMPTIONS.find(entry => entry.path === 'README.md' && entry.rule === 'upstream-distribution-url')!
    files.find(file => file.path === removed.path)!.content = 'Clean replacement'
    expect(auditUpstreamContent(files).errors).toContain(
      `stale exemption (${removed.path}, ${removed.rule}): ${removed.match}`,
    )
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
