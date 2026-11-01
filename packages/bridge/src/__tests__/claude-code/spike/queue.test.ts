/**
 * D8 evidence (research/08-spike.md, Q3/Q4): steer with `priority: "next"` mid-tool, and two sends with
 * `priority: "later"` while a turn runs, through the real CLI.
 */

import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { statesOf } from "./rig/interrupt";
import { indexOf } from "./rig/order";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const isToolUse = (m: SDKMessage) => m.type === "assistant" && m.message.content[0]?.type === "tool_use";
const lastUserText = (body: unknown) => JSON.stringify((body as { messages: unknown[] }).messages.at(-1));

describe("steer and queue", () => {
	test(
		"steer: a `next` send mid-tool is folded into the same turn beside the tool result",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [
					{ toolCalls: [{ name: "Bash", args: { command: "sleep 2", description: "wait" } }] },
					{ text: ["steered answer"] },
					{ text: ["spare"] },
				],
			});
			try {
				const a = spike.send("run it");
				await spike.waitFor(isToolUse);
				const b = spike.send("actually also say hi", { priority: "next" });
				await spike.waitFor((m) => m.type === "result", { timeoutMs: 20_000 });
				await spike.waitFor(isIdle, { after: indexOf(spike.messages, (m) => m.type === "result") });
				spike.record("steer-next");
				expect(spike.results()).toHaveLength(1);
				expect(spike.results()[0]?.user_message_uuids).toEqual([a, b]);
				expect(statesOf(spike.messages, b)).toEqual(["queued", "started", "completed"]);
				const second = lastUserText(spike.server.mainRequests()[1]?.body);
				expect(second).toContain("tool_result");
				expect(second).toContain("The user sent a new message while you were working:\\nactually also say hi");
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"two `later` sends wait for the turn, then run together as one turn; idle comes once, at the end",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [
					{ text: Array.from({ length: 10 }, (_, i) => `w${i} `), delayMs: 100 },
					{ text: ["queued answer"] },
					{ text: ["spare"] },
				],
			});
			try {
				spike.send("talk");
				await spike.waitFor((m) => m.type === "stream_event");
				const b = spike.send("B", { priority: "later" });
				const c = spike.send("C", { priority: "later" });
				await spike.waitFor((m) => m.type === "result" && m.user_message_uuids?.includes(b) === true, {
					timeoutMs: 20_000,
				});
				await spike.waitFor(isIdle, { after: indexOf(spike.messages, (m) => m.type === "result") });
				await Bun.sleep(300);
				spike.record("queue-later");
				expect(spike.results().map((r) => r.queued_turn_count)).toEqual([2, 0]);
				expect(spike.results()[1]?.user_message_uuids).toEqual([b, c]);
				expect(lastUserText(spike.server.mainRequests()[1]?.body)).toContain('"text":"B\\nC"');
				expect(spike.messages.filter(isIdle)).toHaveLength(1);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
