import { cx } from '@/lib/cx'
import { publicAssetPath } from '@/lib/publicAsset'

/**
 * The EchoFlow Code brand mark.
 *
 * This is the *self-owned* app icon shipped in `public/app-icon.png` — the blue
 * cloud with the `</>` glyph — not the upstream "cc-haha" double-C. The old
 * component rebuilt that upstream mark from inline `<path>` geometry, so
 * restoring the binary icon assets could not change what the app actually
 * showed. Pointing at the asset is what makes the in-app brand match the
 * packaged icon.
 *
 * The PNG has its own colours on a transparent ground, so it reads on every
 * palette without theme-specific code. `object-contain` keeps the square mark
 * undistorted inside the (slightly wider) legacy boxes, which are preserved so
 * the sidebar rail and the About header keep their exact footprint.
 */
export type BrandSealSize = 'sm' | 'md' | 'lg' | 'xl'

/** Rendered box per size. Heights match the previous mark at each size. */
const SIZES: Record<BrandSealSize, string> = {
  sm: 'h-6 w-[31px]',
  md: 'h-8 w-[41px]',
  lg: 'h-[38px] w-[48px]',
  xl: 'h-20 w-[98px]',
}

export type BrandSealProps = {
  size?: BrandSealSize
  className?: string
}

export function BrandSeal({ size = 'md', className }: BrandSealProps) {
  return (
    <img
      // Decorative: the product name sits next to the mark in the sidebar and
      // above it on the empty state, so announcing the brand twice is noise.
      aria-hidden="true"
      alt=""
      draggable={false}
      src={publicAssetPath('app-icon.png')}
      className={cx('flex-shrink-0 object-contain', SIZES[size], className)}
    />
  )
}
