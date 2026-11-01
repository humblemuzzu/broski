/**
 * Step 7 · hook frames as harness activities (`includeHookEvents`, D5 as amended). Shapes from `sdk.d.ts`
 * (`SDKHookStartedMessage`, `SDKHookProgressMessage`, `SDKHookResponseMessage`) and a real CLI run
 * (`spike/hook_events.test.ts`): `hook_name` is `PreToolUse:Read`, `hook_event` `PreToolUse`, a response carries the
 * combined `output` and an `outcome`. The frames carry no time, so the duration is the mapper's clock from start to
 * response. Names and output are a user's command's words, so they go through the phone-text helper.
 */

import type {
	SDKHookProgressMessage,
	SDKHookResponseMessage,
	SDKHookStartedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { type Activity, type ActivityStatus, MAX_NAME_CHARS } from "../../../contract";
import { hookActivityId } from "../ids";
import { phoneText } from "../phone-text";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState, OpenHook } from "./state";

type HookFrame = SDKHookStartedMessage | SDKHookProgressMessage | SDKHookResponseMessage;

const MAX_OPEN_HOOKS = 256;

const STATUS_OF: Readonly<Record<SDKHookResponseMessage["outcome"], ActivityStatus>> = {
	success: "succeeded",
	error: "failed",
	cancelled: "cancelled",
};

function opened(state: MapperState, frame: HookFrame): OpenHook {
	const label = phoneText(frame.hook_name, MAX_NAME_CHARS).trim();
	const detail = phoneText(frame.hook_event, MAX_NAME_CHARS).trim();
	return {
		label: label === "" ? detail || "Hook" : label,
		detail: detail === "" || detail === label ? undefined : detail,
		startedAt: state.now(),
	};
}

function activity(id: string, hook: OpenHook, status: ActivityStatus, output?: string, durationMs?: number): Activity {
	const shown = output === undefined ? "" : phoneText(output);
	return {
		id,
		label: hook.label,
		status,
		...(hook.detail !== undefined && { detail: hook.detail }),
		...(shown.trim() !== "" && { output: shown }),
		...(durationMs !== undefined && { durationMs }),
	};
}

function remember(state: MapperState, id: string, hook: OpenHook): void {
	state.openHooks.set(id, hook);
	if (state.openHooks.size > MAX_OPEN_HOOKS) state.openHooks.delete(state.openHooks.keys().next().value ?? id);
}

export function hookEvents(state: MapperState, frame: HookFrame): MappedEvent[] {
	const id = hookActivityId(frame.hook_id);
	if (id === undefined) return [];
	const known = state.openHooks.get(id);
	const hook = known ?? opened(state, frame);
	switch (frame.subtype) {
		case "hook_started":
			remember(state, id, hook);
			return [{ event: { type: "activity", activity: activity(id, hook, "running") } }];
		case "hook_progress":
			remember(state, id, hook);
			return [{ event: { type: "activity", activity: activity(id, hook, "running", frame.output) } }];
		case "hook_response": {
			state.openHooks.delete(id);
			const took = known === undefined ? undefined : Math.max(0, Math.round(state.now() - known.startedAt));
			const ended = activity(id, hook, STATUS_OF[frame.outcome] ?? "failed", frame.output, took);
			return [{ event: { type: "activity", activity: ended } }];
		}
	}
}

/** A hook the CLI never answered before the run ended: told as cancelled, so no entry spins forever. */
export function settleHooks(state: MapperState): MappedEvent[] {
	const events = [...state.openHooks].map(([id, hook]): MappedEvent => {
		const took = Math.max(0, Math.round(state.now() - hook.startedAt));
		return { event: { type: "activity", activity: activity(id, hook, "cancelled", undefined, took) } };
	});
	state.openHooks.clear();
	return events;
}
