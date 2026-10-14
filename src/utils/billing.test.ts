import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import {
  hasClaudeAiBillingAccess,
  hasConsoleBillingAccess,
  setMockBillingAccessOverride,
} from './billing.js'

const originalAccount = getGlobalConfig().oauthAccount
const originalApiKey = process.env.ANTHROPIC_API_KEY
let previousDisableWarnings: string | undefined

function setAccount(account: Record<string, unknown> | undefined) {
  saveGlobalConfig(current => ({ ...current, oauthAccount: account as never }))
}

beforeEach(() => {
  setMockBillingAccessOverride(null)
  setAccount(undefined)
  // getAnthropicApiKey() throws when no credential is present at all, which
  // is the logged-out branch — not the one under test here.
  process.env.ANTHROPIC_API_KEY = 'fixture-key'
})

afterEach(() => {
  setMockBillingAccessOverride(null)
  setAccount(originalAccount as never)
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalApiKey
  if (previousDisableWarnings === undefined)
    delete process.env.DISABLE_COST_WARNINGS
  else process.env.DISABLE_COST_WARNINGS = previousDisableWarnings
})

// The "no auth at all" branch is not reachable here: under NODE_ENV=test
// getAnthropicApiKey() throws on a missing key rather than returning null.

describe('hasConsoleBillingAccess', () => {
  test('is false when cost warnings are disabled', () => {
    previousDisableWarnings = process.env.DISABLE_COST_WARNINGS
    process.env.DISABLE_COST_WARNINGS = 'true'
    setAccount({ organizationRole: 'admin', workspaceRole: 'workspace_admin' })
    expect(hasConsoleBillingAccess()).toBe(false)
  })

  test('is false when roles are missing, so grandfathered accounts stay hidden', () => {
    setAccount({ organizationRole: undefined, workspaceRole: undefined })
    expect(hasConsoleBillingAccess()).toBe(false)
  })

  test('is true for an org admin or org billing role', () => {
    for (const organizationRole of ['admin', 'billing']) {
      setAccount({ organizationRole, workspaceRole: 'none' })
      expect(hasConsoleBillingAccess()).toBe(true)
    }
  })

  test('is true for a workspace admin or workspace billing role', () => {
    for (const workspaceRole of ['workspace_admin', 'workspace_billing']) {
      setAccount({ organizationRole: 'member', workspaceRole })
      expect(hasConsoleBillingAccess()).toBe(true)
    }
  })

  test('is false for roles outside the two allowlists', () => {
    setAccount({ organizationRole: 'member', workspaceRole: 'member' })
    expect(hasConsoleBillingAccess()).toBe(false)
  })
})

describe('hasClaudeAiBillingAccess', () => {
  test('honours the /mock-limits override ahead of everything else', () => {
    setMockBillingAccessOverride(true)
    expect(hasClaudeAiBillingAccess()).toBe(true)
    setMockBillingAccessOverride(false)
    expect(hasClaudeAiBillingAccess()).toBe(false)
  })

  test('is false for non-subscribers regardless of role', () => {
    setAccount({ organizationRole: 'admin' })
    expect(hasClaudeAiBillingAccess()).toBe(false)
  })
})