import { z } from "zod";
import { BackendOpKind } from "./backend-ops";
import { AttachmentKind } from "./content";
import { ExtensionKind } from "./extensions";
import { MentionKind, PromptMode } from "./input";
import { InteractionKind } from "./interactions";

/** When a model or thinking change reaches the model: its next request, even mid-run, or the next run. */
export const ModelSwitchTiming = z.enum(["next_request", "next_run"]);
export type ModelSwitchTiming = z.infer<typeof ModelSwitchTiming>;

function setOf<T extends string>(values: z.ZodEnum<{ [K in T]: K }>) {
	return z
		.array(values)
		.max(values.options.length)
		.refine((list) => new Set(list).size === list.length, "a value is listed twice");
}

/**
 * What a backend can do. `fork`, `rename`, `delete` and `archive` are never declared: they are true
 * exactly when the adapter implements the matching method (see `backendCapabilities`).
 */
export const Capabilities = z.strictObject({
	streamText: z.boolean(),
	streamThinking: z.boolean(),
	promptModes: setOf(PromptMode).refine((modes) => modes.includes("start"), "every backend takes start"),
	attachments: setOf(AttachmentKind),
	mentions: setOf(MentionKind),
	commands: z.boolean(),
	/** `queue_changed` is emitted with the pending input. */
	queue: z.boolean(),
	interactions: setOf(InteractionKind),
	modelSwitch: ModelSwitchTiming,
	thinking: z.boolean(),
	children: z.boolean(),
	usage: z.boolean(),
	plan: z.boolean(),
	planProposals: z.boolean(),
	/** A run another client starts is reported live, as `run_started` with trigger `external`. */
	externalLive: z.boolean(),
	/** A run survives a restart of the bridge. */
	durableRuns: z.boolean(),
	extensions: setOf(ExtensionKind),
	backendOps: setOf(BackendOpKind),
	fork: z.boolean(),
	rename: z.boolean(),
	delete: z.boolean(),
	archive: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;

/** What one open session allows, derived from the methods its adapter provides (see `sessionCapabilities`). */
export const SessionCapabilities = z.strictObject({
	/** False for a session that can only be watched, such as one a terminal UI owns. */
	controllable: z.boolean(),
	compact: z.boolean(),
	cancelQueued: z.boolean(),
});
export type SessionCapabilities = z.infer<typeof SessionCapabilities>;
