import { z } from "zod";
import { CommandId } from "./ids";
import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";

/** `command`: a slash command. `skill`: a skill the prompt invokes. `prompt`: a prompt template. */
export const CommandKind = z.enum(["command", "skill", "prompt"]);
export type CommandKind = z.infer<typeof CommandKind>;

export const CommandSummary = z.strictObject({
	id: CommandId,
	name: z.string().min(1).max(MAX_NAME_CHARS),
	kind: CommandKind,
	description: z.string().max(MAX_TEXT_CHARS).optional(),
	argumentHint: z.string().max(MAX_NAME_CHARS).optional(),
});
export type CommandSummary = z.infer<typeof CommandSummary>;
