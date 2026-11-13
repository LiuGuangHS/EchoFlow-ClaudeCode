import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { landingContent } from './landingContent.ts'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const page = read('./HomePage.tsx')
const guide = read('./guideContent.js')

test('phone screenshots describe synthetic Chinese H5 sessions, not a native app or desktop continuation', () => {
  for (const [locale, c] of Object.entries(landingContent)) {
    const phone = [c.hero.phoneAlt, ...c.mobile.screens.map(screen => screen.alt)].join(' ')
    assert.doesNotMatch(phone, /手机 App|phone app|same request|同一个请求|bun test|v2\.4\.0|lumen/i, locale)
    for (const alt of [c.hero.phoneAlt, ...c.mobile.screens.map(screen => screen.alt)]) {
      assert.match(alt, /H5/, locale)
      assert.match(alt, /合成|synthetic/i, locale)
      if (locale === 'en') assert.match(alt, /Chinese interface/, locale)
    }
    assert.match(c.mobile.screens[0].alt, /echoflow-demo/, locale)
    assert.match(c.mobile.screens[1].alt, /尚未批准或执行|not approved or executed/i, locale)
    assert.match(c.mobile.screens[2].alt, /v0\.7\.6/, locale)
    assert.match(c.mobile.screens[2].alt, /已完成|completed/i, locale)
    assert.match(c.mobile.description, /浏览器|browser/i, locale)
  }
  assert.doesNotMatch(page, /Phone app|手机 App|THE PHONE APP|Android app/)
})

test('desktop screenshots distinguish pending teams, demo models, static preview, and disabled Linux runtime', () => {
  for (const [locale, c] of Object.entries(landingContent)) {
    const alt = id => c.features.find(feature => feature.id === id).alt
    assert.match(c.hero.desktopAlt, /合成.*欢迎|synthetic.*welcome/i, locale)
    assert.match(alt('teams'), /2|两/, locale)
    assert.match(alt('teams'), /review_pending/, locale)
    assert.match(alt('teams'), /均未开始|none started/i, locale)
    assert.match(alt('models'), /EchoFlow.*demo|EchoFlow.*演示/i, locale)
    assert.match(alt('models'), /3|三个/, locale)
    assert.match(alt('models'), /无凭据|without credentials/i, locale)
    assert.match(alt('computer-use'), /Linux/, locale)
    assert.match(alt('computer-use'), /已禁用|disabled/i, locale)
    assert.match(alt('computer-use'), /运行组件不可用|runtime unavailable/i, locale)
    assert.match(alt('workbench'), /静态.*双语.*本地|static.*bilingual.*local/i, locale)
    assert.match(alt('skills'), /398/, locale)
    assert.match(alt('skills'), /非独立.*审计|not an independent.*audit/i, locale)
  }
})

test('the visible localized provenance note distinguishes samples from execution and native acceptance', () => {
  for (const [locale, c] of Object.entries(landingContent)) {
    assert.equal(typeof c.screenshotNote, 'string', locale)
    assert.match(c.screenshotNote, /合成|synthetic/i, locale)
    assert.match(c.screenshotNote, /录制|recorded/i, locale)
    assert.match(c.screenshotNote, /非在线执行|not evidence of live execution/i, locale)
    assert.match(c.screenshotNote, /原生端验收|native.*acceptance/i, locale)
    assert.match(c.screenshotNote, /H5/, locale)
  }
  assert.match(page, /<p\b[^>]*>\{c\.screenshotNote\}<\/p>/)
})

test('image elements receive the desktop and H5 intrinsic dimensions', () => {
  assert.match(page, /const DESKTOP_SHOT_SIZE = \{ width: 2000, height: 1250 \}/)
  assert.match(page, /const FEATURE_IMAGE_SIZE = \{ width: 2000, height: 1250 \}/)
  assert.match(page, /const PHONE_SHOT_SIZE = \{ width: 2000, height: 4350 \}/)
  for (const [src, size] of [['heroDesktop', 'DESKTOP_SHOT_SIZE'], ['phoneApproval', 'PHONE_SHOT_SIZE'], ['phoneScreens[index]', 'PHONE_SHOT_SIZE'], ['image', 'FEATURE_IMAGE_SIZE']]) {
    const tag = page.match(/<img\b[^>]*>/g).find(tag => tag.includes(`src={${src}}`))
    assert.ok(tag?.includes(`width={${size}.width}`) && tag.includes(`height={${size}.height}`), src)
  }
})

test('Computer Use copy distinguishes platform support from session readiness and physical input', () => {
  for (const [locale, c] of Object.entries(landingContent)) {
    const feature = c.features.find(feature => feature.id === 'computer-use').body
    const faq = c.faqs.find(faq => /Computer Use/.test(faq.question)).answer
    for (const copy of [feature, faq]) {
      assert.match(copy, /macOS.*Windows.*Linux/, locale)
      assert.match(copy, /后台语义|background semantic/i, locale)
      assert.match(copy, /物理输入|physical input/i, locale)
      assert.doesNotMatch(copy, /兼容执行器|compatibility executor|Linux 暂无|Linux does not currently have/i, locale)
    }
    assert.match(faq, /AT-SPI/, locale)
    assert.match(faq, /图形会话|graphical session/i, locale)
    assert.match(faq, /确认|consent/i, locale)
  }
})

test('guide captions disclose Linux-disabled settings and synthetic recorded review samples', () => {
  assert.match(guide, /settingsCaption: '[^']*Linux[^']*已禁用[^']*运行组件不可用/)
  assert.match(guide, /settingsCaption: '[^']*Linux[^']*disabled[^']*runtime unavailable/)
  assert.match(guide, /alt: '[^']*合成[^']*录制[^']*审阅/)
  assert.match(guide, /alt: '[^']*synthetic[^']*recorded[^']*review/)
})
