import { PRODUCT_IDENTITY } from '@/lib/productIdentity.generated'

// Set native links only after the APK or TestFlight public invitation is verified.
export const mobileAppLinks: { android: string | null, testFlight: string | null, guide: string } = {
  android: null,
  testFlight: null,
  guide: `${PRODUCT_IDENTITY.docsUrl}/desktop/remote`,
}
