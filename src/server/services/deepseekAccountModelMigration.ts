export const DEEPSEEK_ACCOUNT_FLASH_MODEL = 'deepseek-flash'
const LEGACY_DEEPSEEK_ACCOUNT_FLASH_MODEL = 'deepseek-v4-flash'

/** Upgrade the legacy account route's model IDs without loading OAuth/runtime owners. */
export function migrateLegacyDeepSeekAccountModels<T extends Record<string, unknown>>(models: T): T {
  let changed = false
  const migrated: Record<string, unknown> = { ...models }
  for (const [slot, value] of Object.entries(models)) {
    if (typeof value === 'string' && value.trim() === LEGACY_DEEPSEEK_ACCOUNT_FLASH_MODEL) {
      migrated[slot] = DEEPSEEK_ACCOUNT_FLASH_MODEL
      changed = true
    }
  }
  return changed ? migrated as T : models
}
