/** The custom tools port (D30) over an in-memory map, for the conformance world; the server layer's is Step 5's. */

import type { CustomToolSaved, CustomToolSummary, CustomToolsPort } from "../../../backends/claude-code/ports";
import type { JsonValue } from "../../../contract";

function summary(toolId: string, definition: JsonValue): CustomToolSummary | undefined {
	if (typeof definition !== "object" || definition === null || Array.isArray(definition)) return undefined;
	const { name, description, enabled } = definition;
	if (typeof name !== "string" || name === "") return undefined;
	return {
		toolId,
		name,
		description: typeof description === "string" ? description : "",
		enabled: enabled !== false,
		handler: "builtin",
	};
}

export function memoryCustomTools(): CustomToolsPort {
	const tools = new Map<string, JsonValue>([
		["echo", { name: "echo", description: "Echoes its input", enabled: true }],
	]);
	let next = 1;
	return {
		sessionServers: async () => ({}),
		list: async () => [...tools].flatMap(([toolId, definition]) => summary(toolId, definition) ?? []),
		read: async (toolId) => tools.get(toolId),
		template: () => ({ toolId: `tool-${next++}`, definition: { name: "", description: "", enabled: true } }),
		save: async (toolId, definition): Promise<CustomToolSaved> => {
			if (!summary(toolId, definition)) return { ok: false, problems: ["a tool needs a name"] };
			tools.set(toolId, definition);
			return { ok: true };
		},
		remove: async (toolId) => tools.delete(toolId),
		test: async (toolId) => ({ ok: tools.has(toolId), output: tools.has(toolId) ? "echo: {}" : "no such tool" }),
	};
}
