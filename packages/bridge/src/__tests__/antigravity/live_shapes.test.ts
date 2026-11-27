/**
 * The live layer's own decisions, apart from agy: which session closes to make room, when a prompt to a session agy has
 * just loaded goes, what a turn's token counts say of the prompt cache, what a permission's diff previews, and which
 * replayed message a prompt the phone sent is. The diffs are ACP's own example (protocol/v1/draft/tool-calls, "Diffs":
 * `oldText` is null for a new file), and agy's own step is ACP's documented updates (`live-rig.ts`'s `CHUNK`;
 * protocol/v1/prompt-turn, "Session usage updates").
 */

import { describe, expect, test } from "bun:test";
import { type ConfigOption, PermissionRequest, SessionUpdate } from "../../backends/antigravity/acp/frames";
import { capacityRefusal, evictionCandidate } from "../../backends/antigravity/live/cap";
import { permissionAsk } from "../../backends/antigravity/live/permissions";
import { PhonePrompts } from "../../backends/antigravity/live/phone-prompts";
import {
	chosenAgain,
	modeChoice,
	modelChoice,
	settingEvents,
	settingsOf,
	snapshotOf,
} from "../../backends/antigravity/live/settings";
import { LoadSettle } from "../../backends/antigravity/live/settle";
import { withContext, withTurnCache } from "../../backends/antigravity/live/usage";
import { toolState } from "../../backends/antigravity/mapping/tools";
import type { PromptInput, TranscriptItem } from "../../contract";
import { CHUNK } from "./live-rig";

describe("making room for a session", () => {
	const host = (name: string, lastUsedAt: number, idle: boolean, viewed = false) => ({
		name,
		lastUsedAt,
		viewed,
		idle: () => idle,
	});

	test("closes the least recently used session with nothing in flight, and never a busy one", () => {
		const hosts = [host("busy-oldest", 1, false), host("idle-newer", 3, true), host("idle-older", 2, true)];
		expect(evictionCandidate(hosts)?.name).toBe("idle-older");
		expect(evictionCandidate([host("a", 1, false), host("b", 2, false)])).toBeUndefined();
		expect(capacityRefusal(8).rejection.code).toBe("busy");
	});

	test("closes one no phone views before one a phone has open, however recently that was used", () => {
		const hosts = [host("viewed-oldest", 1, true, true), host("unviewed-newest", 9, true), host("unviewed", 5, true)];
		expect(evictionCandidate(hosts)?.name).toBe("unviewed");
		expect(evictionCandidate([host("viewed-newer", 4, true, true), host("viewed-older", 2, true, true)])?.name).toBe(
			"viewed-older",
		);
	});
});

describe("a prompt to a session agy has just loaded", () => {
	const chunk = SessionUpdate.parse(CHUNK.params.update);
	const usage = SessionUpdate.parse({ sessionUpdate: "usage_update", used: 53000, size: 200000 });
	const sent = () => Promise.resolve("sent");

	test("waits for agy's own step to end, which no run shows, and goes at its usage update", async () => {
		const settle = new LoadSettle({ quietMs: 20, longestMs: 5_000 });
		const outcome = { at: "held" };
		void settle.send(sent, "stopped").then((at) => {
			outcome.at = at;
		});
		expect(settle.own(chunk)).toBe(true);
		await Bun.sleep(40);
		expect(outcome.at).toBe("held");
		expect(settle.own(usage)).toBe(false);
		await Bun.sleep(0);
		expect(outcome.at).toBe("sent");
		expect(settle.own(chunk)).toBe(false);
	});

	test("goes once agy has shown nothing of its own for a while, or once its own step has run too long", async () => {
		expect(await new LoadSettle({ quietMs: 20, longestMs: 5_000 }).send(sent, "stopped")).toBe("sent");
		const endless = new LoadSettle({ quietMs: 20, longestMs: 60 });
		endless.own(chunk);
		const started = performance.now();
		expect(await endless.send(sent, "stopped")).toBe("sent");
		expect(performance.now() - started).toBeGreaterThanOrEqual(50);
	});

	test("a stop drops the held prompt unsent; a session agy did not just load holds nothing", async () => {
		const settle = new LoadSettle({ quietMs: 5_000, longestMs: 10_000 });
		let sends = 0;
		const held = settle.send(async () => {
			sends += 1;
			return "sent";
		}, "stopped");
		expect(settle.stop()).toBe(true);
		expect(await held).toBe("stopped");
		settle.end();
		expect(sends).toBe(0);
		const made = new LoadSettle(undefined);
		expect(made.stop()).toBe(false);
		expect(made.own(chunk)).toBe(false);
		expect(await made.send(sent, "stopped")).toBe("sent");
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
		expect(withContext(cached, 60_000, 200_000)?.cache).toEqual(cached?.cache);
	});
});

describe("a report or a choice of what the session already holds", () => {
	/** protocol/v1/draft/session-config-options, "Initial State" */
	const options: ConfigOption[] = [
		{
			id: "mode",
			name: "Session Mode",
			category: "mode",
			type: "select",
			currentValue: "ask",
			options: [
				{ value: "ask", name: "Ask" },
				{ value: "code", name: "Code" },
			],
		},
		{
			id: "model",
			name: "Model",
			category: "model",
			type: "select",
			currentValue: "model-1",
			options: [
				{ value: "model-1", name: "Model 1" },
				{ value: "model-2", name: "Model 2" },
			],
		},
	];

	test("a context fill the session already shows is the same usage, so it emits nothing", () => {
		const usage = withContext(undefined, 0, 200_000);
		expect(withContext(usage, 0, 200_000)).toBe(usage);
		expect(withContext(usage, 1_200, 200_000)).toEqual({ contextTokens: 1_200, contextWindow: 200_000 });
		expect(withContext(undefined, -1, 0)).toBeUndefined();
	});

	test("choosing the model or mode the session has still shows as that setting's event", () => {
		const snapshot = snapshotOf(settingsOf(options));
		const model = modelChoice(options, "model-1");
		const mode = modeChoice(options, "mode", "ask");
		if ("status" in model || "status" in mode) throw new Error("the session offers both");
		expect(chosenAgain(snapshot, options, model)).toEqual({ type: "model_changed", modelId: "model-1" });
		expect(chosenAgain(snapshot, options, mode)).toEqual({ type: "mode_changed", axis: "mode", value: "ask" });
		expect(settingEvents(snapshot, settingsOf(options))).toEqual([]);
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

describe("the prompts the phone sent", () => {
	const sessionId = "sess_abc123def456";
	const photo = { kind: "image" as const, mimeType: "image/png", data: "iVBORw0KGgo=" };
	const user = (text: string, n: number): TranscriptItem => ({
		kind: "user_message",
		id: `${sessionId}:${n}`,
		text,
		attachments: [],
	});
	const replay = (...texts: string[]) => texts.map(user);

	/** Each replayed user message as its image count and the `clientRequestId` it carries (`-` for none). */
	function sent(...prompts: Array<{ id: string; text: string; images: number }>) {
		const phone = new PhonePrompts(async (data, mimeType) => ({
			ok: true,
			data,
			mimeType,
			originalBytes: 9,
			resized: false,
		}));
		for (const { id, text, images } of prompts) {
			const input: PromptInput = {
				clientRequestId: id,
				mode: "start",
				text,
				attachments: Array.from({ length: images }, () => photo),
			};
			phone.take(sessionId, input, text);
		}
		return (items: TranscriptItem[], underWay = false) =>
			phone
				.restored(sessionId, items, underWay)
				.map((item) =>
					item.kind === "user_message" ? `${item.attachments.length}${item.clientRequestId ?? "-"}` : "",
				);
	}

	test("get their clientRequestId and images back on their message, past turns the bridge sent no prompt of", () => {
		const restored = sent(
			{ id: "a", text: "what is in this picture?", images: 1 },
			{ id: "b", text: "and now?", images: 0 },
		);
		expect(restored(replay("what is in this picture?", "and now?"))).toEqual(["1a", "0b"]);
		expect(restored(replay("what is in this picture?", "and now?", "/compact"))).toEqual(["1a", "0b", "0-"]);
		expect(restored(replay("what is in this picture?", "/compact", "and now?", "from the terminal"))).toEqual([
			"1a",
			"0-",
			"0b",
			"0-",
		]);
		expect(restored(replay("what is in this picture?"))).toEqual(["1a"]);
	});

	test("while a run is under way, its prompt names no older message of the same text", () => {
		const restored = sent({ id: "a", text: "go on", images: 0 }, { id: "b", text: "go on", images: 1 });
		expect(restored(replay("go on"), true)).toEqual(["0a"]);
		expect(restored(replay("go on", "go on"))).toEqual(["0a", "1b"]);
	});

	test("pair a text sent twice with the newest sending, and restore nothing to a message that matches none", () => {
		const restored = sent({ id: "a", text: "look", images: 1 }, { id: "b", text: "look", images: 2 });
		expect(restored(replay("look", "look"))).toEqual(["1a", "2b"]);
		expect(restored(replay("look"))).toEqual(["2b"]);
		expect(restored(replay("something else"))).toEqual(["0-"]);
	});
});
