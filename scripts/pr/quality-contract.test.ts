import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

describe('feature quality contract', () => {
  test('keeps root agent guidance within budget and preserves the repository contract', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')

    // Codex has a 32 KiB default budget for the complete instruction chain.
    // Leave room for the small nested guidance files loaded by affected areas.
    expect(Buffer.byteLength(agents)).toBeLessThan(28 * 1024)

    // The 24 KiB soft threshold is the signal to move content out, not just a
    // line of prose. Leaving it unasserted is how it silently gets crossed.
    expect(Buffer.byteLength(agents)).toBeLessThan(24 * 1024)

    // AGENTS.md states direction; procedures and case law live in docs/.
    // Assert the obligations themselves rather than `## ` section headings, so
    // the file can be restructured without a false failure.
    expect(agents).toContain('## 契约如何维护')
    expect(agents).toContain('否则应放在 `docs/`，并在这里保留一行指针')
    expect(agents).toContain('24 KiB 以下')
    expect(agents).toContain('编辑前检查 `git status --short`')
    expect(agents).toContain('`bun run check:impact`')
    expect(agents).toContain('`bun run verify`')
    expect(agents).toContain('`bun run audit:harness`')
    expect(agents).toContain('`.claude/` 仅供本地使用')
    expect(agents).toContain('`~/.claude/settings.json` 是用户拥有的共享状态')
    expect(agents).toContain('官方 vendor API 和官方 OAuth 集成（包括 Grok Official）')
    expect(agents).toContain('新的 provider 或 preset 默认拒绝')
    expect(agents).toContain('绝不整体使用 `--ours` 或 `--theirs`')
    expect(agents).toContain('`docs/internals/contributing.md` 负责贡献流程、测试设计、质量门禁、coverage 策略和 Agent flow 案例规则')
    expect(agents).toContain('`docs/internals/structure.md` 负责目录地图和模块职责')
    expect(agents).toContain('`docs/_internal/release-windows.md` 及其英文镜像')
    expect(agents).not.toContain('## Build, Test, and Development Commands')
    expect(agents).not.toContain('## Project Structure & Module Organization')
    expect(agents).not.toContain('## Test Design Direction')
    expect(agents).not.toContain('## Desktop & UX Expectations')
    // A resolved gap must not survive as prose. The contract once stated that
    // `mobile/` had no area and no route; both now exist, and nothing tied the
    // claim to the code, so the stale sentence outlived the fix.
    expect(agents).not.toMatch(/`mobile\/` has no/)
  })

  test('keeps pointers out of the contract resolving to real content in docs', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')
    const contributing = readFileSync('docs/internals/contributing.md', 'utf8')
    const englishContributing = readFileSync('docs/en/internals/contributing.md', 'utf8')
    const internalIndex = readFileSync('docs/_internal/README.md', 'utf8')

    expect(agents).toContain('docs/internals/contributing.md')
    expect(agents).not.toContain('### Manual Sync Workflow')
    expect(agents).not.toContain('### Automated Release Tracking')
    expect(agents).not.toContain('upstream-derived')
    expect(agents).not.toContain('former upstream')
    expect(agents).not.toContain('upstream project this repository')
    expect(agents).not.toContain('upstream identity markers')

    expect(contributing).toContain('冲突逐 hunk 裁决')
    expect(englishContributing).toContain('hunk by hunk')
    expect(contributing).not.toContain('archive/upstream-sync-agent-handoff.md')
    expect(englishContributing).not.toContain('archive/upstream-sync-agent-handoff.md')
    expect(internalIndex).not.toContain('upstream-sync-agent-handoff.md')

    // The agent toolset is documented in docs/ and pointed at from AGENTS.md.
    // ECC is no longer the toolset, and re-inlining its commands would put a
    // policy the repository does not follow back into the contract.
    expect(contributing).toContain('## Agent 工具链')
    expect(englishContributing).toContain('## Agent Toolset')
    expect(agents).not.toContain('/ecc:')
    expect(agents).not.toContain('@architect')
  })

  test('keeps the contract vocabulary aligned with the change policy and the docs sections', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')
    const policy = readFileSync('scripts/pr/change-policy.ts', 'utf8')
    const docsGuidance = readFileSync('docs/AGENTS.md', 'utf8')
    const manifest = readFileSync('site/scripts/generate-docs-manifest.mjs', 'utf8')

    // The ChangeArea union is the canonical surface vocabulary. The eight-surface
    // list this file used to carry drifted because nothing tied it to the code;
    // naming every area makes adding or renaming one require a doc update.
    const union = policy.match(/export type ChangeArea =([\s\S]*?)\n\n/)?.[1] ?? ''
    const changeAreas = [...union.matchAll(/'([a-z][a-z-]*)'/g)].map((match) => match[1])
    expect(changeAreas.length).toBeGreaterThan(0)

    const vocabulary = agents.match(/规范词汇以 `scripts\/pr\/change-policy\.ts` 中的 `ChangeArea` 联合类型为准：([^\n]+?)。本文中的文字表面映射/)?.[1] ?? ''
    const documentedAreas = [...vocabulary.matchAll(/`([^`]+)`/g)].map((match) => match[1])
    expect([...documentedAreas].sort()).toEqual([...changeAreas].sort())

    // docs/AGENTS.md states the section list; the site manifest owns it.
    const manifestSections = manifest.match(/export const sections = \[([\s\S]*?)\n\]/)?.[1] ?? ''
    const sectionIds = [...manifestSections.matchAll(/id: '([a-z-]+)'/g)].map((match) => match[1])
    expect(sectionIds.length).toBeGreaterThan(0)

    const documentedSections = [
      ...(docsGuidance.match(/顶层共有七个 section：([^\n]+?)。/)?.[1] ?? '').matchAll(/`([a-z-]+)\//g),
    ].map((match) => match[1])
    expect(documentedSections).toEqual(sectionIds)
  })

  test('keeps area routing in one shared data file', () => {
    const policy = readFileSync('scripts/pr/change-policy.ts', 'utf8')
    const routing = JSON.parse(readFileSync('scripts/pr/area-routing.json', 'utf8')) as {
      areas: Record<string, { prefixes?: string[]; exact?: string[]; excludePrefixes?: string[] }>
    }
    const union = policy.match(/export type ChangeArea =([\s\S]*?)\n\n/)?.[1] ?? ''
    const changeAreas = [...union.matchAll(/'([a-z][a-z-]*)'/g)].map((match) => match[1])

    expect(policy).toContain("from './area-routing.json'")
    expect(Object.keys(routing.areas).sort()).toEqual(changeAreas.sort())
    expect(routing.areas.desktop.prefixes).toContain('native/')
    expect(routing.areas.docs.prefixes).toContain('site/')
    expect(routing.areas.server.prefixes).toContain('runtime/')
    expect(routing.areas.server.prefixes).toContain('tests/')
    expect(routing.areas['cli-core'].excludePrefixes).toContain('src/server/')
  })

  test('keeps every repository path the contract points at resolving', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')

    // `docs/guide/contributing.md` was renamed into `docs/internals/` and left
    // stale pointers behind, so the references are checked rather than trusted.
    // Only root-relative references are checked: nested guidance points at paths
    // relative to its own directory, and home/config paths are not repo paths.
    const roots = ['bin', 'src', 'desktop', 'adapters', 'site', 'docs', 'scripts', 'native', 'mobile', 'release-notes', '.github']
    // Placeholders such as `docs/xxx` and `release-notes/vX.Y.Z.md` are templates.
    const isPlaceholder = (token: string) => token
      .split('/')
      .some((segment) => segment === 'xxx' || segment.includes('X.Y.Z'))

    const references = [...agents.matchAll(/`([^`\n]+)`/g)]
      .map((match) => match[1].trim().replace(/[.,;:]+$/, ''))
      .filter((token) => token.includes('/'))
      .filter((token) => roots.some((root) => token === root || token.startsWith(`${root}/`)))
      .filter((token) => !/[~*?{}<>|]/.test(token))
      .filter((token) => !isPlaceholder(token))

    const unique = [...new Set(references)].sort()
    expect(unique.length).toBeGreaterThan(10)
    for (const reference of unique) {
      expect(existsSync(reference), `AGENTS.md points at \`${reference}\`, which does not exist`).toBe(true)
    }
  })

  test('keeps specialized agent guidance next to the affected code', () => {
    const policy = readFileSync('.github/AGENTS.md', 'utf8')
    const runtime = readFileSync('src/AGENTS.md', 'utf8')
    const desktop = readFileSync('desktop/AGENTS.md', 'utf8')
    const adapters = readFileSync('adapters/AGENTS.md', 'utf8')
    const docs = readFileSync('docs/AGENTS.md', 'utf8')
    const mobile = readFileSync('mobile/AGENTS.md', 'utf8')

    expect(policy).toContain('`scripts/pr/change-policy.ts` 是路径到检查路由的唯一事实来源')
    expect(policy).toContain('`pull_request_target`')
    expect(policy).toContain('`pr-quality-gate`')
    expect(runtime).toContain('`bun run check:server`')
    expect(runtime).toContain('临时 `HOME`/`CLAUDE_CONFIG_DIR`')
    expect(runtime).toContain('`bun run check:provider-contract`')
    expect(desktop).toContain('`bun run check:desktop`')
    expect(desktop).toContain('`bun run check:chat-contract`')
    expect(adapters).toContain('`bun run check:adapters`')
    expect(docs).toContain('`bun run check:docs`')
    expect(mobile).toContain('`bun run check:mobile`')
  })

  test('keeps PR authors accountable for tests, coverage, E2E, and risk', () => {
    const template = readFileSync('.github/pull_request_template.md', 'utf8')

    expect(template).toContain('## Feature Quality Contract')
    expect(template).toContain('## Tooling & Reproduction Evidence')
    expect(template).toContain('`bun run audit:harness`')
    expect(template).toContain('`.claude/` local state was not committed')
    expect(template).toContain('Changed surface:')
    expect(template).toContain('Tests added or updated:')
    expect(template).toContain('Coverage evidence:')
    expect(template).toContain('changed-line coverage')
    expect(template).toContain('E2E / live-model evidence:')
    expect(template).toContain('Known risk / rollback:')
    expect(template).toContain('I added or updated same-area tests')
  })

  test('keeps quality policy and cross-process boundaries maintainer-owned', () => {
    const codeowners = readFileSync('.github/CODEOWNERS', 'utf8')

    expect(codeowners).toContain('/.github/workflows/ @LiuGuangHS')
    expect(codeowners).toContain('/AGENTS.md @LiuGuangHS')
    expect(codeowners).toContain('**/AGENTS.md @LiuGuangHS')
    expect(codeowners).toContain('/CONTRIBUTING.md @LiuGuangHS')
    expect(codeowners).toContain('/scripts/pr/ @LiuGuangHS')
    expect(codeowners).toContain('/scripts/quality-gate/ @LiuGuangHS')
    expect(codeowners).toContain('/desktop/src/api/websocket* @LiuGuangHS')
    expect(codeowners).toContain('/desktop/src/lib/persistenceMigrations* @LiuGuangHS')
    expect(codeowners).toContain('/src/server/services/conversationService* @LiuGuangHS')
    expect(codeowners).toContain('/src/server/proxy/ @LiuGuangHS')
    expect(codeowners).toContain('/src/server/ws/ @LiuGuangHS')
    expect(codeowners).toContain('/src/services/openaiAuth/ @LiuGuangHS')
    expect(codeowners).toContain('/src/utils/model/ @LiuGuangHS')
  })

  test('keeps the one-command verification entrypoint documented', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>
    }
    const prePushHook = readFileSync('scripts/git-hooks/pre-push', 'utf8')
    const contributing = readFileSync('docs/internals/contributing.md', 'utf8')
    const englishContributing = readFileSync('docs/en/internals/contributing.md', 'utf8')
    const rootContributing = readFileSync('CONTRIBUTING.md', 'utf8')

    expect(packageJson.scripts?.['audit:harness']).toBe('node scripts/harness-audit.js repo --format json --fail-on-required')
    expect(packageJson.scripts?.verify).toBe('bun run quality:pr')
    expect(packageJson.scripts?.['quality:verify']).toBe('bun run quality:pr')
    expect(packageJson.scripts?.['quality:push']).toBe('bun run quality:gate --mode pr --skip coverage')
    expect(packageJson.scripts?.['check:persistence-upgrade']).toBe('bun run scripts/quality-gate/persistence-upgrade.ts')
    expect(packageJson.scripts?.['check:provider-contract']).toBe('bun run scripts/pr/run-provider-contract-tests.ts')
    expect(packageJson.scripts?.['check:chat-contract']).toBe('bun run scripts/pr/run-chat-contract-tests.ts')
    expect(packageJson.scripts?.['check:policy']).toContain('bun test ./scripts/')
    expect(packageJson.scripts?.['check:native']).toContain('electron:package:dir')
    expect(packageJson.scripts?.['check:native']).toContain('test:package-smoke:current')
    expect(packageJson.scripts?.['test:package-smoke:current']).toBe('bun run scripts/quality-gate/package-smoke/current.ts')
    expect(prePushHook).toContain('non-blocking')
    expect(prePushHook).not.toContain('\nbun run quality:push\n')
    expect(prePushHook).not.toContain('quality:gate')
    expect(prePushHook).not.toContain('quality:smoke')
    expect(contributing).toContain('bun run verify')
    expect(contributing).toContain('bun run quality:push')
    expect(contributing).toContain('push 不再自动运行本地质量门禁')
    expect(contributing).toContain('AI Coding Agent 修复循环')
    expect(englishContributing).toContain('bun run verify')
    expect(englishContributing).toContain('bun run quality:push')
    expect(englishContributing).toContain('A push no longer runs the local quality gate automatically')
    expect(englishContributing).toContain('## AI Coding Agent Fix Loop')
    expect(rootContributing).toContain('bun run verify')
    expect(rootContributing).toContain('bun run quality:push')
    expect(rootContributing).toContain('不再自动运行本地质量门禁')
  })

  test('keeps the English contributing mirror free of Chinese text', () => {
    // The mirror was once overwritten with the Chinese page, and the harness audit,
    // which only checks that a counterpart file exists, stayed green.
    const englishContributing = readFileSync('docs/en/internals/contributing.md', 'utf8')

    expect(englishContributing).not.toMatch(/[一-鿿]/)
  })

  test('keeps desktop native CI aligned with Electron packaging', () => {
    const prQuality = readFileSync('.github/workflows/pr-quality.yml', 'utf8')
    const buildSidecars = readFileSync('desktop/scripts/build-sidecars.ts', 'utf8')

    expect(prQuality).toContain('run: bun run check:native')
    expect(prQuality).not.toContain('dtolnay/rust-toolchain')
    expect(prQuality).not.toContain('swatinem/rust-cache')
    expect(prQuality).not.toContain('libwebkit2gtk')
    expect(prQuality).not.toContain('libayatana-appindicator')
    expect(buildSidecars).not.toContain("Bun.spawn(['rustc'")
    expect(buildSidecars).toContain("process.platform")
    expect(buildSidecars).toContain("process.arch")
  })

  test('keeps stateful server tests deterministic', () => {
    const serverRunner = readFileSync('scripts/pr/run-server-tests.ts', 'utf8')
    const providerRunner = readFileSync('scripts/pr/run-provider-contract-tests.ts', 'utf8')
    const chatRunner = readFileSync('scripts/pr/run-chat-contract-tests.ts', 'utf8')
    const testEnvironment = readFileSync('scripts/pr/test-environment.ts', 'utf8')
    const coverageRunner = readFileSync('scripts/quality-gate/coverage.ts', 'utf8')

    expect(serverRunner).toContain("'--max-concurrency=1'")
    expect(serverRunner).toContain("'--timeout=20000'")
    expect(serverRunner).toContain('TEST_PROCESS_CONCURRENCY = 4')
    expect(serverRunner).toContain("const roots = ['src', 'tests']")
    expect(serverRunner).toContain('TEST_FILE_PATTERN')
    expect(serverRunner).toContain("'--no-env-file'")
    expect(serverRunner).toContain('createSandboxedTestEnvironment')
    expect(serverRunner).toContain('rootBunTestFilter(file)')
    expect(serverRunner).toContain('evidenceComplete')
    expect(serverRunner).toContain('reportedFiles === 1')
    expect(serverRunner).toContain('passedTests + failedTests > 0')
    expect(testEnvironment).toContain('CLAUDE_CONFIG_DIR:')
    expect(testEnvironment).toContain("BUN_OPTIONS: '--no-env-file'")
    expect(coverageRunner).toContain('TEST_FILE_PATTERN')
    expect(coverageRunner).toContain("'--no-env-file'")
    expect(coverageRunner).toContain('createSandboxedTestEnvironment')
    expect(coverageRunner).toContain('serverFiles.map(rootBunTestFilter)')
    expect(coverageRunner).toContain("correctness is enforced by check:server's per-file sandboxed test processes")
    expect(coverageRunner).toContain('rootCoverageAvailable')
    expect(coverageRunner).toContain('rootTestDiscoveryComplete')
    expect(coverageRunner).toContain("id: 'root-runtime'")
    for (const contractRunner of [providerRunner, chatRunner]) {
      expect(contractRunner).toContain("'--no-env-file'")
      expect(contractRunner).toContain('createSandboxedTestEnvironment')
      expect(contractRunner).toContain('rootBunTestFilter')
    }
  })

  test('keeps quality gate lanes that boot the real server out of the developer config', () => {
    // Baseline, desktop smoke, and provider smoke all spawn src/server/index.ts.
    // That server resolves transcripts, session index, diagnostics, and settings
    // from CLAUDE_CONFIG_DIR, so inheriting the parent environment makes a QA run
    // read and write the developer's real ~/.claude. Desktop smoke additionally
    // switched the global permission mode to bypassPermissions.
    const laneSources = {
      'scripts/quality-gate/baseline/execute.ts': readFileSync('scripts/quality-gate/baseline/execute.ts', 'utf8'),
      'scripts/quality-gate/desktop-smoke/execute.ts': readFileSync('scripts/quality-gate/desktop-smoke/execute.ts', 'utf8'),
      'scripts/quality-gate/provider-smoke/execute.ts': readFileSync('scripts/quality-gate/provider-smoke/execute.ts', 'utf8'),
    }

    for (const [path, source] of Object.entries(laneSources)) {
      const serverSpawns = source.split('\n').filter((line) => line.includes("'src/server/index.ts'"))
      expect(serverSpawns.length, `${path} should still spawn the real server`).toBeGreaterThan(0)
      expect(source, `${path} must sandbox the server it spawns`).toContain('createQualityGateSandbox')
      expect(source, `${path} must pass the sandbox environment to the server`).toContain('...sandbox.env')
      expect(source, `${path} must not inherit the developer environment`).not.toContain('...process.env,\n      SERVER_PORT')
      expect(source, `${path} must release the sandbox`).toContain('sandbox.cleanup()')
      expect(
        source.includes('applyUserStateGuard') || source.includes('detectUserStateMutations'),
        `${path} must fail the lane when user state was written`,
      ).toBe(true)
    }

    const sandbox = readFileSync('scripts/quality-gate/sandbox.ts', 'utf8')
    expect(sandbox).toContain('createSandboxedTestEnvironment')
    expect(sandbox).toContain('GUARDED_USER_STATE_PATHS')
    expect(sandbox).toContain("'settings.json'")
    expect(sandbox).toContain("'echoflow-code/providers.json'")
  })

  test('keeps general AI coding tools pointed at the same quality bar', () => {
    const instructions = readFileSync('.github/copilot-instructions.md', 'utf8')

    expect(instructions).toContain('Follow the root `AGENTS.md` and the nearest nested `AGENTS.md`')
    expect(instructions).toContain('Add same-area tests with the production change')
    expect(instructions).toContain('Preserve or improve the coverage ratchet')
    expect(instructions).toContain('changed-line coverage threshold')
    expect(instructions).toContain('E2E or desktop UI smoke')
    expect(instructions).toContain('Ad-hoc browser automation')
    expect(instructions).toContain('Provider/auth/runtime-env/model-window/proxy changes require offline `bun run check:provider-contract`')
    expect(instructions).toContain('Live smoke is trusted-maintainer evidence only and requires explicit authorization')
    expect(instructions).toContain('include changed files, tests added, commands actually run with pass/fail counts')
  })

  test('keeps every policy test either on the gate or on a reasoned exclusion', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>
    }
    const gate = packageJson.scripts?.['check:policy'] ?? ''

    // `scripts/` holds the policy suite and the sample projects the quality gate
    // compiles. Samples are inputs that fail on purpose, so they can never run
    // here. Every other test claims to protect something, and a test the gate
    // never executes is indistinguishable from no test at all: harness-audit.test.ts
    // sat unexecuted while the script it covers gated every pull request, and the
    // Windows installer contracts were unrun despite guarding release integrity.
    const samplePrefixes = [
      'scripts/quality-gate/baseline/fixtures/',
      'scripts/quality-gate/desktop-smoke/fixtures/',
    ]
    const reasonedExclusions = new Map([
      ['scripts/perf/local-index-acceptance.test.ts', 'builds a local index corpus; the full sweep owns its runtime'],
      ['scripts/perf/local-index-corpus.test.ts', 'generates a 10k-session corpus; the full sweep owns its runtime'],
      ['scripts/cli-launcher.test.ts', 'spawns the real CLI; check:server owns that sandbox'],
      ['scripts/release.test.ts', 'creates a real git repository and commits; the release workflow owns it'],
    ])

    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name).replaceAll('\\', '/')
        if (entry.isDirectory()) walk(full, acc)
        else if (entry.name.endsWith('.test.ts')) acc.push(full)
      }
      return acc
    }

    const onDisk = walk('scripts')
    const isExcluded = (file: string) =>
      samplePrefixes.some((prefix) => file.startsWith(prefix)) || reasonedExclusions.has(file)

    // Gate entries pointing at deleted files still read as coverage.
    for (const token of gate.split('&&')[0].split(' ').filter((part) => part.startsWith('./scripts/'))) {
      const path = token.replace('./', '')
      expect(existsSync(path), `check:policy lists \`${path}\`, which no longer exists`).toBe(true)
    }

    // A test nobody runs is not protection.
    for (const file of onDisk) {
      if (isExcluded(file)) continue
      expect(
        gate.includes(`./${file}`),
        `\`${file}\` is not on the check:policy gate; add it there or record the reason in the exclusion map`,
      ).toBe(true)
    }

    // An exclusion that outlives its file turns a decision into an oversight.
    for (const target of [...reasonedExclusions.keys(), ...samplePrefixes]) {
      const alive = target.endsWith('/')
        ? onDisk.some((candidate) => candidate.startsWith(target))
        : existsSync(target)
      expect(alive, `excluded \`${target}\` matches nothing; drop it or fix the path`).toBe(true)
    }
  })

  test('keeps the root test harness preloads load-bearing', () => {
    // A bunfig preload that is empty (or that no longer patches anything) is a
    // silent no-op: the suite still passes, the commit message still claims the
    // preload is wired in, and the failure only shows up as unexplained flakes
    // under load. `test-preload.ts` was once committed as a 0-byte file while
    // its commit message said the test runtime was patched.
    const bunfig = readFileSync('bunfig.toml', 'utf8')
    const preloadPaths = [...bunfig.matchAll(/preload\s*=\s*\["\.\/([^"]+)"\]/g)].map((match) => match[1])

    expect(preloadPaths.length).toBeGreaterThan(0)
    for (const preloadPath of preloadPaths) {
      expect(existsSync(preloadPath), `bunfig.toml preloads \`${preloadPath}\`, which does not exist`).toBe(true)
      const source = readFileSync(preloadPath, 'utf8')
      expect(
        source.trim().length,
        `\`${preloadPath}\` is empty, so the preload it declares is a no-op`,
      ).toBeGreaterThan(0)
    }

    // The test preload must actually patch the runtime it claims to harden.
    const testPreload = readFileSync('test-preload.ts', 'utf8')
    expect(testPreload).toContain('serveWithTransientBindRetry')
  })
})
