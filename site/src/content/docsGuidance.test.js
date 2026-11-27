import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// Exercise the production heading renderer without Vite or a browser; sanitization is not under test.
const source = (await readFile(new URL('./docs.js', import.meta.url), 'utf8'))
  .replace('import.meta.env.BASE_URL', "'/'")
  .replace("import { docsContent, docsIndex, imageSizes, sections } from '../generated/docs-index'", 'const docsContent = {}, docsIndex = [], imageSizes = {}, sections = []')
  .replace("import DOMPurify from 'dompurify'", 'const DOMPurify = { sanitize: html => html }')
  .replace("'marked'", JSON.stringify(import.meta.resolve('marked')))
const { renderMarkdown } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const publishedAnchors = {
  zh: [
    '环境准备', '四层门禁分工', '普通-pr-的影响面检查', '无模型的端到端-agent-门禁',
    'ai-coding-agent-修复循环', '回归测试设计', '覆盖率参考', '维护-agent-指导', '功能质量契约',
    '本机-push-前提醒', 'pr-ci-合并门禁', '门禁红了怎么办', '按改动范围补充测试',
    '真实模型-baseline', '什么时候必须跑-baseline', 'release-门禁', '发版与自动更新',
    '产物命名', '签名-secrets', '发版前检查', '发版步骤', '验证一条真实更新链路',
    'pr-提交流程', '常见问题', '没有-provider-可以跑吗', 'provider-selector-冲突怎么办', '模型-id-里带冒号怎么办',
  ],
  en: [
    'setup', 'gate-tiers', 'path-aware-pr-checks', 'deterministic-agent-gate-no-model-required',
    'ai-coding-agent-fix-loop', 'regression-test-design', 'coverage-references', 'maintaining-agent-instructions',
    'feature-quality-contract', 'local-pre-push-reminder', 'pr-ci-merge-gate', 'when-the-gate-is-red',
    'area-specific-checks', 'live-model-baseline', 'when-to-run-the-baseline', 'release-gate',
    'releases-and-auto-update', 'artifact-names', 'signing-secrets', 'pre-release-checks', 'release-steps',
    'verify-one-real-update-path', 'pr-workflow', 'faq', 'can-i-run-checks-without-a-provider',
    'what-if-provider-selectors-conflict', 'what-if-a-model-id-contains-a-colon',
  ],
}

for (const locale of ['zh', 'en']) {
  test(`${locale} consolidated contribution guidance retains published heading anchors and runbook links`, async () => {
    const prefix = locale === 'en' ? 'en/' : ''
    const markdown = await readFile(new URL(`../../../docs/${prefix}internals/contributing.md`, import.meta.url), 'utf8')
    const doc = { locale, sourcePath: `docs/${prefix}internals/contributing.md`, path: `/${prefix}internals/contributing` }
    const { html, tableOfContents } = renderMarkdown(doc, markdown.replace(/^---\n[\s\S]*?\n---\n/, ''))
    const ids = [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((match) => match[1])
    for (const anchor of publishedAnchors[locale]) {
      assert.ok(ids.includes(anchor), `missing published anchor #${anchor}`)
    }
    assert.equal(ids.length, new Set(ids).size, 'headings must have unique IDs')
    const diagnosis = locale === 'en' ? 'evidence-and-failure-diagnosis' : '证据与失败诊断'
    assert.ok(tableOfContents.some(({ id }) => id === diagnosis), 'shared evidence diagnosis must be discoverable')
    const runbooks = [
      `../../../docs/${prefix}_internal/release-windows.md`,
      '../../../CONTRIBUTING.md',
      ...(locale === 'zh' ? ['../../../docs/_internal/quality-baseline.md', '../../../.agents/workflows/issue-router.md', '../../../.github/pull_request_template.md'] : []),
    ]
    for (const runbook of runbooks) {
      const body = await readFile(new URL(runbook, import.meta.url), 'utf8')
      for (const [, target, anchor] of body.matchAll(/\]\(([^)]*internals\/contributing\.md)#([^)]*)\)/g)) {
        const targetLocale = target.includes('docs/en/') ? 'en' : target.includes('docs/internals/') ? 'zh' : locale
        if (targetLocale === locale) assert.ok(ids.includes(decodeURIComponent(anchor)), `${runbook}: missing rendered target #${anchor}`)
      }
    }
    assert.doesNotMatch(markdown, /\]\([^)]*_internal/)
  })
}
