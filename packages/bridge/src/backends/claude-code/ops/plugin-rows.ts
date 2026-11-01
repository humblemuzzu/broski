/** The plugin list: `enabledPlugins` as the settings cascade resolves it, each with where its value comes from. */

import type { ResolvedSettings } from "@anthropic-ai/claude-agent-sdk";
import { isRecord } from "../json";
import { action, type RowSpec } from "./list-rows";

export interface PluginEntry {
	readonly id: string;
	readonly enabled: boolean;
	/** The highest settings tier that names the plugin: `user`, `project`, `local`, `flag` or `managed`. */
	readonly origin: string;
	/** A version-constraints form (a list or an object) rather than a plain on or off. */
	readonly constrained: boolean;
}

export function pluginEntries(resolved: ResolvedSettings): PluginEntry[] {
	const effective = resolved.effective.enabledPlugins;
	if (!isRecord(effective)) return [];
	const entries: PluginEntry[] = [];
	for (const [id, value] of Object.entries(effective)) {
		const origin = [...resolved.sources].reverse().find((source) => hasPlugin(source.settings.enabledPlugins, id));
		entries.push({
			id,
			enabled: value !== false,
			origin: origin?.source ?? "user",
			constrained: typeof value !== "boolean",
		});
	}
	return entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function hasPlugin(map: unknown, id: string): boolean {
	return isRecord(map) && Object.hasOwn(map, id);
}

export function pluginRow(entry: PluginEntry): RowSpec {
	const at = entry.id.lastIndexOf("@");
	const managed = entry.origin === "managed";
	return {
		id: entry.id,
		title: at > 0 ? entry.id.slice(0, at) : entry.id,
		subtitle: entry.constrained ? "Enabled with version constraints" : undefined,
		status: entry.enabled ? { label: "enabled", tone: "ok" } : { label: "disabled", tone: "neutral" },
		group: at > 0 ? entry.id.slice(at + 1) : "Plugins",
		badges: managed ? ["managed by policy"] : [`set in ${entry.origin} settings`],
		actions: managed ? [] : [entry.enabled ? action("disable", "Disable") : action("enable", "Enable")],
	};
}
