import { z } from "zod";
import { MAX_CATALOG_ITEMS, MAX_ID_CHARS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";
import { Option } from "./option";

export const ModeAxisId = z.string().min(1).max(MAX_ID_CHARS);
export type ModeAxisId = z.infer<typeof ModeAxisId>;

/**
 * One setting a session runs under that the human picks from the backend's own list, such as
 * Claude Code's permission mode. Values are opaque; an option's description
 * says what it allows.
 */
export const ModeAxis = z.strictObject({
	id: ModeAxisId,
	label: z.string().min(1).max(MAX_NAME_CHARS),
	description: z.string().max(MAX_TEXT_CHARS).optional(),
	options: z.array(Option).min(1).max(MAX_CATALOG_ITEMS),
	defaultValue: z.string().max(MAX_NAME_CHARS).optional(),
});
export type ModeAxis = z.infer<typeof ModeAxis>;

export const ModeSetting = z.strictObject({ axis: ModeAxisId, value: z.string().max(MAX_NAME_CHARS) });
export type ModeSetting = z.infer<typeof ModeSetting>;
