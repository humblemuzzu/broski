import {
	AgentEvent,
	type InteractionRequestedEvent,
	type ServerMessage,
	ServerMessage as ServerMessageSchema,
	sessionCapabilities,
} from "../../src/contract";
import { CatalogRecorder, SessionRecorder } from "../../src/contract/testing/conformance-harness";
import { validReply } from "../../src/contract/testing/example-replies";
import { createFakeBackend } from "../../src/contract/testing/fake-backend";
import { sampleRequest } from "../../src/contract/testing/fake-scenarios";

const EPOCH = "fixture-epoch";

/**
 * A scripted fake session as the app receives it: attach, prompts, every kind of live event, answers,
 * steer, queue and catalog rows. Ids and times are counters, so the output never changes by itself.
 */
export async function fakeSessionStream(): Promise<ServerMessage[]> {
	let tick = 1_800_000_000_000;
	let id = 0;
	const catalog = new CatalogRecorder(1_000);
	const backend = createFakeBackend({ catalog }, { id: "pi", now: () => tick++, newId: () => `id-${++id}` });
	const recorder = new SessionRecorder(1_000);
	const opened = await backend.open({ kind: "new", options: { cwd: "/fixture", modelId: "fake-large" } }, recorder);
	if (opened.status === "rejected") throw new Error(opened.rejection.message);
	const { session, snapshot } = opened;
	const first = session.session;
	const control = session.control;
	if (!control) throw new Error("the fixture session must be controllable");
	const messages: ServerMessage[] = [
		{
			type: "session.attach.result",
			requestId: "attach-1",
			capabilities: sessionCapabilities(session),
			sync: { kind: "snapshot", epoch: EPOCH, lastSeq: 0, snapshot },
		},
	];

	backend.fake.script(session.session, [
		{ kind: "thinking", text: "Reading the task." },
		{ kind: "text", text: "Starting." },
		{
			kind: "tool",
			name: "edit",
			input: { path: "a.ts" },
			output: "edited",
			streamInput: true,
			permission: true,
			child: true,
			fileChanges: [{ path: "a.ts", change: "modified", diff: "@@ -1 +1 @@\n-a\n+b", additions: 1, deletions: 1 }],
			nested: [{ kind: "tool", name: "read", input: { path: "a.ts" }, output: "a" }],
		},
		{ kind: "ask", title: "Pick a library", request: sampleRequest("questions") },
		{
			kind: "plan",
			plan: {
				items: [
					{ text: "Edit a.ts", status: "completed" },
					{ text: "Test", status: "in_progress" },
				],
			},
		},
		{ kind: "usage", usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 900, costUsd: 0.0125 } },
		{ kind: "retry", attempts: 1 },
		{ kind: "compaction" },
		{ kind: "extension", extension: { kind: "turn_diff", diff: "diff --git a/a.ts b/a.ts" } },
		{ kind: "notice", level: "warning", text: "Close to the context limit." },
		{ kind: "backend_error", error: { code: "network", message: "The stream dropped." }, retryable: true },
		{ kind: "retract" },
		{ kind: "return_input", texts: ["Also lint", "Then commit"] },
		{ kind: "plan_proposal", text: "1. Test\n2. Ship" },
		{ kind: "replace_session" },
		{ kind: "text", text: "Finished." },
	]);
	await control.prompt({
		clientRequestId: uuid(1),
		mode: "start",
		text: "Fix a.ts",
		attachments: [
			{ kind: "image", mimeType: "image/png", data: "iVBORw0KGgo=", name: "shot.png" },
			{ kind: "file", uri: "/fixture/a.ts" },
		],
		mentions: [{ kind: "file", path: "/fixture/a.ts" }],
	});
	for (const kind of ["tool_permission", "questions"]) {
		const requested = await recorder.waitFor(
			(records) =>
				records
					.map((record) => record.event)
					.find(
						(event: AgentEvent): event is InteractionRequestedEvent =>
							event.type === "interaction_requested" && event.interaction.request.kind === kind,
					),
			kind,
		);
		await control.answer({ interactionId: requested.interaction.id, reply: validReply(requested.interaction) });
	}
	await recorder.waitFor((records) => records.find((record) => record.event.type === "run_finished"), "run_finished");

	backend.fake.script(session.session, [
		{ kind: "text", text: "Working." },
		{ kind: "hold" },
		{ kind: "text", text: "Done." },
	]);
	await control.prompt({ clientRequestId: uuid(2), mode: "start", text: "Keep going", attachments: [], mentions: [] });
	await control.prompt({ clientRequestId: uuid(3), mode: "steer", text: "Also lint", attachments: [], mentions: [] });
	await control.prompt({ clientRequestId: uuid(4), mode: "queue", text: "Then commit", attachments: [], mentions: [] });
	backend.fake.release(session.session);
	await recorder.waitFor(
		(records) => (records.filter((record) => record.event.type === "run_finished").length === 3 ? true : undefined),
		"three runs",
	);
	await control.setThinking("high");
	await control.setMode("agent", "plan");
	backend.fake.resync(session.session);
	await backend.dispose();

	const missing = AgentEvent.options
		.map((option) => option.shape.type.value)
		.filter((type) => !recorder.items.some((record) => record.event.type === type));
	if (missing.length > 0) throw new Error(`the fixture session never emits ${missing.join(", ")}`);

	let current = first;
	recorder.items.forEach((record, index) => {
		messages.push({ type: "event", envelope: { session: current, seq: index + 1, ...record } });
		if (record.event.type === "session_replaced") current = record.event.session;
	});
	for (const event of catalog.items) messages.push({ type: "catalog", backend: "pi", event });
	for (const message of messages) ServerMessageSchema.parse(message);
	return messages;
}

function uuid(n: number): string {
	return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
