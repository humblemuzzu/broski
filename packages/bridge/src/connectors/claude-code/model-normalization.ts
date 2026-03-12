import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeCodeSupportedModel } from '../../types'

function toEffortLevels(value: unknown): Array<'low' | 'medium' | 'high' | 'max'> | undefined {
  if (!Array.isArray(value)) return undefined
  const levels = value
    .map((entry) => String(entry).trim())
    .filter(
      (entry): entry is 'low' | 'medium' | 'high' | 'max' =>
        entry === 'low' || entry === 'medium' || entry === 'high' || entry === 'max',
    )
  return levels.length > 0 ? levels : undefined
}

export function normalizeSupportedModels(models: unknown): ClaudeCodeSupportedModel[] {
  if (!Array.isArray(models)) return []

  const normalized = models
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const typed = item as Partial<ModelInfo>
      const value = String(typed.value ?? '').trim()
      if (!value) return null

      return {
        value,
        displayName: String(typed.displayName ?? value).trim() || value,
        description: String(typed.description ?? '').trim(),
        supportsEffort: typeof typed.supportsEffort === 'boolean'
          ? typed.supportsEffort
          : undefined,
        supportedEffortLevels: toEffortLevels(typed.supportedEffortLevels),
        supportsAdaptiveThinking: typeof typed.supportsAdaptiveThinking === 'boolean'
          ? typed.supportsAdaptiveThinking
          : undefined,
        supportsFastMode: typeof typed.supportsFastMode === 'boolean'
          ? typed.supportsFastMode
          : undefined,
      } satisfies ClaudeCodeSupportedModel
    })
    .filter((item): item is ClaudeCodeSupportedModel => item != null)

  return normalized
}
