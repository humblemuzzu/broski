/** Step 7 · the hooks recorded after an entry (`hook-facts.ts`) as activity items, under their own entry's uuid. */

import { type ActivityItem, MAX_NAME_CHARS } from "../../../contract";
import { phoneText } from "../phone-text";
import type { HookFact } from "./hook-facts";

function timeOf(timestamp: string | undefined): number | undefined {
	if (timestamp === undefined) return undefined;
	const at = Date.parse(timestamp);
	return Number.isFinite(at) && at >= 0 ? at : undefined;
}

function hookItem(hook: HookFact): ActivityItem {
	const label = phoneText(hook.name, MAX_NAME_CHARS).trim();
	const detail = hook.event === undefined ? "" : phoneText(hook.event, MAX_NAME_CHARS).trim();
	const output = hook.output === undefined ? "" : phoneText(hook.output);
	const at = timeOf(hook.timestamp);
	return {
		kind: "activity",
		id: hook.uuid,
		label: label === "" ? "Hook" : label,
		status: hook.status,
		...(at !== undefined && { at }),
		...(detail !== "" && { detail }),
		...(output !== "" && { output }),
		...(hook.durationMs !== undefined && { durationMs: hook.durationMs }),
	};
}

export function hookItems(hooks: readonly HookFact[] | undefined): ActivityItem[] {
	return (hooks ?? []).map(hookItem);
}
