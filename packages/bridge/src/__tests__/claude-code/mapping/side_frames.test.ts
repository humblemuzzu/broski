/** Frames that are not part of a turn's content: notices, the two extensions, a conversation reset. */

import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { AgentEvent } from "../../../contract";
import { ids } from "./frames";
import { newMapper } from "./helpers";

type System<S extends string> = Extract<SDKMessage, { type: "system"; subtype: S }>;

function map(...frames: SDKMessage[]) {
	const mapper = newMapper();
	return frames.flatMap((frame) => mapper.map(frame)).map((item) => item.event);
}

function valid(events: readonly AgentEvent[]): void {
	for (const event of events) expect(AgentEvent.safeParse(event).success).toBe(true);
}

const informational = (content: string, level: System<"informational">["level"]): SDKMessage => ({
	type: "system",
	subtype: "informational",
	content,
	level,
	...ids(),
});

describe("notices", () => {
	test.each([
		["info", "info"],
		["notice", "info"],
		["suggestion", "info"],
		["warning", "warning"],
	] as const)("an informational line of level %s is a %s notice", (from, to) => {
		expect(map(informational("line", from))).toEqual([{ type: "notice", level: to, text: "line" }]);
	});

	test.each([
		["low", "info"],
		["medium", "info"],
		["high", "warning"],
		["immediate", "warning"],
	] as const)("a notification of priority %s is a %s notice", (priority, level) => {
		expect(map({ type: "system", subtype: "notification", key: "k", text: "hello", priority, ...ids() })).toEqual([
			{ type: "notice", level, text: "hello" },
		]);
	});

	test("an empty line shows nothing, escapes and surrounding blanks are removed", () => {
		expect(map(informational("   ", "info"))).toEqual([]);
		expect(map(informational("\u001B[33m  yellow \u001B[0m", "info"))).toEqual([
			{ type: "notice", level: "info", text: "yellow" },
		]);
	});

	test("local command output, a mirror error, a shutdown and a failed plugin install are notices", () => {
		const events = map(
			{ type: "system", subtype: "local_command_output", content: "ran", ...ids() },
			{
				type: "system",
				subtype: "mirror_error",
				error: "disk full",
				key: { projectKey: "p", sessionId: "s" },
				...ids(),
			},
			{ type: "system", subtype: "worker_shutting_down", reason: "host_exit", ...ids() },
			{ type: "system", subtype: "plugin_install", status: "failed", name: "docs", error: "404", ...ids() },
			{ type: "system", subtype: "plugin_install", status: "installed", name: "docs", ...ids() },
		);
		expect(events.map((event) => event.type === "notice" && [event.level, event.text])).toEqual([
			["info", "ran"],
			["error", "The session could not be mirrored: disk full"],
			["warning", "Claude Code is shutting down: host_exit"],
			["warning", "Installing the plugin docs failed: 404"],
		]);
	});

	test("a refusal falling back says so; one with no fallback and no words says nothing of its own", () => {
		const fallback: SDKMessage = {
			type: "system",
			subtype: "model_refusal_fallback",
			trigger: "refusal",
			direction: "retry",
			original_model: "opus",
			fallback_model: "sonnet",
			request_id: null,
			content: "",
			...ids(),
		};
		expect(map(fallback)).toEqual([
			{ type: "notice", level: "warning", text: "opus refused the request; continuing with sonnet" },
		]);
		const none: SDKMessage = {
			type: "system",
			subtype: "model_refusal_no_fallback",
			original_model: "opus",
			request_id: null,
			content: "",
			...ids(),
		};
		expect(map(none)).toEqual([]);
		expect(map({ ...none, content: "Declined." })).toEqual([{ type: "notice", level: "warning", text: "Declined." }]);
	});
});

const limit = (info: Extract<SDKMessage, { type: "rate_limit_event" }>["rate_limit_info"]): SDKMessage => ({
	type: "rate_limit_event",
	rate_limit_info: info,
	...ids(),
});

describe("rate limit", () => {
	test("is an extension in the contract's units: milliseconds and a percentage", () => {
		const events = map(
			limit({ status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.853, resetsAt: 1_800_003_600 }),
		);
		expect(events).toEqual([
			{
				type: "extension",
				extension: {
					kind: "rate_limit",
					window: "five_hour",
					status: "allowed_warning",
					usedPercent: 85.3,
					resetsAt: 1_800_003_600_000,
				},
			},
		]);
		valid(events);
	});

	test("a limit with no window names the account, and no number becomes no field", () => {
		expect(map(limit({ status: "rejected" }))).toEqual([
			{ type: "extension", extension: { kind: "rate_limit", window: "account", status: "rejected" } },
		]);
	});

	test("the same window saying the same again is not sent again; a change is", () => {
		const mapper = newMapper();
		const send = (info: Parameters<typeof limit>[0]) => mapper.map(limit(info)).length;
		const rejected = { status: "rejected", rateLimitType: "seven_day", resetsAt: 1_800_000_000 } as const;
		expect([send(rejected), send(rejected), send({ ...rejected, resetsAt: 1_800_000_100 })]).toEqual([1, 0, 1]);
		expect(send({ status: "rejected", rateLimitType: "five_hour", resetsAt: 1_800_000_000 })).toBe(1);
	});

	test("hostile numbers are dropped", () => {
		const [event] = map(
			limit({ status: "allowed", rateLimitType: "five_hour", utilization: Number.NaN, resetsAt: -4 }),
		);
		expect(event).toEqual({
			type: "extension",
			extension: { kind: "rate_limit", window: "five_hour", status: "allowed" },
		});
	});
});

describe("conversation reset", () => {
	test("the session goes on as the new conversation", () => {
		const events = map({
			type: "conversation_reset",
			new_conversation_id: "22222222-3333-4444-8555-666666666666",
			trigger: "clear",
			...ids(),
		});
		expect(events).toEqual([
			{
				type: "session_replaced",
				session: { backend: "claude-code", sessionId: "22222222-3333-4444-8555-666666666666" },
			},
		]);
		valid(events);
	});

	test("an id that cannot be a session id is not followed", () => {
		expect(map({ type: "conversation_reset", new_conversation_id: `${"a".repeat(300)}-1-2-3-4`, ...ids() })).toEqual(
			[],
		);
	});
});
