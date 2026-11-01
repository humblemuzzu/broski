/** Retry, compaction and tool progress: the frames that come and go inside a turn and must leave nothing open. */

import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
	assistant,
	blockStart,
	failure,
	ids,
	messageStart,
	success,
	text,
	textDelta,
	toolUse,
	userText,
} from "./frames";
import { NOW, newMapper, ofType, play, shapeOf } from "./helpers";

type ApiRetry = Extract<SDKMessage, { type: "system"; subtype: "api_retry" }>;

const retry = (extra: { attempt?: number; status?: number | null } = {}): ApiRetry => ({
	type: "system",
	subtype: "api_retry",
	attempt: extra.attempt ?? 1,
	max_retries: 10,
	retry_delay_ms: 600,
	error_status: extra.status === undefined ? 529 : extra.status,
	error: "overloaded",
	...ids(),
});

const status = (
	value: "compacting" | "requesting" | null,
	extra: { result?: "success" | "failed"; error?: string } = {},
): SDKMessage => ({
	type: "system",
	subtype: "status",
	status: value,
	...(extra.result && { compact_result: extra.result }),
	...(extra.error && { compact_error: extra.error }),
	...ids(),
});

const boundary = (trigger: "manual" | "auto", pre: number, post?: number): SDKMessage => ({
	type: "system",
	subtype: "compact_boundary",
	compact_metadata: { trigger, pre_tokens: pre, ...(post !== undefined && { post_tokens: post }) },
	...ids(),
});

const events = (frames: readonly SDKMessage[]) => play(frames).streams.get("");

describe("retry", () => {
	test("each attempt is announced with when it will run and why", () => {
		const [first] = ofType(events([retry()]), "retry_scheduled");
		expect(first).toEqual({
			type: "retry_scheduled",
			attempt: 1,
			maxAttempts: 10,
			retryAt: NOW + 600,
			message: "The API is overloaded (HTTP 529); retrying",
		});
	});

	test("a connection failure has no HTTP status; a first-byte timeout says how long it waited", () => {
		expect(ofType(events([retry({ status: null })]), "retry_scheduled")[0]?.message).toBe(
			"The API is overloaded; retrying",
		);
		const waited: SDKMessage = { ...retry(), no_response: { waited_ms: 30_000, retry_wait_ms: 10_000 } };
		expect(ofType(events([waited]), "retry_scheduled")[0]?.message).toBe(
			"No response from the API after 30s; retrying",
		);
	});

	test("the next stream event of the turn says it worked: retry_finished once, however many attempts", () => {
		const out = events([
			retry(),
			retry({ attempt: 2 }),
			messageStart("msg_1"),
			blockStart(0, text("")),
			textDelta(0, "ok"),
		]);
		expect(shapeOf(out)).toBe(
			"run_started retry_scheduled retry_scheduled retry_finished block_started:text block_delta block_finished run_finished:completed",
		);
		expect(ofType(out, "retry_finished")).toEqual([{ type: "retry_finished", succeeded: true }]);
	});

	test("frames that prove nothing leave the retry scheduled", () => {
		const mapper = newMapper();
		mapper.map(retry());
		expect(mapper.map(status("requesting"))).toEqual([]);
		expect(mapper.map(userText("[Request interrupted by user]"))).toEqual([]);
		const sub = assistant("msg_sub", [text("from a subagent")], { parent_tool_use_id: "toolu_x", agent_id: "agent-1" });
		expect(mapper.map(sub).map((item) => item.event.type)).not.toContain("retry_finished");
		expect(mapper.settle("completed").map((item) => item.event)).toEqual([
			{ type: "retry_finished", succeeded: false },
		]);
	});

	test("the CLI giving up (a synthetic error frame, or an error result) is the retry failing", () => {
		const gaveUp = events([retry(), assistant("err", [text("API Error")], { error: "overloaded" })]);
		expect(ofType(gaveUp, "retry_finished")).toEqual([{ type: "retry_finished", succeeded: false }]);
		const aborted = events([retry(), failure({ terminal_reason: "aborted_streaming" })]);
		expect(ofType(aborted, "retry_finished")).toEqual([{ type: "retry_finished", succeeded: false }]);
		const fine = events([retry(), success()]);
		expect(ofType(fine, "retry_finished")).toEqual([{ type: "retry_finished", succeeded: true }]);
	});

	test("no retry, no retry_finished", () => {
		expect(ofType(events([messageStart("msg_1"), success()]), "retry_finished")).toEqual([]);
	});
});

describe("compaction", () => {
	test("one before the turn's init is the person's (manual); the sizes come with the boundary", () => {
		const out = events([status("compacting"), status(null, { result: "success" }), boundary("manual", 1000, 200)]);
		expect(shapeOf(out)).toBe("run_started compaction_started compaction_finished:completed run_finished:completed");
		expect(ofType(out, "compaction_started")[0]).toEqual({ type: "compaction_started", trigger: "manual" });
		expect(ofType(out, "compaction_finished")[0]?.outcome).toEqual({
			kind: "completed",
			tokensBefore: 1000,
			tokensAfter: 200,
		});
	});

	test("one inside a turn that already began is the context filling (auto)", () => {
		const out = events([status("requesting"), status("compacting"), boundary("auto", 900)]);
		expect(ofType(out, "compaction_started")[0]?.trigger).toBe("auto");
		expect(ofType(out, "compaction_finished")[0]?.outcome).toEqual({ kind: "completed", tokensBefore: 900 });
	});

	test("a failed compaction ends at the status that says so, with its error", () => {
		const out = events([status("compacting"), status(null, { result: "failed", error: "too big" })]);
		expect(ofType(out, "compaction_finished")[0]?.outcome).toEqual({ kind: "failed", message: "too big" });
		const unsaid = events([status("compacting"), status(null, { result: "failed" })]);
		expect(ofType(unsaid, "compaction_finished")[0]?.outcome).toEqual({ kind: "failed", message: "Compaction failed" });
	});

	test("a boundary nobody announced is a whole compaction of its own, with the boundary's trigger", () => {
		const out = events([boundary("auto", 5, 1)]);
		expect(shapeOf(out)).toBe("run_started compaction_started compaction_finished:completed run_finished:completed");
		expect(ofType(out, "compaction_started")[0]?.trigger).toBe("auto");
	});

	test("one that is announced twice starts once; a status with nothing to end changes nothing", () => {
		const mapper = newMapper();
		expect(mapper.map(status("compacting"))).toHaveLength(1);
		expect(mapper.map(status("compacting"))).toEqual([]);
		expect(newMapper().map(status(null, { result: "success" }))).toEqual([]);
	});

	test("one the boundary never closed ends with its turn, or aborted with its run", () => {
		const turn = events([status("compacting"), status(null, { result: "success" }), success()]);
		expect(ofType(turn, "compaction_finished")[0]?.outcome).toEqual({ kind: "completed" });
		const stopped = events([status("compacting"), failure({ terminal_reason: "aborted_streaming" })]);
		expect(ofType(stopped, "compaction_finished")[0]?.outcome).toEqual({ kind: "aborted" });
		const mapper = newMapper();
		mapper.map(status("compacting"));
		expect(mapper.settle("aborted").map((item) => item.event)).toEqual([
			{ type: "compaction_finished", outcome: { kind: "aborted" } },
		]);
	});
});

describe("progress", () => {
	const call = assistant("msg_1", [toolUse("toolu_1", "Bash", { command: "sleep 9" })]);
	const progress = (seconds: number, extra: { heartbeat?: true } = {}): SDKMessage => ({
		type: "tool_progress",
		tool_use_id: "toolu_1",
		tool_name: "Bash",
		parent_tool_use_id: null,
		elapsed_time_seconds: seconds,
		...extra,
		...ids(),
	});
	const updates = (frames: readonly SDKMessage[]) =>
		ofType(events(frames), "tool_updated").map((event) => event.update);

	test("shows how long the call has run, once per change", () => {
		expect(updates([call, progress(2.4), progress(2.9), progress(75)])).toEqual([
			{ kind: "progress", message: "Running · 2s" },
			{ kind: "progress", message: "Running · 1m 15s" },
		]);
	});

	test("a heartbeat, a call that is not running, and one that ended say nothing", () => {
		expect(updates([call, progress(3, { heartbeat: true })])).toEqual([]);
		expect(updates([progress(3)])).toEqual([]);
		const done = { ...call };
		expect(ofType(events([done, progress(1)]), "tool_finished")).toHaveLength(1);
	});

	test("a task's summary is the progress of the call that started it", () => {
		const task: SDKMessage = {
			type: "system",
			subtype: "task_progress",
			task_id: "t1",
			tool_use_id: "toolu_1",
			description: "Reading files",
			summary: "Read 3 files",
			usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 },
			...ids(),
		};
		expect(updates([call, task])).toEqual([{ kind: "progress", message: "Read 3 files" }]);
	});

	test("a shell task is not a child session; a subagent task is, once", () => {
		const started = (taskType: string, taskId: string): SDKMessage => ({
			type: "system",
			subtype: "task_started",
			task_id: taskId,
			tool_use_id: "toolu_1",
			description: "d",
			task_type: taskType,
			...ids(),
		});
		expect(updates([call, started("local_bash", "bash-1")])).toEqual([]);
		expect(updates([call, started("local_agent", "agent-1"), started("local_agent", "agent-1")])).toHaveLength(1);
		expect(updates([call, started("local_agent", "not valid!")])).toEqual([]);
	});
});

describe("a turn's end", () => {
	test("the result's text is never shown again, only the totals", () => {
		const out = events([success({ result: "the answer the blocks already showed" })]);
		expect(shapeOf(out)).toBe("run_started usage_updated run_finished:completed");
		expect(JSON.stringify(out)).not.toContain("the answer");
	});
});
