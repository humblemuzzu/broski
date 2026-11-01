/**
 * The server layer's own custom tools port (D30, `server/cc-custom-tools.ts`) for the conformance world: its checks,
 * templates and trash are the production ones; only the store is in memory (production's is `~/.broski`) and the
 * trash is under the world's temp `HOME`. One tool is seeded so the list has a row.
 */

import { join } from "node:path";
import type { CustomToolsPort } from "../../../backends/claude-code/ports";
import { trashTargetOf } from "../../../backends/claude-code/trash";
import type { CustomToolDefinition } from "../../../custom-tools";
import { createCustomToolsPort } from "../../../server/cc-custom-tools";

const ECHO: CustomToolDefinition = {
	id: "tool_echo",
	name: "echo",
	description: "Echoes its input",
	parameters: [],
	handler: "builtin",
	handlerConfig: { action: "echo" },
	enabled: true,
	createdAt: 0,
	updatedAt: 0,
};

export function worldCustomTools(homeDir: string): CustomToolsPort {
	const tools: CustomToolDefinition[] = [ECHO];
	let next = 1;
	return createCustomToolsPort({
		store: {
			all: async () => tools,
			save: async (tool) => {
				const at = tools.findIndex((kept) => kept.id === tool.id);
				if (at >= 0) tools[at] = tool;
				else tools.push(tool);
			},
			delete: async (toolId) => {
				const at = tools.findIndex((kept) => kept.id === toolId);
				if (at >= 0) tools.splice(at, 1);
				return at >= 0;
			},
			test: async (tool) => ({ success: true, result: `${tool.name}: {}` }),
			server: async () => null,
			newId: () => `tool_${next++}`,
		},
		stagingDir: join(homeDir, ".broski", "claude-code", "trash-staging"),
		trash: () => trashTargetOf({ HOME: homeDir }, new Date()),
	});
}
