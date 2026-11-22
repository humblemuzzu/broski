/**
 * The `data` of the command responses the adapter reads (pi-coding-agent 1.5.2 `docs/rpc-commands.md`,
 * `dist/modes/rpc/rpc-types.d.ts:162-404`): only the fields it uses.
 */

import { z } from "zod";

/** A configured model (`docs/rpc-commands.md:836-858`). */
export const PiModel = z.object({
	id: z.string(),
	name: z.string().optional(),
	provider: z.string(),
	api: z.string(),
	reasoning: z.boolean().optional(),
	/** A level mapped to `null` is one the model does not offer (`docs/models-configuration.md:37`). */
	thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
	input: z.array(z.string()).optional(),
	contextWindow: z.number().optional(),
	/** Seconds a prompt cache entry lives per retention (pi-ai 1.5.2 `dist/types.d.ts:673-674`); unset when unknown. */
	promptCache: z
		.object({ short: z.number().positive().optional(), long: z.number().positive().optional() })
		.optional()
		.catch(undefined),
});
export type PiModel = z.output<typeof PiModel>;
export type PromptCache = NonNullable<PiModel["promptCache"]>;

export const StateReply = z.object({
	model: PiModel.optional(),
	thinkingLevel: z.string(),
	isStreaming: z.boolean(),
	isCompacting: z.boolean(),
	sessionFile: z.string().optional(),
	sessionId: z.string(),
	sessionName: z.string().optional(),
});
export type PiState = z.output<typeof StateReply>;

/**
 * The model a session runs, or undefined when it has none: Pi's agent then holds a placeholder whose id, provider and
 * api are all "unknown" (pi-agent-core 1.5.2 `dist/agent.js:18-29`), and `get_state` reports it as the model.
 */
export function selectedModel(state: Pick<PiState, "model">): PiModel | undefined {
	const { model } = state;
	const placeholder = model?.id === "unknown" && model.provider === "unknown" && model.api === "unknown";
	return placeholder ? undefined : model;
}

export const ModelsReply = z.object({ models: z.array(PiModel) });

export const CommandsReply = z.object({
	commands: z.array(
		z.object({
			name: z.string(),
			description: z.string().optional(),
			source: z.enum(["extension", "prompt", "skill"]),
			sourceInfo: z.object({ path: z.string() }),
		}),
	),
});
export type PiCommand = z.output<typeof CommandsReply>["commands"][number];

export const StatsReply = z.object({
	tokens: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() }),
	cost: z.number(),
	contextUsage: z.object({ tokens: z.number().nullable(), contextWindow: z.number() }).optional(),
});
export type SessionStats = z.output<typeof StatsReply>;

export const PromptReply = z.object({ disposition: z.enum(["started", "queued", "handled"]) });
export type PromptDisposition = z.output<typeof PromptReply>["disposition"];

export const QueueReply = z.object({ steering: z.array(z.string()), followUp: z.array(z.string()) });

/** `get_entries` (`docs/rpc-commands.md:689-717`): the entries after a cursor, and the leaf now. */
export const EntriesReply = z.object({
	entries: z.array(
		z.object({
			id: z.string(),
			parentId: z.string().nullable(),
			type: z.string(),
			message: z
				.object({ role: z.string(), timestamp: z.number().optional(), toolCallId: z.string().optional() })
				.optional(),
		}),
	),
	leafId: z.string().nullable(),
});
export type PiEntry = z.output<typeof EntriesReply>["entries"][number];

/** A command whose answer carries nothing the adapter reads. */
export const Ignored = z.unknown();
