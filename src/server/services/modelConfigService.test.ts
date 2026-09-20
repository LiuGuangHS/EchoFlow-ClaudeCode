import { describe, expect, it } from 'bun:test'
import { ModelConfigService } from './modelConfigService.js'

describe('ModelConfigService', () => {
  it('rejects an empty model id', () => {
    const service = new ModelConfigService()
    expect(() => service.register({ providerId: null, modelId: '  ' })).toThrow(
      'Model configuration requires a model id',
    )
  })

  it('normalizes provider and effort values', () => {
    const service = new ModelConfigService()
    expect(service.normalize({
      providerId: '  provider  ',
      modelId: ' model ',
      effortLevel: '  high  ',
    })).toEqual({ providerId: 'provider', modelId: 'model', effortLevel: 'high' })
    expect(service.normalize({ providerId: '   ', modelId: 'model', effortLevel: '  ' }))
      .toEqual({ providerId: null, modelId: 'model' })
  })

  it('creates stable ids and reuses the canonical object', () => {
    const service = new ModelConfigService()
    const first = service.register({ providerId: 'provider', modelId: 'model' })
    const second = service.register({ providerId: ' provider ', modelId: ' model ' })
    expect(first.id).toMatch(/^mc_[0-9a-f]{64}$/)
    expect(second).toBe(first)
    expect(service.get(first.id)).toBe(first)
  })

  it('gives different ids to different model configurations', () => {
    const service = new ModelConfigService()
    const first = service.register({ providerId: null, modelId: 'model-a' })
    const second = service.register({ providerId: null, modelId: 'model-b' })
    const third = service.register({ providerId: null, modelId: 'model-a', effortLevel: 'high' })
    expect(new Set([first.id, second.id, third.id]).size).toBe(3)
  })

  it('allows multiple runtime owners to share one config id', () => {
    const service = new ModelConfigService()
    const config = service.register({ providerId: 'provider', modelId: 'model' })
    const runtimeBindings = new Map([
      ['runtime-a', config.id],
      ['runtime-b', config.id],
    ])
    expect(runtimeBindings.get('runtime-a')).toBe(config.id)
    expect(runtimeBindings.get('runtime-b')).toBe(config.id)
  })
})
