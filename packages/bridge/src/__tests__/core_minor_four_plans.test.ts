/**
 * A plan approval's next mode (protocol 1.4), as the core serves it: a client of this minor is offered the modes and
 * may answer with one; a client of an older minor sees the plan without them, in events, snapshots and resyncs alike,
 * and may not answer with one.
 */

import { describe, expect, test } from "bun:test";
import {
	type AgentEvent,
	type EventEnvelope,
	emptySnapshot,
	type Interaction,
	type InteractionRequest,
	PROTOCOL_VERSION,
	type ProtocolVersion,
	type SessionRef,
} from "../contract";
import { CoreClient } from "../core/client";
import { withOlderView } from "../core/older-events";
import { fitEvent } from "../core/wire-fit";
import { quiesce, RecordingLog, RIG_CWD, startCoreRig } from "./helpers/core-rig";

const MINOR_THREE = { major: 1, minor: 3 } as const;
const MINOR_ONE = { major: 1, minor: 1 } as const;

const modes = {
	axis: "permissions",
	options: [
		{ value: "ask", label: "Ask first" },
		{ value: "edits", label: "Accept edits" },
	],
	defaultValue: "ask",
};
const offering: InteractionRequest = { kind: "plan_approval", plan: "1. Do it", editable: true, modeOptions: modes };
const { modeOptions: _modes, ...withoutModes } = offering;

async function asked(protocol?: ProtocolVersion) {
	const rig = await startCoreRig();
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	rig.fake.fake.script(session, [{ kind: "ask", title: "Approve the plan", request: offering }]);
	const phone = await rig.client("phone", protocol);
	await phone.ok("session.attach", { session });
	await phone.ok("prompt", {
		session,
		input: { clientRequestId: crypto.randomUUID(), mode: "start", text: "go", attachments: [], mentions: [] },
	});
	await quiesce();
	const requested = phone.events(session).find((event) => event.type === "interaction_requested");
	if (requested?.type !== "interaction_requested") throw new Error("no ask arrived");
	return { rig, session, phone, interaction: requested.interaction };
}

describe("a plan approval that offers the modes to go on in", () => {
	test("reaches a client of this minor with the modes, and its answer may name one", async () => {
		const { rig, session, phone, interaction } = await asked();
		expect(interaction.request).toEqual(offering);
		const reply = { kind: "plan_approval", decision: "approve", modeAfter: "edits" } as const;
		const answer = await phone.ok("interaction.answer", { session, answer: { interactionId: interaction.id, reply } });
		expect(answer.result.status).toBe("accepted");
		expect([...phone.violations, ...rig.log.errors]).toEqual([]);
	});

	test("refuses, for a client of this minor, a mode the plan did not offer", async () => {
		const { session, phone, interaction } = await asked();
		const reply = { kind: "plan_approval", decision: "approve", modeAfter: "all" } as const;
		const answer = await phone.ok("interaction.answer", { session, answer: { interactionId: interaction.id, reply } });
		expect(answer.result.status === "rejected" && answer.result.rejection).toEqual({
			code: "invalid_input",
			message: "not one of the modes offered",
		});
	});

	test("reaches an older client without the modes, at the same place in the stream", async () => {
		const modern = await asked();
		const older = await asked(MINOR_THREE);
		expect(older.interaction.request).toEqual(withoutModes);
		const seqOf = (client: typeof modern.phone, session: SessionRef) =>
			client.envelopes(session).find((envelope) => envelope.event.type === "interaction_requested")?.seq;
		expect(seqOf(older.phone, older.session)).toBe(seqOf(modern.phone, modern.session));
		expect([...older.phone.violations, ...older.rig.log.errors]).toEqual([]);
	});

	test("is in an older client's attach snapshot and resync without the modes", async () => {
		const { rig, session } = await asked();
		const older = await rig.client("older", MINOR_THREE);
		const attached = await older.ok("session.attach", { session });
		const snapshot = attached.sync.kind === "snapshot" ? attached.sync.snapshot : undefined;
		expect(snapshot?.interactions.map((pending) => pending.request)).toEqual([withoutModes]);

		const modern = await rig.client("modern");
		await modern.ok("session.attach", { session });
		rig.fake.fake.resync(session);
		await quiesce();
		const resynced = (events: AgentEvent[]) => {
			const found = events.find((event) => event.type === "resynced");
			return found?.type === "resynced" ? found.snapshot.interactions.map((pending) => pending.request) : [];
		};
		expect(resynced(older.events(session))).toEqual([withoutModes]);
		expect(resynced(modern.events(session))).toEqual([offering]);
		expect(older.violations).toEqual([]);
	});

	test("may not be answered with a mode by an older client", async () => {
		const { session, phone, interaction } = await asked(MINOR_THREE);
		const reply = { kind: "plan_approval", decision: "approve", modeAfter: "edits" } as const;
		const answer = await phone.ok("interaction.answer", { session, answer: { interactionId: interaction.id, reply } });
		expect(answer.result.status === "rejected" && answer.result.rejection.code).toBe("invalid_input");
		const plain = await phone.ok("interaction.answer", {
			session,
			answer: { interactionId: interaction.id, reply: { kind: "plan_approval", decision: "approve" } },
		});
		expect(plain.result.status).toBe("accepted");
	});
});

describe("an event that has a stand-in for two older minors", () => {
	test("reaches each client as the newest stand-in its minor speaks", () => {
		const maxBytes = 64 * 1024;
		const log = new RecordingLog();
		const plan: Interaction = {
			id: "plan",
			runId: "run",
			createdAt: 1,
			title: "Approve",
			blocksRun: true,
			request: offering,
		};
		const after = { ...emptySnapshot(), interactions: [plan] };
		const texts = Array.from({ length: 100 }, () => "é".repeat(2_000));
		const envelope: EventEnvelope = {
			session: { backend: "pi", sessionId: "s" },
			seq: 7,
			at: 1,
			event: { type: "input_returned", texts },
		};
		const frame = withOlderView(fitEvent(envelope, after, maxBytes, log), envelope, after, maxBytes, log);
		const received = (protocol: ProtocolVersion) => {
			const sent: string[] = [];
			const client = new CoreClient({ send: (text) => sent.push(text) }, log);
			client.hello(protocol, PROTOCOL_VERSION);
			client.send(frame);
			return JSON.parse(sent[0] ?? "{}").message.envelope.event;
		};
		const current = received(PROTOCOL_VERSION);
		expect(current.type).toBe("resynced");
		expect(current.snapshot.interactions[0].request).toEqual(offering);
		const three = received(MINOR_THREE);
		expect(three.type).toBe("resynced");
		expect(three.snapshot.interactions[0].request).toEqual(withoutModes);
		expect(received(MINOR_ONE).type).toBe("notice");
	});
});
