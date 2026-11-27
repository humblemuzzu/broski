/**
 * agy's recorded short jobs played to the bridge's own reading jobs: the listing (`store/sessions.ts` `listAll`, then
 * `store/list.ts`) and a session's history from its `session/load` replay (`store/transcript.ts`, then
 * `store/transcript-items.ts`). The recording's workspace stands on a real folder here, so its rows' paths resolve as
 * they did on the recording's Mac. agy's rows there carried the folder plainly: no row is percent-encoded and none
 * reports the void folder, which `list.test.ts` covers on rows built for it. The rows and the replay are held to what
 * agy wrote in the recording (`recorded.ts`), so the tests pass on any recording of the scenarios. The sessions this
 * bridge made are read from its journal (`store/made.ts`) as a bridge that restarted reads them.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { InitializeResult } from "../../../backends/antigravity/acp/frames";
import { type ListedSession, sessionsPage } from "../../../backends/antigravity/store/list";
import { MadeSessions } from "../../../backends/antigravity/store/made";
import { AgySessions, listAll } from "../../../backends/antigravity/store/sessions";
import { replayedTranscript } from "../../../backends/antigravity/store/transcript";
import type { SessionSummary } from "../../../contract";
import { journalsIn } from "../../../server/json-lines-journal";
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

function fail(message: string): never {
	throw new Error(message);
}

/** The bridge's listing, over the scenario's short job, for a bridge whose journal is `journals`. */
async function bridgeSessions(scenario: string, journals: string) {
	const replay = new Replay(jobOf(recording(scenario, realWorkspace)));
	const job = replay.process(await replay.request("initialize", InitializeResult));
	const made = new MadeSessions(journalsIn(journals, fail));
	const sessions = new AgySessions({ run: (read) => read(job) }, voidDir, made);
	return { made, sessions, answered: () => replay.play(nothingToDo) };
}

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

/** The ids of agy's `session/list` answer. */
function listedIds(recorded: RecordedAgy): string[] {
	const { sessions } = answerTo(recorded, "session/list");
	const rows: readonly unknown[] = Array.isArray(sessions) ? sessions : [];
	return rows.flatMap((row) => (isRecord(row) && typeof row.sessionId === "string" ? [row.sessionId] : []));
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
	const seen: string[] = [];
	let cursor: string | undefined;
	do {
		const page = sessionsPage(sessions, query, { limit, ...(cursor && { cursor }) }, () => "external");
		if (page.status !== "accepted") throw new Error(page.rejection.message);
		seen.push(...page.page.items.map((item: SessionSummary) => item.session.sessionId));
		cursor = page.page.nextCursor;
	} while (cursor !== undefined);
	return seen;
}

describe("agy's recorded short jobs, read by the bridge's jobs", () => {
	test("a chat the bridge made that agy never stored is still listed after a restart, by its first prompt", async () => {
		const journals = join(root, "lost");
		const before = new MadeSessions(journalsIn(journals, fail));
		before.note("lost-chat", { cwd: workspace }, 1_000);
		before.prompted("lost-chat", "Fix the login redirect", { modes: [] });
		before.note("empty-chat", { cwd: workspace }, 2_000);

		const { sessions, answered } = await bridgeSessions("listing", journals);
		const listing = sessions.list({}, { limit: 50 });
		await answered();
		const listed = await listing;
		if (listed.status !== "accepted") throw new Error(listed.rejection.message);
		const row: SessionSummary = {
			session: { backend: "antigravity", sessionId: "lost-chat" },
			title: { text: "Fix the login redirect", source: "first_prompt" },
			cwd: realWorkspace,
			updatedAt: 1_000,
			status: "idle",
			origin: "broski",
		};
		expect(listed.page.items).toContainEqual(row);
		expect(listed.page.items.map((item) => item.session.sessionId)).not.toContain("empty-chat");
		expect(listed.page.items.filter((item) => item.origin === "external")).toHaveLength(
			listedRows(jobOf(recording("listing"))).length,
		);
		expect(await sessions.get("lost-chat")).toEqual({ status: "accepted", summary: row });
		expect(await sessions.get("empty-chat")).toMatchObject({ status: "accepted", summary: { status: "idle" } });
	});

	test("once agy lists a chat the bridge made, the bridge keeps its folder and settings, and its words leave the disk", async () => {
		const journals = join(root, "stored");
		const { recorded } = await listed("listing");
		const [stored] = listedIds(recorded);
		if (stored === undefined) throw new Error("agy listed no session");
		const before = new MadeSessions(journalsIn(journals, fail));
		before.note(stored, { cwd: workspace, modelId: "gemini-3.8-flash" }, 1_000);
		before.prompted(stored, "Remember the word heron", { modelId: "gemini-3.8-flash", modes: [] });

		const { made, sessions, answered } = await bridgeSessions("listing", journals);
		const found = sessions.find(stored);
		await answered();
		expect((await found).ok).toBe(true);
		expect(made.get(stored)).toEqual({
			at: 1_000,
			options: { cwd: workspace, modelId: "gemini-3.8-flash", modes: [] },
			stored: true,
		});
		expect(readFileSync(join(journals, "sessions.jsonl"), "utf8")).toContain("heron");
		const restarted = new MadeSessions(journalsIn(journals, fail));
		expect(restarted.origin(stored)).toBe("broski");
		expect(readFileSync(join(journals, "sessions.jsonl"), "utf8")).not.toContain("heron");
	});

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
