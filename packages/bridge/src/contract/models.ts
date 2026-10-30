import { z } from "zod";
import { ModelId } from "./ids";
import { MAX_CATALOG_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";

/** One setting a model accepts for thinking or reasoning effort. `value` is opaque and backend-defined. */
export const ThinkingOption = z.strictObject({
	value: z.string().min(1).max(MAX_NAME_CHARS),
	label: z.string().max(MAX_NAME_CHARS).optional(),
	description: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type ThinkingOption = z.infer<typeof ThinkingOption>;

/** No options means the model's thinking cannot be set. */
export const ThinkingSpec = z.strictObject({
	options: z.array(ThinkingOption).max(MAX_CATALOG_ITEMS),
	defaultValue: z.string().max(MAX_NAME_CHARS).optional(),
});
export type ThinkingSpec = z.infer<typeof ThinkingSpec>;

export const InputModality = z.enum(["text", "image", "audio"]);
export type InputModality = z.infer<typeof InputModality>;

export const ModelSummary = z.strictObject({
	id: ModelId,
	displayName: z.string().min(1).max(MAX_NAME_CHARS),
	description: z.string().max(MAX_TEXT_CHARS).optional(),
	providerId: z.string().max(MAX_NAME_CHARS).optional(),
	providerName: z.string().max(MAX_NAME_CHARS).optional(),
	contextWindow: z.int().positive().optional(),
	inputModalities: z.array(InputModality).max(InputModality.options.length).optional(),
	thinking: ThinkingSpec,
	isDefault: z.boolean(),
	/** Present when the model is known but cannot be used now, and says why; `setModel` refuses it. Only a `models.list` that asked for `includeUnavailable` holds such models. */
	unavailableReason: z.string().min(1).max(MAX_NAME_CHARS).optional(),
});
export type ModelSummary = z.infer<typeof ModelSummary>;
