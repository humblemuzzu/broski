/** The directories config paths hang from for one cwd, read from what the CLI itself resolves (research 05 §8). */

import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedSettings } from "@anthropic-ai/claude-agent-sdk";
import type { OpsDeps } from "../ports";
import { managedDirFor, type PlaceRoots } from "./config-paths";

const SANITIZED_MAX = 200;

/** The project directory name the CLI derives from a cwd: every non-alphanumeric character becomes `-` (research 04 §2.1). */
export function sanitizedProject(cwd: string): string {
	return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

async function projectDirectoryName(projectsDir: string, cwd: string): Promise<string | undefined> {
	const name = sanitizedProject(cwd);
	if (name.length <= SANITIZED_MAX) return name;
	const prefix = `${name.slice(0, SANITIZED_MAX)}-`;
	const names = await readdir(projectsDir).catch(() => []);
	const matches = names.filter((entry) => entry.startsWith(prefix));
	return matches.length === 1 ? matches[0] : undefined;
}

/** `autoMemoryDirectory` from any settings source but the project's, which the CLI ignores for it (research 05 §2.8). */
function customAutoMemory(resolved: ResolvedSettings | undefined, home: string | undefined): string | undefined {
	const sources = resolved?.sources.filter((entry) => entry.source !== "project") ?? [];
	const chosen = [...sources].reverse().find((entry) => typeof entry.settings.autoMemoryDirectory === "string");
	const value = chosen?.settings.autoMemoryDirectory;
	if (typeof value !== "string" || value === "") return undefined;
	if (!value.startsWith("~/")) return value.startsWith("/") ? value : undefined;
	return home === undefined || home === "" ? undefined : join(home, value.slice(2));
}

function settingsPathsOf(resolved: ResolvedSettings | undefined): PlaceRoots["settingsPaths"] {
	const paths: Partial<Record<"project" | "local", string>> = {};
	for (const entry of resolved?.sources ?? []) {
		if ((entry.source === "project" || entry.source === "local") && entry.path !== undefined)
			paths[entry.source] = entry.path;
	}
	return paths;
}

async function loadedPaths(resolved: ResolvedSettings | undefined): Promise<Set<string>> {
	const loaded = new Set<string>();
	for (const entry of resolved?.sources ?? []) {
		const path = entry.path;
		if (path === undefined) continue;
		loaded.add(path);
		loaded.add(await realpath(path).catch(() => path));
	}
	return loaded;
}

export async function placeRoots(deps: OpsDeps, cwd: string): Promise<PlaceRoots> {
	const configRoot = deps.services.sdk.configRoot();
	const resolved = await deps.services.sdk.resolveSettings({ cwd }).catch(() => undefined);
	const custom = customAutoMemory(resolved, deps.services.cliEnv.HOME);
	const projects = join(configRoot, "projects");
	const name = custom === undefined ? await projectDirectoryName(projects, cwd) : undefined;
	return {
		configRoot,
		cwd,
		managedDir: managedDirFor(process.platform),
		autoMemoryDir: custom ?? (name === undefined ? undefined : join(projects, name, "memory")),
		settingsPaths: settingsPathsOf(resolved),
		loadedSettings: resolved === undefined ? undefined : await loadedPaths(resolved),
	};
}
