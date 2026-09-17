import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'

import { BrandSeal } from './BrandSeal'

const SIZES = ['sm', 'md', 'lg', 'xl'] as const

describe('BrandSeal', () => {
  it('is decorative and hidden from assistive tech', () => {
    // The product name always sits beside the mark (sidebar) or under it
    // (empty state); announcing the brand again reads it twice.
    const { container } = render(<BrandSeal />)
    const mark = container.firstElementChild!
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark).toHaveAttribute('alt', '')
  })

  it('renders the shared app icon so the in-app mark matches the OS one', () => {
    // Tray, packaged icon and favicon all point at app-icon.png. Sourcing the
    // in-app mark from anywhere else is how the two silently drift apart.
    const { container } = render(<BrandSeal />)
    expect(container.firstElementChild).toHaveAttribute('src', '/app-icon.png')
  })

  it('keeps the mark square at every size', () => {
    // The artwork is a 1:1 icon, so a non-square box would letterbox or squash
    // it. Each size still has to resolve to a concrete box - an unmapped size
    // would silently fall back to the intrinsic 1024px bitmap.
    for (const size of SIZES) {
      const { container, unmount } = render(<BrandSeal size={size} />)
      const className = container.firstElementChild!.getAttribute('class')!
      const height = className.match(/h-(\[[^\]]+\]|\S+)/)?.[1]
      const width = className.match(/w-(\[[^\]]+\]|\S+)/)?.[1]
      expect(height).toBeDefined()
      expect(width).toBe(height)
      unmount()
    }
  })

  it('merges caller classes instead of dropping them', () => {
    const { container } = render(<BrandSeal size="xl" className="mb-4" />)
    const className = container.firstElementChild!.getAttribute('class')!
    expect(className).toContain('mb-4')
    expect(className).toContain('h-20')
  })
})
