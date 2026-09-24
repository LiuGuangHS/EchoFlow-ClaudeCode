import type {
  ApiFormat,
  ImageGenerationConfig,
  Model1mSupport,
  ModelContextWindows,
  ModelMapping,
  ProviderAuthStrategy,
  ProviderRuntimeKind,
  RequestCompatibility,
} from './provider'

export type ShareableProvider = {
  presetId: string
  name: string
  baseUrl: string
  apiFormat: ApiFormat
  authStrategy?: ProviderAuthStrategy
  runtimeKind?: ProviderRuntimeKind
  models: ModelMapping
  model1mSupport?: Model1mSupport
  autoCompactWindow?: number
  modelContextWindows?: ModelContextWindows
  toolSearchEnabled?: boolean
  disableExperimentalBetas?: boolean
  supportsNestedToolResultMedia?: boolean
  requestCompatibility?: Pick<RequestCompatibility, 'maxOutputTokens' | 'outputTokenLimit' | 'outputTokenField' | 'sampling' | 'reasoning' | 'parallelTools' | 'structuredOutput'>
  imageGeneration?: Omit<ImageGenerationConfig, 'apiKey'>
  notes?: string
}

/** Versioned provider template; credentials and local app settings are never shared. */
export interface ShareableConfig {
  version: 1
  source: string
  timestamp: number
  config: {
    providers: ShareableProvider[]
  }
}

export interface DeepLinkPayload {
  type: 'config-import'
  data: ShareableConfig
}
