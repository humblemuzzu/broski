/**
 * Subagents (adapter README D8, D20; `forwardSubagentText`): a foreground
 * Agent call, a background one and `idle`, and an interrupt while a background agent runs.
 */

import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { interruptQuery } from "./rig/interrupt";
import { indexOf } from "./rig/order";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const SLOW_SUBAGENT = { text: Array.from({ length: 20 }, (_, i) => `s${i} `), delayMs: 150 };

function agentCall(background: boolean) {
	const args = {
		description: "Find the word",
		prompt: "Read README.md",
		subagent_type: "general-purpose",
		run_in_background: background,
	};
	return { toolCalls: [{ name: "Agent", args }] };
}

function systemFrames(messages: readonly SDKMessage[], subtype: string): Extract<SDKMessage, { type: "system" }>[] {
	return messages.filter(
		(m): m is Extract<SDKMessage, { type: "system" }> => m.type === "system" && m.subtype === subtype,
	);
}

const fromSubagent = (m: SDKMessage) => (m.type === "assistant" || m.type === "user") && m.parent_tool_use_id !== null;

describe("subagents", () => {
	test(
		"foreground with forwardSubagentText: the subagent's prompt, tool call, result and text arrive under the Agent call",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [agentCall(false), { text: ["Main: PLUMBUS."] }, { text: ["spare"] }],
				server: {
					sideRequests: {
						subagent: [
							{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
							{ text: ["Subagent: PLUMBUS."] },
						],
					},
				},
			});
			try {
				spike.send("use a subagent");
				await spike.waitFor((m) => m.type === "result", { timeoutMs: 20_000 });
				await spike.waitFor(isIdle, { after: indexOf(spike.messages, (m) => m.type === "result") });
				spike.record("subagent");
				expect([spike.server.served("main"), spike.server.served("subagent")]).toEqual([2, 2]);
				const sub = spike.messages.filter(fromSubagent);
				expect(sub.map((m) => m.type)).toEqual(["user", "assistant", "user", "assistant"]);
				const agentIds = new Set(sub.map((m) => ("agent_id" in m ? m.agent_id : null)));
				expect(agentIds.size).toBe(1);
				expect(JSON.stringify(sub.at(-1))).toContain("Subagent: PLUMBUS.");
				expect(systemFrames(spike.messages, "task_notification")).toHaveLength(1);
				expect(spike.messages.some((m) => m.type === "stream_event" && m.parent_tool_use_id !== null)).toBe(false);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"background: the turn's result comes while the agent runs; idle only after the agent ends and the wake-up turn",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [agentCall(true), { text: ["launched"] }, { text: ["agent finished, main wakes"] }, { text: ["spare"] }],
				server: { sideRequests: { subagent: [SLOW_SUBAGENT] } },
			});
			try {
				spike.send("background agent");
				await spike.waitFor(isIdle, { after: 2, timeoutMs: 25_000 });
				await Bun.sleep(500);
				spike.record("subagent-background");
				const results = spike.results();
				expect(results.map((r) => ["result" in r ? r.result : r.subtype, r.queued_turn_count])).toEqual([
					["launched", 0],
					["agent finished, main wakes", 0],
				]);
				const firstResult = indexOf(spike.messages, (m) => m.type === "result");
				const notification = indexOf(spike.messages, (m) => m.type === "system" && m.subtype === "task_notification");
				const idle = indexOf(spike.messages, isIdle, 1);
				expect(firstResult).toBeLessThan(notification);
				expect(notification).toBeLessThan(idle);
				expect(spike.messages.filter(isIdle)).toHaveLength(1);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a plain interrupt kills a running background agent (task killed, notification stopped)",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [
					agentCall(true),
					{ text: Array.from({ length: 30 }, (_, i) => `m${i} `), delayMs: 100 },
					{ text: ["spare"] },
				],
				server: { sideRequests: { subagent: [SLOW_SUBAGENT] } },
			});
			try {
				spike.send("background agent then talk");
				await spike.waitFor((m) => m.type === "system" && m.subtype === "task_started");
				await spike.waitFor((m) => m.type === "stream_event" && m.event.type === "content_block_delta", {
					after: indexOf(spike.messages, (m) => m.type === "user"),
				});
				await interruptQuery(spike.q);
				await spike.waitFor((m) => m.type === "system" && m.subtype === "task_notification");
				await spike.waitFor(isIdle, { after: 2 });
				const updated = systemFrames(spike.messages, "task_updated");
				expect(updated.some((m) => "patch" in m && m.patch.status === "killed")).toBe(true);
				expect(systemFrames(spike.messages, "task_notification")[0]).toMatchObject({ status: "stopped" });
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
