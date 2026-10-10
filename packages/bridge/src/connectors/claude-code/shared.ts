import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Query as SDKQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
	ClaudeCodeAccountInfo,
	ClaudeCodeBeta,
	ClaudeCodeConfig,
	ClaudeCodeMcpServerStatus,
	ClaudeCodeSupportedModel,
} from "../../types";

export const CLAUDE_SETTINGS_FILE = join(homedir(), ".claude", "settings.json");
export const BROSKI_DIR = join(homedir(), ".broski");
export const CC_CONFIG_FILE = join(BROSKI_DIR, "claude-code-config.json");

/**
 * Classify a .claude/ subdirectory as 'project' or 'user' scope.
 *
 * The old check `dir.startsWith(homedir())` was wrong because *every* path on
 * macOS/Linux starts with the home directory — even project paths.
 *
 * The correct logic: a directory is 'user' scoped if and only if it lives
 * directly under `~/.claude/<feature>/` (the user-level config root).
 * Everything else (including `<project>/.claude/<feature>/`) is 'project'.
 */
export function classifySource(dir: string, feature: string): "project" | "user" {
	const userDir = join(homedir(), ".claude", feature);
	// Exact match or direct child — this IS the user-scope directory.
	return dir === userDir ? "user" : "project";
}

export type ActiveSession = {
	controller: AbortController;
	cwd: string;
	query?: SDKQuery;
	startedAt: number;
};

export const activeSessions = new Map<string, ActiveSession>();
export const ccSupportedModelsByCwd = new Map<string, ClaudeCodeSupportedModel[]>();
export const ccAccountInfoByCwd = new Map<string, ClaudeCodeAccountInfo>();
export const ccMcpStatusByCwd = new Map<string, ClaudeCodeMcpServerStatus[]>();

let currentConfig: ClaudeCodeConfig = {
	permissionMode: "default",
	allowedTools: [
		"Read",
		"Glob",
		"Grep",
		"WebFetch",
		"WebSearch",
		"TodoRead",
		"TodoWrite",
		"Write",
		"Edit",
		"MultiEdit",
		"Bash",
		"NotebookEdit",
		"Task",
	],
	disallowedTools: [],
	model: "sonnet",
	betas: [],
	enableAgentTeams: false,
	promptSuggestions: false,
	systemPrompt: { type: "preset", preset: "claude_code" },
	// Defaults: Claude Code itself defaults to respecting .gitignore in file pickers.
	// Leave language/releaseChannel unset unless the user configures them.
	respectGitignore: true,
};

export function getCurrentConfig(): ClaudeCodeConfig {
	return currentConfig;
}

export function setCurrentConfig(next: ClaudeCodeConfig): void {
	currentConfig = next;
}

// Best-effort persisted config load (keeps Claude Code settings stable across bridge restarts).
try {
	if (existsSync(CC_CONFIG_FILE)) {
		const raw = readFileSync(CC_CONFIG_FILE, "utf-8");
		const parsed = JSON.parse(raw) as Partial<ClaudeCodeConfig>;
		currentConfig = {
			...currentConfig,
			...parsed,
			...(parsed.betas ? { betas: normalizeBetas(parsed.betas) } : {}),
		};
	}
} catch {
	// ignore (use defaults)
}

export async function persistConfig(): Promise<void> {
	try {
		await mkdir(BROSKI_DIR, { recursive: true });
		await writeFile(CC_CONFIG_FILE, JSON.stringify(currentConfig, null, 2), "utf-8");
	} catch (err) {
		console.warn("[Claude Code] Failed to persist config:", err);
	}
}

export function cwdCacheKey(cwd?: string): string {
	const normalized = (cwd || "").trim();
	return normalized.length > 0 ? normalized : "__global__";
}

export function normalizeBetas(betas?: string[] | ClaudeCodeBeta[]): ClaudeCodeBeta[] | undefined {
	if (!Array.isArray(betas)) return undefined;
	const normalized = Array.from(
		new Set(betas.map((b) => String(b).trim()).filter((b): b is ClaudeCodeBeta => b === "context-1m-2025-08-07")),
	);
	return normalized.length > 0 ? normalized : undefined;
}

export function fallbackSupportedModels(): ClaudeCodeSupportedModel[] {
	return [
		{
			value: "sonnet",
			displayName: "Claude Sonnet",
			description: "Balanced model for coding and reasoning",
		},
		{
			value: "opus",
			displayName: "Claude Opus",
			description: "High-capability model for complex tasks",
		},
		{
			value: "haiku",
			displayName: "Claude Haiku",
			description: "Fast and efficient model for lightweight tasks",
		},
	];
}

/**
 * Thinking level variants mapped to maxThinkingTokens values.
 * These provide user-friendly named presets for Claude's extended thinking feature.
 * Values chosen to match typical reasoning effort levels.
 */
const THINKING_VARIANTS: Record<string, number | null> = {
	default: null, // Use SDK default (no override)
	low: 4096, // Quick responses, minimal reasoning
	medium: 16384, // Balanced reasoning
	high: 65536, // Deep reasoning for complex tasks
	max: null, // Use model maximum (SDK default handles this)
};

/**
 * Convert a named variant to maxThinkingTokens value.
 * Returns undefined if variant is not recognized (allowing fallback to explicit maxThinkingTokens).
 */
export function variantToThinkingTokens(variant?: string): number | null | undefined {
	if (!variant) return undefined;
	const normalized = variant.toLowerCase();
	if (normalized in THINKING_VARIANTS) {
		return THINKING_VARIANTS[normalized];
	}
	return undefined;
}
