import { z } from "zod";
import { AttachmentKind } from "./content";
import { ExtensionKind } from "./extensions";
import { PromptMode } from "./input";
import { InteractionKind } from "./interactions";

function setOf<T extends string>(values: z.ZodEnum<{ [K in T]: K }>) {
	return z
		.array(values)
		.max(values.options.length)
		.refine((list) => new Set(list).size === list.length, "a value is listed twice");
}

/**
 * What a backend can do. `fork`, `rename` and `delete` are never declared: they are true exactly when
 * the adapter implements the matching method (see `backendCapabilities`).
 */
export const Capabilities = z.strictObject({
	streamText: z.boolean(),
	streamThinking: z.boolean(),
	promptModes: setOf(PromptMode).refine((modes) => modes.includes("start"), "every backend takes start"),
	attachments: setOf(AttachmentKind),
	commands: z.boolean(),
	/** `queue_changed` is emitted with the pending input. */
	queue: z.boolean(),
	interactions: setOf(InteractionKind),
	thinking: z.boolean(),
	children: z.boolean(),
	usage: z.boolean(),
	planProposals: z.boolean(),
	/** A run another client starts is reported live, as `run_started` with trigger `external`. */
	externalLive: z.boolean(),
	extensions: setOf(ExtensionKind),
	fork: z.boolean(),
	rename: z.boolean(),
	delete: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;

/** What one open session allows, derived from the methods its adapter provides (see `sessionCapabilities`). */
export const SessionCapabilities = z.strictObject({
	/** False for a session that can only be watched, such as one a terminal UI owns. */
	controllable: z.boolean(),
	compact: z.boolean(),
	cancelQueued: z.boolean(),
	/** The session's asks can be answered here, with or without `controllable`. */
	answer: z.boolean(),
});
export type SessionCapabilities = z.infer<typeof SessionCapabilities>;
