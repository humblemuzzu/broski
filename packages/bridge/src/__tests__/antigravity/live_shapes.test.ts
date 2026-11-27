/**
 * The live layer's own decisions, apart from agy: which session closes to make room, what a turn's token counts say of
 * the prompt cache, and what a permission's diff previews. The diffs are ACP's own example (protocol/v1/draft/tool-calls,
 * "Diffs": `oldText` is null for a new file).
 */

import { describe, expect, test } from "bun:test";
import { PermissionRequest } from "../../backends/antigravity/acp/frames";
import { capacityRefusal, evictionCandidate } from "../../backends/antigravity/live/cap";
import { permissionAsk } from "../../backends/antigravity/live/permissions";
import { withContext, withTurnCache } from "../../backends/antigravity/live/usage";
import { toolState } from "../../backends/antigravity/mapping/tools";

describe("making room for a session", () => {
	const host = (name: string, lastUsedAt: number, idle: boolean) => ({ name, lastUsedAt, idle: () => idle });

	test("closes the least recently used session with nothing in flight, and never a busy one", () => {
		const hosts = [host("busy-oldest", 1, false), host("idle-newer", 3, true), host("idle-older", 2, true)];
		expect(evictionCandidate(hosts)?.name).toBe("idle-older");
		expect(evictionCandidate([host("a", 1, false), host("b", 2, false)])).toBeUndefined();
		expect(capacityRefusal(8).rejection.code).toBe("busy");
	});
});

describe("a turn's token counts", () => {
	const at = 5_000;

	test("are the cache window of that turn, its prompt counted once whether or not the input holds the reads", () => {
		const apart = withTurnCache(undefined, { inputTokens: 200, cachedReadTokens: 800, outputTokens: 50 }, at);
		expect(apart?.cache).toEqual({ lastTouchAt: at, confidence: "exact", cachedTokens: 800, promptTokens: 1_000 });
		const counted = {
			totalTokens: 1_060,
			inputTokens: 1_000,
			cachedReadTokens: 800,
			outputTokens: 50,
			thoughtTokens: 10,
		};
		expect(withTurnCache(undefined, counted, at)?.cache?.promptTokens).toBe(1_000);
		const summed = {
			totalTokens: 1_860,
			inputTokens: 1_000,
			cachedReadTokens: 800,
			outputTokens: 50,
			thoughtTokens: 10,
		};
		expect(withTurnCache(undefined, summed, at)?.cache?.promptTokens).toBe(1_800);
	});

	test("say nothing of the cache without a cache read, and leave the session totals unset", () => {
		const context = withContext(undefined, 53_000, 200_000);
		expect(context).toEqual({ contextTokens: 53_000, contextWindow: 200_000 });
		expect(withTurnCache(context, { inputTokens: 900, outputTokens: 20 }, at)).toBe(context);
		const cached = withTurnCache(context, { inputTokens: 900, cachedReadTokens: 100 }, at);
		expect(Object.keys(cached ?? {}).sort()).toEqual(["cache", "contextTokens", "contextWindow"]);
		expect(withContext(cached, 60_000, 200_000).cache).toEqual(cached?.cache);
	});
});

describe("a permission for a file change", () => {
	const request = (oldText: string | null) =>
		PermissionRequest.parse({
			sessionId: "sess_abc123def456",
			toolCall: {
				toolCallId: "call_001",
				title: "Editing configuration",
				kind: "edit",
				content: [
					{
						type: "diff",
						path: "/home/user/project/src/config.json",
						oldText,
						newText: '{\n  "debug": true\n}',
					},
				],
			},
			options: [
				{ optionId: "allow", name: "Allow", kind: "allow_once" },
				{ optionId: "always", name: "Always allow", kind: "allow_always" },
				{ optionId: "deny", name: "Deny", kind: "reject_once" },
				{ optionId: "later", name: "Later", kind: "_maybe" },
			],
		});

	test("previews the diff, a new file as added, and offers agy's options by what their kind says", () => {
		const changed = request('{\n  "debug": false\n}');
		const ask = permissionAsk(changed, toolState(changed.toolCall));
		expect(ask?.title).toBe("Editing configuration");
		expect(ask?.request.previews).toEqual([
			{
				kind: "file_changes",
				changes: [
					expect.objectContaining({
						path: "/home/user/project/src/config.json",
						change: "modified",
						additions: 1,
						deletions: 1,
					}),
				],
			},
		]);
		expect(ask?.request.options.map((option) => [option.id, option.effect, option.scope])).toEqual([
			["allow", "allow", "once"],
			["always", "allow", "always"],
			["deny", "deny", "once"],
		]);
		expect(ask?.request.defaultOptionId).toBeUndefined();
		const created = request(null);
		const added = permissionAsk(created, toolState(created.toolCall));
		expect(added?.request.previews).toEqual([
			{ kind: "file_changes", changes: [expect.objectContaining({ change: "added", deletions: 0 })] },
		]);
	});
});
