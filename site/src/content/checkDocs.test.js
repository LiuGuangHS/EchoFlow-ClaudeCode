import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const run = promisify(execFile)

test('the docs CLI checks all README links and screenshot locales', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'check-docs-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const write = async (relative, content) => {
    const target = path.join(root, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  for (const name of ['check-docs.mjs', 'generate-docs-manifest.mjs', 'image-size.mjs']) {
    await fs.mkdir(path.join(root, 'site/scripts'), { recursive: true })
    await fs.copyFile(new URL(`../../scripts/${name}`, import.meta.url), path.join(root, 'site/scripts', name))
  }
  for (const relative of ['start/index.md', 'en/start/index.md']) {
    await write(`docs/${relative}`, '---\ntitle: Start\nnav_title: Start\ndescription: Start here\norder: 0\n---\n# Start\n')
  }
  await write('site/src/lib/locale.js', "const LOCALE_STORAGE_KEY = 'locale'\nconst DEFAULT_LOCALE = 'en'\n")
  await write('site/index.html', `<title>Fixture</title><meta name="description" content="Start here">
    localStorage.getItem('locale'); navigator.languages && navigator.languages[0]; navigator.language;
    isChinese ? 'zh' : 'en'; window.location.pathname.replace(/\\/+$/, '') !== ''`)
  await write('site/src/pages/home/HomePage.tsx', "'Fixture'")
  await write('site/scripts/prepare-static-output.mjs', "'Fixture'; 'Start here'")
  const downloads = "android: 'https://example.test/app.apk', testFlight: 'https://example.test/ios'"
  await write('site/src/pages/home/landingContent.ts', `route: '/start', description: ['Start', 'here'], ${downloads}`)
  await write('desktop/src/pages/settings/mobileAppLinks.ts', downloads)
  // Synthetic WebP headers exercise the dimension contract without real product screenshots.
  const image = Buffer.alloc(30)
  image.write('RIFF', 0)
  image.write('WEBP', 8)
  image.write('VP8X', 12)
  image.writeUIntLE(1999, 24, 3)
  image.writeUIntLE(999, 27, 3)
  for (const locale of ['en', 'zh-CN']) {
    await write(`docs/images/app/${locale}/screen.webp`, image)
  }
  await write('guide with spaces.md', '# Repository guide\n')
  const readmes = new Map([
    ['README.md', 'en'],
    ['README.zh-CN.md', 'zh-CN'],
    ['README.en.md', 'en'],
  ])
  const content = (locale) => `![App](docs/images/app/${locale}/screen.webp)
[Guide](docs/start/index.md) [Route](/start) [Fragment](#section)
[External](https://example.test/missing) [Mail](mailto:example@example.test)
\`\`\`md
[Ignored example](not-a-real-file.md)
\`\`\`
`
  for (const [name, locale] of readmes) await write(name, content(locale))
  const check = () => run(process.execPath, [path.join(root, 'site/scripts/check-docs.mjs')], { cwd: root })

  await t.test('accepts valid bilingual README references', async () => {
    assert.match((await check()).stdout, /Documentation check passed/)
  })
  for (const [name, locale] of readmes) {
    await t.test(`${name}: broken local links fail the CLI`, async () => {
      await write(name, `${content(locale)}\n[Broken](missing.md)\n`)
      try {
        await assert.rejects(check(), (error) => error.code === 1
          && error.stderr.includes(`${name}: unresolved link missing.md`))
      } finally {
        await write(name, content(locale))
      }
    })
    await t.test(`${name}: screenshots must use the README language`, async () => {
      await write(name, content(locale === 'en' ? 'zh-CN' : 'en'))
      try {
        await assert.rejects(check(), (error) => error.code === 1
          && error.stderr.includes(`${name}: app screenshot`)
          && error.stderr.includes(`must use docs/images/app/${locale}/`))
      } finally {
        await write(name, content(locale))
      }
    })
  }
  for (const [target, fixture] of [
    ['../_internal/design.md', 'docs/_internal/design.md'],
    ['../../guide%20with%20spaces.md', 'guide with spaces.md'],
  ]) {
    await t.test(`public docs reject unpublished local target ${target}`, async () => {
      await write(fixture, '# Unpublished source\n')
      const source = 'docs/start/index.md'
      const original = await fs.readFile(path.join(root, source), 'utf8')
      await write(source, `${original}\n[Unpublished](${target})\n`)
      try {
        await assert.rejects(check(), (error) => error.code === 1
          && error.stderr.includes(`${source}: unresolved link ${target}`))
      } finally {
        await write(source, original)
      }
    })
  }

  await t.test('accepts repository-root links and URL-encoded file names in READMEs', async () => {
    await write('README.md', `${content('en')}\n[Source](/docs/start/index.md)\n[Encoded](guide%20with%20spaces.md)\n`)
    assert.match((await check()).stdout, /Documentation check passed/)
  })
})
