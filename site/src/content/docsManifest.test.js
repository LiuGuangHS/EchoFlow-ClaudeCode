import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

test('internal docs never reach generated modules or static publication', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-manifest-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  const siteDir = path.join(root, 'site')
  const scriptsDir = path.join(siteDir, 'scripts')
  const generatedDir = path.join(siteDir, 'src/generated')
  const distDir = path.join(siteDir, 'dist')
  await fs.mkdir(scriptsDir, { recursive: true })
  await fs.mkdir(distDir, { recursive: true })
  await fs.mkdir(path.join(siteDir, 'src'), { recursive: true })
  await fs.writeFile(path.join(siteDir, 'package.json'), '{"type":"module"}\n')
  for (const name of ['generate-docs-manifest.mjs', 'image-size.mjs', 'prepare-static-output.mjs']) {
    await fs.copyFile(new URL(`../../scripts/${name}`, import.meta.url), path.join(scriptsDir, name))
  }

  const publicDocs = [
    ['start/index.md', '/start', '开始使用', '公开中文正文'],
    ['en/start/index.md', '/en/start', 'Get started', 'Public English body'],
    ['mobile/index.md', '/mobile', '移动端', '公开移动端正文'],
    ['en/mobile/index.md', '/en/mobile', 'Mobile app', 'Public mobile body'],
    ['internals/index.md', '/internals', '深入原理', '公开架构正文'],
    ['en/internals/index.md', '/en/internals', 'Internals', 'Public architecture body'],
  ]
  const internalDocs = ['_internal/design.md', 'en/_internal/design.md', 'start/_internal/draft.md']
  for (const [relative, , title, body] of [
    ...publicDocs,
    ...internalDocs.map((relative) => [relative, '', 'Private design', 'UNPUBLISHED_INTERNAL_BODY']),
  ]) {
    const target = path.join(root, 'docs', relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, `---\ntitle: ${title}\nnav_title: ${title}\ndescription: ${title}\norder: 0\n---\n# ${title}\n\n${body}\n`)
  }

  await run(process.execPath, [path.join(scriptsDir, 'generate-docs-manifest.mjs')], { cwd: root })
  const expectedRoutes = publicDocs.map(([, route]) => route).sort()

  await t.test('index, lazy content and search include only public Chinese and English docs', async () => {
    const { docsIndex, docsContent, sections } = await import(pathToFileURL(path.join(generatedDir, 'docs-index.js')))
    const { default: searchIndex } = await import(pathToFileURL(path.join(generatedDir, 'search-index.js')))
    assert.deepEqual(docsIndex.map((record) => record.path).sort(), expectedRoutes)
    assert.deepEqual(Object.keys(docsContent).sort(), expectedRoutes)
    assert.deepEqual(searchIndex.map((record) => record.p).sort(), expectedRoutes)
    assert.deepEqual(sections.find((section) => section.id === 'mobile'), {
      id: 'mobile',
      zh: '移动端',
      en: 'Mobile app',
    })
    assert.deepEqual(
      (await fs.readdir(path.join(generatedDir, 'content'))).sort(),
      publicDocs.map(([relative]) => relative.replace(/\.md$/, '').replaceAll('/', '-') + '.js').sort(),
    )
    for (const [, route, title, body] of publicDocs) {
      assert.equal(docsIndex.find((record) => record.path === route).title, title)
      assert.equal((await docsContent[route]()).default, `# ${title}\n\n${body}\n`)
      assert.ok(searchIndex.find((record) => record.p === route).x.includes(body))
    }
    assert.ok(!JSON.stringify(searchIndex).includes('UNPUBLISHED_INTERNAL_BODY'))
  })

  for (const locale of ['', 'en/']) {
    const source = path.join(root, `docs/${locale}internals/index.md`)
    const image = path.join(root, `docs/${locale}internals/images/diagram.svg`)
    await fs.mkdir(path.dirname(image), { recursive: true })
    await fs.writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await fs.appendFile(source, '\n![Diagram](./images/diagram.svg)\n')
    const shared = locale ? '../../internals/images/shared.svg' : './images/shared.svg'
    await fs.appendFile(source, `\n![Shared diagram](${shared})\n`)
  }
  const sharedImage = 'internals/images/shared.svg'
  await fs.writeFile(path.join(root, 'docs', sharedImage), '<svg xmlns="http://www.w3.org/2000/svg"><title>Shared</title></svg>')

  const shell = '<html lang="zh-CN"><head><title>Fixture</title><meta name="description" content="Fixture"></head><body></body></html>'
  await fs.writeFile(path.join(siteDir, 'index.html'), shell)
  await fs.writeFile(path.join(distDir, 'index.html'), shell)
  await fs.copyFile(new URL('../../../docs/public/CNAME', import.meta.url), path.join(distDir, 'CNAME'))
  await run(process.execPath, [path.join(scriptsDir, 'prepare-static-output.mjs')], { cwd: root })

  await t.test('static routes and sitemap omit internal docs while retaining public routes', async () => {
    for (const [, route, title] of publicDocs) {
      const html = await fs.readFile(path.join(distDir, route.slice(1), 'index.html'), 'utf8')
      assert.ok(html.includes(`<title>${title} ·`))
    }
    for (const relative of internalDocs) {
      await assert.rejects(fs.access(path.join(distDir, relative.replace(/\.md$/, ''), 'index.html')), { code: 'ENOENT' })
    }
    for (const locale of ['', 'en/']) {
      const relative = `${locale}internals/images/diagram.svg`
      assert.equal(await fs.readFile(path.join(distDir, relative), 'utf8'), await fs.readFile(path.join(root, 'docs', relative), 'utf8'))
    }
    const sitemap = await fs.readFile(path.join(distDir, 'sitemap.xml'), 'utf8')
    const routes = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname)
    assert.deepEqual(routes.sort(), ['/', '/en', '/download', '/en/download', ...expectedRoutes].sort())
  })

  await t.test('both locales publish the shared diagram once without an English copy', async () => {
    assert.deepEqual(
      await fs.readFile(path.join(distDir, sharedImage)),
      await fs.readFile(path.join(root, 'docs', sharedImage)),
    )
    await assert.rejects(fs.access(path.join(distDir, 'en', sharedImage)), { code: 'ENOENT' })
    const englishContent = await fs.readFile(path.join(generatedDir, 'content/en-internals-index.js'), 'utf8')
    assert.ok(englishContent.includes('../../internals/images/shared.svg'))
  })

  await t.test('CRLF source frontmatter has the same metadata and body as LF', async () => {
    const target = path.join(root, 'docs/start/index.md')
    const original = await fs.readFile(target, 'utf8')
    await fs.writeFile(target, original.replaceAll('\n', '\r\n'))
    try {
      await run(process.execPath, [path.join(scriptsDir, 'generate-docs-manifest.mjs')], { cwd: root })
      const { docsIndex } = await import(`${pathToFileURL(path.join(generatedDir, 'docs-index.js'))}?crlf`)
      const doc = docsIndex.find((record) => record.path === '/start')
      assert.equal(doc.title, '开始使用')
      assert.equal(doc.description, '开始使用')
      assert.equal(doc.order, 0)
      const module = await fs.readFile(path.join(generatedDir, 'content/start-index.js'), 'utf8')
      assert.ok(!module.includes('title:'))
      assert.ok(!module.includes('\\r'))
    } finally {
      await fs.writeFile(target, original)
    }
  })

  for (const relative of ['start/index.md', 'en/start/index.md']) {
    await t.test(`missing ${relative} fails before replacing any generated output`, async () => {
      const target = path.join(root, 'docs', relative)
      const original = await fs.readFile(target, 'utf8')
      const outputs = ['docs-index.js', 'search-index.js', 'content/start-index.js']
      const before = await Promise.all(outputs.map((file) => fs.readFile(path.join(generatedDir, file), 'utf8')))
      await fs.rm(target)
      try {
        await assert.rejects(
          run(process.execPath, [path.join(scriptsDir, 'generate-docs-manifest.mjs')], { cwd: root }),
          (error) => error.code === 1 && error.stderr.includes(`missing translation docs/${relative}`),
        )
        assert.deepEqual(await Promise.all(outputs.map((file) => fs.readFile(path.join(generatedDir, file), 'utf8'))), before)
      } finally {
        await fs.writeFile(target, original)
        await run(process.execPath, [path.join(scriptsDir, 'generate-docs-manifest.mjs')], { cwd: root })
      }
    })
  }

  await t.test('an unregistered public section fails before replacing generated content', async () => {
    const unknown = path.join(root, 'docs/unregistered/index.md')
    await fs.mkdir(path.dirname(unknown), { recursive: true })
    await fs.writeFile(unknown, '---\ntitle: Unknown\nnav_title: Unknown\ndescription: Unknown\norder: 0\n---\n# Unknown\n')
    const indexBefore = await fs.readFile(path.join(generatedDir, 'docs-index.js'), 'utf8')
    await assert.rejects(
      run(process.execPath, [path.join(scriptsDir, 'generate-docs-manifest.mjs')], { cwd: root }),
      (error) => error.code === 1 && error.stderr.includes('docs/unregistered/index.md: unregistered documentation section unregistered'),
    )
    assert.equal(await fs.readFile(path.join(generatedDir, 'docs-index.js'), 'utf8'), indexBefore)
    await fs.rm(path.dirname(unknown), { recursive: true })
  })

  for (const [field, value] of [['title', ''], ['nav_title', ''], ['description', ''], ['order', '1oops']]) {
    await t.test(`invalid ${field} frontmatter fails before publication`, async () => {
      const target = path.join(root, 'docs/start/index.md')
      const original = await fs.readFile(target, 'utf8')
      await fs.writeFile(target, original.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`))
      try {
        await assert.rejects(
          run(process.execPath, [path.join(scriptsDir, 'generate-docs-manifest.mjs')], { cwd: root }),
          (error) => error.code === 1 && error.stderr.includes(`docs/start/index.md: invalid or missing frontmatter ${field}`),
        )
      } finally {
        await fs.writeFile(target, original)
      }
    })
  }

  await t.test('consolidated Computer Use docs retain bilingual legacy routes, anchors and static entries', async () => {
    const routes = ['', '/en'].flatMap((locale) => [
      `${locale}/internals/computer-use`, `${locale}/internals/computer-use-contracts`,
    ])
    for (const locale of ['', 'en/']) {
      const directory = new URL(`../../../docs/${locale}internals/`, import.meta.url)
      for (const name of (await fs.readdir(directory)).filter((name) => /^computer-use.*\.md$/.test(name))) {
        await fs.copyFile(new URL(name, directory), path.join(root, 'docs', locale, 'internals', name))
      }
    }
    const internalQA = await fs.readFile(new URL('../../../docs/_internal/computer-use-native-manual-qa.md', import.meta.url), 'utf8')
    for (const id of ['4.7', '4.8', '4.9', '4.10']) {
      assert.ok(internalQA.includes(`| ${id} |`), `missing preserved QA case ${id}`)
    }
    await fs.writeFile(path.join(root, 'docs/_internal/computer-use-native-manual-qa.md'), internalQA)
    await run(process.execPath, [path.join(scriptsDir, 'prepare-static-output.mjs')], { cwd: root })
    const indexURL = pathToFileURL(path.join(generatedDir, 'docs-index.js')).href
    const { docsIndex, docsContent } = await import(`${indexURL}?computer-use`)
    const { default: searchIndex } = await import(`${pathToFileURL(path.join(generatedDir, 'search-index.js'))}?computer-use`)
    assert.deepEqual(docsIndex.filter((doc) => doc.path.includes('/computer-use')).map((doc) => doc.path).sort(), routes.sort())

    // Load the production router against this fixture without Vite or shared generated output.
    const routerSource = (await fs.readFile(new URL('./docs.js', import.meta.url), 'utf8'))
      .replace('import.meta.env.BASE_URL', "'/'")
      .replace("'../generated/docs-index'", JSON.stringify(`${indexURL}?computer-use`))
      .replace("'marked'", JSON.stringify(import.meta.resolve('marked')))
      .replace("'dompurify'", JSON.stringify(import.meta.resolve('dompurify')))
    const router = await import(`data:text/javascript;base64,${Buffer.from(routerSource).toString('base64')}`)
    const anchors = new Map()
    for (const route of routes) {
      const record = router.findDoc(route)
      assert.ok(record, `missing public route ${route}`)
      assert.ok(record.title && record.navTitle && record.description)
      const { default: body } = await docsContent[route]()
      assert.equal(await router.loadDocContent(route), body)
      assert.doesNotMatch(body, /\]\([^)]*_internal|\/Users\/|wf_32a4859d|quizzical-lehmann/)
      anchors.set(route, new Set([
        ...[...body.matchAll(/^#{1,6} (.+)$/gm)].map((match) => router.slugifyHeading(match[1])),
        ...[...body.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
      ]))
      const html = await fs.readFile(path.join(distDir, route.slice(1), 'index.html'), 'utf8')
      assert.ok(html.includes(`<title>${record.title} ·`))
      assert.ok(html.includes(`rel="canonical" href="https://code.echoflow.cn${route}"`))
    }
    const legacy = [
      ['cef-injection', 'contracts', '进程窗口与坐标是一条链', 'process-window-and-coordinates-form-one-chain'],
      ['codex-impl-blueprint', 'contracts', 'javascript-与原生边界', 'javascript-and-native-boundaries'],
      ['codex-parity-review', 'contracts', '分开报告证据', 'report-evidence-separately'],
      ['codex-redesign', 'contracts', '视觉反馈不是定位依据', 'visual-feedback-is-not-targeting-evidence'],
      ['handoff', '', '从入口走到原生引擎', 'from-entry-points-to-native-engines'],
      ['native-manual-qa', 'contracts', '需要单独观察的边界', 'boundaries-needing-separate-observation'],
      ['native-swift-design', 'contracts', '权限与签名', 'permissions-and-signing'],
    ]
    for (const [name, target, zhAnchor, enAnchor] of legacy) {
      for (const locale of ['', '/en']) {
        const oldRoute = `${locale}/internals/computer-use-${name}`
        const expected = `${locale}/internals/computer-use${target ? `-${target}` : ''}`
        const anchor = locale ? enAnchor : zhAnchor
        for (const suffix of ['', '/', '.md', '.html', `#${encodeURIComponent(anchor)}`]) {
          assert.equal(router.resolveLegacyRoute(`${oldRoute}${suffix}`), expected)
        }
        assert.equal(router.findDoc(oldRoute), null)
        assert.equal(router.alternateLocaleRoute(router.findDoc(expected)), locale ? expected.slice(3) : `/en${expected}`)
        assert.ok(anchors.get(expected).has(anchor), `missing legacy anchor ${oldRoute}#${anchor}`)
        assert.equal(await fs.readFile(path.join(distDir, oldRoute.slice(1), 'index.html'), 'utf8'), shell)
      }
    }
    const sitemap = await fs.readFile(path.join(distDir, 'sitemap.xml'), 'utf8')
    const published = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname)
    assert.deepEqual(published.filter((route) => route.includes('/computer-use')).sort(), routes)
    assert.ok(!JSON.stringify(docsIndex).includes('_internal'))
    assert.ok(!JSON.stringify(searchIndex).includes('focusSettleMs = 800'))
  })

})
