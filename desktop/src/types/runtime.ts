import type { ReasoningEffortLevel } from './settings'

export type ModelConfig = {
  id?: string
  providerId: string | null
  modelId: string
  effortLevel?: ReasoningEffortLevel
}

/** @deprecated Use ModelConfig for model selection. */
export type RuntimeSelection = Omit<ModelConfig, 'id'>
