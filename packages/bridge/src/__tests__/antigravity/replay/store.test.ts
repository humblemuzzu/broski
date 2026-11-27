/**
 * agy's recorded short jobs played to the bridge's own reading jobs: the listing (`store/sessions.ts` `listAll`, then
 * `store/list.ts`) and a session's history from its `session/load` replay (`store/transcript.ts`, then
 * `store/transcript-items.ts`). The recording's workspace stands on a real folder here, so its rows' paths resolve as
 * they did on the recording's Mac. agy's rows there carried the folder plainly: no row is percent-encoded and none
 * reports the void folder, which `list.test.ts` covers on rows built for it. The rows and the replay are held to what
 * agy wrote in the recording (`recorded.ts`), so the tests pass on any recording of the scenarios.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { InitializeResult } from "../../../backends/antigravity/acp/frames";
import { type ListedSession, sessionsPage } from "../../../backends/antigravity/store/list";
import { MadeSessions } from "../../../backends/antigravity/store/made";
import { listAll } from "../../../backends/antigravity/store/sessions";
import { replayedTranscript } from "../../../backends/antigravity/store/transcript";
import type { SessionSummary } from "../../../contract";
import { OK_PROMPT } from "../live/runs";
import type { RecordedAgy } from "../record/scrub";
import { answerTo, chunkText, recordsOf } from "./recorded";
import { jobOf, recording } from "./recordings";
import { Replay } from "./replay";

const root = mkdtempSync(join(tmpdir(), "broski-agy-replay-"));
/** As `tmpdir()` spells it on macOS (`/var/…`), while agy wrote the real path (`/private/var/…`). */
const workspace = join(root, "workspace");
const voidDir = join(root, "void");
const other = join(root, "other");
for (const dir of [workspace, voidDir, other]) mkdirSync(dir);
const realWorkspace = realpathSync(workspace);

afterAll(() => rmSync(root, { recursive: true, force: true }));

const nothingToDo = () => undefined;

/** The scenario's short job, opened with its recorded `initialize`, and its listing read by the bridge's job. */
async function listed(scenario: string) {
	const recorded = jobOf(recording(scenario, realWorkspace));
	const replay = new Replay(recorded);
	const job = replay.process(await replay.request("initialize", InitializeResult));
	const listing = listAll(job, voidDir);
	await replay.play(nothingToDo, replay.answerOf("session/list"));
	const rows = await listing;
	if (!rows.ok) throw new Error(rows.failure.message);
	return { recorded, replay, job, sessions: rows.result };
}

/** Each row of agy's `session/list` answer as its title and time, written as JSON to be compared as a set. */
function listedRows(recorded: RecordedAgy): string[] {
	const { sessions } = answerTo(recorded, "session/list");
	const rows: readonly unknown[] = Array.isArray(sessions) ? sessions : [];
	return rows.map((row) => {
		const { title, updatedAt } = isRecord(row) ? row : {};
		return JSON.stringify([title, typeof updatedAt === "string" ? Date.parse(updatedAt) : undefined]);
	});
}

function ids(sessions: readonly ListedSession[], query: { cwd?: string }, limit = 50): string[] {
	const made = new MadeSessions();
	const seen: string[] = [];
	let cursor: string | undefined;
	do {
		const page = sessionsPage(sessions, query, { limit, ...(cursor && { cursor }) }, (id) => made.origin(id));
		if (page.status !== "accepted") throw new Error(page.rejection.message);
		seen.push(...page.page.items.map((item: SessionSummary) => item.session.sessionId));
		cursor = page.page.nextCursor;
	} while (cursor !== undefined);
	return seen;
}

describe("agy's recorded short jobs, read by the bridge's jobs", () => {
	test("listing: every session agy listed, in its real folder, newest first, filtered and paged by the bridge", async () => {
		const { recorded, replay, sessions } = await listed("listing");
		expect(replay.unrecorded()).toEqual([]);
		expect(replay.faults).toEqual([]);
		const shown = sessions.map((session) => JSON.stringify([session.title, session.updatedAt]));
		expect(shown.toSorted()).toEqual(listedRows(recorded).toSorted());
		const times = sessions.map((session) => session.updatedAt);
		expect(times).toEqual(times.toSorted((a, b) => b - a));
		expect(sessions.every((session) => session.cwd === realWorkspace)).toBe(true);
		const newestFirst = sessions.map((session) => session.sessionId);
		expect(ids(sessions, { cwd: workspace }, 3)).toEqual(newestFirst);
		expect(ids(sessions, {})).toEqual(newestFirst);
		expect(ids(sessions, { cwd: other })).toEqual([]);
	});

	test("load-replay: the session's history is its replay, the user's words and agy's answer, then session/close", async () => {
		const { recorded, replay, job, sessions } = await listed("load-replay");
		const [load] = recordsOf(recorded, "session/load", "client");
		const session = sessions.find((listedSession) => listedSession.sessionId === load?.sessionId);
		if (session === undefined) throw new Error("agy listed no plain-turn session");
		const read = replayedTranscript(job, session, session.cwd ?? voidDir);
		await replay.play(nothingToDo);
		expect(replay.unrecorded()).toEqual([]);
		expect(replay.faults).toEqual([]);
		const { sessionId, updatedAt: at } = session;
		const answer = chunkText(recorded, "agent_message_chunk");
		expect(await read).toEqual({
			ok: true,
			result: [
				{ kind: "user_message", id: `${sessionId}:0`, at, text: OK_PROMPT, attachments: [] },
				{ kind: "block", id: `${sessionId}:1`, at, messageId: "message-1", block: "text", text: answer },
			],
		});
	});
});
