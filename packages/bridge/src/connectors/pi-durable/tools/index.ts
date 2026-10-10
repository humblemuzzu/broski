import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";
import { loadPiCodingAgent } from "../../../sdk/pi-coding-agent";
import { loadPiDurable } from "../../../sdk/pi-durable";
import { createPiDurableFindOperations } from "./find-operations";
import { createPiDurableGrepTool } from "./grep-tool";
import { piDurableReadOnlyTool } from "./pi-tool-bridge";

export const PI_DURABLE_SEARCH_EXTENSION = "broski-search-tools";

export async function createPiDurableSearchTools(cwd: string): Promise<ToolRegistration[]> {
	const { createFindTool, createLsTool } = await loadPiCodingAgent();
	return [
		await piDurableReadOnlyTool((toolCwd) => createLsTool(toolCwd), cwd),
		await piDurableReadOnlyTool(
			(toolCwd) => createFindTool(toolCwd, { operations: createPiDurableFindOperations() }),
			cwd,
		),
		await createPiDurableGrepTool(cwd),
	];
}

export async function createPiDurableSearchExtension(cwd: string): Promise<Extension> {
	const { defineExtension } = await loadPiDurable();
	return defineExtension({ name: PI_DURABLE_SEARCH_EXTENSION, tools: await createPiDurableSearchTools(cwd) });
}
