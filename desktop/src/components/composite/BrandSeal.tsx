import { cx } from '@/lib/cx'
import { publicAssetPath } from '@/lib/publicAsset'

/**
 * The EchoFlow Code mark.
 *
 * Every surface that shows the logo — sidebar rail, empty state, H5 connection
 * screen, About panel — goes through here, so the brand asset is swapped in one
 * place instead of six. The artwork itself lives in `desktop/public/app-icon.png`
 * (and `app-icon.svg`, which wraps it) and is shared with the tray, the packaged
 * app icon and the favicon, so the in-app mark can never drift from the one the
 * OS shows.
 */
export type BrandSealSize = 'sm' | 'md' | 'lg' | 'xl'

/**
 * The sizes the layout calls for — dense chrome 24, sidebar 32, collapsed rail
 * 38, empty state 80. The mark is square, unlike a wordmark, so width tracks
 * height at every step.
 */
const SIZES: Record<BrandSealSize, string> = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-[38px] w-[38px]',
  xl: 'h-20 w-20',
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
      src={publicAssetPath('app-icon.png')}
      className={cx('flex-shrink-0 select-none', SIZES[size], className)}
      draggable={false}
    />
  )
}
