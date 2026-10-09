import { createFindTool, createLsTool } from "@earendil-works/pi-coding-agent";
import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";
import { defineExtension } from "@earendil-works/pi-durable";
import { createPiDurableFindOperations } from "./find-operations";
import { createPiDurableGrepTool } from "./grep-tool";
import { piDurableReadOnlyTool } from "./pi-tool-bridge";

export const PI_DURABLE_SEARCH_EXTENSION = "broski-search-tools";

export function createPiDurableSearchTools(cwd: string): ToolRegistration[] {
	return [
		piDurableReadOnlyTool((toolCwd) => createLsTool(toolCwd), cwd),
		piDurableReadOnlyTool((toolCwd) => createFindTool(toolCwd, { operations: createPiDurableFindOperations() }), cwd),
		createPiDurableGrepTool(cwd),
	];
}

export function createPiDurableSearchExtension(cwd: string): Extension {
	return defineExtension({ name: PI_DURABLE_SEARCH_EXTENSION, tools: createPiDurableSearchTools(cwd) });
}
