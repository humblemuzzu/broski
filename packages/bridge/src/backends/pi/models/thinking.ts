import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, clampThinkingLevel, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import type { ThinkingSpec } from "../../../contract";

/** pi-coding-agent `src/core/defaults.ts:3`, which the package does not export. */
const DEFAULT_LEVEL: ThinkingLevel = "medium";

/**
 * A model with one level has nothing to choose, and an empty `ThinkingSpec` is how the contract says so
 * (README §11.3). That is every model that cannot reason, and the terminal has no thinking control for it either
 * (`AgentSession.cycleThinkingLevel`, pi-coding-agent `src/core/agent-session.ts:2705-2707`).
 */
function offeredLevels(model: Model<Api>): ThinkingLevel[] {
	const levels = getSupportedThinkingLevels(model);
	return levels.length <= 1 ? [] : levels;
}

/** `defaultLevel` is the level a session would start this model at, clamped to the model as Pi clamps it. */
export function thinkingSpec(model: Model<Api>, defaultLevel: ThinkingLevel | undefined): ThinkingSpec {
	const levels = offeredLevels(model);
	if (levels.length === 0) return { options: [] };
	return {
		options: levels.map((value) => ({ value })),
		defaultValue: clampThinkingLevel(model, defaultLevel ?? DEFAULT_LEVEL),
	};
}

/** `value` as a level `model` offers, or undefined: `setThinking` refuses it `invalid_input`. */
export function supportedLevel(model: Model<Api>, value: string): ThinkingLevel | undefined {
	return offeredLevels(model).find((level) => level === value);
}
