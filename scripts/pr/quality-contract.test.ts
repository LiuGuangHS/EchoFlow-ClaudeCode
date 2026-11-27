import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

describe('feature quality contract', () => {
  test('keeps root agent guidance small, high-signal, and layered', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')

    // Codex has a 32 KiB default budget for the complete instruction chain.
    // Keep the root well below that limit so nested guidance has room to load.
    expect(Buffer.byteLength(agents)).toBeLessThan(16 * 1024)
    expect(agents).toContain('`bun run check:impact`')
    expect(agents).toContain('`bun run verify`')
    expect(agents).toContain('`bun run check:persistence-upgrade`')
  })

  test('keeps area contracts in one first-party rule file without losing validation entrypoints', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')
    for (const section of ['CLI 与 IM', '桌面', '移动端', '文档与站点', 'CI 与仓库策略']) {
      expect(agents).toContain(`### ${section}`)
    }
    expect(agents).toContain('`scripts/pr/change-policy.ts` 是路径到检查路由的唯一事实来源')
    expect(agents).toContain('`pull_request_target`')
    expect(agents).toContain('`pr-quality-gate`')
    expect(agents).toContain('临时 `HOME`/`CLAUDE_CONFIG_DIR`')
    expect(agents).toContain('`ChatPort`')
    expect(agents).toContain('所有发布产物必须排除')
    for (const directory of ['.github', 'src', 'desktop', 'desktop/src/components', 'adapters', 'docs', 'mobile', 'site']) {
      expect(existsSync(`${directory}/AGENTS.md`)).toBe(false)
    }
    expect(existsSync('native/agent-desktop/AGENTS.md')).toBe(true)
    const design = readFileSync('DESIGN.md', 'utf8')
    expect(design).toContain('useDismissable')
    expect(design).toContain('aria-describedby')
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    for (const lane of ['server', 'provider-contract', 'desktop', 'chat-contract', 'adapters', 'docs']) {
      expect(typeof scripts[`check:${lane}`]).toBe('string')
    }
  })

  test('keeps mobile contracts and its existing check entrypoint', () => {
    const agents = readFileSync('AGENTS.md', 'utf8')
    expect(agents).toContain('(mobile/RELEASING.md)')
    expect(agents).toContain('`bunx expo install`')
    expect(agents).toContain('development build')
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(scripts['check:mobile']).toMatch(/^bun(?: --no-env-file)? run scripts\/pr\/run-mobile-checks\.ts$/)
  })

  test('links the PR template to the contribution guide', () => {
    const template = readFileSync('.github/pull_request_template.md', 'utf8')
    expect(template).toContain('(https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/docs/internals/contributing.md#pr-提交流程)')
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
    expect(englishContributing).toContain('bun run verify')
    expect(englishContributing).toContain('bun run quality:push')
    expect(rootContributing).toContain('docs/internals/contributing.md#ai-coding-agent-修复循环')
    expect(rootContributing).toContain('docs/en/internals/contributing.md#ai-coding-agent-fix-loop')
    expect(packageJson.scripts?.['quality:pr']).toBe('bun run quality:gate --mode pr')
    expect(packageJson.scripts?.['check:policy']).toContain('./scripts/pr/ci-preparation.test.ts')
  })

  test('keeps bilingual release guidance aligned with the actual publication gate', () => {
    for (const path of ['docs/internals/contributing.md', 'docs/en/internals/contributing.md']) {
      const guidance = readFileSync(path, 'utf8')
      for (const job of ['verify-governance', 'verify-runtime', 'verify-desktop', 'release-verify-gate', 'publish-release']) {
        expect(guidance, path).toContain(`\`${job}\``)
      }
      expect(guidance, path).toContain('check:product-identity')
      expect(guidance, path).toContain('check:upstream-content')
      expect(guidance, path).not.toMatch(/不跑任何质量门禁|runs no quality gate/)
    }
  })

  test('keeps bilingual verification evidence limits explicit', () => {
    for (const path of ['docs/internals/contributing.md', 'docs/en/internals/contributing.md']) {
      const guidance = readFileSync(path, 'utf8')
      for (const field of ['candidate.before', 'candidate.after', 'candidate.failures', 'changedLines.scope', 'signalCode', '${logPath}.process.json']) {
        expect(guidance, path).toContain(`\`${field}\``)
      }
    }
  })

  test('keeps specialist runbooks scoped and linked to the shared policy', () => {
    const baseline = readFileSync('docs/_internal/quality-baseline.md', 'utf8')
    expect(baseline).toContain('bun run verify')
    expect(baseline).toContain('不是普通 PR')
    expect(baseline).toContain('../internals/contributing.md#')
    expect(baseline).not.toContain('| Lane 全绿但总体失败 |')
    for (const path of ['docs/_internal/release-windows.md', 'docs/en/_internal/release-windows.md']) {
      const release = readFileSync(path, 'utf8')
      expect(release, path).toContain('../internals/contributing.md#')
      expect(release, path).toContain('`macos_signing`')
      expect(release, path).toContain('`windows_signing`')
      expect(release, path).not.toContain('skip_windows_signing')
      expect(release, path).not.toContain('缺少 macOS 签名/公证配置时 preflight 直接失败')
      expect(release, path).not.toContain('When macOS configuration is missing, the workflow marks artifacts unsigned')
    }
    const router = readFileSync('.agents/workflows/issue-router.md', 'utf8')
    expect(router).not.toContain('声称 PR-ready 前运行 verify')
    expect(router).not.toContain('必须列出 check:impact 选中检查和 verify 的实际结果')
    expect(router).toContain('../../docs/internals/contributing.md#')
    expect(router).toContain('所有 selected 包括 advisory 必须 completed/success')
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

  test('uses one native packaging producer before all artifact and Electron host checks', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    const { scripts: desktop } = JSON.parse(readFileSync('desktop/package.json', 'utf8'))
    const electronChecks = desktop['check:electron'].split(' && ')

    // Packaging already builds Electron; retain every other standalone host check.
    expect(electronChecks.at(-1)).toBe('bun run build:electron')
    expect(electronChecks.slice(0, -1)).toEqual([
      'bun run test:package:dir',
      'node ./node_modules/typescript/bin/tsc -p electron/tsconfig.json',
      'bun test ./electron',
    ])
    expect(desktop['electron:build'].split(' && ')).toEqual([
      'bun run build:sidecars', 'bun run build', 'bun run build:electron',
    ])
    expect(scripts['check:electron']).toBe('cd desktop && bun run check:electron')
    expect(scripts['check:native'].split(' && ')).toEqual([
      'bun run check:agent-desktop',
      'bun run check:swift',
      'cd desktop',
      'CSC_IDENTITY_AUTO_DISCOVERY=false bun run electron:package:dir',
      'bun run test:compiled-sidecar-smoke',
      ...electronChecks.slice(0, -1),
      'cd ..',
      'bun run test:package-smoke:current',
    ])
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

    expect(instructions).toContain('[AGENTS.md](../AGENTS.md)')
    expect(instructions).toContain('[DESIGN.md](../DESIGN.md)')
    expect(instructions).toContain('不复制授权、实现或验证规则')
    expect(Buffer.byteLength(instructions)).toBeLessThan(1024)
  })
})
