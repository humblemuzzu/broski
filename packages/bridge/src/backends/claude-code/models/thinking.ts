/** Lane C · a model's `ThinkingSpec`: its `supportedEffortLevels` as given (D11). */

import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { ThinkingOption, ThinkingSpec } from "../../../contract";

const LABELS = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
} as const;

export function thinkingSpec(model: ModelInfo): ThinkingSpec {
	if (model.supportsEffort === false) return { options: [] };
	const options: ThinkingOption[] = [];
	for (const level of model.supportedEffortLevels ?? []) {
		if (!options.some((option) => option.value === level)) options.push({ value: level, label: LABELS[level] });
	}
	return { options };
}
