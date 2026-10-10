import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeCodeHook, ClaudeCodeHookEvent } from "../../types";
import { classifySource } from "./shared";

export async function listHooks(cwd?: string): Promise<ClaudeCodeHook[]> {
	const hooks: ClaudeCodeHook[] = [];
	const searchDirs: string[] = [];

	if (cwd) {
		searchDirs.push(join(cwd, ".claude", "hooks"));
		searchDirs.push(join(cwd, "hooks"));
	}

	searchDirs.push(join(homedir(), ".claude", "hooks"));

	const parseHooksJson = (hooksJsonPath: string, source: "project" | "user" | "plugin", content: string) => {
		const parsed = JSON.parse(content) as { hooks?: Record<string, any[]>; description?: string };
		if (!parsed.hooks) return;
		let idx = 0;
		for (const [event, matchers] of Object.entries(parsed.hooks)) {
			if (!Array.isArray(matchers)) continue;
			for (const entry of matchers) {
				const matcherValue =
					typeof entry?.matcher === "string"
						? entry.matcher
						: typeof entry?.matcher?.matcher === "string"
							? entry.matcher.matcher
							: undefined;
				const enabled = typeof entry?.enabled === "boolean" ? entry.enabled : true;
				const hooksArr = Array.isArray(entry?.hooks) ? entry.hooks : undefined;
				const description = typeof entry?.description === "string" ? entry.description : undefined;
				hooks.push({
					id: `${source}:${hooksJsonPath}:${event}:${idx++}`,
					event: event as ClaudeCodeHookEvent,
					matcher: matcherValue,
					enabled,
					description,
					hooks: hooksArr,
					source,
					path: hooksJsonPath,
				});
			}
		}
	};

	for (const dir of searchDirs) {
		const source = classifySource(dir, "hooks");
		try {
			const hooksJsonPath = join(dir, "hooks.json");
			const content = await readFile(hooksJsonPath, "utf-8");
			parseHooksJson(hooksJsonPath, source, content);
		} catch {}
	}

	// Also read hooks from settings.json files.
	// Claude Code CLI stores hooks in settings.json under the "hooks" key (the
	// standard approach).  The standalone hooks.json file is an alternative that
	// some projects and plugins use.  We read both so the Broski UI surfaces
	// hooks regardless of which convention the project follows.
	const settingsFiles: Array<{ path: string; source: "project" | "user" }> = [];
	if (cwd) {
		settingsFiles.push({ path: join(cwd, ".claude", "settings.json"), source: "project" });
	}
	settingsFiles.push({ path: join(homedir(), ".claude", "settings.json"), source: "user" });

	for (const { path: settingsPath, source } of settingsFiles) {
		try {
			const raw = await readFile(settingsPath, "utf-8");
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			if (parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)) {
				// Wrap in the same shape as hooks.json so parseHooksJson can handle it.
				parseHooksJson(settingsPath, source, JSON.stringify({ hooks: parsed.hooks }));
			}
		} catch {
			// settings.json missing or unreadable — fine.
		}
	}

	// Also include hooks exposed by enabled plugins.
	try {
		const pluginsModule = await import("../../plugins");
		const plugins = await pluginsModule.discoverPlugins(cwd);
		for (const plugin of plugins) {
			if (plugin.status !== "enabled") continue;
			const hooksJsonPath = join(plugin.path, "hooks", "hooks.json");
			try {
				const content = await readFile(hooksJsonPath, "utf-8");
				parseHooksJson(hooksJsonPath, "plugin", content);
			} catch {
				// ignore missing hooks
			}
		}
	} catch {
		// ignore (plugins optional)
	}

	return hooks;
}
