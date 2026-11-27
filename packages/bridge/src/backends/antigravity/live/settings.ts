/**
 * A live session's model, thinking level and mode, read from its config options (`session/new`, `session/load`, every
 * `session/set_config_option` answer and `config_option_update`): agy's own values, checked against the options the
 * session offers now, since each model has thinking levels of its own.
 */

import { rejected } from "../../../adapter-kit/rejections";
import {
	type AgentEvent,
	emptySnapshot,
	MAX_NAME_CHARS,
	ModelId,
	type Rejected,
	type SessionSnapshot,
} from "../../../contract";
import { type ConfigOption, selectValues } from "../acp/frames";
import { configOption } from "../catalog/config-options";
import { MODE_AXIS_ID } from "../catalog/modes";

export interface Settings {
	readonly modelId?: string;
	readonly thinking?: string;
	readonly mode?: string;
}

/** One `session/set_config_option`. */
export interface Choice {
	readonly configId: string;
	readonly value: string;
}

export function settingsOf(options: readonly ConfigOption[]): Settings {
	const modelId = currentValue(options, "model");
	const thinking = currentValue(options, "thought_level");
	const mode = currentValue(options, MODE_AXIS_ID);
	return {
		...(modelId !== undefined && ModelId.safeParse(modelId).success && { modelId }),
		...(thinking !== undefined && thinking.length <= MAX_NAME_CHARS && { thinking }),
		...(mode !== undefined && mode.length <= MAX_NAME_CHARS && { mode }),
	};
}

export function snapshotOf(settings: Settings): SessionSnapshot {
	return { ...emptySnapshot(), ...snapshotSettings(settings) };
}

function snapshotSettings(settings: Settings): Partial<SessionSnapshot> {
	return {
		...(settings.modelId !== undefined && { modelId: settings.modelId }),
		...(settings.thinking !== undefined && { thinking: settings.thinking }),
		modes: settings.mode === undefined ? [] : [{ axis: MODE_AXIS_ID, value: settings.mode }],
	};
}

/** The events that take `snapshot` to `after`: nothing when the settings are already what it shows. */
export function settingEvents(snapshot: SessionSnapshot, after: Settings): AgentEvent[] {
	const events: AgentEvent[] = [];
	if (snapshot.modelId !== after.modelId || snapshot.thinking !== after.thinking) {
		events.push({
			type: "model_changed",
			...(after.modelId !== undefined && { modelId: after.modelId }),
			...(after.thinking !== undefined && { thinking: after.thinking }),
		});
	}
	const mode = snapshot.modes.find((setting) => setting.axis === MODE_AXIS_ID)?.value;
	if (after.mode !== undefined && after.mode !== mode) {
		events.push({ type: "mode_changed", axis: MODE_AXIS_ID, value: after.mode });
	}
	return events;
}

/** A choice of what the session already has changes nothing, and still shows as the event of that setting. */
export function chosenAgain(snapshot: SessionSnapshot, options: readonly ConfigOption[], choice: Choice): AgentEvent {
	if (configOption(options, MODE_AXIS_ID)?.id === choice.configId) {
		return { type: "mode_changed", axis: MODE_AXIS_ID, value: choice.value };
	}
	return {
		type: "model_changed",
		...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
		...(snapshot.thinking !== undefined && { thinking: snapshot.thinking }),
	};
}

export function modelChoice(options: readonly ConfigOption[], modelId: string): Choice | Rejected {
	const choice = choiceOf(options, "model", modelId);
	return choice ?? rejected("not_found", `Antigravity offers no model ${modelId} in this session`);
}

export function thinkingChoice(options: readonly ConfigOption[], value: string): Choice | Rejected {
	const choice = choiceOf(options, "thought_level", value);
	return choice ?? rejected("invalid_input", `the session's model has no thinking level ${value}`);
}

export function modeChoice(options: readonly ConfigOption[], axis: string, value: string): Choice | Rejected {
	const choice = axis === MODE_AXIS_ID ? choiceOf(options, MODE_AXIS_ID, value) : undefined;
	return choice ?? rejected("invalid_input", `Antigravity has no mode ${axis}=${value}`);
}

/** The values a category offers, as one key: a change means the lists the phone has are stale. */
export function offeredKey(options: readonly ConfigOption[], category: string): string {
	const option = configOption(options, category);
	return option === undefined ? "" : JSON.stringify(selectValues(option).map((value) => value.value));
}

function choiceOf(options: readonly ConfigOption[], category: string, value: string): Choice | undefined {
	const option = configOption(options, category);
	if (option === undefined || !selectValues(option).some((offered) => offered.value === value)) return undefined;
	return { configId: option.id, value };
}

function currentValue(options: readonly ConfigOption[], category: string): string | undefined {
	const value = configOption(options, category)?.currentValue;
	return typeof value === "string" && value !== "" ? value : undefined;
}
