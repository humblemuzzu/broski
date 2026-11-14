import { describe, expect, test } from "bun:test";
import type { InteractionRequestedEvent, SessionRef, SessionSnapshot } from "../contract";
import { CatalogRecorder, SessionRecorder } from "../contract/testing/conformance-harness";
import { createFakeBackend, type FakeBackend } from "../contract/testing/fake-backend";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import { sampleRequest } from "../contract/testing/fake-scenarios";
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

describe("the fake backend", () => {
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
