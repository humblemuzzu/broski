import { homedir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { BroskiConfigSchema, type BroskiConfig } from './schema'
import { getDefaultConfig } from './defaults'

const CONFIG_PATH = resolve(homedir(), '.broski', 'config.json')

/**
 * Get the path to the config file.
 */
export function getConfigPath(): string {
  return CONFIG_PATH
}

/**
 * Read and validate the config file.
 * Returns default config if the file is missing or invalid.
 */
export async function readConfig(): Promise<BroskiConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    const result = BroskiConfigSchema.safeParse(parsed)
    if (result.success) {
      return result.data
    }
    // Schema validation failed — return defaults
    console.warn('[config] Invalid config, using defaults:', result.error.message)
    return getDefaultConfig()
  } catch {
    // File missing or unreadable — return defaults
    return getDefaultConfig()
  }
}

/**
 * Write the config atomically (write to .tmp, then rename).
 */
export async function writeConfig(config: BroskiConfig): Promise<void> {
  const dir = dirname(CONFIG_PATH)
  await mkdir(dir, { recursive: true })

  const tmpPath = `${CONFIG_PATH}.tmp`
  const content = JSON.stringify(config, null, 2) + '\n'
  await writeFile(tmpPath, content, { mode: 0o600 })
  await rename(tmpPath, CONFIG_PATH)
}

/**
 * Deep merge helper. Merges source into target (1 level of nesting).
 */
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]
    if (
      sv != null &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv != null &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      result[key] = { ...tv, ...sv }
    } else {
      result[key] = sv
    }
  }
  return result
}

/**
 * Read config, deep-merge the partial update, validate, and write back.
 */
export async function updateConfig(partial: Partial<BroskiConfig>): Promise<BroskiConfig> {
  const current = await readConfig()
  const merged = deepMerge(current as Record<string, any>, partial as Record<string, any>)
  const result = BroskiConfigSchema.safeParse(merged)
  if (!result.success) {
    throw new Error(`Invalid config after merge: ${result.error.message}`)
  }
  await writeConfig(result.data)
  return result.data
}
