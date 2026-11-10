import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'bun:test'

const here = dirname(fileURLToPath(import.meta.url))
const logoPath = join(here, 'Logo.tsx')
const iconPath = join(here, '..', '..', 'assets', 'icon.png')
const iconIosPath = join(here, '..', '..', 'assets', 'icon-ios.png')

// v0.7.4 self-owned icon (blue cloud + </>). The upstream "cc-haha" flat CC
// mark that HEAD substituted is 51a86c68187aac4e0e324a13dab1a2ec.
const SELF_OWNED_MD5 = '6d108fa79ff29faf644e19fe5687595f'

// Follow the repo's isolated-mock convention: mock.module is process-global in
// bun, so the render assertion runs in a child process (see ProfileContent.test.ts).
test('mobile Logo renders the self-owned app-icon asset, not the inline upstream CC mark', () => {
  const script = `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    const pngPath = ${JSON.stringify(iconPath)}
    const rnPath = ${JSON.stringify(import.meta.resolve('react-native'))}
    // The asset is a binary PNG; replace it with a sentinel so this process
    // never parses raster bytes, while Logo still receives the require result.
    mock.module(pngPath, () => ({ default: 'SELF_OWNED_APP_ICON' }))
    mock.module(rnPath, () => ({ Image: 'Image' }))
    const { Logo } = await import(${JSON.stringify(logoPath)})
    const expectedSource = require(pngPath)
    const node = Logo({ size: 34 })
    assert.equal(node.type, 'Image')
    assert.equal(node.props.source, expectedSource)
    assert.equal(node.props.style.width, 34)
    assert.equal(node.props.style.height, 34)
    assert.equal(node.props.style.resizeMode, 'contain')
    assert.equal(node.props.accessibilityRole, 'image')
    assert.equal(node.props.accessibilityLabel, 'EchoFlow Code 标志')
    assert.ok(!JSON.stringify(node).includes('437.75 695.01'), 'no inline CC geometry')
  `
  execFileSync(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
})

test('Logo references the self-owned icon asset that actually ships', () => {
  const src = readFileSync(logoPath, 'utf8')
  // Real asset reference — the same icon.png app.json ships (not inline paths).
  expect(src).toContain("require('../../assets/icon.png')")
  // The upstream CC geometry must not be inlined any more.
  expect(src).not.toContain('437.75 695.01')
  expect(src).not.toContain('viewBox="250 300 524 434"')

  expect(existsSync(iconPath)).toBe(true)
  const bytes = readFileSync(iconPath)
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  // The upstream flat CC icon was only ~35 KB; the self-owned cloud mark is a
  // detailed 1024px raster. Guards against re-substituting the upstream image.
  expect(bytes.length).toBeGreaterThan(100_000)
})

test('app.json icons are the self-owned artwork, with an opaque iOS derivative', () => {
  // Byte-level guard: never re-substitute the upstream flat CC icon as our own.
  const md5 = createHash('md5').update(readFileSync(iconPath)).digest('hex')
  expect(md5).toBe(SELF_OWNED_MD5)

  // iOS app icons must be opaque (no alpha channel). Derived by flattening the
  // self-owned source, not by guessing a shape.
  const ios = readFileSync(iconIosPath)
  expect(ios.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  expect(ios.readUInt32BE(16)).toBe(1024) // width
  expect(ios.readUInt32BE(20)).toBe(1024) // height
  expect(ios[25]).toBe(2) // PNG colour type 2 = RGB (no alpha)
})
