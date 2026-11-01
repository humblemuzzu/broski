/**
 * The custom tools port the Claude Code adapter is given (D30): Broski's own tools from `custom-tools.ts`, served to
 * every session as the `broski-custom-tools` MCP server, edited as JSON definitions, and deleted to the OS trash (a
 * definition's JSON is put there as a file before it leaves the store), never removed outright.
 */

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { CustomToolsPort } from "../backends/claude-code/ports";
import { moveToTrash, type TrashTarget } from "../backends/claude-code/trash";
import type { JsonValue } from "../contract";
import type { CustomToolDefinition } from "../custom-tools";
import { checkDefinition, editableDefinition } from "./cc-custom-tool-schema";

export const CUSTOM_TOOLS_SERVER = "broski-custom-tools";

/** Where the definitions live: `custom-tools.ts` in production, a temp store in tests. */
export interface CustomToolStore {
	all(): Promise<readonly CustomToolDefinition[]>;
	save(tool: CustomToolDefinition): Promise<unknown>;
	delete(toolId: string): Promise<boolean>;
	test(tool: CustomToolDefinition): Promise<{ success: boolean; result?: string; error?: string }>;
	server(): Promise<McpServerConfig | null>;
	newId(): string;
}

export interface CustomToolsPortDeps {
	readonly store: CustomToolStore;
	/** A directory on the trash's volume where a deleted definition is written before it is moved. */
	readonly stagingDir: string;
	readonly trash: () => TrashTarget | undefined;
}

const TEMPLATE: JsonValue = {
	name: "",
	description: "",
	parameters: [],
	handler: "http",
	handlerConfig: { url: "", method: "GET" },
	enabled: true,
};

export function createCustomToolsPort(deps: CustomToolsPortDeps): CustomToolsPort {
	const { store } = deps;
	const find = async (toolId: string) => (await store.all()).find((tool) => tool.id === toolId);
	return {
		sessionServers: async () => {
			const server = await store.server();
			const servers: Record<string, McpServerConfig> = {};
			if (server !== null) servers[CUSTOM_TOOLS_SERVER] = server;
			return servers;
		},
		list: async () =>
			(await store.all()).map((tool) => ({
				toolId: tool.id,
				name: tool.name,
				description: tool.description,
				enabled: tool.enabled,
				handler: tool.handler,
			})),
		read: async (toolId) => {
			const tool = await find(toolId);
			return tool === undefined ? undefined : asJson(tool);
		},
		template: () => ({ toolId: store.newId(), definition: TEMPLATE }),
		save: async (toolId, definition) => {
			const checked = checkDefinition(toolId, definition);
			if (!checked.ok) return checked;
			await store.save(checked.tool);
			return { ok: true };
		},
		remove: async (toolId) => {
			const tool = await find(toolId);
			if (tool === undefined) return false;
			await trashDefinition(deps, tool);
			return store.delete(toolId);
		},
		test: async (toolId) => {
			const tool = await find(toolId);
			if (tool === undefined) return { ok: false, output: `no custom tool ${toolId}` };
			const tested = await store.test(tool);
			return { ok: tested.success, output: tested.result ?? tested.error ?? "" };
		},
	};
}

/** The definition as a file in the trash; a failure throws, and the tool stays where it is. */
async function trashDefinition(deps: CustomToolsPortDeps, tool: CustomToolDefinition): Promise<void> {
	await mkdir(deps.stagingDir, { recursive: true, mode: 0o700 });
	const staged = join(deps.stagingDir, `custom tool ${tool.name.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
	await writeFile(staged, `${JSON.stringify(tool, null, 2)}\n`, { mode: 0o600 });
	const moved = await moveToTrash([staged], deps.trash());
	if (moved.status !== "rejected") return;
	await unlink(staged).catch(() => undefined);
	throw new Error(moved.rejection.message);
}

function asJson(tool: CustomToolDefinition): JsonValue {
	const value: JsonValue = JSON.parse(JSON.stringify(editableDefinition(tool)));
	return value;
}
