/**
 * Q1, Q2, Q4, Q5 (docs/architecture/backends/claude-code/research/08-spike.md): one offline turn through the
 * real bundled CLI against the scripted endpoint, for text, thinking and a Read tool call.
 */

import { describe, expect, test } from "bun:test";
import { README_TEXT } from "../../helpers/claude-home";
import { statesOf } from "./rig/interrupt";
import { blockOrder, indexOf } from "./rig/order";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, type SpikeSession, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

async function oneTurn(spike: SpikeSession, text: string): Promise<string> {
	const uuid = spike.send(text);
	await spike.waitFor((m) => m.type === "result");
	await spike.waitFor(isIdle, { after: indexOf(spike.messages, (m) => m.type === "result") });
	return uuid;
}

function expectOffline(spike: SpikeSession): void {
	expect(spike.server.escapes()).toEqual([]);
	const routes = new Set(spike.server.requests().map((r) => `${r.method} ${r.path}`));
	for (const route of routes)
		expect(["POST /v1/messages", "POST /v1/messages/count_tokens", "GET /v1/models"]).toContain(route);
}

describe("Q1/Q2/Q4/Q5: one offline turn through the real CLI", () => {
	test(
		"plain text turn: offline, idle after result, lifecycle queued→started→completed, assistant before block stop",
		async () => {
			const spike = startSpike({ permissionMode: "default", turns: [{ text: ["Hello ", "from ", "the script."] }] });
			try {
				const uuid = await oneTurn(spike, "say hello");
				spike.record("text");
				expectOffline(spike);
				const result = spike.results()[0];
				expect(result).toMatchObject({
					subtype: "success",
					terminal_reason: "completed",
					result: "Hello from the script.",
				});
				expect(result?.user_message_uuids).toEqual([uuid]);
				const states = spike.messages.flatMap((m) =>
					m.type === "system" && m.subtype === "session_state_changed" ? [m.state] : [],
				);
				expect(states).toEqual(["running", "idle"]);
				expect(indexOf(spike.messages, isIdle)).toBeGreaterThan(indexOf(spike.messages, (m) => m.type === "result"));
				expect(statesOf(spike.messages, uuid)).toEqual(["queued", "started", "completed"]);
				for (const block of blockOrder(spike.messages)) expect(block.assistantAt).toBeLessThan(block.stopAt);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"thinking turn: the thinking block's assistant frame also precedes its content_block_stop",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [{ thinking: ["Let me ", "think."], text: ["Thought it through."] }],
			});
			try {
				await oneTurn(spike, "think first");
				spike.record("thinking");
				expectOffline(spike);
				const order = blockOrder(spike.messages);
				expect(order.map((b) => b.kind)).toEqual(["thinking", "text"]);
				for (const block of order) expect(block.assistantAt).toBeLessThan(block.stopAt);
				const thinking = spike.messages.find(
					(m) => m.type === "assistant" && m.message.content[0]?.type === "thinking",
				);
				expect(thinking?.type === "assistant" && thinking.message.content[0]).toMatchObject({
					thinking: "Let me think.",
				});
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"tool turn: Read README.md runs, its result comes back as a user frame, one result per turn",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [
					{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
					{ text: ["The word is PLUMBUS."] },
				],
			});
			try {
				await oneTurn(spike, "read the readme");
				spike.record("tool-read");
				expectOffline(spike);
				const order = blockOrder(spike.messages);
				expect(order.map((b) => b.kind)).toEqual(["tool_use", "text"]);
				for (const block of order) expect(block.assistantAt).toBeLessThan(block.stopAt);
				const toolResult = spike.messages.find((m) => m.type === "user" && m.tool_use_result !== undefined);
				expect(JSON.stringify(toolResult)).toContain("PLUMBUS");
				expect(JSON.stringify(spike.server.mainRequests()[1]?.body)).toContain(README_TEXT.split("\n")[2] ?? "");
				expect(spike.results()).toHaveLength(1);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"without CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS no session_state_changed reaches the consumer",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [{ text: ["one"] }],
				env: { CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: undefined },
			});
			try {
				spike.send("hi");
				await spike.waitFor((m) => m.type === "result");
				await Bun.sleep(500);
				expect(spike.messages.some((m) => m.type === "system" && m.subtype === "session_state_changed")).toBe(false);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
