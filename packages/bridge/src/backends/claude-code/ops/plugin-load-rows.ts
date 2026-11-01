/**
 * What the running session's CLI loaded: the plugins of its latest `system/init` and the ones that failed
 * (`plugin_errors`, `sdk.d.ts` `SDKSystemMessage`). Read only: enabling and disabling is the `enabledPlugins` rows'.
 * Names, paths and messages are the plugin author's words, so they go through the phone-text helper.
 */

import type { SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { MAX_NAME_CHARS, MAX_PATH_CHARS } from "../../../contract";
import { phoneText } from "../phone-text";
import type { RowSpec } from "./list-rows";

export const LOADED_GROUP = "Loaded in this session";
export const FAILED_GROUP = "Failed to load in this session";

/** The rows for [init]; none before the session's process ran a turn (no init yet). */
export function pluginLoadRows(init: SDKSystemMessage | undefined): RowSpec[] {
	if (init === undefined) return [];
	const plugins: SDKSystemMessage["plugins"] = Array.isArray(init.plugins) ? init.plugins : [];
	const loaded = plugins.map(
		(plugin, index): RowSpec => ({
			id: `loaded:${index}`,
			title: phoneText(plugin.name, MAX_NAME_CHARS),
			subtitle: phoneText(plugin.path, MAX_PATH_CHARS),
			status: { label: "loaded", tone: "ok" },
			group: LOADED_GROUP,
			badges: plugin.version === undefined ? [] : [phoneText(plugin.version, MAX_NAME_CHARS)],
		}),
	);
	const failed = (init.plugin_errors ?? []).map(
		(error, index): RowSpec => ({
			id: `failed:${index}`,
			title: phoneText(error.plugin, MAX_NAME_CHARS),
			subtitle: phoneText(error.message),
			status: { label: "failed", tone: "error" },
			group: FAILED_GROUP,
			badges: [phoneText(error.type, MAX_NAME_CHARS)],
		}),
	);
	return [...loaded, ...failed];
}
