// GENERATED FROM product.json — do not edit. Run `bun run product:identity`.

export const PRODUCT_IDENTITY = {
  name: "EchoFlow Code",
  slug: "echoflow-code",
  appId: "com.echoflow.code.desktop",
  mobilePackage: "com.echoflow.code.mobile",
  mobileBundleId: "com.echoflow.code.mobile",
  scheme: "codemobile",
  protocol: "echoflowcode",
  repoUrl: "https://github.com/LiuGuangHS/EchoFlow-ClaudeCode",
  docsUrl: "https://code.echoflow.cn",
  envPrefix: "ECHOFLOW_",
  legacyEnvPrefix: "CC_HAHA_",
  configDir: "echoflow-code",
  adsPublisherId: "pub-1962125033823297",
} as const

export type ProductIdentity = typeof PRODUCT_IDENTITY

export const PRODUCT_NAME = PRODUCT_IDENTITY.name
export const PRODUCT_SLUG = PRODUCT_IDENTITY.slug
export const PRODUCT_APP_ID = PRODUCT_IDENTITY.appId
export const PRODUCT_REPO_URL = PRODUCT_IDENTITY.repoUrl
export const PRODUCT_ENV_PREFIX = PRODUCT_IDENTITY.envPrefix
export const PRODUCT_LEGACY_ENV_PREFIX = PRODUCT_IDENTITY.legacyEnvPrefix
export const PRODUCT_CONFIG_DIR = PRODUCT_IDENTITY.configDir
