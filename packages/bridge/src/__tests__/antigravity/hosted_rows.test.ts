/**
 * A hosted session's row in the listing of the production backend, every `agy` it starts answering as
 * `answering-agy.ts` says: the short job with agy's recorded listing (`listing`), the front with ACP's documented
 * `session/new` answer naming the oldest session that listing has (agy lists a session once it stored its first prompt)
 * and, for the turn, the `plain-turn` recording's answer. The test's clock starts the chat just before agy's stored
 * time of it and ends the turn after every time agy listed.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListSessionsResult } from "../../backends/antigravity/acp/frames";
import { antigravityBackendOf } from "../../backends/antigravity/backend";
import type { CatalogEvent, SessionSummary } from "../../contract";
import { allPages } from "../../contract/testing/conformance-reads";
import { fileLock } from "../../platform/file-lock";
import { fitImageBase64 } from "../../platform/image-fit";
import { journalsIn } from "../../server/json-lines-journal";
import { ManualClock, promptInput } from "../helpers/core-rig";
import { AnsweringAgy, recordedFrontInitialize, recordedListing } from "./answering-agy";
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

test("a hosted session whose turn ended after agy's stored time is listed, paged, read and announced by one time", async () => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-agy-rows-")));
	const cwd = join(root, "project");
	mkdirSync(cwd);
	const oldest = LISTED[TIMES.indexOf(Math.min(...TIMES))];
	if (oldest === undefined) throw new Error("agy's recorded listing holds no session");
	const agy = new AnsweringAgy(
		{
			initialize: [recordedFrontInitialize()],
			"session/new": [{ result: { sessionId: oldest.sessionId } }],
		},
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
	try {
		clock.advance(Date.parse(oldest.updatedAt ?? "") - 1_000 - clock.now());
		const opened = await backend.open({ kind: "new", options: { cwd } }, { emit: () => undefined });
		if (opened.status === "rejected") throw new Error(`the open was refused: ${opened.rejection.message}`);
		const ref = opened.session.session;
		expect(await opened.session.control?.prompt(promptInput("Reply with exactly: ok"))).toEqual({
			status: "accepted",
			disposition: "started",
		});
		clock.advance(Math.max(...TIMES) + 60_000 - clock.now());
		agy.answerLate("session/prompt", { result: answerTo(PLAIN_TURN, "session/prompt") });
		await Bun.sleep(5);

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
		const announced = catalog.flatMap((event): SessionSummary[] =>
			event.type === "session_updated" && event.summary.session.sessionId === ref.sessionId ? [event.summary] : [],
		);
		expect(announced.at(-1)).toEqual(first);
		expect(faults).toEqual([]);
	} finally {
		await backend.dispose();
	}
});
