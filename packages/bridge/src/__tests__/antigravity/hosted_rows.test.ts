/**
 * A hosted session's row in the listing of the production backend, every `agy` it starts answering as
 * `answering-agy.ts` says: the short job with agy's recorded listing (`listing`), the front with ACP's documented
 * `session/new` answer, naming either the oldest session that listing has (agy lists a session once it stored its first
 * prompt) or one it does not, and, for the turn, the `plain-turn` recording's answer. The test's clock starts the chat
 * just before agy's stored time of it and ends the turn after every time agy listed. A restart is a second backend on
 * the first one's journal.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListSessionsResult } from "../../backends/antigravity/acp/frames";
import { antigravityBackendOf } from "../../backends/antigravity/backend";
import type { AgentBackend, CatalogEvent, SessionRef, SessionSummary } from "../../contract";
import { allPages } from "../../contract/testing/conformance-reads";
import { fileLock } from "../../platform/file-lock";
import { fitImageBase64 } from "../../platform/image-fit";
import { journalsIn } from "../../server/json-lines-journal";
import { ManualClock, promptInput } from "../helpers/core-rig";
import { type Answer, AnsweringAgy, recordedFrontInitialize, recordedListing } from "./answering-agy";
import { answerTo } from "./replay/recorded";
import { frontOf, jobOf, recording } from "./replay/recordings";

let root: string | undefined;

afterEach(() => {
	if (root !== undefined) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

const PLAIN_TURN = frontOf(recording("plain-turn"));
const LISTED = ListSessionsResult.parse(answerTo(jobOf(recording("listing")), "session/list")).sessions;
const TIMES = LISTED.map((row) => Date.parse(row.updatedAt ?? ""));
const PROMPT = "Fix the login redirect and explain what was wrong";
/** protocol/v1/session-setup, "Creating a session" */
const DOCUMENTED_NEW_SESSION = { result: { sessionId: "sess_abc123def456" } };

function folders() {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-agy-rows-")));
	const cwd = join(root, "project");
	mkdirSync(cwd);
	return { root, cwd };
}

/** A backend on `root`'s journal whose front makes the session `made` names. */
function bridge(root: string, cwd: string, made: Answer) {
	const agy = new AnsweringAgy(
		{ initialize: [recordedFrontInitialize()], "session/new": [made] },
		recordedListing(cwd),
	);
	const clock = new ManualClock();
	const catalog: CatalogEvent[] = [];
	const faults: string[] = [];
	const backend = antigravityBackendOf(
		{
			install: {
				cli: { found: false, reason: "every agy here answers from recordings" },
				env: {},
				voidDir: join(root, "void"),
				presenceDir: join(root, "presence"),
			},
			bridgeVersion: "0.0.0-test",
			fileLock,
			fitImage: fitImageBase64,
			journal: journalsIn(join(root, "antigravity"), (message) => faults.push(message)),
			launch: agy.launch,
			log: (message) => faults.push(message),
			clock,
		},
		{ catalog: { emit: (event) => catalog.push(event) } },
	);
	/** A new chat in `cwd` whose first turn, `text`, has started. */
	const prompted = async (text: string) => {
		const opened = await backend.open({ kind: "new", options: { cwd } }, { emit: () => undefined });
		if (opened.status === "rejected") throw new Error(`the open was refused: ${opened.rejection.message}`);
		const started = await opened.session.control?.prompt(promptInput(text));
		expect(started).toEqual({ status: "accepted", disposition: "started" });
		return opened.session.session;
	};
	const turnEnds = async () => {
		agy.answerLate("session/prompt", { result: answerTo(PLAIN_TURN, "session/prompt") });
		await Bun.sleep(5);
	};
	const announced = (ref: SessionRef) =>
		catalog.flatMap((event): SessionSummary[] =>
			event.type === "session_updated" && event.summary.session.sessionId === ref.sessionId ? [event.summary] : [],
		);
	return { backend, clock, faults, prompted, turnEnds, announced };
}

async function rowOf(backend: AgentBackend, cwd: string, ref: SessionRef): Promise<SessionSummary> {
	const listed = await backend.listSessions({ cwd }, { limit: 200 });
	if (listed.status === "rejected") throw new Error(listed.rejection.message);
	const row = listed.page.items.find((item) => item.session.sessionId === ref.sessionId);
	if (row === undefined) throw new Error(`${ref.sessionId} is not listed`);
	return row;
}

test("a hosted session whose turn ended after agy's stored time is listed, paged, read and announced by one time", async () => {
	const { root, cwd } = folders();
	const oldest = LISTED[TIMES.indexOf(Math.min(...TIMES))];
	if (oldest === undefined) throw new Error("agy's recorded listing holds no session");
	const { backend, clock, faults, prompted, turnEnds, announced } = bridge(root, cwd, {
		result: { sessionId: oldest.sessionId },
	});
	try {
		clock.advance(Date.parse(oldest.updatedAt ?? "") - 1_000 - clock.now());
		const ref = await prompted("Reply with exactly: ok");
		clock.advance(Math.max(...TIMES) + 60_000 - clock.now());
		await turnEnds();

		const paged = await allPages(backend, { cwd }, 2);
		const times = paged.map((row) => row.updatedAt);
		expect(times).toEqual(times.toSorted((a, b) => b - a));
		const whole = await backend.listSessions({ cwd }, { limit: 200 });
		if (whole.status === "rejected") throw new Error(whole.rejection.message);
		expect(paged).toEqual(whole.page.items);
		expect(paged).toHaveLength(LISTED.length);

		const [first] = paged;
		if (first === undefined) throw new Error("nothing listed");
		expect(first).toMatchObject({ session: ref, updatedAt: clock.now(), status: "idle", origin: "broski" });
		expect(await backend.getSession(ref)).toEqual({ status: "accepted", summary: first });
		expect(announced(ref).at(-1)).toEqual(first);
		expect(faults).toEqual([]);
	} finally {
		await backend.dispose();
	}
});

test("a hosted new chat agy has not titled stands under its first prompt, as it does once the bridge restarts", async () => {
	const { root, cwd } = folders();
	const title = { text: PROMPT, source: "first_prompt" };
	const before = bridge(root, cwd, DOCUMENTED_NEW_SESSION);
	let ref: SessionRef;
	try {
		ref = await before.prompted(PROMPT);
		const running = await before.backend.getSession(ref);
		expect(running).toMatchObject({ status: "accepted", summary: { title, status: "running" } });
		if (running.status === "accepted") expect(before.announced(ref).at(-1)).toEqual(running.summary);
		await before.turnEnds();
		const ended = await rowOf(before.backend, cwd, ref);
		expect(ended).toMatchObject({ title, status: "idle" });
		expect(await before.backend.getSession(ref)).toEqual({ status: "accepted", summary: ended });
		expect(before.announced(ref).at(-1)).toEqual(ended);
		expect(before.faults).toEqual([]);
	} finally {
		await before.backend.dispose();
	}
	const after = bridge(root, cwd, DOCUMENTED_NEW_SESSION);
	try {
		expect(await rowOf(after.backend, cwd, ref)).toMatchObject({ title, status: "idle", origin: "broski" });
		expect(after.faults).toEqual([]);
	} finally {
		await after.backend.dispose();
	}
});
