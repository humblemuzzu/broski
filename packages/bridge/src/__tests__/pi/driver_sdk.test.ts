/**
 * The conformance driver's machinery against the pinned SDK, with no adapter: the faux models, the
 * per-session router, the driver extension's hold, the prompt template, and the activity counter.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { Activity } from "./helpers/activity";
import { deliveredInput } from "./helpers/delivered";
import { FAUX_MODEL_IDS, wireIdOf } from "./helpers/faux-models";
import { FALLBACK_REPLY } from "./helpers/faux-router";
import { TEMPLATE_MARKER } from "./helpers/pi-world";
import { REPLY_TEXT, say, scenarioSteps } from "./helpers/scenarios";
import { recordEvents, SdkRig } from "./helpers/sdk-rig";

let rig: SdkRig;

beforeEach(() => {
	rig = new SdkRig();
});

afterEach(() => rig.dispose());

const types = (events: ReturnType<typeof recordEvents>) => events.map((event) => event.type);

describe("the faux models", () => {
	test("five models, none real; the no-off model lacks off; the blind one takes no images; the tiny one a small window", async () => {
		const stack = await rig.stack();
		const available = await stack.services.models.runtime.getAvailable();
		expect(available.map((model) => `${model.provider}/${model.id}`)).toEqual(
			Object.values(FAUX_MODEL_IDS).map(wireIdOf),
		);
		const levels = (id: string) => getSupportedThinkingLevels(available.find((model) => model.id === id)!);
		expect(levels(FAUX_MODEL_IDS.noOff)).not.toContain("off");
		expect(levels(FAUX_MODEL_IDS.reasoner)).toContain("off");
		expect(levels(FAUX_MODEL_IDS.plain)).toEqual(["off"]);
		expect(available.find((model) => model.id === FAUX_MODEL_IDS.blind)?.input).toEqual(["text"]);
		expect(available.find((model) => model.id === FAUX_MODEL_IDS.tiny)?.contextWindow).toBe(20_000);
	});

	test("a provider key left in the environment makes the faux registration refuse", async () => {
		process.env.OPENAI_API_KEY = "sk-not-real";
		await expect(rig.stack()).rejects.toThrow("real models are available");
	});
});

describe("the agent dir the driver writes", () => {
	test("its extension loads without errors and its tools, commands and template are there", async () => {
		const session = await rig.host(await rig.stack());
		expect(session.resourceLoader.getExtensions().errors).toEqual([]);
		expect(session.getAllTools().map((tool) => tool.name)).toEqual(
			expect.arrayContaining(["driver_hold", "ask_human"]),
		);
		const commands = session.extensionRunner.getRegisteredCommands().map((command) => command.invocationName);
		expect(commands).toEqual(expect.arrayContaining(["drv-ping", "drv-ask"]));
		expect(session.promptTemplates.map((template) => template.name)).toEqual(["drv-template"]);
		expect(rig.bus.starts(session.sessionId)).toBe(1);
	});

	test("the template expands to a marker the driver recognises, and the arguments follow it", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		stack.router.script(session.sessionId, [say("ok")]);
		await session.prompt("/drv-template now");
		const noTranscript = { readTranscript: () => Promise.reject(new Error("this prompt has no image")) };
		const delivered = await deliveredInput(noTranscript, stack.router, ref(session));
		expect(delivered).toEqual({ text: "now", attachments: [], command: "prompt:drv-template" });
		expect(TEMPLATE_MARKER).toBe("[[drv-template]]");
	});
});

function ref(session: AgentSession) {
	return { backend: "pi" as const, sessionId: session.sessionId };
}

describe("per-session scripts", () => {
	test("two sessions asked in the same tick each get their own script", async () => {
		const stack = await rig.stack();
		const [one, two] = [await rig.host(stack), await rig.host(stack)];
		stack.router.script(one.sessionId, [say("first session")]);
		stack.router.script(two.sessionId, [say("second session")]);
		await Promise.all([one.prompt("a"), two.prompt("b")]);
		expect([one.getLastAssistantText(), two.getLastAssistantText()]).toEqual(["first session", "second session"]);
		expect(stack.router.requests(one.sessionId)).toHaveLength(1);
		expect(stack.router.requests(two.sessionId)).toHaveLength(1);
	});

	test("the faux queue never runs dry however many requests are made", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		for (let turn = 0; turn < 100; turn++) {
			stack.router.script(session.sessionId, [say(`reply ${turn}`)]);
			await session.prompt(`turn ${turn}`);
		}
		expect(session.getLastAssistantText()).toBe("reply 99");
		expect(stack.faux.getPendingResponseCount()).toBeGreaterThanOrEqual(30);
	});

	test("a request with nothing scripted is answered by the fallback, and counted", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		await session.prompt("anything");
		expect(session.getLastAssistantText()).toBe(FALLBACK_REPLY);
		expect(stack.router.requests(session.sessionId)).toHaveLength(1);
		expect(stack.router.remaining(session.sessionId)).toBe(0);
	});
});

describe("the hold", () => {
	test("parks inside the run after a finished block, and release lets the run go on", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		const events = recordEvents(session);
		stack.router.script(session.sessionId, scenarioSteps(rig.bus, session.sessionId, { kind: "hold" }) ?? []);
		const run = session.prompt("go");
		await rig.bus.entered(session.sessionId);
		expect(types(events).slice(-2)).toEqual(["message_end", "tool_execution_start"]);
		expect(types(events)).not.toContain("agent_settled");
		rig.bus.release(session.sessionId);
		await run;
		expect(types(events).at(-1)).toBe("agent_settled");
		expect(session.getLastAssistantText()).toBe("Done.");
	});

	test("a release before the hold is reached is not lost", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		stack.router.script(session.sessionId, scenarioSteps(rig.bus, session.sessionId, { kind: "hold" }) ?? []);
		rig.bus.release(session.sessionId);
		await session.prompt("go");
		expect(session.getLastAssistantText()).toBe("Done.");
	});

	test("an abort ends it; the unplayed step stays until the next arrange replaces it", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		const events = recordEvents(session);
		stack.router.script(session.sessionId, scenarioSteps(rig.bus, session.sessionId, { kind: "hold" }) ?? []);
		const run = session.prompt("go");
		await rig.bus.entered(session.sessionId);
		await session.abort();
		await run;
		const settled = events.findLast((event) => event.type === "agent_settled");
		expect(settled?.type === "agent_settled" && settled.aborted).toBe(true);
		expect(stack.router.remaining(session.sessionId)).toBe(1);
		stack.router.script(session.sessionId, scenarioSteps(rig.bus, session.sessionId, { kind: "reply" }) ?? []);
		await session.prompt("again");
		expect(session.getLastAssistantText()).toBe(REPLY_TEXT);
		expect(stack.router.remaining(session.sessionId)).toBe(0);
	});

	test("echo_model names the model of each request; a switch made at the hold reaches the second", async () => {
		const stack = await rig.stack();
		const session = await rig.host(stack);
		const plain = stack.faux.getModel(FAUX_MODEL_IDS.plain);
		if (!plain) throw new Error("no plain model");
		const texts: string[] = [];
		session.subscribe((event) => {
			if (event.type !== "message_end" || event.message.role !== "assistant") return;
			for (const block of event.message.content) if (block.type === "text") texts.push(block.text);
		});
		stack.router.script(session.sessionId, scenarioSteps(rig.bus, session.sessionId, { kind: "echo_model" }) ?? []);
		const run = session.prompt("which?");
		await rig.bus.entered(session.sessionId);
		await session.setModel(plain);
		rig.bus.release(session.sessionId);
		await run;
		expect(texts).toEqual([wireIdOf(FAUX_MODEL_IDS.reasoner), wireIdOf(FAUX_MODEL_IDS.plain)]);
	});
});

describe("the activity counter behind quiesce()", () => {
	test("is settled at once when nothing runs", async () => {
		await new Activity().settle();
	});

	test("waits for work in flight and for what that work starts in the same macrotask", async () => {
		const activity = new Activity();
		const log: string[] = [];
		const endFirst = activity.begin();
		const settled = activity.settle().then(() => log.push("settled"));
		queueMicrotask(() => {
			log.push("first ends");
			const endSecond = activity.begin();
			endFirst();
			setImmediate(() => {
				log.push("second ends");
				endSecond();
			});
		});
		await settled;
		expect(log).toEqual(["first ends", "second ends", "settled"]);
	});

	test("ending one piece of work twice does not free another", () => {
		const activity = new Activity();
		const end = activity.begin();
		activity.begin();
		end();
		end();
		expect(activity.busy).toBe(true);
	});
});
