import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { BrandSeal } from './BrandSeal'
import { publicAssetPath } from '@/lib/publicAsset'

const SIZES = ['sm', 'md', 'lg', 'xl'] as const
const ASSET = 'app-icon.png'
// desktop/src/components/composite/ -> desktop/public/app-icon.png
// Built with join(...) rather than new URL(..., import.meta.url): Vite rewrites
// the latter as a public asset URL, which no longer points at the source file.
const assetOnDisk = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'public', ASSET)

describe('BrandSeal', () => {
  it('is decorative and hidden from assistive tech', () => {
    // The product name always sits beside the mark (sidebar) or under it
    // (empty state); announcing the brand again reads it twice.
    const { container } = render(<BrandSeal />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the real self-owned app-icon asset, not the inline upstream CC geometry', () => {
    const { container } = render(<BrandSeal />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', publicAssetPath(ASSET))
    expect(img).toHaveAttribute('alt', '')

    // The upstream double-C was rebuilt from these inline paths / theme tokens.
    // None of that geometry belongs in the mark any more.
    expect(container.querySelector('svg')).toBeNull()
    expect(container.innerHTML).not.toContain('437.75 695.01') // BIG_C
    expect(container.innerHTML).not.toContain('var(--color-text-primary)')
    expect(container.innerHTML).not.toContain('var(--color-brand)')
  })

  it('points at an asset that actually ships, and it is the detailed self-owned icon', () => {
    expect(existsSync(assetOnDisk)).toBe(true)
    const bytes = readFileSync(assetOnDisk)
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    // The upstream flat CC icon was only ~35 KB; the self-owned cloud mark is a
    // detailed 1024px raster. Guards against re-substituting the upstream image.
    expect(bytes.length).toBeGreaterThan(100_000)
  })

  it('keeps a distinct, size-stable box for every size', () => {
    const expectedHeight: Record<(typeof SIZES)[number], string> = {
      sm: 'h-6',
      md: 'h-8',
      lg: 'h-[38px]',
      xl: 'h-20',
    }
    const classes = SIZES.map((size) => {
      const { container, unmount } = render(<BrandSeal size={size} />)
      const cls = container.firstElementChild!.getAttribute('class')!
      expect(cls).toContain(expectedHeight[size])
      expect(cls).toContain('object-contain')
      unmount()
      return cls
    })
    expect(new Set(classes).size).toBe(SIZES.length)
  })

  it('honours the className passthrough', () => {
    const { container } = render(<BrandSeal className="custom" />)
    expect(container.firstElementChild).toHaveClass('custom')
  })
})
