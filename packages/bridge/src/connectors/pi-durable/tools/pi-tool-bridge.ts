import type { JsonValue } from "@earendil-works/chord";
import type { ImageContent, Static, TextContent, TSchema } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { loadPiDurable } from "../../../sdk/pi-durable";
import { toJsonValue } from "./json-value";

export type PiToolOutcome = {
	readonly content: readonly (TextContent | ImageContent)[];
	readonly details: unknown;
	readonly isError?: boolean;
};

/** The part of `@earendil-works/pi-agent-core`'s `AgentTool` a built-in `create*Tool(cwd)` satisfies. */
export type PiTool<Parameters extends TSchema> = {
	readonly name: string;
	readonly description: string;
	readonly parameters: Parameters;
	execute(
		toolCallId: string,
		args: Static<Parameters>,
		signal?: AbortSignal,
		onUpdate?: undefined,
	): Promise<PiToolOutcome>;
};

/**
 * Registers a pi coding-agent tool as a durable tool. The pi tool is built again per call from the call's environment
 * cwd, so a changed conversation directory reaches calls the model already made.
 */
export async function piDurableReadOnlyTool<Parameters extends TSchema>(
	build: (cwd: string) => PiTool<Parameters>,
	fallbackCwd: string,
): Promise<ToolRegistration<Parameters, JsonValue>> {
	const { defineTool } = await loadPiDurable();
	const registered = build(fallbackCwd);
	return defineTool({
		name: registered.name,
		description: registered.description,
		parameters: registered.parameters,
		replay: "safe",
		execute: async (args, api) => {
			const result = await build(api.env?.cwd ?? fallbackCwd).execute(api.callId, args, undefined, undefined);
			const details = toJsonValue(result.details);
			return {
				output: [...result.content],
				...(details !== undefined ? { details } : {}),
				...(result.isError !== undefined ? { isError: result.isError } : {}),
			};
		},
	});
}
