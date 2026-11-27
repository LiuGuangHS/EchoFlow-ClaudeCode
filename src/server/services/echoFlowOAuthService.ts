// Both API names share sessions, refresh coalescing and account identity.
export {
  HahaOAuthService as EchoFlowOAuthService,
  hahaOAuthService as echoFlowOAuthService,
} from './hahaOAuthService.js'
export type { StoredOAuthTokens, OAuthSession } from './hahaOAuthService.js'
