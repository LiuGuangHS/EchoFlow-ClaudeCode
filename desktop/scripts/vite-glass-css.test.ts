// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import postcss from 'postcss'
import { build } from 'vite'
import { expect, it } from 'vitest'
import config from '../vite.config'

it('preserves glass blur for Chromium and Safari plus accessibility overrides in production CSS', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-glass-css-'))
  try {
    const source = postcss.parse(fs.readFileSync(new URL('../src/theme/globals.css', import.meta.url), 'utf8'))
    const fixture = postcss.root()
    source.walkRules(/^\.(glass-panel|pet-activity-card)$/, rule => {
      if (rule.parent?.type === 'root') fixture.append(rule.clone())
      else if (rule.parent?.type === 'atrule') fixture.append(rule.parent.clone())
    })
    // Trigger Tailwind's production optimizer without scanning/building the app.
    fs.writeFileSync(path.join(root, 'glass.css'), `@tailwind utilities source(none);\n@source inline("block");\n${fixture}`)
    const result = await build({
      configFile: false,
      envFile: false,
      root,
      publicDir: false,
      logLevel: 'silent',
      plugins: [tailwindcss()],
      build: {
        ...config.build,
        write: false,
        rollupOptions: { input: path.join(root, 'glass.css') },
      },
    })
    if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one build output')
    const asset = result.output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'))
    if (!asset || asset.type !== 'asset') throw new Error('Missing production CSS')
    const css = postcss.parse(String(asset.source))
    const glassRules: Array<{ selector: string, context: string, declarations: Record<string, string> }> = []
    css.walkRules(/^\.(glass-panel|pet-activity-card)$/, rule => {
      const declarations: Record<string, string> = {}
      rule.walkDecls(decl => { declarations[decl.prop] = decl.value })
      glassRules.push({ selector: rule.selector, context: rule.parent?.type === 'atrule' ? rule.parent.params : '', declarations })
    })
    expect(css.toString()).toContain('.block{display:block}')
    const normalize = (value: string) => value.replace(/\s+/g, '')
    for (const [selector, blur] of [
      ['.glass-panel', 'blur(18px)'],
      ['.pet-activity-card', 'blur(20px)saturate(1.18)'],
    ]) {
      const declarations = glassRules.find(rule => rule.selector === selector && rule.context === '')?.declarations
      expect(normalize(declarations?.['backdrop-filter'] ?? '')).toBe(blur)
      expect(normalize(declarations?.['-webkit-backdrop-filter'] ?? '')).toBe(blur)
    }
    for (const mode of ['prefers-reduced-transparency', 'forced-colors']) {
      expect(glassRules.find(rule => rule.context.includes(mode))?.declarations).toMatchObject({
        background: 'var(--color-surface-dialog)',
        'backdrop-filter': 'none',
        '-webkit-backdrop-filter': 'none',
      })
    }
    expect(glassRules.find(rule => rule.context.startsWith('not '))?.declarations).toMatchObject({
      background: 'rgb(var(--cc-bg-rgb))',
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
