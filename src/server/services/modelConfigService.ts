import { createHash } from 'node:crypto'

export type ModelConfigInput = {
  providerId: string | null
  modelId: string
  effortLevel?: string
}

export type ModelConfig = ModelConfigInput & {
  id: string
}

function canonicalValue(input: ModelConfigInput): ModelConfigInput {
  const providerId = typeof input.providerId === 'string'
    ? input.providerId.trim() || null
    : null
  const modelId = input.modelId.trim()
  const effortLevel = typeof input.effortLevel === 'string'
    ? input.effortLevel.trim() || undefined
    : undefined
  return {
    providerId,
    modelId,
    ...(effortLevel ? { effortLevel } : {}),
  }
}

function modelConfigId(input: ModelConfigInput): string {
  return `mc_${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`
}

export class ModelConfigService {
  private readonly configs = new Map<string, ModelConfig>()

  normalize(input: ModelConfigInput): ModelConfigInput {
    const normalized = canonicalValue(input)
    if (!normalized.modelId) throw new Error('Model configuration requires a model id')
    return normalized
  }

  register(input: ModelConfigInput): ModelConfig {
    const normalized = this.normalize(input)
    const id = modelConfigId(normalized)
    const existing = this.configs.get(id)
    if (existing) return existing

    const config: ModelConfig = { id, ...normalized }
    this.configs.set(id, config)
    return config
  }

  get(configId: string): ModelConfig | null {
    return this.configs.get(configId) ?? null
  }

  findOrCreate(input: ModelConfigInput): ModelConfig {
    return this.register(input)
  }

  clear(): void {
    this.configs.clear()
  }
}

export const modelConfigService = new ModelConfigService()
