import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { getDefaultConfig } from "./defaults";
import { type BroskiConfig, BroskiConfigSchema } from "./schema";

/**
 * Get the path to the config file.
 */
export function getConfigPath(): string {
	return resolve(homedir(), ".broski", "config.json");
}

/**
 * Read and validate the config file.
 * Returns default config if the file is missing or invalid.
 */
export async function readConfig(path = getConfigPath()): Promise<BroskiConfig> {
	try {
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw);
		const result = BroskiConfigSchema.safeParse(parsed);
		if (result.success) {
			return result.data;
		}
		// Schema validation failed — return defaults
		console.warn("[config] Invalid config, using defaults:", result.error.message);
		return getDefaultConfig();
	} catch {
		// File missing or unreadable — return defaults
		return getDefaultConfig();
	}
}

/**
 * Write the config atomically (write to .tmp, then rename).
 */
export async function writeConfig(config: BroskiConfig, path = getConfigPath()): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });

	const tmpPath = `${path}.tmp`;
	const content = `${JSON.stringify(config, null, 2)}\n`;
	await writeFile(tmpPath, content, { mode: 0o600 });
	await rename(tmpPath, path);
}

/**
 * Deep merge helper. Merges source into target (1 level of nesting).
 */
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		const sv = source[key];
		const tv = target[key];
		if (
			sv != null &&
			typeof sv === "object" &&
			!Array.isArray(sv) &&
			tv != null &&
			typeof tv === "object" &&
			!Array.isArray(tv)
		) {
			result[key] = { ...tv, ...sv };
		} else {
			result[key] = sv;
		}
	}
	return result;
}

/**
 * Read config, deep-merge the partial update, validate, and write back.
 */
export async function updateConfig(partial: Partial<BroskiConfig>, path = getConfigPath()): Promise<BroskiConfig> {
	const current = await readConfig(path);
	const merged = deepMerge(current as Record<string, any>, partial as Record<string, any>);
	const result = BroskiConfigSchema.safeParse(merged);
	if (!result.success) {
		throw new Error(`Invalid config after merge: ${result.error.message}`);
	}
	await writeConfig(result.data, path);
	return result.data;
}
