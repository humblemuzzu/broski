/**
 * Broski's own custom tools (D30), provided by the server layer over `custom-tools.ts`, which the adapter never
 * imports. Lane D serves `sessionServers()` to every host; lane F builds `custom_tools` and `custom_tool` on the rest.
 */

import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { JsonValue } from "../../../contract";

export interface CustomToolSummary {
	readonly toolId: string;
	readonly name: string;
	readonly description: string;
	readonly enabled: boolean;
	/** `http`, `script` or `builtin`, as the definition says. */
	readonly handler: string;
}

export type CustomToolSaved = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

export interface CustomToolsPort {
	/** Read at every host start; `{}` when no tool is enabled. Tool names stay `mcp__broski-custom-tools__<name>`. */
	sessionServers(): Promise<Record<string, McpServerConfig>>;
	list(): Promise<readonly CustomToolSummary[]>;
	read(toolId: string): Promise<JsonValue | undefined>;
	/** A starting definition and the id no tool has yet. */
	template(): { readonly toolId: string; readonly definition: JsonValue };
	/** Creates or replaces the whole definition; not saved when it is not a valid tool. */
	save(toolId: string, definition: JsonValue): Promise<CustomToolSaved>;
	remove(toolId: string): Promise<boolean>;
	test(toolId: string): Promise<{ readonly ok: boolean; readonly output: string }>;
}
