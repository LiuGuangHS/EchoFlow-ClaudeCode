import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('feature quality contract', () => {
  test('keeps root agent guidance small, high-signal, and layered', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')

    // Codex has a 32 KiB default budget for the complete instruction chain.
    // Keep the root well below that limit so nested guidance has room to load.
    expect(Buffer.byteLength(agents)).toBeLessThan(16 * 1024)
    expect(agents).toContain('## 从这里开始')
    expect(agents).toContain('## 仓库地图')
    expect(agents).toContain('## 验证')
    expect(agents).toContain('## 用户状态安全')
    expect(agents).toContain('## 交接')
    expect(agents).toContain('阅读该目录的嵌套 `AGENTS.md` 及适用的祖先规则')
    expect(agents).toContain('工具访问是能力，不是授权。')
    expect(agents).toContain('需要同区域回归测试')
    expect(agents).toContain('`bun run check:impact`')
    expect(agents).toContain('`bun run verify`')
    expect(agents).toContain('必需 PR 检查必须确定性')
    expect(agents).toContain('在机器上找到凭据不等于获得授权')
    expect(agents).toContain('`bun run check:persistence-upgrade`')
    expect(agents).toContain('将 `~/.claude/settings.json` 视为用户拥有的共享状态')
    expect(agents).toContain('实际运行的命令及观察结果')
  })

  test('keeps specialized agent guidance next to the affected code', () => {
    const policy = readFileSync('.github/AGENTS.md', 'utf8')
    const runtime = readFileSync('src/AGENTS.md', 'utf8')
    const desktop = readFileSync('desktop/AGENTS.md', 'utf8')
    const adapters = readFileSync('adapters/AGENTS.md', 'utf8')
    const docs = readFileSync('docs/AGENTS.md', 'utf8')

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
  })

  test('routes mobile work to its specialized guidance', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')
    const mobile = readFileSync('mobile/AGENTS.md', 'utf8')

    expect(agents).toMatch(/\[[^\]]+\]\(mobile\/AGENTS\.md\)/)
    expect(mobile).toContain('`bun run check:mobile`')
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(scripts['check:mobile']).toMatch(/^bun(?: --no-env-file)? run scripts\/pr\/run-mobile-checks\.ts$/)
  })

  test('keeps PR authors accountable for tests, coverage, E2E, and risk', () => {
    const template = readFileSync('.github/pull_request_template.md', 'utf8')

    expect(template).toContain('## 功能质量契约')
    expect(template).toContain('变更范围：')
    expect(template).toContain('新增或更新的测试：')
    expect(template).toContain('覆盖率证据：')
    expect(template).toContain('changed-line coverage')
    expect(template).toContain('E2E / 真实模型证据：')
    expect(template).toContain('已知风险 / 回退：')
    expect(template).toContain('已为每项生产行为变更新增或更新同区域测试')
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
    expect(englishContributing).toContain('push no longer runs a local quality gate')
    expect(englishContributing).toContain('AI Coding Agent Fix Loop')
    expect(rootContributing).toContain('bun run verify')
    expect(rootContributing).toContain('bun run quality:push')
    expect(rootContributing).toContain('不再自动运行本地质量门禁')
  })

  test('keeps desktop native CI aligned with Electron packaging', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    const prQuality = readFileSync('.github/workflows/pr-quality.yml', 'utf8')
    const buildSidecars = readFileSync('desktop/scripts/build-sidecars.ts', 'utf8')

    expect(prQuality).toContain('run: bun run check:native')
    expect(prQuality).toContain('cargo +stable fetch --locked --manifest-path native/agent-desktop/Cargo.toml')
    expect(packageJson.scripts?.['check:native']).toContain('check:agent-desktop')
    expect(prQuality).not.toContain('cargo tauri')
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
    expect(coverageRunner).toContain('evaluateRootCoverage(')
    expect(coverageRunner).toContain('parseBunStartedTestFileCount')
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
    expect(sandbox).toContain("'cc-haha/providers.json'")
  })

  test('keeps general AI coding tools pointed at the same quality bar', () => {
    const instructions = readFileSync('.github/copilot-instructions.md', 'utf8')

    expect(instructions).toContain('遵循根 `AGENTS.md` 和最近的嵌套 `AGENTS.md`')
    expect(instructions).toContain('生产改动须附同区域测试')
    expect(instructions).toContain('保持或提高覆盖率基线')
    expect(instructions).toContain('变更行覆盖率门槛')
    expect(instructions).toContain('E2E 或桌面 UI 冒烟')
    expect(instructions).toContain('临时浏览器自动化')
    expect(instructions).toContain('Provider/auth/runtime-env/model-window/proxy 改动在 `check:impact` 选中时，须运行离线 `bun run check:provider-contract`')
    expect(instructions).toContain('真实冒烟仅作为可信维护者证据，且需要明确授权')
    expect(instructions).toContain('须列出变更文件、新增测试、实际运行的命令及可获得的通过/失败数量')
  })
})
