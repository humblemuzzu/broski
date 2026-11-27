/**
 * The model option's values as the contract's models: agy's names, each model's own thinking levels, a context window
 * when the probe saw one, and the session's starting model as the default. A model agy refused to select is listed
 * only to a reader that asks for unavailable models, after the usable ones.
 */

import { phoneName, phoneText } from "../../../adapter-kit/phone-text";
import { MAX_CATALOG_ITEMS, MAX_NAME_CHARS, ModelId, type ModelSummary, type ThinkingSpec } from "../../../contract";
import { type ConfigOption, selectValues } from "../acp/frames";
import { configOption } from "./config-options";
import type { ProbeFacts } from "./probe";

export function modelSummaries(facts: ProbeFacts): ModelSummary[] {
	const model = configOption(facts.options, "model");
	if (model === undefined) return [];
	const summaries = selectValues(model).flatMap((value): ModelSummary[] => {
		if (!ModelId.safeParse(value.value).success) return [];
		const known = facts.models.get(value.value);
		const description = phoneText(value.description ?? "");
		const providerName = phoneName(value.group ?? "");
		const contextWindow = facts.contextSizes.get(value.value);
		const refused = known?.refused === undefined ? undefined : phoneName(known.refused) || "agy refused to select it";
		return [
			{
				id: value.value,
				displayName: phoneName(value.name) || value.value,
				...(description !== "" && { description }),
				...(providerName !== "" && { providerName }),
				...(contextWindow !== undefined && Number.isSafeInteger(contextWindow) && { contextWindow }),
				thinking: thinkingOf(known?.thought),
				isDefault: value.value === model.currentValue,
				...(refused !== undefined && { unavailableReason: refused }),
			},
		];
	});
	return summaries.slice(0, MAX_CATALOG_ITEMS);
}

/** The usable models, then, when asked for, the ones agy refused. */
export function listedModels(models: readonly ModelSummary[], includeUnavailable: boolean): ModelSummary[] {
	const usable = models.filter((model) => model.unavailableReason === undefined);
	return includeUnavailable ? [...usable, ...models.filter((model) => model.unavailableReason !== undefined)] : usable;
}

function thinkingOf(option: ConfigOption | undefined): ThinkingSpec {
	if (option === undefined) return { options: [] };
	const options = selectValues(option)
		.filter((value) => value.value.length > 0 && value.value.length <= MAX_NAME_CHARS)
		.slice(0, MAX_CATALOG_ITEMS)
		.map((value) => {
			const label = phoneName(value.name);
			const description = phoneText(value.description ?? "");
			return { value: value.value, ...(label !== "" && { label }), ...(description !== "" && { description }) };
		});
	const current = options.find((value) => value.value === option.currentValue)?.value;
	return { options, ...(current !== undefined && { defaultValue: current }) };
}
