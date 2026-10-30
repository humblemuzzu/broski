/**
 * The SDK facts the live matrix and the driver's `delivered`/`quiesce` stand on, pinned without the
 * adapter: dialogs reaching the UI context, images reaching the model, retry, an error run, a real
 * compaction (manual and automatic), and a second stack over the same directories.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { AgentSessionEvent, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { TranscriptReadResult } from "../../contract";
import { deliveredInput } from "./helpers/delivered";
import { FAUX_MODEL_IDS } from "./helpers/faux-models";
import { FALLBACK_REPLY } from "./helpers/faux-router";
import { askHuman, failWith, OVERLOADED, say } from "./helpers/scenarios";
import { recordEvents, SdkRig } from "./helpers/sdk-rig";

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let rig: SdkRig;

beforeEach(() => {
	rig = new SdkRig();
});

afterEach(() => rig.dispose());

interface Dialog {
	readonly kind: string;
	readonly title: string;
	readonly options?: readonly string[];
	readonly timeout?: number;
	readonly signal?: AbortSignal;
}

/** A UI context that records each dialog; a text or flag it is not given is a dialog nobody ever answers. */
function dialogs(answers: { text?: string; flag?: boolean }): { ui: Partial<ExtensionUIContext>; seen: Dialog[] } {
	const seen: Dialog[] = [];
	const never = <T>() => new Promise<T>(() => {});
	const text = (dialog: Dialog) => {
		seen.push(dialog);
		return answers.text === undefined ? never<string | undefined>() : Promise.resolve(answers.text);
	};
	return {
		seen,
		ui: {
			select: (title, options, opts) => text({ kind: "select", title, options, ...opts }),
			confirm: (title, _message, opts) => {
				seen.push({ kind: "confirm", title, ...opts });
				return answers.flag === undefined ? never<boolean>() : Promise.resolve(answers.flag);
			},
			input: (title, _placeholder, opts) => text({ kind: "input", title, ...opts }),
			editor: (title) => text({ kind: "editor", title }),
		},
	};
}

describe("ask_human", () => {
	test("opens each dialog kind with its title, options, timeout and (when asked) signal, and returns the answer", async () => {
		const stack = await rig.stack();
		const { ui, seen } = dialogs({ text: "yes", flag: true });
		const session = await rig.host(stack, { ui });
		stack.router.script(session.sessionId, [
			askHuman("select", "Pick one", { options: ["a", "b"], timeoutMs: 250, withSignal: true, tag: "pick" }),
			askHuman("confirm", "Sure?"),
			askHuman("input", "Name?"),
			askHuman("editor", "Edit"),
			say("Thanks."),
		]);
		await session.prompt("ask");
		expect(seen.map((dialog) => [dialog.kind, dialog.title])).toEqual([
			["select", "Pick one"],
			["confirm", "Sure?"],
			["input", "Name?"],
			["editor", "Edit"],
		]);
		expect(seen[0]?.options).toEqual(["a", "b"]);
		expect(seen[0]?.timeout).toBe(250);
		expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
		expect(seen[1]?.signal).toBeUndefined();
		expect(rig.bus.asks.map((ask) => ask.tag)).toEqual(["pick", "confirm", "input", "editor"]);
		expect(rig.bus.asks.map((ask) => ask.answer)).toEqual(["yes", true, "yes", "yes"]);
	});

	test("a dialog that never answers holds the run until the signal it was given aborts", async () => {
		const stack = await rig.stack();
		const asked = Promise.withResolvers<void>();
		const ui: Partial<ExtensionUIContext> = {
			select: (_title, _options, opts) =>
				new Promise((resolve) => {
					opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
					asked.resolve();
				}),
		};
		const session = await rig.host(stack, { ui });
		const events = recordEvents(session);
		stack.router.script(session.sessionId, [
			askHuman("select", "Wait", { options: ["a"], withSignal: true }),
			say("x"),
		]);
		const run = session.prompt("ask");
		await asked.promise;
		expect(events.some((event) => event.type === "agent_settled")).toBe(false);
		await session.abort();
		await run;
		expect(rig.bus.asks).toEqual([{ tag: "select", answer: undefined }]);
		expect(events.findLast((event) => event.type === "agent_settled")).toEqual({
			type: "agent_settled",
			aborted: true,
		});
	});

	test("a signal of the extension's own ends its dialog without touching the run", async () => {
		const stack = await rig.stack();
		const signals: (AbortSignal | undefined)[] = [];
		const asked = Promise.withResolvers<void>();
		const ui: Partial<ExtensionUIContext> = {
			select: (_title, _options, opts) =>
				new Promise((resolve) => {
					signals.push(opts?.signal);
					opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
					asked.resolve();
				}),
		};
		const session = await rig.host(stack, { ui });
		const events = recordEvents(session);
		stack.router.script(session.sessionId, [
			askHuman("select", "Mine", { options: ["a"], ownSignal: true, tag: "mine" }),
			say("Carried on."),
		]);
		const run = session.prompt("ask");
		await asked.promise;
		rig.bus.abortOwn("mine");
		await run;
		expect(signals[0]).toBeInstanceOf(AbortSignal);
		expect(rig.bus.asks).toEqual([{ tag: "mine", answer: undefined }]);
		expect(events.at(-1)).toEqual({ type: "agent_settled", aborted: false });
	});

	test("an extension command opens a dialog outside any run, and the shutdown handler can ask too", async () => {
		const stack = await rig.stack();
		const { ui, seen } = dialogs({ flag: false });
		const session = await rig.host(stack, { ui });
		rig.bus.askOnShutdown = true;
		await session.prompt("/drv-ask");
		expect(seen.map((dialog) => dialog.title)).toEqual(["Proceed?"]);
		expect(session.isStreaming).toBe(false);
		await rig.endSessions();
		expect(rig.bus.asks).toEqual([
			{ tag: "drv-ask", answer: false },
			{ tag: "shutdown", answer: false },
		]);
		expect(rig.bus.lifecycle.map((record) => record.event)).toEqual(["start", "shutdown"]);
	});
});

function transcriptWith(
	text: string,
	names: (string | undefined)[],
): { readTranscript: () => Promise<TranscriptReadResult> } {
	return {
		readTranscript: async () => ({
			status: "accepted",
			page: {
				idStability: "stable",
				items: [
					{
						kind: "user_message",
						id: "entry:0",
						text,
						attachments: names.map((name, index) => ({
							kind: "image_ref" as const,
							id: `entry:${index}`,
							mimeType: "image/png",
							...(name !== undefined && { name }),
						})),
					},
				],
			},
		}),
	};
}

describe("delivered", () => {
	test("an image reaches the model byte for byte, and takes its name from the transcript's ImageRef", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		stack.router.script(session.sessionId, [say("seen")]);
		await session.prompt("Look.", { images: [{ type: "image", mimeType: "image/png", data: PIXEL }] });
		const ref = { backend: "pi" as const, sessionId: session.sessionId };
		const delivered = await deliveredInput(transcriptWith("Look.", ["pixel.png"]), stack.router, ref);
		expect(delivered).toEqual({
			text: "Look.",
			attachments: [{ kind: "image", mimeType: "image/png", data: PIXEL, name: "pixel.png" }],
			mentions: [],
		});
		const unnamed = await deliveredInput(transcriptWith("Look.", [undefined]), stack.router, ref);
		expect(unnamed?.attachments).toEqual([{ kind: "image", mimeType: "image/png", data: PIXEL }]);
	});

	test("the user message is the newest of the newest request, and a transcript without it is an error", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		stack.router.script(session.sessionId, [say("one"), say("two")]);
		await session.prompt("first");
		await session.prompt("second");
		const ref = { backend: "pi" as const, sessionId: session.sessionId };
		expect((await deliveredInput(transcriptWith("second", []), stack.router, ref))?.text).toBe("second");
		stack.router.script(session.sessionId, [say("three")]);
		await session.prompt("third", { images: [{ type: "image", mimeType: "image/png", data: PIXEL }] });
		await expect(deliveredInput(transcriptWith("something else", []), stack.router, ref)).rejects.toThrow(
			"no user message with the text",
		);
	});
});

describe("a provider failure", () => {
	test("a transient one is retried inside the run; the run settles once", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		const events = recordEvents(session);
		stack.router.script(session.sessionId, [failWith(OVERLOADED), say("recovered")]);
		await session.prompt("go");
		const retry = events.filter((event) => event.type.startsWith("auto_retry"));
		expect(retry.map((event) => event.type)).toEqual(["auto_retry_start", "auto_retry_end"]);
		expect(retry[1]).toMatchObject({ success: true, attempt: 1 });
		expect(events.filter((event) => event.type === "agent_settled")).toHaveLength(1);
		expect(session.getLastAssistantText()).toBe("recovered");
	});

	test("a transient one that keeps failing is retried three times, then ends the run in error", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		const events = recordEvents(session);
		stack.router.script(
			session.sessionId,
			Array.from({ length: 4 }, () => failWith(OVERLOADED)),
		);
		await session.prompt("go");
		const retry = events.filter((event) => event.type.startsWith("auto_retry"));
		expect(retry.map((event) => event.type)).toEqual([
			"auto_retry_start",
			"auto_retry_start",
			"auto_retry_start",
			"auto_retry_end",
		]);
		expect(retry.at(-1)).toMatchObject({ success: false, attempt: 3, finalError: OVERLOADED });
		expect(events.filter((event) => event.type === "agent_settled")).toHaveLength(1);
		expect(session.state.messages.findLast((message) => message.role === "assistant")).toMatchObject({
			stopReason: "error",
			errorMessage: OVERLOADED,
		});
	});

	test("one that is not transient ends the run with the provider's message on the last assistant message", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		const events = recordEvents(session);
		stack.router.script(session.sessionId, [failWith("the account is closed")]);
		await session.prompt("go");
		expect(events.some((event) => event.type.startsWith("auto_retry"))).toBe(false);
		const last = session.state.messages.findLast((message) => message.role === "assistant");
		expect(last).toMatchObject({ stopReason: "error", errorMessage: "the account is closed" });
		expect(events.at(-1)).toEqual({ type: "agent_settled", aborted: false });
	});
});

function compactionEvents(events: readonly AgentSessionEvent[]) {
	return events.flatMap((event) =>
		event.type === "compaction_start" || event.type === "compaction_end" ? [event] : [],
	);
}

describe("compaction", () => {
	test("a manual one on a one-turn session produces a summary, because keepRecentTokens is small", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		stack.router.script(session.sessionId, [say("An answer.")]);
		await session.prompt("Something to compact.");
		const events = recordEvents(session);
		const result = await session.compact();
		expect(result.summary).toContain(FALLBACK_REPLY);
		expect(compactionEvents(events)).toMatchObject([
			{ type: "compaction_start", reason: "manual" },
			{ type: "compaction_end", reason: "manual", aborted: false, result: { summary: result.summary } },
		]);
	});

	test("a long reply on the tiny model passes the threshold: compaction runs inside the run and leaves the context unknown", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack, { modelId: FAUX_MODEL_IDS.tiny });
		const events = recordEvents(session);
		stack.router.script(session.sessionId, [say("x".repeat(16_000))]);
		await session.prompt("fill");
		const types = events.map((event) => event.type);
		expect(types.indexOf("compaction_start")).toBeGreaterThan(types.indexOf("agent_end"));
		expect(types.indexOf("compaction_end")).toBeLessThan(types.indexOf("agent_settled"));
		expect(compactionEvents(events)[0]).toEqual({ type: "compaction_start", reason: "threshold" });
		expect(session.getContextUsage()?.tokens).toBeNull();
	});
});

describe("a second stack over the same directories", () => {
	test("reopens the session file the first one wrote and continues it", async () => {
		const first = await rig.stack();
		const session = await rig.host(first);
		first.router.script(session.sessionId, [say("before the restart")]);
		await session.prompt("one");
		const file = session.sessionFile;
		if (!file) throw new Error("the session has no file");
		await rig.endSessions();

		const again = await rig.stack();
		const reopened = await rig.reopen(again, file);
		again.router.script(reopened.sessionId, [say("after the restart")]);
		await reopened.prompt("two");
		expect(reopened.sessionId).toBe(session.sessionId);
		const sent = JSON.stringify(again.router.requests(session.sessionId).at(-1)?.messages);
		expect(sent).toContain("before the restart");
		expect(sent).toContain('"two"');
		await rig.endSessions();
		expect(basename(file)).toContain(session.sessionId);
		expect(readFileSync(file, "utf8")).toContain("after the restart");
	});
});
