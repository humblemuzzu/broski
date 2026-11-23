import type { ThinkingSpec } from "../../../contract";
import type { PiModel } from "../rpc/replies";

/** Pi's levels, lowest first (`EXTENDED_THINKING_LEVELS`, pi-ai 1.5.2 `dist/models.js:701`). */
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** What the phone shows for each level; Pi's own values are not words (`xhigh`). */
const LABELS: Record<(typeof LEVELS)[number], string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};

/**
 * The levels a model offers, as Pi's `getSupportedThinkingLevels` reads them from the model (pi-ai 1.5.2
 * `dist/models.js:702-713`): only `off` without `reasoning`; a level its `thinkingLevelMap` maps to `null` is not
 * offered, and `xhigh` and `max` only when the map names them.
 */
export function supportedLevels(model: Pick<PiModel, "reasoning" | "thinkingLevelMap">): string[] {
	if (model.reasoning !== true) return ["off"];
	return LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		return level === "xhigh" || level === "max" ? mapped !== undefined : true;
	});
}

/**
 * A model with one level has nothing to choose, and an empty `ThinkingSpec` is how the contract says so (README
 * §11.3). `current` is the default when it is one of the model's levels: the level a session of this model runs at.
 */
export function thinkingSpec(model: Pick<PiModel, "reasoning" | "thinkingLevelMap">, current?: string): ThinkingSpec {
	const levels = supportedLevels(model);
	if (levels.length <= 1) return { options: [] };
	return {
		options: LEVELS.filter((level) => levels.includes(level)).map((value) => ({ value, label: LABELS[value] })),
		...(current !== undefined && levels.includes(current) && { defaultValue: current }),
	};
}

/** `value` when the model offers it as a choice, else undefined: `setThinking` refuses it `invalid_input`. */
export function supportedLevel(
	model: Pick<PiModel, "reasoning" | "thinkingLevelMap">,
	value: string,
): string | undefined {
	const levels = supportedLevels(model);
	return levels.length > 1 && levels.includes(value) ? value : undefined;
}
