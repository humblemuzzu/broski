/**
 * The pinned SDK's behaviour the adapter builds on, each fact proven by running it:
 * how input is queued mid-run, what an abort leaves in Pi's queue, the settle window, a `tool_call`
 * hook under abort, where `navigateTree` puts the leaf, a too-small compaction, and when a model
 * switch reaches the model. Faux provider, temp agent dir, package-root imports only.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionRuntime, InlineExtension } from "@earendil-works/pi-coding-agent";
import { hostSpikeSession, silentUi, spikeRuntimeFactory } from "./helpers/pi-spike";
import {
	createPiTestEnv,
	createTestModelRuntime,
	type FauxModels,
	type PiTestEnv,
	registerFaux,
} from "./helpers/pi-test-env";

let env: PiTestEnv;
let runtime: AgentSessionRuntime | undefined;

beforeEach(() => {
	env = createPiTestEnv();
});

afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	env.dispose();
});

/** A session whose `driver_hold` tool waits for `release`, and whose `/drv` command does nothing. */
async function host(extensions: InlineExtension[] = []): Promise<{ session: AgentSession; faux: FauxModels }> {
	const modelRuntime = await createTestModelRuntime(env);
	const faux = await registerFaux(modelRuntime, [{ id: "m1", reasoning: true }, { id: "m2" }]);
	runtime = await hostSpikeSession(env, spikeRuntimeFactory(modelRuntime, faux.handle.getModel(), extensions));
	await runtime.session.bindExtensions({ uiContext: silentUi(), mode: "rpc" });
	return { session: runtime.session, faux };
}

function holdingTool(entered: () => void, release: Promise<void>): InlineExtension {
	return {
		name: "driver",
		factory: (pi) => {
			pi.registerCommand("drv", { description: "does nothing", handler: async () => {} });
			pi.registerTool({
				name: "driver_hold",
				label: "Hold",
				description: "Waits until the test releases it.",
				parameters: Type.Object({}),
				execute: async () => {
					entered();
					await release;
					return { content: [{ type: "text", text: "released" }], details: {} };
				},
			});
		},
	};
}

function disposition(): { record: (value: string) => void; readonly value: string | undefined } {
	let value: string | undefined;
	return {
		record: (next) => {
			value = next;
		},
		get value() {
			return value;
		},
	};
}

describe("input during a run", () => {
	test("steer() refuses an extension command's name; prompt({streamingBehavior}) queues text as given", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const { session, faux } = await host([holdingTool(entered.resolve, release.promise)]);
		faux.handle.setResponses([
			fauxAssistantMessage([fauxToolCall("driver_hold", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		const run = session.prompt("go", { expandPromptTemplates: false });
		await entered.promise;
		await expect(session.steer("/drv now")).rejects.toThrow("cannot be queued");
		const steered = disposition();
		await session.prompt("/drv literal", {
			streamingBehavior: "steer",
			expandPromptTemplates: false,
			preflightResult: steered.record,
		});
		const queued = disposition();
		await session.prompt("later", {
			streamingBehavior: "followUp",
			expandPromptTemplates: false,
			preflightResult: queued.record,
		});
		expect([steered.value, queued.value]).toEqual(["queued", "queued"]);
		expect(session.getSteeringMessages()).toEqual(["/drv literal"]);
		expect(session.getFollowUpMessages()).toEqual(["later"]);
		release.resolve();
		await run;
	});

	test("an abort clears nothing: a steer still reaches the aborted run at its next turn, a follow-up waits for the next run", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const { session, faux } = await host([holdingTool(entered.resolve, release.promise)]);
		faux.handle.setResponses([
			fauxAssistantMessage([fauxToolCall("driver_hold", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("next"),
		]);
		const users: string[] = [];
		const ends: string[] = [];
		session.subscribe((event) => {
			if (event.type === "message_start" && event.message.role === "user") users.push(userText(event.message));
			if (event.type === "message_end" && event.message.role === "assistant") ends.push(event.message.stopReason);
			if (event.type === "agent_settled") ends.push(`settled aborted=${event.aborted}`);
		});
		const run = session.prompt("go", { expandPromptTemplates: false });
		await entered.promise;
		await session.prompt("steer", { streamingBehavior: "steer", expandPromptTemplates: false });
		await session.prompt("later", { streamingBehavior: "followUp", expandPromptTemplates: false });
		const aborting = session.abort();
		release.resolve();
		await aborting;
		await run;
		expect(users).toEqual(["go", "steer"]);
		expect(ends).toEqual(["toolUse", "error", "settled aborted=true"]);
		expect(session.getSteeringMessages()).toEqual([]);
		expect(session.getFollowUpMessages()).toEqual(["later"]);
		await session.prompt("next", { expandPromptTemplates: false });
		expect(users).toEqual(["go", "steer", "next", "later"]);
		expect(session.pendingMessageCount).toBe(0);
	});

	test("a prompt made inside the agent_settled listener resolves before Pi decides it, and runs after the settle", async () => {
		const { session, faux } = await host();
		faux.handle.setResponses([fauxAssistantMessage("a"), fauxAssistantMessage("b")]);
		const inside = disposition();
		let streamingAtSettle: boolean | undefined;
		let decidedWhenResolved: string | undefined = "not resolved";
		const unsubscribe = session.subscribe((event) => {
			if (event.type !== "agent_settled") return;
			unsubscribe();
			streamingAtSettle = session.isStreaming;
			void session.prompt("inside", { expandPromptTemplates: false, preflightResult: inside.record }).then(() => {
				decidedWhenResolved = inside.value;
			});
		});
		await session.prompt("one", { expandPromptTemplates: false });
		await session.waitForIdle();
		expect(streamingAtSettle).toBe(false);
		expect(decidedWhenResolved).toBeUndefined();
		expect(inside.value).toBe("started");
	});

	test("a prompt made a microtask after the agent_settled listener is decided at once", async () => {
		const { session, faux } = await host();
		faux.handle.setResponses([fauxAssistantMessage("a"), fauxAssistantMessage("b")]);
		const after = disposition();
		const prompted = Promise.withResolvers<string | undefined>();
		const unsubscribe = session.subscribe((event) => {
			if (event.type !== "agent_settled") return;
			unsubscribe();
			queueMicrotask(() => {
				void session
					.prompt("after", { expandPromptTemplates: false, preflightResult: after.record })
					.then(() => prompted.resolve(after.value));
			});
		});
		await session.prompt("one", { expandPromptTemplates: false });
		expect(await prompted.promise).toBe("started");
	});
});

function userText(message: { content: string | readonly { type: string; text?: string }[] }): string {
	const content = message.content;
	return typeof content === "string" ? content : content.map((part) => part.text ?? `[${part.type}]`).join("");
}

describe("abort", () => {
	test("settles a run whose tool_call hook waits on ctx.signal (contract README Q29)", async () => {
		const hooked = Promise.withResolvers<void>();
		const gate: InlineExtension = {
			name: "signal-gate",
			factory: (pi) => {
				pi.on("tool_call", async (_event, ctx) => {
					hooked.resolve();
					const signal = ctx.signal;
					await new Promise<void>((resolve) => {
						if (signal === undefined || signal.aborted) return resolve();
						signal.addEventListener("abort", () => resolve(), { once: true });
					});
					return { block: true, reason: "withdrawn" };
				});
			},
		};
		const { session, faux } = await host([gate]);
		faux.handle.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" }),
		]);
		const settled: boolean[] = [];
		session.subscribe((event) => {
			if (event.type === "agent_settled") settled.push(event.aborted);
		});
		const run = session.prompt("read it", { expandPromptTemplates: false });
		await hooked.promise;
		await session.abort();
		await run;
		expect(settled).toEqual([true]);
	});
});

describe("the session tree", () => {
	test("navigateTree to a user message puts the leaf on its parent and hands back its text; without a summary it writes nothing", async () => {
		const { session, faux } = await host();
		faux.handle.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
		await session.prompt("one", { expandPromptTemplates: false });
		await session.prompt("two", { expandPromptTemplates: false });
		const file = session.sessionFile;
		if (file === undefined) throw new Error("the session has no file");
		const before = readFileSync(file, "utf8");
		const user = session.sessionManager
			.getEntries()
			.find((entry) => entry.type === "message" && entry.message.role === "user");
		if (user === undefined) throw new Error("no user message");
		const result = await session.navigateTree(user.id, { summarize: false });
		expect(result).toEqual({ cancelled: false, editorText: "one" });
		expect(session.sessionManager.getLeafId()).toBe(user.parentId);
		expect(readFileSync(file, "utf8")).toBe(before);
	});
});

describe("compaction", () => {
	test("a session too small to compact still emits compaction_start, then compaction_end with the reason", async () => {
		const { session, faux } = await host();
		faux.handle.setResponses([fauxAssistantMessage("short")]);
		await session.prompt("one", { expandPromptTemplates: false });
		const events: string[] = [];
		session.subscribe((event) => {
			if (event.type === "compaction_start") events.push("start");
			if (event.type === "compaction_end") events.push(`end ${event.errorMessage ?? ""}`);
		});
		await expect(session.compact()).rejects.toThrow("Nothing to compact");
		expect(events).toEqual(["start", "end Compaction failed: Nothing to compact (session too small)"]);
	});
});

describe("model switch", () => {
	test("setModel while a tool runs reaches the run's next request (modelSwitch next_request)", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const { session, faux } = await host([holdingTool(entered.resolve, release.promise)]);
		const requested: string[] = [];
		faux.handle.setResponses([
			(_context, _options, _state, model) => {
				requested.push(model.id);
				return fauxAssistantMessage([fauxText("hold"), fauxToolCall("driver_hold", {})], { stopReason: "toolUse" });
			},
			(_context, _options, _state, model) => {
				requested.push(model.id);
				return fauxAssistantMessage("done");
			},
		]);
		const run = session.prompt("which model", { expandPromptTemplates: false });
		await entered.promise;
		const second = faux.handle.getModel("m2");
		if (second === undefined) throw new Error("no faux model m2");
		await session.setModel(second);
		release.resolve();
		await run;
		expect(requested).toEqual(["m1", "m2"]);
	});
});
