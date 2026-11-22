/**
 * What a holder keeps of `pi`'s records for the bridge that takes the session over (`holder/replay-log.ts`): since the
 * session was last at rest, without command responses, asks only while open, and within its bound.
 */

import { describe, expect, test } from "bun:test";
import { ReplayLog } from "../../backends/pi/holder/replay-log";

const line = (record: Record<string, unknown>): string => JSON.stringify(record);
const typesOf = (log: ReplayLog): unknown[] => log.replay().lines.map((text) => JSON.parse(text).type ?? "?");

const ask = (id: string, extra: Record<string, unknown> = {}) =>
	line({ type: "extension_ui_request", id, method: "confirm", title: `ask ${id}`, message: "?", ...extra });

function logWith(...records: string[]): { log: ReplayLog; clock: { at: number } } {
	const clock = { at: 0 };
	const log = new ReplayLog(() => clock.at);
	for (const record of records) log.take(record);
	return { log, clock };
}

describe("the replay", () => {
	test("is what pi said since the session was last at rest, without the answers to commands", () => {
		const { log } = logWith(
			line({ type: "agent_start" }),
			line({ type: "message_start", message: { role: "user" } }),
			line({ type: "agent_settled", aborted: false }),
			line({ type: "response", id: "a-1", command: "prompt", success: true }),
			line({ type: "agent_start" }),
			line({ type: "message_start", message: { role: "assistant" } }),
			line({ type: "message_update", assistantMessageEvent: { type: "text_delta" } }),
			line({ type: "tool_execution_start", toolCallId: "t1" }),
		);
		expect(typesOf(log)).toEqual(["agent_start", "message_start", "message_update", "tool_execution_start"]);
		expect(log.state()).toEqual({ running: true, asking: false });
	});

	test("starts over at rest only once no compaction or retry is open", () => {
		const { log } = logWith(
			line({ type: "agent_start" }),
			line({ type: "compaction_start", reason: "threshold" }),
			line({ type: "agent_settled", aborted: false }),
		);
		expect(typesOf(log)).toEqual(["agent_start", "compaction_start", "agent_settled"]);
		log.take(line({ type: "compaction_end", reason: "threshold", aborted: false }));
		expect(typesOf(log)).toEqual([]);
		log.take(line({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 1, errorMessage: "529" }));
		expect(log.state().running).toBe(true);
		log.take(line({ type: "auto_retry_end", success: true }));
		expect(typesOf(log)).toEqual([]);
	});
});

describe("asks", () => {
	test("an open one outlives the rest; an answered, a timed-out, a permission or a broski_ask one does not", () => {
		const permission = line({
			type: "extension_ui_request",
			id: "p",
			method: "input",
			title: 'broski-permission:{"toolCallId":"t"}',
		});
		const questions = line({
			type: "extension_ui_request",
			id: "q",
			method: "input",
			title: 'broski-questions:{"questions":[{"question":"Which store?"}]}',
		});
		const { log, clock } = logWith(
			line({ type: "agent_start" }),
			ask("open"),
			ask("answered"),
			ask("timed", { timeout: 1_000 }),
			permission,
			questions,
			line({ type: "extension_ui_request", id: "n", method: "notify", message: "hi" }),
		);
		log.resolved("answered");
		clock.at = 400;
		const timed = log
			.replay()
			.lines.map((text) => JSON.parse(text))
			.find((record) => record.id === "timed");
		expect(timed?.timeout).toBe(600);
		clock.at = 1_000;
		log.take(line({ type: "agent_settled", aborted: true }));
		expect(log.replay().lines.map((text) => JSON.parse(text).id)).toEqual(["open"]);
		expect(log.state()).toEqual({ running: false, asking: true });
		log.resolved("open");
		expect(log.state()).toEqual({ running: false, asking: false });
	});

	test("an extension's status is kept, its latest value per key", () => {
		const status = (text: string) =>
			line({ type: "extension_ui_request", id: text, method: "setStatus", statusKey: "k", statusText: text });
		const { log } = logWith(status("one"), line({ type: "agent_start" }), status("two"));
		log.take(line({ type: "agent_settled", aborted: false }));
		expect(log.replay().lines.map((text) => JSON.parse(text).statusText)).toEqual(["two"]);
	});
});

describe("the bound", () => {
	test("goes first to the deltas of a message that has ended, whose end carries all of it", () => {
		const log = new ReplayLog(() => 0, 6_000);
		log.take(line({ type: "agent_start" }));
		log.take(line({ type: "message_start", message: { role: "assistant" } }));
		for (let index = 0; index < 4; index++) log.take(line({ type: "message_update", delta: "x".repeat(1_000) }));
		log.take(line({ type: "message_end", message: { role: "assistant" } }));
		log.take(line({ type: "message_start", message: { role: "assistant" } }));
		for (let index = 0; index < 2; index++) log.take(line({ type: "message_update", delta: "y".repeat(1_000) }));
		const kept = log.replay();
		expect(kept.truncated).toBe(false);
		expect(kept.lines.map((text) => JSON.parse(text).type)).toEqual([
			"agent_start",
			"message_start",
			"message_end",
			"message_start",
			"message_update",
			"message_update",
		]);
	});

	test("then to a tool's output that a later one replaces or its end carries", () => {
		const output = (id: string, text: string) =>
			line({ type: "tool_execution_update", toolCallId: id, partialResult: { content: text.repeat(1_000) } });
		const log = new ReplayLog(() => 0, 4_000);
		log.take(line({ type: "agent_start" }));
		log.take(output("done", "a"));
		log.take(line({ type: "tool_execution_end", toolCallId: "done" }));
		log.take(output("running", "b"));
		log.take(output("running", "c"));
		log.take(output("running", "d"));
		const kept = log.replay();
		expect(kept.truncated).toBe(false);
		const contents = kept.lines.map((text) => JSON.parse(text).partialResult?.content?.[0]);
		expect(contents).toEqual([undefined, undefined, "d"]);
	});

	test("lost structure is marked truncated, keeps only asks and statuses, and is forgotten at rest", () => {
		const log = new ReplayLog(() => 0, 1_000);
		log.take(line({ type: "agent_start" }));
		log.take(ask("kept"));
		for (let index = 0; index < 20; index++)
			log.take(line({ type: "tool_execution_start", toolCallId: `t${index}`, pad: "x".repeat(80) }));
		expect(log.replay().truncated).toBe(true);
		expect(log.replay().lines.map((text) => JSON.parse(text).id)).toEqual(["kept"]);
		log.take(line({ type: "tool_execution_start", toolCallId: "later" }));
		expect(log.replay().lines).toHaveLength(1);
		log.take(line({ type: "agent_settled", aborted: false }));
		expect(log.replay().truncated).toBe(false);
		log.take(line({ type: "agent_start" }));
		expect(typesOf(log)).toEqual(["extension_ui_request", "agent_start"]);
	});
});
