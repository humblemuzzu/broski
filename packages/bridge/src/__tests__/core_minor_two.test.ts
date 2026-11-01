/**
 * What protocol 1.2 added, as the core sends it: a session that goes on as itself with other capabilities
 * (`session_replaced` naming the same session), `input_returned` (an older client is sent a `notice` with the same
 * `seq` and texts), and the `take_over` op (an older client is not told it exists).
 */

import { describe, expect, test } from "bun:test";
import {
	type AgentBackend,
	MAX_TEXT_CHARS,
	type OpenSession,
	type SessionControl,
	type SessionRef,
	type SessionSink,
} from "../contract";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import { quiesce, RIG_CWD, startCoreRig, streamProblems } from "./helpers/core-rig";

const MINOR_ONE = { major: 1, minor: 1 } as const;
const MINOR_ZERO = { major: 1, minor: 0 } as const;

/** The fake, except that every session it opens has no control until `grant()`, as a watch-only session has. */
function watchOnlyUntilGranted(): {
	adapt: (backend: AgentBackend) => AgentBackend;
	grant: (session: SessionRef) => void;
} {
	const sinks = new Map<string, SessionSink>();
	const granted = new Set<string>();
	return {
		adapt: (backend) => ({
			...backend,
			open: async (target, sink) => {
				const result = await backend.open(target, sink);
				if (result.status === "rejected") return result;
				const inner = result.session;
				sinks.set(inner.session.sessionId, sink);
				const view: OpenSession = {
					get session() {
						return inner.session;
					},
					snapshot: () => inner.snapshot(),
					get control(): SessionControl | undefined {
						return granted.has(inner.session.sessionId) ? inner.control : undefined;
					},
					close: () => inner.close(),
				};
				return { ...result, session: view };
			},
		}),
		grant: (session) => {
			granted.add(session.sessionId);
			sinks.get(session.sessionId)?.emit({ at: 1, event: { type: "session_replaced", session } });
		},
	};
}

describe("a session that goes on as itself with other capabilities", () => {
	test("its viewers see the stream end, attach again and are given the new capabilities", async () => {
		const world = watchOnlyUntilGranted();
		const rig = await startCoreRig({ adapt: world.adapt });
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const phone = await rig.client("phone");
		const first = await phone.ok("session.attach", { session });
		expect(first.capabilities).toEqual({
			controllable: false,
			compact: false,
			cancelQueued: false,
			cancelCompaction: false,
			cancelRetry: false,
			answer: false,
		});
		if (first.sync.kind !== "snapshot") throw new Error("a fresh attach gets a snapshot");

		world.grant(session);
		await quiesce();
		expect(phone.events(session).map((event) => event.type)).toEqual(["session_replaced"]);
		expect(await phone.request("abort", { session })).toMatchObject({ error: { code: "not_attached" } });

		const second = await phone.ok("session.attach", { session });
		expect(second.capabilities).toEqual({
			controllable: true,
			compact: true,
			cancelQueued: true,
			cancelCompaction: true,
			cancelRetry: true,
			answer: true,
		});
		if (second.sync.kind !== "snapshot") throw new Error("the new stream starts with a snapshot");
		expect(second.sync.epoch).not.toBe(first.sync.epoch);
		expect(second.sync.lastSeq).toBe(0);
		expect([...phone.violations, ...rig.log.errors]).toEqual([]);
	});

	test("a phone that was away is told by its old epoch, and an older client attaches as ever", async () => {
		const world = watchOnlyUntilGranted();
		const rig = await startCoreRig({ adapt: world.adapt });
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const away = await rig.client("away");
		const held = await away.ok("session.attach", { session });
		if (held.sync.kind !== "snapshot") throw new Error("a fresh attach gets a snapshot");
		away.close();
		const stays = await rig.client("stays");
		await stays.ok("session.attach", { session });
		world.grant(session);
		await quiesce();

		const back = await rig.client("back");
		const told = await back.ok("session.attach", {
			session,
			resume: { epoch: held.sync.epoch, seq: held.sync.lastSeq },
		});
		expect(told.sync).toEqual({ kind: "replaced", epoch: held.sync.epoch, session });
		expect(told.capabilities.controllable).toBe(true);

		const older = await rig.client("older", MINOR_ZERO);
		const attached = await older.ok("session.attach", {
			session,
			resume: { epoch: held.sync.epoch, seq: held.sync.lastSeq },
		});
		expect(attached.sync.kind).toBe("snapshot");
		expect(attached.capabilities.controllable).toBe(true);
	});
});

describe("input handed back by a backend", () => {
	async function stoppedWithQueue(clientMinor: typeof MINOR_ONE | undefined, returned = ["Also lint", "Then commit"]) {
		const rig = await startCoreRig();
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, [
			{ kind: "text", text: "Working." },
			{ kind: "return_input", texts: returned },
		]);
		const phone = await rig.client("phone", clientMinor);
		await phone.ok("session.attach", { session });
		await phone.ok("prompt", {
			session,
			input: { clientRequestId: crypto.randomUUID(), mode: "start", text: "go", attachments: [], mentions: [] },
		});
		await quiesce();
		return { rig, session, phone };
	}

	test("a client of this minor is sent the event", async () => {
		const { rig, session, phone } = await stoppedWithQueue(undefined);
		expect(phone.events(session).find((event) => event.type === "input_returned")).toEqual({
			type: "input_returned",
			texts: ["Also lint", "Then commit"],
		});
		expect([...phone.violations, ...rig.log.errors]).toEqual([]);
	});

	test("an older client is sent a notice with the same texts at the same place in the stream", async () => {
		const modern = await stoppedWithQueue(undefined);
		const older = await stoppedWithQueue(MINOR_ONE);
		const seqOf = (client: typeof modern.phone, session: SessionRef) =>
			client
				.envelopes(session)
				.find((envelope) => envelope.event.type === "input_returned" || envelope.event.type === "notice")?.seq;
		expect(seqOf(older.phone, older.session)).toBe(seqOf(modern.phone, modern.session));
		const notice = older.phone.events(older.session).find((event) => event.type === "notice");
		expect(notice).toMatchObject({ level: "info" });
		expect(notice && "text" in notice ? notice.text : "").toContain("Also lint\n\nThen commit");
		expect(older.phone.events(older.session).some((event) => event.type === "input_returned")).toBe(false);
		expect([...older.phone.violations, ...older.rig.log.errors]).toEqual([]);
	});

	test("a notice too long for the contract is cut between characters, never inside one", async () => {
		const noticeText = async (returned: string[]) => {
			const { phone, session } = await stoppedWithQueue(MINOR_ONE, returned);
			const notice = phone.events(session).find((event) => event.type === "notice");
			return notice && "text" in notice ? notice.text : "";
		};
		const headingLength = (await noticeText(["x"])).length - 1;
		const padding = "a".repeat(MAX_TEXT_CHARS - headingLength - 1);
		const text = await noticeText([`${padding}😀 and more`]);
		expect(text.length).toBe(MAX_TEXT_CHARS - 1);
		expect(text.endsWith("a")).toBe(true);
	});

	test("an older client that reattaches by replay is sent the notice too, and its stream stays gapless", async () => {
		const { rig, session, phone } = await stoppedWithQueue(undefined);
		const held = await phone.ok("session.attach", { session });
		if (held.sync.kind !== "snapshot") throw new Error("a fresh attach gets a snapshot");
		const older = await rig.client("older", MINOR_ONE);
		const replayed = await older.ok("session.attach", { session, resume: { epoch: held.sync.epoch, seq: 0 } });
		expect(replayed.sync.kind).toBe("replay");
		const seqs = older.envelopes(session).map((envelope) => envelope.seq);
		expect(seqs).toEqual(seqs.map((_, index) => index + 1));
		expect(older.events(session).some((event) => event.type === "notice")).toBe(true);
		expect(older.events(session).some((event) => event.type === "input_returned")).toBe(false);
		expect(streamProblems(older, session, FULL_TRAITS, held.sync.snapshot)).toEqual([]);
	});
});

describe("an op a later minor added", () => {
	test("is listed only to a client that speaks that minor", async () => {
		const rig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				traits: { ...backend.traits, backendOps: [...backend.traits.backendOps, "take_over"] },
			}),
		});
		const listed = async (protocol?: typeof MINOR_ONE) =>
			(await (await rig.client("app", protocol)).ok("backends.list", {})).backends.flatMap(
				(backend) => backend.capabilities.backendOps,
			);
		expect(await listed()).toContain("take_over");
		expect(await listed(MINOR_ONE)).not.toContain("take_over");
		expect(await listed(MINOR_ONE)).toContain("navigate_tree");
	});
});
