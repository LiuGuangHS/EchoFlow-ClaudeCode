import {
  PRODUCT_ENV_PREFIX,
  PRODUCT_LEGACY_ENV_PREFIX,
} from './productIdentity.generated'

/**
 * Reads a product environment variable, preferring the current prefix and
 * falling back to the legacy one.
 *
 * Writes must always use `writeProductEnvName()`. Reading the legacy name is a
 * migration aid: an installed build may still carry `CC_HAHA_*` in its shell,
 * unit file or CI secret, and dropping the fallback would silently change
 * behaviour for those users.
 */
export function readProductEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const current = env[`${PRODUCT_ENV_PREFIX}${name}`]
  if (current !== undefined && current !== '') return current
  const legacy = env[`${PRODUCT_LEGACY_ENV_PREFIX}${name}`]
  return legacy === undefined || legacy === '' ? undefined : legacy
}

/** The only name a write is allowed to use. */
export function writeProductEnvName(name: string): string {
  return `${PRODUCT_ENV_PREFIX}${name}`
}
