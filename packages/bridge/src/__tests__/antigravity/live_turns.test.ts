/**
 * A live session's turns, over the bridge's JSON-RPC layer with ACP's documented records (`live-rig.ts`): one prompt in
 * flight, a stop, the session's process going, ACP's stop reasons, and the phone's compaction.
 */

import { describe, expect, test } from "bun:test";
import { CHUNK, PERMISSION, session, start, TOOL_CALL, TOOL_PROGRESS } from "./live-rig";

describe("a live session's turns", () => {
	test("one prompt in flight: a run starts as it is sent, a second is busy, a repeat is the first's result", async () => {
		const { turns, prompts, agy, ends, types, violations, live } = session();
		const first = start("Can you analyze this code for potential issues?");
		expect(turns.prompt(first)).toEqual({ status: "accepted", disposition: "started" });
		expect(prompts.map((sent) => sent.prompt)).toEqual([[{ type: "text", text: first.text }]]);
		expect(turns.prompt(start("and this?"))).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		expect(turns.prompt(first)).toEqual({ status: "accepted", disposition: "started" });
		expect(prompts).toHaveLength(1);
		const echoed = live.snapshot().run?.items[0];
		expect(echoed).toMatchObject({ kind: "user_message", text: first.text, clientRequestId: first.clientRequestId });
		agy(CHUNK);
		agy(TOOL_CALL);
		agy(TOOL_PROGRESS);
		await ends("end_turn");
		expect(types()).toEqual([
			"run_started",
			"user_message",
			"block_started",
			"block_delta",
			"block_finished",
			"tool_started",
			"tool_updated",
			"tool_finished",
			"run_finished",
		]);
		expect(live.snapshot().lastOutcome).toEqual({ kind: "completed" });
		expect(violations()).toEqual([]);
		expect(turns.prompt(start("next"))).toEqual({ status: "accepted", disposition: "started" });
	});

	test("a stop cancels the turn, answers its asks cancelled, and keeps what agy streams until the turn ends", async () => {
		const { turns, live, sent, counts, agy, ends, records, violations } = session();
		turns.prompt(start("Analyze it"));
		agy(CHUNK);
		agy(TOOL_CALL);
		agy(PERMISSION);
		expect(turns.abort()).toEqual({ status: "accepted" });
		expect(counts.cancels).toBe(1);
		// protocol/v1/draft/prompt-turn, "Cancellation": pending permissions are answered `cancelled`
		expect(sent).toEqual([{ jsonrpc: "2.0", id: 5, result: { outcome: { outcome: "cancelled" } } }]);
		expect(live.snapshot().interactions).toEqual([]);
		expect(records.find((record) => record.event.type === "interaction_resolved")?.event).toMatchObject({
			reason: "withdrawn",
		});
		agy(CHUNK);
		expect(live.snapshot().blocks.map((block) => block.text)).toEqual([
			"I'll analyze your code for potential issues. Let me examine it...",
		]);
		await ends("cancelled");
		expect(live.snapshot().lastOutcome).toEqual({ kind: "aborted" });
		expect(live.snapshot().blocks).toEqual([]);
		expect(live.snapshot().tools).toEqual([]);
		expect(counts.ran).toBe(1);
		expect(violations()).toEqual([]);
	});

	test("the session's process going ends the run failed, and its asks withdrawn", () => {
		const { turns, live, agy, violations } = session();
		turns.prompt(start("Read it"));
		agy(TOOL_CALL);
		agy(PERMISSION);
		turns.lose("agy exited with code 1");
		expect(live.snapshot().lastOutcome).toEqual({
			kind: "error",
			error: { code: "backend_unavailable", message: "the session's agy process stopped: agy exited with code 1" },
		});
		expect(live.snapshot().interactions).toEqual([]);
		expect(violations()).toEqual([]);
	});

	test("ACP's other stop reasons: the output limit is a limit, a refusal fails with what it means", async () => {
		const { turns, live, ends, records, violations } = session();
		turns.prompt(start("one"));
		await ends("max_tokens");
		expect(live.snapshot().lastOutcome).toEqual({ kind: "limit", limit: "output_tokens" });
		turns.prompt(start("two"));
		await ends("refusal");
		expect(live.snapshot().lastOutcome).toMatchObject({ kind: "error", error: { code: "content_filter" } });
		expect(records.some((record) => record.event.type === "notice")).toBe(true);
		expect(violations()).toEqual([]);
	});

	test("a compaction is `/compact` as a prompt, shown as a compaction with agy's words as the command's output", async () => {
		const { turns, live, prompts, agy, ends, types, violations } = session();
		live.emit({ type: "usage_updated", usage: { contextTokens: 53_000, contextWindow: 200_000 } });
		expect(turns.compact("keep the API notes")).toEqual({ status: "accepted" });
		expect(prompts[0]?.prompt).toEqual([{ type: "text", text: "/compact keep the API notes" }]);
		expect(turns.prompt(start("go on"))).toMatchObject({ rejection: { code: "busy" } });
		agy(CHUNK);
		await ends("end_turn");
		expect(types().slice(1)).toEqual(["compaction_started", "compaction_finished", "activity"]);
		const finished = live.snapshot();
		expect(finished.compaction).toBeUndefined();
		expect(finished.run).toBeUndefined();
		expect(violations()).toEqual([]);
	});
});
