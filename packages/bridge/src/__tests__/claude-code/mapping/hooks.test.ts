/** Step 7: the hook frames `includeHookEvents` sends, as harness activities, frame by frame. */

import { describe, expect, test } from "bun:test";
import type {
	SDKHookProgressMessage,
	SDKHookResponseMessage,
	SDKHookStartedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Activity } from "../../../contract";
import { ids } from "./frames";
import { newMapper, play, violationsOf } from "./helpers";

const HOOK = "f830c1d7-b9a4-402e-b5c0-b27b77852acc";

function started(hookId = HOOK, name = "PreToolUse:Read"): SDKHookStartedMessage {
	return {
		type: "system",
		subtype: "hook_started",
		hook_id: hookId,
		hook_name: name,
		hook_event: "PreToolUse",
		...ids(),
	};
}

function progress(output: string): SDKHookProgressMessage {
	return {
		type: "system",
		subtype: "hook_progress",
		hook_id: HOOK,
		hook_name: "PreToolUse:Read",
		hook_event: "PreToolUse",
		stdout: output,
		stderr: "",
		output,
		...ids(),
	};
}

function response(outcome: SDKHookResponseMessage["outcome"], output = "pre-read-ok\n"): SDKHookResponseMessage {
	return {
		type: "system",
		subtype: "hook_response",
		hook_id: HOOK,
		hook_name: "PreToolUse:Read",
		hook_event: "PreToolUse",
		output,
		stdout: output,
		stderr: "",
		exit_code: outcome === "success" ? 0 : 1,
		outcome,
		...ids(),
	};
}

function activities(events: readonly { event: { type: string } }[]): Activity[] {
	return events.flatMap(({ event }) => ("activity" in event ? [event.activity as Activity] : []));
}

describe("hook frames", () => {
	test("started, progress and response are one activity: running, then its outcome and duration", () => {
		let now = 1_000;
		const mapper = newMapper(() => now);
		const id = `hook:${HOOK}`;
		expect(activities(mapper.map(started()))).toEqual([
			{ id, label: "PreToolUse:Read", detail: "PreToolUse", status: "running" },
		]);
		now = 1_004;
		expect(activities(mapper.map(progress("half")))).toEqual([
			{ id, label: "PreToolUse:Read", detail: "PreToolUse", status: "running", output: "half" },
		]);
		now = 1_007;
		expect(activities(mapper.map(response("success")))).toEqual([
			{
				id,
				label: "PreToolUse:Read",
				detail: "PreToolUse",
				status: "succeeded",
				output: "pre-read-ok\n",
				durationMs: 7,
			},
		]);
	});

	test.each<[SDKHookResponseMessage["outcome"], Activity["status"]]>([
		["success", "succeeded"],
		["error", "failed"],
		["cancelled", "cancelled"],
	])("outcome %p is %p", (outcome, status) => {
		const mapper = newMapper();
		mapper.map(started());
		expect(activities(mapper.map(response(outcome)))[0]?.status).toBe(status);
	});

	test("a response with no start seen has no duration; empty output is left out", () => {
		const [ended] = activities(newMapper().map(response("success", "  \n")));
		expect(ended).toEqual({ id: `hook:${HOOK}`, label: "PreToolUse:Read", detail: "PreToolUse", status: "succeeded" });
	});

	test("a name that is its event is not said twice; a blank name reads as its event", () => {
		const stop = activities(newMapper().map({ ...started(), hook_name: "Stop", hook_event: "Stop" }));
		expect(stop[0]).toEqual({ id: `hook:${HOOK}`, label: "Stop", status: "running" });
		const blank = activities(newMapper().map({ ...started(), hook_name: " ", hook_event: "Stop" }));
		expect(blank[0]?.label).toBe("Stop");
	});

	test("names and output are shown without terminal escapes or direction marks", () => {
		const mapper = newMapper();
		mapper.map(started(HOOK, "\u001b[31mevil\u202e"));
		const [ended] = activities(mapper.map(response("error", "\u001b]0;title\u0007bad\u200f")));
		expect(ended?.label).toBe("evil");
		expect(ended?.output).toBe("bad");
	});

	test("an outcome a newer CLI added, or one an object inherits, reads as failed", () => {
		for (const outcome of ["timed_out", "toString"]) {
			const mapper = newMapper();
			mapper.map(started());
			const frame = JSON.parse(JSON.stringify({ ...response("success"), outcome }));
			expect(activities(mapper.map(frame))[0]?.status).toBe("failed");
		}
	});

	test("a hook id that is empty shows nothing", () => {
		expect(newMapper().map(started(""))).toEqual([]);
	});

	test("a hook still running when the run ends is told as cancelled, and the stream stays valid", () => {
		const played = play([
			{ type: "system", subtype: "session_state_changed", state: "running", ...ids() },
			started(),
			{ type: "system", subtype: "session_state_changed", state: "idle", ...ids() },
		]);
		const main = played.streams.get("") ?? [];
		const ended = main.flatMap((event) => (event.type === "activity" ? [event.activity] : []));
		expect(ended.map((activity) => activity.status)).toEqual(["running", "cancelled"]);
		expect(violationsOf(played)).toEqual([]);
	});
});
