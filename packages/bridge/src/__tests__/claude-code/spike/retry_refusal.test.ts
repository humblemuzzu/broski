/**
 * Q13 (research/08-spike.md): a 529 then success, a 529 retry cut short by an interrupt, and a refusal.
 * The refusal-fallback dialog is not reachable from a scripted endpoint (`scripts/cc-spike/probe-refusal-fallback.ts`).
 */

import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { interruptQuery } from "./rig/interrupt";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const REFUSAL = { text: ["I can't help with that."], stopReason: "refusal" as const };

function systemFrames(messages: readonly SDKMessage[], subtype: string): Extract<SDKMessage, { type: "system" }>[] {
	return messages.filter(
		(m): m is Extract<SDKMessage, { type: "system" }> => m.type === "system" && m.subtype === subtype,
	);
}

describe("retries and refusals", () => {
	test(
		"529 then success: one system/api_retry (overloaded), then the turn completes",
		async () => {
			const spike = startSpike({ permissionMode: "default", turns: [{ status: 529 }, { text: ["ok after retry"] }] });
			try {
				spike.send("hi");
				await spike.waitFor((m) => m.type === "result", { timeoutMs: 25_000 });
				spike.record("retry-529");
				expect(systemFrames(spike.messages, "api_retry")).toEqual([
					expect.objectContaining({
						attempt: 1,
						max_retries: 10,
						error_status: 529,
						error: "overloaded",
						retry_delay_ms: expect.any(Number),
					}),
				]);
				expect(spike.results()[0]).toMatchObject({ subtype: "success", result: "ok after retry" });
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"an interrupt during the retry wait ends the turn at once (aborted_streaming) and stops further attempts",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: Array.from({ length: 12 }, () => ({ status: 529 })),
			});
			try {
				spike.send("hi");
				await spike.waitFor((m) => m.type === "system" && m.subtype === "api_retry", { timeoutMs: 20_000 });
				await interruptQuery(spike.q);
				await spike.waitFor((m) => m.type === "result", { timeoutMs: 5_000 });
				await Bun.sleep(1500);
				expect(spike.results()[0]).toMatchObject({
					subtype: "error_during_execution",
					terminal_reason: "aborted_streaming",
				});
				expect(spike.server.served("main")).toBe(1);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"refusal: one same-model retry with an informational notice, then model_refusal_no_fallback and a refusal result",
		async () => {
			const spike = startSpike({ permissionMode: "default", turns: [REFUSAL, REFUSAL, { text: ["must not run"] }] });
			try {
				spike.send("something bad");
				await spike.waitFor((m) => m.type === "result", { timeoutMs: 20_000 });
				await spike.waitFor(isIdle, { after: 2 });
				spike.record("refusal");
				expect(spike.server.served("main")).toBe(2);
				expect(systemFrames(spike.messages, "informational")[0]).toMatchObject({
					level: "notice",
					content: expect.stringContaining("safeguards stopped the response above"),
				});
				expect(systemFrames(spike.messages, "model_refusal_no_fallback")).toHaveLength(1);
				expect(spike.results()[0]).toMatchObject({ subtype: "success", is_error: true, stop_reason: "refusal" });
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
