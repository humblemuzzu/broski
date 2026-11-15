import { describe, expect, test } from "bun:test";
import type { AgentEvent, InteractionRequestedEvent, SessionRef, SessionSnapshot } from "../contract";
import { CatalogRecorder, SessionRecorder } from "../contract/testing/conformance-harness";
import { createFakeBackend, type FakeBackend } from "../contract/testing/fake-backend";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import { sampleRequest } from "../contract/testing/fake-scenarios";
import type { FakeStep } from "../contract/testing/fake-script";
import { streamViolations, unsettledParts } from "../contract/testing/stream-rules";

interface Asking {
	readonly backend: FakeBackend;
	readonly session: SessionRef;
	readonly initial: SessionSnapshot;
	readonly recorder: SessionRecorder;
	readonly asked: InteractionRequestedEvent;
}

/** A fake session whose run waits on a confirm. */
async function asking(): Promise<Asking> {
	const backend = createFakeBackend({ catalog: new CatalogRecorder(1_000) });
	const recorder = new SessionRecorder(1_000);
	const opened = await backend.open({ kind: "new", options: { cwd: "/fake" } }, recorder);
	if (opened.status === "rejected" || !opened.session.control) throw new Error("the fake would not open");
	const session = opened.session.session;
	backend.fake.script(session, [
		{ kind: "ask", title: "Go on?", request: sampleRequest("confirm") },
		{ kind: "text", text: "Went on." },
	]);
	await opened.session.control.prompt({
		clientRequestId: crypto.randomUUID(),
		mode: "start",
		text: "Ask first.",
		attachments: [],
	});
	const asked = await recorder.waitFor(
		(records) =>
			records
				.map((record) => record.event)
				.find((event): event is InteractionRequestedEvent => event.type === "interaction_requested"),
		"the ask",
	);
	return { backend, session, initial: opened.snapshot, recorder, asked };
}

/** A fake session that plays `steps` for one prompt, to the end of its run unless it asks. */
async function played(steps: FakeStep[], until: (events: AgentEvent[]) => boolean) {
	const backend = createFakeBackend({ catalog: new CatalogRecorder(1_000) });
	const recorder = new SessionRecorder(1_000);
	const opened = await backend.open({ kind: "new", options: { cwd: "/fake" } }, recorder);
	if (opened.status === "rejected" || !opened.session.control) throw new Error("the fake would not open");
	backend.fake.script(opened.session.session, steps);
	const started = performance.now();
	await opened.session.control.prompt({
		clientRequestId: crypto.randomUUID(),
		mode: "start",
		text: "Go.",
		attachments: [],
	});
	await recorder.waitFor((records) => (until(records.map((record) => record.event)) ? true : undefined), "the run");
	return { events: recorder.items.map((record) => record.event), elapsedMs: performance.now() - started };
}

describe("the fake backend", () => {
	test("a permission previews the command the tool was given, not its name", async () => {
		const { events } = await played(
			[{ kind: "tool", name: "bash", input: { command: "rm -rf build" }, output: "removed", permission: true }],
			(seen) => seen.some((event) => event.type === "interaction_requested"),
		);
		const asked = events.find((event) => event.type === "interaction_requested");
		expect(asked).toMatchObject({
			interaction: { request: { kind: "tool_permission", previews: [{ kind: "command", command: "rm -rf build" }] } },
		});
	});

	test("a paced text streams its parts over time, so its block is open and growing for a while", async () => {
		const { events, elapsedMs } = await played(
			[{ kind: "text", text: "Streaming this a few words at a time.", paceMs: 60 }],
			(seen) => seen.some((event) => event.type === "run_finished"),
		);
		expect(events.filter((event) => event.type === "block_delta").length).toBeGreaterThanOrEqual(3);
		expect(elapsedMs).toBeGreaterThanOrEqual(150);
	});

	test("losing the backend expires the pending ask and fails the run, as a valid stream", async () => {
		const { backend, session, initial, recorder, asked } = await asking();
		await backend.fake.loseBackend(session);
		const events = recorder.items.map((record) => record.event);
		expect(events).toContainEqual({
			type: "interaction_resolved",
			interactionId: asked.interaction.id,
			reason: "expired",
		});
		expect(events.at(-1)).toMatchObject({
			type: "run_finished",
			outcome: { kind: "error", error: { code: "backend_unavailable" } },
		});
		expect(streamViolations(recorder.items, FULL_TRAITS, initial)).toEqual([]);
		expect(unsettledParts(recorder.items, initial)).toEqual([]);
	});

	test("an ask another client answers is withdrawn, and the run goes on", async () => {
		const { backend, session, initial, recorder, asked } = await asking();
		backend.fake.answerElsewhere(session, asked.interaction.id);
		await recorder.waitFor((records) => records.find((record) => record.event.type === "run_finished"), "the end");
		const events = recorder.items.map((record) => record.event);
		expect(events).toContainEqual({
			type: "interaction_resolved",
			interactionId: asked.interaction.id,
			reason: "withdrawn",
		});
		expect(events.at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "completed" } });
		expect(streamViolations(recorder.items, FULL_TRAITS, initial)).toEqual([]);
	});
});
