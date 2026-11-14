/**
 * The bridge core end to end over the real broski-link path: a real bridge, its unix socket, its
 * connection layer and send queue, and phones speaking the contract.
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { PROTOCOL_VERSION } from "../contract";
import { validReply } from "../contract/testing/example-replies";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import { streamViolations, unsettledParts } from "../contract/testing/stream-rules";
import { E2E_TEST_TIMEOUT_MS, setupTestEnv } from "./e2e/harness";
import { removeRoot, startCoreBridge } from "./helpers/core-bridge";
import { promptInput } from "./helpers/core-rig";
import { connectPhone, type LinkContractClient } from "./helpers/link-contract-client";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const roots: string[] = [];

afterAll(() => {
	for (const root of roots) removeRoot(root);
	env.restore();
});

const HOLD = [
	{ kind: "text" as const, text: "Working on it." },
	{ kind: "hold" as const },
	{ kind: "text" as const, text: "Done." },
];

function errorsOf(phone: LinkContractClient): Array<[string | undefined, string]> {
	return phone
		.messages()
		.flatMap((message) => (message.type === "error" ? [[message.requestId, message.error.code]] : []));
}

describe("the core over the link", () => {
	test("hello is required and checked, and broken frames and frames that are not contract frames are refused", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const phone = await connectPhone(rig.socketPath, "phone");
			await phone.request("backends.list", {});
			await phone.request("hello", {
				protocol: { major: PROTOCOL_VERSION.major + 1, minor: 0 },
				client: { name: "old", version: "0" },
			});
			await phone.hello();
			expect((await phone.ok("backends.list", {})).backends.map((backend) => backend.id)).toEqual(["pi"]);
			phone.sendRaw({ type: "no.such.request", requestId: "bad-1" });
			phone.socket.send({ type: "contract" });
			phone.socket.send({ type: "abort", sessionId: "not-a-contract-frame", requestId: "old-1" });
			await phone.waitForMessage(
				() => errorsOf(phone).filter(([requestId]) => requestId === undefined).length === 2,
				"the refusals of both frames",
			);
			expect(errorsOf(phone)).toEqual([
				["phone-0", "invalid_message"],
				["phone-1", "unsupported_version"],
				["bad-1", "invalid_message"],
				[undefined, "invalid_message"],
				[undefined, "invalid_message"],
			]);
			expect(phone.foreignFrames()).toEqual([]);
		} finally {
			await rig.stop();
		}
	});

	test("two phones: catalog news, listing, one shared stream, steer and queue", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const a = await rig.phone("a");
			const b = await rig.phone("b");
			const session = rig.fake.fake.seed({ cwd: rig.cwd, title: "Shared" });
			for (const phone of [a, b]) {
				await phone.waitForMessage((message) => message.type === "catalog", "catalog news");
				const news = phone.messages().filter((message) => message.type === "catalog");
				expect(news).toEqual([
					{ type: "catalog", backend: "pi", event: expect.objectContaining({ type: "session_updated" }) },
				]);
			}
			const listed = await a.ok("sessions.list", {
				backend: "pi",
				query: { archived: false, cwd: rig.cwd },
				page: { limit: 10 },
			});
			expect(listed.result.status === "accepted" && listed.result.page.items.map((row) => row.session)).toEqual([
				session,
			]);

			rig.fake.fake.script(session, HOLD);
			const attachedA = await a.ok("session.attach", { session });
			await b.ok("session.attach", { session });
			if (attachedA.sync.kind !== "snapshot") throw new Error("expected a snapshot");
			expect((await a.ok("prompt", { session, input: promptInput("Start") })).result).toMatchObject({
				disposition: "started",
			});
			await b.waitForEvent(session, (envelope) => envelope.event.type === "block_finished", "the first block");
			expect((await a.ok("prompt", { session, input: promptInput("Steer", "steer") })).result).toMatchObject({
				disposition: "steered",
			});
			expect((await b.ok("prompt", { session, input: promptInput("Queue", "queue") })).result).toMatchObject({
				disposition: "queued",
			});
			expect((await b.ok("prompt", { session, input: promptInput("Start again") })).result).toMatchObject({
				rejection: { code: "busy" },
			});
			rig.fake.fake.release(session);
			const triggers = async (phone: LinkContractClient) => {
				await phone.waitForEvent(
					session,
					(envelope) => envelope.event.type === "run_started" && envelope.event.trigger === "queue",
					"the queued run",
				);
				return phone.waitForEvent(
					session,
					(envelope) =>
						envelope.event.type === "run_finished" &&
						phone.envelopes(session).filter((item) => item.event.type === "run_finished").length === 2,
					"both runs finished",
				);
			};
			await Promise.all([triggers(a), triggers(b)]);
			expect(b.envelopes(session)).toEqual(a.envelopes(session));
			const records = a.envelopes(session).map(({ at, event }) => ({ at, event }));
			expect([
				...streamViolations(records, FULL_TRAITS, attachedA.sync.snapshot),
				...unsettledParts(records, attachedA.sync.snapshot),
			]).toEqual([]);
			expect(a.envelopes(session).map((envelope) => envelope.seq)).toEqual(
				a.envelopes(session).map((_, index) => index + 1),
			);
		} finally {
			await rig.stop();
		}
	});

	test("an ask answered on one phone is resolved on the other, whose own answer is then stale", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const a = await rig.phone("a");
			const b = await rig.phone("b");
			const session = rig.fake.fake.seed({ cwd: rig.cwd });
			rig.fake.fake.script(session, [
				{ kind: "tool", name: "write", input: { path: "notes.md" }, output: "written", permission: true },
				{ kind: "text", text: "Wrote it." },
			]);
			await a.ok("session.attach", { session });
			await b.ok("session.attach", { session });
			await a.ok("prompt", { session, input: promptInput("Write the notes") });
			const asked = await b.waitForEvent(
				session,
				(envelope) => envelope.event.type === "interaction_requested",
				"the ask",
			);
			if (asked.event.type !== "interaction_requested") throw new Error("not an ask");
			const interaction = asked.event.interaction;
			const wrong = await b.ok("interaction.answer", {
				session,
				answer: { interactionId: interaction.id, reply: { kind: "confirm", confirmed: true } },
			});
			expect(wrong.result).toMatchObject({ rejection: { code: "invalid_input" } });
			const answer = { interactionId: interaction.id, reply: validReply(interaction) };
			expect((await a.ok("interaction.answer", { session, answer })).result).toEqual({ status: "accepted" });
			await b.waitForEvent(
				session,
				(envelope) => envelope.event.type === "interaction_resolved" && envelope.event.reason === "answered",
				"the resolution",
			);
			expect((await b.ok("interaction.answer", { session, answer })).result).toMatchObject({
				rejection: { code: "stale" },
			});
			await b.waitForEvent(session, (envelope) => envelope.event.type === "run_finished", "the end of the run");
		} finally {
			await rig.stop();
		}
	});

	test("a session the backend does not have is unknown_session, and controlling one not attached is not_attached", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const a = await rig.phone("a");
			const missing = { backend: "pi" as const, sessionId: "no-such-session" };
			expect(await a.request("session.attach", { session: missing })).toMatchObject({
				error: { code: "unknown_session" },
			});
			const session = rig.fake.fake.seed({ cwd: rig.cwd });
			expect(await a.request("prompt", { session, input: promptInput("x") })).toMatchObject({
				error: { code: "not_attached" },
			});
			expect(a.foreignFrames()).toEqual([]);
		} finally {
			await rig.stop();
		}
	});
});
