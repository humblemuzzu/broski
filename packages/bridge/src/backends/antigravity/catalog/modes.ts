import { phoneName, phoneText } from "../../../adapter-kit/phone-text";
import { MAX_CATALOG_ITEMS, MAX_NAME_CHARS, type ModeAxis } from "../../../contract";
import { type ConfigOption, selectValues } from "../acp/frames";
import { configOption } from "./config-options";

export const MODE_AXIS_ID = "mode";

/** agy's mode option (default, accept-edits, auto, plan in 1.5.18) as one axis, starting where a new session starts. */
export function modeAxes(options: readonly ConfigOption[]): ModeAxis[] {
	const mode = configOption(options, "mode");
	if (mode === undefined) return [];
	const values = selectValues(mode)
		.filter((value) => value.value.length <= MAX_NAME_CHARS)
		.slice(0, MAX_CATALOG_ITEMS)
		.map((value) => {
			const description = phoneText(value.description ?? "");
			return {
				value: value.value,
				label: phoneName(value.name) || value.value,
				...(description !== "" && { description }),
			};
		});
	if (values.length === 0) return [];
	const description = phoneText(mode.description ?? "");
	const current = values.find((value) => value.value === mode.currentValue)?.value;
	return [
		{
			id: MODE_AXIS_ID,
			label: "Mode",
			...(description !== "" && { description }),
			options: values,
			...(current !== undefined && { defaultValue: current }),
		},
	];
}
