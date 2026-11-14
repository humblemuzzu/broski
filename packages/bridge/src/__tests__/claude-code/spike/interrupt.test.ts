/**
 * Stop (adapter README D8, D9): `interrupt()` mid-text and mid-tool, and the receipt with and without
 * `cancelQueued` while two `priority: "later"` sends wait.
 */

import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { interruptQuery, statesOf } from "./rig/interrupt";
import { indexOf } from "./rig/order";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, type SpikeSession, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const SLOW_TEXT = { text: Array.from({ length: 40 }, (_, i) => `word${i} `), delayMs: 100 };

const isTextDelta = (m: SDKMessage) =>
	m.type === "stream_event" && m.event.type === "content_block_delta" && m.event.delta.type === "text_delta";

function idleCount(messages: readonly SDKMessage[]): number {
	return messages.filter(isIdle).length;
}

async function settle(spike: SpikeSession): Promise<void> {
	await spike.waitFor((m) => m.type === "result");
	await spike.waitFor(isIdle, { after: indexOf(spike.messages, (m) => m.type === "result") });
}

describe("interrupt", () => {
	test(
		"mid-text: error_during_execution / aborted_streaming, the partial block flagged aborted, the send cancelled",
		async () => {
			const spike = startSpike({ permissionMode: "default", turns: [SLOW_TEXT, { text: ["after"] }] });
			try {
				const uuid = spike.send("talk slowly");
				await spike.waitFor(isTextDelta);
				expect(await interruptQuery(spike.q)).toEqual({ still_queued: [] });
				await settle(spike);
				spike.record("interrupt-mid-text");
				expect(spike.results()[0]).toMatchObject({
					subtype: "error_during_execution",
					is_error: true,
					terminal_reason: "aborted_streaming",
					user_message_uuids: [uuid],
				});
				const partial = spike.messages.find((m) => m.type === "assistant");
				expect(partial?.type === "assistant" && partial.aborted).toBe(true);
				expect(statesOf(spike.messages, uuid)).toEqual(["queued", "started", "cancelled"]);
				expect(spike.server.served("main")).toBe(1);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"mid-tool: aborted_tools; the running Bash gets a stopped-while-running tool result",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [
					{ toolCalls: [{ name: "Bash", args: { command: "sleep 20", description: "wait" } }] },
					{ text: ["after"] },
				],
			});
			try {
				spike.send("run it");
				await spike.waitFor((m) => m.type === "assistant" && m.message.content[0]?.type === "tool_use");
				await Bun.sleep(500);
				const started = Date.now();
				expect(await interruptQuery(spike.q)).toEqual({ still_queued: [] });
				await settle(spike);
				spike.record("interrupt-mid-tool");
				expect(Date.now() - started).toBeLessThan(5_000);
				expect(spike.results()[0]).toMatchObject({
					subtype: "error_during_execution",
					terminal_reason: "aborted_tools",
				});
				const results = JSON.stringify(spike.messages.filter((m) => m.type === "user"));
				expect(results).toContain("this call was stopped while running");
				expect(results).toContain("[Request interrupted by user for tool use]");
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"without cancelQueued: the receipt lists the queued sends, which then run as one turn before one idle",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [SLOW_TEXT, { text: ["B and C ran"] }, { text: ["spare"] }],
			});
			try {
				spike.send("talk slowly");
				await spike.waitFor(isTextDelta);
				const b = spike.send("B", { priority: "later" });
				const c = spike.send("C", { priority: "later" });
				await Bun.sleep(300);
				expect(await interruptQuery(spike.q)).toEqual({ still_queued: [b, c] });
				await spike.waitFor((m) => m.type === "result" && m.user_message_uuids?.includes(b) === true);
				await spike.waitFor(isIdle, {
					after: indexOf(spike.messages, (m) => m.type === "result" && m.subtype === "success"),
				});
				const results = spike.results();
				expect(results.map((r) => [r.terminal_reason, r.queued_turn_count])).toEqual([
					["aborted_streaming", 2],
					["completed", 0],
				]);
				expect(results[1]?.user_message_uuids).toEqual([b, c]);
				expect(statesOf(spike.messages, b)).toEqual(["queued", "started", "completed"]);
				expect(idleCount(spike.messages)).toBe(1);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"with cancelQueued: the receipt lists them as cancelled, they never run",
		async () => {
			const spike = startSpike({ permissionMode: "default", turns: [SLOW_TEXT, { text: ["must not run"] }] });
			try {
				spike.send("talk slowly");
				await spike.waitFor(isTextDelta);
				const b = spike.send("B", { priority: "later" });
				const c = spike.send("C", { priority: "later" });
				await Bun.sleep(300);
				expect(await interruptQuery(spike.q, { cancelQueued: true })).toEqual({ still_queued: [], cancelled: [b, c] });
				await settle(spike);
				await Bun.sleep(500);
				expect(statesOf(spike.messages, b)).toEqual(["queued", "cancelled"]);
				expect(statesOf(spike.messages, c)).toEqual(["queued", "cancelled"]);
				expect(spike.results()).toHaveLength(1);
				expect(spike.server.served("main")).toBe(1);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
