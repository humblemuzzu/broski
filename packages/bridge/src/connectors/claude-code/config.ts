import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClaudeCodeConfig } from "../../types";
import { getCurrentConfig, normalizeBetas, persistConfig, setCurrentConfig } from "./shared";

async function readProjectSettings(cwd: string): Promise<Record<string, any>> {
	const settingsPath = join(cwd, ".claude", "settings.json");
	try {
		const raw = await readFile(settingsPath, "utf-8");
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
	} catch {
		return {};
	}
}

async function writeProjectSettings(cwd: string, next: Record<string, any>): Promise<void> {
	const settingsPath = join(cwd, ".claude", "settings.json");
	await mkdir(join(cwd, ".claude"), { recursive: true });
	await writeFile(settingsPath, JSON.stringify(next, null, 2), "utf-8");
}

function applyProjectSettingsPatch(
	settings: Record<string, any>,
	patch: Pick<ClaudeCodeConfig, "language" | "releaseChannel" | "respectGitignore">,
): Record<string, any> {
	const next = { ...settings };

	if ("language" in patch) {
		const v = patch.language;
		if (typeof v === "string" && v.trim().length > 0) next.language = v.trim();
		else delete next.language;
	}

	if ("releaseChannel" in patch) {
		const v = patch.releaseChannel;
		if (v === "stable" || v === "latest") next.releaseChannel = v;
		else delete next.releaseChannel;
	}

	if ("respectGitignore" in patch) {
		const v = patch.respectGitignore;
		if (typeof v === "boolean") next.respectGitignore = v;
		else delete next.respectGitignore;
	}

	return next;
}

export async function getConfig(cwd?: string): Promise<ClaudeCodeConfig> {
	const cfg: ClaudeCodeConfig = { ...getCurrentConfig() };

	if (cwd) {
		const settings = await readProjectSettings(cwd);
		if (typeof settings.language === "string" && settings.language.trim().length > 0) {
			cfg.language = settings.language.trim();
		}
		if (
			typeof settings.releaseChannel === "string" &&
			(settings.releaseChannel === "stable" || settings.releaseChannel === "latest")
		) {
			cfg.releaseChannel = settings.releaseChannel;
		}
		if (typeof settings.respectGitignore === "boolean") {
			cfg.respectGitignore = settings.respectGitignore;
		}
	}

	return cfg;
}

export async function setConfig(config: Partial<ClaudeCodeConfig>, cwd?: string): Promise<ClaudeCodeConfig> {
	const normalized: Partial<ClaudeCodeConfig> = {
		...config,
		...(config.betas ? { betas: normalizeBetas(config.betas) } : {}),
	};

	if ("maxTurns" in normalized && typeof normalized.maxTurns === "number" && normalized.maxTurns <= 0) {
		normalized.maxTurns = undefined;
	}
	if ("maxBudgetUsd" in normalized && typeof normalized.maxBudgetUsd === "number" && normalized.maxBudgetUsd <= 0) {
		normalized.maxBudgetUsd = undefined;
	}

	setCurrentConfig({ ...getCurrentConfig(), ...normalized });

	// Persist our app-level defaults (allowedTools, systemPrompt, etc).
	// Fire-and-forget so the caller isn't blocked on IO.
	queueMicrotask(() => {
		persistConfig().catch(() => {});
	});

	// Also apply project-scoped settings when a cwd is provided.
	if (cwd) {
		const touchesProjectSettings = "language" in config || "releaseChannel" in config || "respectGitignore" in config;

		if (touchesProjectSettings) {
			const settings = await readProjectSettings(cwd);
			const nextSettings = applyProjectSettingsPatch(settings, {
				language: config.language,
				releaseChannel: config.releaseChannel,
				respectGitignore: config.respectGitignore,
			});
			await writeProjectSettings(cwd, nextSettings);
		}
	}

	return await getConfig(cwd);
}
