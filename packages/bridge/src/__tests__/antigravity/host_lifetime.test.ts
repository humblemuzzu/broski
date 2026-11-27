/**
 * How long a session stays hosted once no view has it, on the production backend with the test's own clock, every
 * `agy` it starts answering as `answering-agy.ts` says: the first session is ACP's documented `session/new` answer, the
 * second the one agy gave in the `plain-turn` recording, a turn ends with agy's answer of that recording, and agy's
 * `session/close` answer is the one of the `load-replay` recording. The terminal is another real process taking agy's
 * presence lock (`lock-holder.ts`).
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityBackendOf } from "../../backends/antigravity/backend";
import { PresenceLocks } from "../../backends/antigravity/live/lock";
import { UNVIEWED_GRACE_MS } from "../../backends/antigravity/live/unviewed";
import type { AgentBackend, OpenSession } from "../../contract";
import { fileLock } from "../../platform/file-lock";
import { fitImageBase64 } from "../../platform/image-fit";
import { journalsIn } from "../../server/json-lines-journal";
import { ManualClock, promptInput } from "../helpers/core-rig";
import { AnsweringAgy, recordedFrontInitialize } from "./answering-agy";
import { lockHolder } from "./lock-holder";
import { answerTo } from "./replay/recorded";
import { frontOf, jobOf, recording } from "./replay/recordings";

let root: string | undefined;

afterEach(() => {
	if (root !== undefined) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

/** protocol/v1/session-setup, "Creating a session" */
const DOCUMENTED_NEW_SESSION = { result: { sessionId: "sess_abc123def456" } };
const PLAIN_TURN = frontOf(recording("plain-turn"));
const CLOSED = { result: answerTo(jobOf(recording("load-replay")), "session/close") };
const SINK = { emit: () => undefined };

interface Rig {
	readonly backend: AgentBackend;
	readonly agy: AnsweringAgy;
	readonly clock: ManualClock;
	readonly locks: PresenceLocks;
	readonly presenceDir: string;
	readonly faults: string[];
	openNew(): Promise<OpenSession>;
}

function rig(maxSessions?: number): Rig {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-agy-hosts-")));
	const cwd = join(root, "project");
	const presenceDir = join(root, "presence");
	mkdirSync(cwd);
	const agy = new AnsweringAgy(
		{
			initialize: [recordedFrontInitialize()],
			"session/new": [DOCUMENTED_NEW_SESSION, { result: answerTo(PLAIN_TURN, "session/new") }],
			"session/close": [CLOSED, CLOSED],
		},
		{},
	);
	const clock = new ManualClock();
	const faults: string[] = [];
	const backend = antigravityBackendOf(
		{
			install: {
				cli: { found: false, reason: "every agy here answers from recordings" },
				env: {},
				voidDir: join(root, "void"),
				presenceDir,
			},
			bridgeVersion: "0.0.0-test",
			fileLock,
			fitImage: fitImageBase64,
			journal: journalsIn(join(root, "antigravity"), (message) => faults.push(message)),
			launch: agy.launch,
			...(maxSessions !== undefined && { maxSessions }),
			log: (message) => faults.push(message),
			clock,
		},
		{ catalog: { emit: () => undefined } },
	);
	const openNew = async () => {
		const opened = await backend.open({ kind: "new", options: { cwd } }, SINK);
		if (opened.status === "rejected") throw new Error(`the open was refused: ${opened.rejection.message}`);
		return opened.session;
	};
	return { backend, agy, clock, locks: new PresenceLocks(presenceDir, fileLock), presenceDir, faults, openNew };
}

/** What the fake agy answers reaches the bridge on a later turn of the event loop. */
const answered = () => Bun.sleep(5);

test("a session whose view closed stays hosted through the grace, and a view back in it finds it with no reload", async () => {
	const { backend, agy, clock, locks, faults, openNew } = rig();
	try {
		const first = await openNew();
		const ref = first.session;
		await first.close();
		clock.advance(UNVIEWED_GRACE_MS - 1);
		await answered();
		expect(agy.sent(true)).toEqual(["session/new"]);
		expect(locks.heldElsewhere(ref.sessionId)).toBe(true);

		const again = await backend.open({ kind: "existing", session: ref }, SINK);
		if (again.status === "rejected") throw new Error(again.rejection.message);
		expect(again.session.session).toEqual(ref);
		clock.advance(UNVIEWED_GRACE_MS * 2);
		await answered();
		expect(agy.sent(true)).toEqual(["session/new"]);

		await again.session.close();
		clock.advance(UNVIEWED_GRACE_MS - 1);
		await answered();
		expect(agy.sent(true)).toEqual(["session/new"]);
		expect(locks.heldElsewhere(ref.sessionId)).toBe(true);
		expect(faults).toEqual([]);
	} finally {
		await backend.dispose();
	}
});

test("an idle session no view has had for the grace is closed, and its lock is a terminal's to take", async () => {
	const { backend, agy, clock, presenceDir, faults, openNew } = rig();
	try {
		const first = await openNew();
		const { sessionId } = first.session;
		await first.close();
		clock.advance(UNVIEWED_GRACE_MS);
		await answered();
		expect(agy.sent(true)).toEqual(["session/new", "session/close"]);
		expect(agy.written.find((record) => record.method === "session/close")?.params).toEqual({ sessionId });
		expect(clock.pending()).toBe(0);

		const terminal = await lockHolder(join(presenceDir, `${sessionId}.lock`));
		expect(terminal.first).toBe("held");
		await terminal.quit();
		expect(faults).toEqual([]);
	} finally {
		await backend.dispose();
	}
});

test("a session with a turn under way is not closed however long no view has it, and is once the turn has ended", async () => {
	const { backend, agy, clock, locks, faults, openNew } = rig();
	try {
		const first = await openNew();
		const { sessionId } = first.session;
		const prompted = await first.control?.prompt(promptInput("Reply with exactly: ok"));
		expect(prompted).toEqual({ status: "accepted", disposition: "started" });
		await first.close();
		clock.advance(UNVIEWED_GRACE_MS * 4);
		await answered();
		expect(agy.sent(true)).toEqual(["session/new", "session/prompt"]);
		expect(locks.heldElsewhere(sessionId)).toBe(true);

		agy.answerLate("session/prompt", { result: answerTo(PLAIN_TURN, "session/prompt") });
		await answered();
		expect(agy.sent(true)).toEqual(["session/new", "session/prompt"]);
		clock.advance(UNVIEWED_GRACE_MS);
		await answered();
		expect(agy.sent(true)).toEqual(["session/new", "session/prompt", "session/close"]);
		expect(locks.heldElsewhere(sessionId)).toBe(false);
		expect(faults).toEqual([]);
	} finally {
		await backend.dispose();
	}
});

test("the bound closes a session no view has before its grace ends, to make room for another", async () => {
	const { backend, agy, clock, locks, faults, openNew } = rig(1);
	try {
		const first = await openNew();
		const { sessionId } = first.session;
		await first.close();

		const second = await openNew();
		expect(agy.sent(true)).toEqual(["session/new", "session/close", "session/new"]);
		expect(agy.written.find((record) => record.method === "session/close")?.params).toEqual({ sessionId });
		expect(locks.heldElsewhere(sessionId)).toBe(false);
		expect(clock.pending()).toBe(0);

		const prompted = await second.control?.prompt(promptInput("Reply with exactly: ok"));
		expect(prompted).toEqual({ status: "accepted", disposition: "started" });
		expect(agy.sent(true).at(-1)).toBe("session/prompt");
		expect(faults).toEqual([]);
	} finally {
		await backend.dispose();
	}
});

test("disposing the backend ends the grace of every session no view has", async () => {
	const { backend, agy, clock, openNew } = rig();
	const first = await openNew();
	await first.close();
	expect(clock.pending()).toBe(1);
	await backend.dispose();
	expect(clock.pending()).toBe(0);
	clock.advance(UNVIEWED_GRACE_MS);
	await answered();
	expect(agy.sent(true)).toEqual(["session/new"]);
});
