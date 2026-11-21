// Compatibility exports share the canonical callback and refresh owner.
export {
  EchoFlowGrokOAuthService as HahaGrokOAuthService,
  echoFlowGrokOAuthService as hahaGrokOAuthService,
  getEchoFlowGrokOAuthFilePath as getHahaGrokOAuthFilePath,
  GROK_OAUTH_SUCCESS_HTML,
} from './echoFlowGrokOAuthService.js'
export type { StoredGrokOAuthTokens, GrokOAuthSession } from './echoFlowGrokOAuthService.js'
