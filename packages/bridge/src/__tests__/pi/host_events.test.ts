/**
 * Pi's events as the live stream: a run Pi starts on its own, a
 * message that starts no run, the prompt record written after the user message, a tool the model never got to
 * run, a denied call, and what a settle leaves open.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { commandId } from "../../backends/pi/command-ids";
import { type AgentEvent, applyEvent } from "../../contract";
import { countOf, userMessages } from "./helpers/live-steps";
import { readReadme, say } from "./helpers/scenarios";
import { messagesIn, sessionEntries } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function promptRecordIds(path: string): unknown[] {
	return sessionEntries(path).flatMap((entry): unknown[] =>
		entry.type === "custom" &&
		entry.customType === "broski.prompt" &&
		typeof entry.data === "object" &&
		entry.data !== null &&
		"clientRequestId" in entry.data
			? [entry.data.clientRequestId]
			: [],
	);
}

function indexOf(events: readonly AgentEvent[], type: AgentEvent["type"]): number {
	return events.findIndex((event) => event.type === type);
}

describe("a run Pi starts on its own", () => {
	test("an extension's user message is a run with trigger system, a user message nobody of ours sent, and one end", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [say("hello from the model")]);
		const kick = commandId({ source: "extension", name: "kick" });
		const result = await live.control.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "",
			attachments: [],
			...(kick && { command: kick }),
		});
		expect(result).toMatchObject({ status: "accepted", disposition: "handled" });

		const started = await live.waitFor("run_started");
		expect(started.trigger).toBe("system");
		const finished = await live.waitFor("run_finished");
		expect(finished.runId).toBe(started.runId);
		expect(finished.outcome.kind).toBe("completed");
		expect(userMessages(live)).toEqual([{ text: "from the extension", clientRequestId: undefined }]);
		live.assertSettled();
	});

	test("a note that asks for no turn starts no run, and the next prompt is an ordinary run", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		const note = commandId({ source: "extension", name: "note" });
		await live.control.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "",
			attachments: [],
			...(note && { command: note }),
		});
		await t.rig.driver.quiesce();
		expect(countOf(live, "run_started")).toBe(0);
		expect(live.reduced().run).toBeUndefined();

		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		const { outcome } = await live.run("after the note");
		expect(outcome.kind).toBe("completed");
		expect(countOf(live, "run_started")).toBe(1);
		live.assertSettled();
	});
});

describe("the prompt record", () => {
	test("is written right after the user message, names the prompt, and the live id is the transcript's", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		const { clientRequestId } = await live.run("hello");

		const entries = sessionEntries(t.rig.fileOf(live.ref));
		const at = entries.findIndex((entry) => entry.type === "message" && entry.message.role === "user");
		const record = entries[at + 1];
		expect(record).toMatchObject({
			type: "custom",
			customType: "broski.prompt",
			data: { clientRequestId, imageNames: [] },
		});

		const message = live.events().find((event) => event.type === "user_message");
		const userEntry = entries[at];
		expect(message?.type === "user_message" && message.messageId).toBe(`${userEntry?.id}:0`);
		const page = await t.rig.rig.backend.readTranscript(live.ref, { limit: 50 });
		const item = page.status === "accepted" ? page.page.items.find((i) => i.kind === "user_message") : undefined;
		expect(item?.id).toBe(`${userEntry?.id}:0`);
		expect(item?.kind === "user_message" && item.clientRequestId).toBe(clientRequestId);
	});

	test("a steered and a queued prompt are named when Pi delivers them, each by its own record", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("first");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		const steerId = crypto.randomUUID();
		const queueId = crypto.randomUUID();
		const steered = await live.prompt("steer me", "steer", steerId);
		const queued = await live.prompt("queue me", "queue", queueId);
		expect(steered).toMatchObject({ disposition: "steered" });
		expect(queued).toMatchObject({ disposition: "queued" });
		t.router.script(live.ref.sessionId, [say("after steer"), say("after queue")]);

		await t.rig.driver.release(live.ref);
		await live.waitFor("run_finished");
		await t.rig.driver.quiesce();

		expect(userMessages(live)).toEqual([
			{ text: "first", clientRequestId: expect.any(String) },
			{ text: "steer me", clientRequestId: steerId },
			{ text: "queue me", clientRequestId: queueId },
		]);
		const queues = live.events().filter((event) => event.type === "queue_changed");
		expect(queues.map((event) => event.items.length)).toEqual([1, 2, 1, 0]);
		expect(live.reduced().queue).toEqual([]);
		expect(promptRecordIds(t.rig.fileOf(live.ref))).toEqual([userMessages(live)[0]?.clientRequestId, steerId, queueId]);
	});

	test("an image's name is kept for the transcript; names that no longer line up are all unknown", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		const named = crypto.randomUUID();
		await live.runInput({
			clientRequestId: named,
			mode: "start",
			text: "look",
			attachments: [{ kind: "image", mimeType: "image/png", data: PIXEL, name: "pixel.png" }],
		});
		const entry = sessionEntries(t.rig.fileOf(live.ref)).find(
			(candidate) => candidate.type === "custom" && candidate.customType === "broski.prompt",
		);
		expect(entry).toMatchObject({ data: { clientRequestId: named, imageNames: ["pixel.png"] } });
		const message = live.events().find((event) => event.type === "user_message");
		expect(message?.type === "user_message" && message.attachments[0]).toMatchObject({
			kind: "image_ref",
			name: "pixel.png",
		});
	});
});

describe("an image Pi cannot process", () => {
	test("leaves fewer images stored than were sent, so no name is kept rather than a wrong one", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		const id = crypto.randomUUID();
		await live.runInput({
			clientRequestId: id,
			mode: "start",
			text: "two pictures",
			attachments: [
				{ kind: "image", mimeType: "image/png", data: "bm90IGEgcGljdHVyZQ==", name: "broken.png" },
				{ kind: "image", mimeType: "image/png", data: PIXEL, name: "pixel.png" },
			],
		});
		const entries = sessionEntries(t.rig.fileOf(live.ref));
		const user = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
		const stored =
			user?.type === "message" && user.message.role === "user" && Array.isArray(user.message.content)
				? user.message.content.filter((block) => block.type === "image").length
				: -1;
		const record = entries.find((entry) => entry.type === "custom" && entry.customType === "broski.prompt");
		const names = record?.type === "custom" ? (record.data as { imageNames: unknown[] }).imageNames : [];
		expect(stored).toBe(1);
		expect(names).toEqual([null]);
	});
});

describe("a tool the model never got to run", () => {
	test("a response that fails after streaming a call finishes the call before the run ends", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [
			{
				text: ["starting"],
				toolCalls: [{ name: "read", args: { path: "README.md" } }],
				breaksWith: "the account is closed",
			},
		]);
		const { outcome } = await live.run("go");

		expect(outcome.kind).toBe("error");
		const events = live.events();
		expect(indexOf(events, "tool_started")).toBeGreaterThan(-1);
		const finished = events.find((event) => event.type === "tool_finished");
		expect(finished?.type === "tool_finished" && finished.outcome).toBe("aborted");
		expect(events.findIndex((event) => event.type === "tool_finished")).toBeLessThan(indexOf(events, "run_finished"));
		live.assertSettled();
	});
});

describe("a message that fails after a started tool call", () => {
	test("leaves no running tool while the run retries, nor after it", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		const overloaded = {
			text: ["trying"],
			toolCalls: [{ name: "read", args: { path: "README.md" } }],
			breaksWith: "the provider is overloaded",
		};
		t.router.script(live.ref.sessionId, [overloaded, say("recovered")]);
		const { outcome } = await live.run("go");
		expect(outcome.kind).toBe("completed");

		const records = live.recorder.items;
		const retry = records.findIndex((record) => record.event.type === "retry_scheduled");
		expect(retry).toBeGreaterThan(-1);
		const duringRetry = records.slice(0, retry + 1).reduce(applyEvent, live.initial);
		expect(duringRetry.tools).toEqual([]);
		expect(live.reduced().tools).toEqual([]);
		live.assertSettled();
	});
});

describe("a denied call", () => {
	test("finishes denied, with the run going on to the next response", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew({ modes: [{ axis: "permissions", value: "ask" }] });
		t.router.script(live.ref.sessionId, [readReadme(), say("done without it")]);
		await live.prompt("read it");
		const ask = await live.waitFor("interaction_requested");

		const answered = await live.control.answer({
			interactionId: ask.interaction.id,
			reply: { kind: "tool_permission", optionId: "deny", grantIds: [] },
		});
		expect(answered.status).toBe("accepted");

		const finished = await live.waitFor("tool_finished");
		expect(finished.outcome).toBe("denied");
		const run = await live.waitFor("run_finished");
		expect(run.outcome.kind).toBe("completed");
		live.assertSettled();
	});
});

describe("what a settle leaves open", () => {
	test("order at the end of a run: finished parts, then usage, then run_finished", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [{ thinking: ["hmm"], text: ["answer"] }]);
		await live.run("go");
		const types = live.events().map((event) => event.type);
		expect(types.at(-1)).toBe("run_finished");
		expect(types.at(-2)).toBe("usage_updated");
		expect(types.indexOf("block_finished")).toBeLessThan(types.indexOf("usage_updated"));
		expect(messagesIn(t.rig.fileOf(live.ref)).map(([role]) => role)).toContain("assistant");
	});
});
