import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ArtifactsConfig } from './types'

const BROSKI_DIR = join(homedir(), '.broski')
const CONFIG_FILE = join(BROSKI_DIR, 'artifacts-config.json')

const DEFAULT_CONFIG: ArtifactsConfig = {
  indexingEnabled: true,
  maxContentChars: 250_000,
  enrichment: {
    provider: 'off',
    enabled: false,
    batchSize: 5,
    maxCharsPerArtifact: 6000,
    hiddenCwd: '/tmp/broski-enrichment',
  },
}

let cachedConfig: ArtifactsConfig | null = null

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), min), max)
}

function sanitizeConfig(partial: Partial<ArtifactsConfig>): ArtifactsConfig {
  const enrichment = partial.enrichment ?? {}
  const provider = enrichment.provider ?? DEFAULT_CONFIG.enrichment.provider
  const safeProvider =
    provider === 'off' || provider === 'claude-code' || provider === 'opencode'
      ? provider
      : DEFAULT_CONFIG.enrichment.provider

  const hiddenCwd =
    typeof enrichment.hiddenCwd === 'string' && enrichment.hiddenCwd.trim().length > 0
      ? enrichment.hiddenCwd.trim()
      : DEFAULT_CONFIG.enrichment.hiddenCwd

  return {
    indexingEnabled: partial.indexingEnabled ?? DEFAULT_CONFIG.indexingEnabled,
    maxContentChars: clampInt(partial.maxContentChars, DEFAULT_CONFIG.maxContentChars, 20_000, 2_000_000),
    enrichment: {
      provider: safeProvider,
      enabled: enrichment.enabled ?? DEFAULT_CONFIG.enrichment.enabled,
      batchSize: clampInt(enrichment.batchSize, DEFAULT_CONFIG.enrichment.batchSize, 1, 20),
      maxCharsPerArtifact: clampInt(enrichment.maxCharsPerArtifact, DEFAULT_CONFIG.enrichment.maxCharsPerArtifact, 500, 20_000),
      hiddenCwd,
    },
  }
}

export async function getArtifactsConfig(): Promise<ArtifactsConfig> {
  if (cachedConfig) return cachedConfig
  try {
    const text = await readFile(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(text) as Partial<ArtifactsConfig>
    cachedConfig = sanitizeConfig(parsed)
    return cachedConfig
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG }
    return cachedConfig
  }
}

export async function setArtifactsConfig(update: Partial<ArtifactsConfig>): Promise<ArtifactsConfig> {
  const current = await getArtifactsConfig()
  const merged: Partial<ArtifactsConfig> = {
    ...current,
    ...update,
    enrichment: {
      ...current.enrichment,
      ...(update.enrichment ?? {}),
    },
  }
  const next = sanitizeConfig(merged)
  cachedConfig = next

  try {
    await mkdir(dirname(CONFIG_FILE), { recursive: true })
    await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[Artifacts] Failed to save config:', err)
  }
  return next
}

export async function getArtifactsDbSizeBytes(dbPath: string): Promise<number> {
  try {
    const s = await stat(dbPath)
    return Number(s.size ?? 0)
  } catch {
    return 0
  }
}

