/**
 * Q13 (research/08-spike.md): `/compact` sent as a prompt, with a slow summary request, and what the
 * consumer sees while it runs.
 */

import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { indexOf } from "./rig/order";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const SLOW_SUMMARY = {
	text: [
		"<analysis>",
		...Array.from({ length: 10 }, (_, i) => `step${i} `),
		"</analysis>\n<summary>Scripted summary.</summary>",
	],
	delayMs: 150,
};

const label = (m: SDKMessage) =>
	m.type === "system" ? `${m.subtype}${m.subtype === "status" ? `:${m.status}` : ""}` : m.type;

describe("compaction", () => {
	test(
		"slow /compact: status compacting → status null + success → compact_boundary → summary → result with no model turn",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [{ text: ["first answer"] }, { text: ["must not run"] }],
				server: { sideRequests: { compact: [SLOW_SUMMARY] } },
			});
			try {
				spike.send("hello");
				await spike.waitFor((m) => m.type === "result");
				await spike.waitFor(isIdle, { after: indexOf(spike.messages, (m) => m.type === "result") });
				const at = spike.messages.length;
				spike.send("/compact");
				await spike.waitFor((m) => m.type === "result", { after: at, timeoutMs: 20_000 });
				await spike.waitFor(isIdle, { after: at });
				spike.record("compaction");
				expect([spike.server.served("main"), spike.server.served("compact")]).toEqual([1, 1]);
				const labels = spike.messages
					.slice(at)
					.map(label)
					.filter((l) => l !== "command_lifecycle");
				expect(labels).toEqual([
					"session_state_changed",
					"status:compacting",
					"status:null",
					"init",
					"compact_boundary",
					"user",
					"user",
					"result",
					"session_state_changed",
				]);
				const boundary = spike.messages.find((m) => m.type === "system" && m.subtype === "compact_boundary");
				expect(boundary).toMatchObject({ compact_metadata: { trigger: "manual", duration_ms: expect.any(Number) } });
				const done = spike.messages.find((m) => m.type === "system" && m.subtype === "status" && m.status === null);
				expect(done).toMatchObject({ compact_result: "success" });
				expect(spike.results()[1]).toMatchObject({ subtype: "success", num_turns: 0 });
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
