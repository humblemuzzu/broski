/**
 * Claude Code Plugin Management
 *
 * Handles discovery, configuration, and loading of Claude Code plugins.
 * Plugins provide slash commands, agents, skills, hooks, and MCP servers.
 *
 * Plugin discovery locations:
 * - Global: ~/.claude/plugins/
 * - Project: {cwd}/.claude/plugins/
 * - Custom: User-added paths via cc_add_plugin_path
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type {
	ClaudeCodePlugin,
	ClaudeCodePluginConfig,
	ClaudeCodePluginManifest,
	ClaudeCodePluginStatus,
} from "./types";
import { dirExists, fileExists } from "./utils/fs-helpers";

const GLOBAL_PLUGINS_DIR = join(homedir(), ".claude", "plugins");
const BROSKI_CONFIG_DIR = join(homedir(), ".broski");
const PLUGINS_CONFIG_FILE = join(BROSKI_CONFIG_DIR, "plugins-config.json");

// In-memory cache of discovered plugins
let cachedPlugins: ClaudeCodePlugin[] = [];
let lastDiscoveryCwd: string | undefined;
let lastDiscoveryTime = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

// Stored config (enabled/disabled state, custom paths)
let pluginConfig: ClaudeCodePluginConfig = {
	enabled: [],
	disabled: [],
	customPaths: [],
};

/**
 * Load plugin configuration from disk
 */
async function loadPluginConfig(): Promise<ClaudeCodePluginConfig> {
	try {
		const text = await readFile(PLUGINS_CONFIG_FILE, "utf-8");
		const config = JSON.parse(text) as Partial<ClaudeCodePluginConfig>;
		pluginConfig = {
			enabled: config.enabled || [],
			disabled: config.disabled || [],
			customPaths: config.customPaths || [],
		};
		return pluginConfig;
	} catch {
		// File doesn't exist or is invalid, use defaults
		return pluginConfig;
	}
}

/**
 * Save plugin configuration to disk
 */
async function savePluginConfig(): Promise<void> {
	try {
		await mkdir(BROSKI_CONFIG_DIR, { recursive: true });
		await writeFile(PLUGINS_CONFIG_FILE, JSON.stringify(pluginConfig, null, 2), "utf-8");
	} catch (error) {
		console.error("[Plugins] Failed to save config:", error);
	}
}

/**
 * Parse a plugin manifest from plugin.json
 */
async function parsePluginManifest(pluginDir: string): Promise<ClaudeCodePluginManifest | null> {
	const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
	try {
		const text = await readFile(manifestPath, "utf-8");
		const manifest = JSON.parse(text) as ClaudeCodePluginManifest;
		return manifest;
	} catch {
		return null;
	}
}

/**
 * Discover components in a plugin directory
 */
async function discoverPluginComponents(pluginDir: string): Promise<{
	commands: string[];
	agents: string[];
	skills: string[];
	hasHooks: boolean;
	hasMcpServers: boolean;
}> {
	const commands: string[] = [];
	const agents: string[] = [];
	const skills: string[] = [];
	let hasHooks = false;
	let hasMcpServers = false;

	// Check for commands directory
	const commandsDir = join(pluginDir, "commands");
	if (await dirExists(commandsDir)) {
		try {
			const entries = await readdir(commandsDir);
			for (const entry of entries) {
				if (entry.endsWith(".md")) {
					commands.push(basename(entry, ".md"));
				}
			}
		} catch {
			// ignore
		}
	}

	// Check for agents directory
	const agentsDir = join(pluginDir, "agents");
	if (await dirExists(agentsDir)) {
		try {
			const entries = await readdir(agentsDir);
			for (const entry of entries) {
				if (entry.endsWith(".md")) {
					agents.push(basename(entry, ".md"));
				}
			}
		} catch {
			// ignore
		}
	}

	// Check for skills directory
	const skillsDir = join(pluginDir, "skills");
	if (await dirExists(skillsDir)) {
		try {
			const entries = await readdir(skillsDir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					// Check if skill has SKILL.md
					if (await fileExists(join(skillsDir, entry.name, "SKILL.md"))) {
						skills.push(entry.name);
					}
				}
			}
		} catch {
			// ignore
		}
	}

	// Check for hooks
	if (await fileExists(join(pluginDir, "hooks", "hooks.json"))) {
		hasHooks = true;
	} else if (await fileExists(join(pluginDir, "hooks.json"))) {
		hasHooks = true;
	}

	// Check for MCP servers
	if (await fileExists(join(pluginDir, ".mcp.json"))) {
		hasMcpServers = true;
	}

	return { commands, agents, skills, hasHooks, hasMcpServers };
}

/**
 * Discover a single plugin from a directory
 */
async function discoverPlugin(pluginDir: string): Promise<ClaudeCodePlugin | null> {
	// Check if it has a manifest
	const manifestDir = join(pluginDir, ".claude-plugin");
	if (!(await dirExists(manifestDir))) {
		return null;
	}

	const manifest = await parsePluginManifest(pluginDir);
	if (!manifest?.name) {
		return null;
	}

	const components = await discoverPluginComponents(pluginDir);

	// Determine status based on config
	let status: ClaudeCodePluginStatus = "enabled";
	if (pluginConfig.disabled.includes(manifest.name)) {
		status = "disabled";
	}

	return {
		name: manifest.name,
		path: resolve(pluginDir),
		status,
		manifest,
		commands: components.commands.length > 0 ? components.commands : undefined,
		agents: components.agents.length > 0 ? components.agents : undefined,
		skills: components.skills.length > 0 ? components.skills : undefined,
		hasHooks: components.hasHooks || undefined,
		hasMcpServers: components.hasMcpServers || undefined,
		loadedAt: Date.now(),
	};
}

/**
 * Scan a directory for plugins
 */
async function scanPluginDirectory(dir: string): Promise<ClaudeCodePlugin[]> {
	const plugins: ClaudeCodePlugin[] = [];

	if (!(await dirExists(dir))) {
		return plugins;
	}

	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const pluginDir = join(dir, entry.name);
			const plugin = await discoverPlugin(pluginDir);
			if (plugin) {
				plugins.push(plugin);
			}
		}
	} catch (error) {
		console.error(`[Plugins] Error scanning ${dir}:`, error);
	}

	return plugins;
}

/**
 * Discover all plugins from all known locations
 */
export async function discoverPlugins(cwd?: string, forceRefresh = false): Promise<ClaudeCodePlugin[]> {
	// Check cache
	const now = Date.now();
	if (!forceRefresh && cachedPlugins.length > 0 && lastDiscoveryCwd === cwd && now - lastDiscoveryTime < CACHE_TTL_MS) {
		return cachedPlugins;
	}

	// Load config
	await loadPluginConfig();

	const allPlugins: ClaudeCodePlugin[] = [];
	const indexByName = new Map<string, number>();
	const priorityByName = new Map<string, number>();

	const addOrReplace = (plugin: ClaudeCodePlugin, priority: number) => {
		const existingIdx = indexByName.get(plugin.name);
		if (existingIdx == null) {
			indexByName.set(plugin.name, allPlugins.length);
			priorityByName.set(plugin.name, priority);
			allPlugins.push(plugin);
			return;
		}

		const existingPriority = priorityByName.get(plugin.name) ?? 0;
		if (priority <= existingPriority) return;

		allPlugins[existingIdx] = plugin;
		priorityByName.set(plugin.name, priority);
	};

	// 1. Global plugins (~/.claude/plugins/)
	const globalPlugins = await scanPluginDirectory(GLOBAL_PLUGINS_DIR);
	for (const plugin of globalPlugins) {
		addOrReplace(plugin, 0);
	}

	// 2. Project plugins ({cwd}/.claude/plugins/)
	if (cwd) {
		const projectPluginsDir = join(cwd, ".claude", "plugins");
		const projectPlugins = await scanPluginDirectory(projectPluginsDir);
		for (const plugin of projectPlugins) {
			addOrReplace(plugin, 1);
		}
	}

	// 3. Custom paths (from user config)
	for (const customPath of pluginConfig.customPaths) {
		const resolvedPath = resolve(customPath);
		const plugin = await discoverPlugin(resolvedPath);
		if (plugin) addOrReplace(plugin, 2);
	}

	// Update cache
	cachedPlugins = allPlugins;
	lastDiscoveryCwd = cwd;
	lastDiscoveryTime = now;

	return allPlugins;
}

/**
 * Get a specific plugin by name
 */
export async function getPlugin(name: string, cwd?: string): Promise<ClaudeCodePlugin | null> {
	const plugins = await discoverPlugins(cwd);
	return plugins.find((p) => p.name === name) || null;
}

/**
 * Toggle a plugin's enabled/disabled state
 */
export async function togglePlugin(name: string, enabled: boolean): Promise<boolean> {
	await loadPluginConfig();

	if (enabled) {
		// Remove from disabled, add to enabled (if not there)
		pluginConfig.disabled = pluginConfig.disabled.filter((n) => n !== name);
		if (!pluginConfig.enabled.includes(name)) {
			pluginConfig.enabled.push(name);
		}
	} else {
		// Remove from enabled, add to disabled
		pluginConfig.enabled = pluginConfig.enabled.filter((n) => n !== name);
		if (!pluginConfig.disabled.includes(name)) {
			pluginConfig.disabled.push(name);
		}
	}

	await savePluginConfig();

	// Invalidate cache so next discovery reflects the change
	cachedPlugins = [];
	lastDiscoveryTime = 0;

	return true;
}

/**
 * Add a custom plugin path
 */
export async function addPluginPath(path: string): Promise<boolean> {
	const resolvedPath = resolve(path);

	// Validate it's a valid plugin directory
	const plugin = await discoverPlugin(resolvedPath);
	if (!plugin) {
		return false;
	}

	await loadPluginConfig();

	if (!pluginConfig.customPaths.includes(resolvedPath)) {
		pluginConfig.customPaths.push(resolvedPath);
		await savePluginConfig();
	}

	// Invalidate cache
	cachedPlugins = [];
	lastDiscoveryTime = 0;

	return true;
}

/**
 * Remove a custom plugin path
 */
export async function removePluginPath(path: string): Promise<boolean> {
	const resolvedPath = resolve(path);

	await loadPluginConfig();

	const initialLength = pluginConfig.customPaths.length;
	pluginConfig.customPaths = pluginConfig.customPaths.filter((p) => p !== resolvedPath);

	if (pluginConfig.customPaths.length !== initialLength) {
		await savePluginConfig();
		// Invalidate cache
		cachedPlugins = [];
		lastDiscoveryTime = 0;
		return true;
	}

	return false;
}

/**
 * Get the current plugin configuration
 */
export async function getPluginConfig(): Promise<ClaudeCodePluginConfig> {
	await loadPluginConfig();
	return { ...pluginConfig };
}

/**
 * Get enabled plugins for SDK query options
 * Returns plugins in the format expected by the Claude Code SDK
 */
export async function getEnabledPluginsForSdk(cwd?: string): Promise<Array<{ type: "local"; path: string }>> {
	const plugins = await discoverPlugins(cwd);
	return plugins.filter((p) => p.status === "enabled").map((p) => ({ type: "local" as const, path: p.path }));
}

/**
 * Force reload plugins (clear cache)
 */
export async function reloadPlugins(cwd?: string): Promise<ClaudeCodePlugin[]> {
	cachedPlugins = [];
	lastDiscoveryTime = 0;
	return discoverPlugins(cwd, true);
}
