import { z } from "zod";
import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";

/** One value a human picks from a list: a dialog choice, a form option, a session mode. */
export const Option = z.strictObject({
	value: z.string().max(MAX_NAME_CHARS),
	label: z.string().max(MAX_NAME_CHARS),
	description: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type Option = z.infer<typeof Option>;
