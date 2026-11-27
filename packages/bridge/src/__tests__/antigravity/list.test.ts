/**
 * agy's session rows as the bridge lists them, on real folders: percent-encoded and symlinked paths name the folder they
 * stand for, the lister's own folder means no `cwd`, and the bridge filters, orders and pages what agy returns at once.
 * A hosted session's row is the listed one with what its host knows, and the two agree on whose it is and when.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostRow } from "../../backends/antigravity/live/host-row";
import {
	type ListedSession,
	listedSessions,
	sessionsPage,
	summaryOf,
	unstoredRow,
} from "../../backends/antigravity/store/list";
import { MadeSessions } from "../../backends/antigravity/store/made";
import { type CatalogEvent, emptySnapshot, type SessionOrigin, type SessionSummary } from "../../contract";
import { journalsIn } from "../../server/json-lines-journal";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temp tree under `tmpdir()` as macOS spells it (`/var/…`), whose real path is `/private/var/…`. */
function tree() {
	const root = mkdtempSync(join(tmpdir(), "broski-agy-list-"));
	roots.push(root);
	const project = join(root, "Code stuff");
	const other = join(root, "other");
	const voidDir = join(root, "void");
	for (const dir of [project, other, voidDir]) mkdirSync(dir);
	const link = join(root, "linked");
	symlinkSync(project, link);
	return { root, project, other, voidDir, link, real: realpathSync(project) };
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 27, 9, minute)).toISOString();

/** The rows a listing of `listed` pages, none of them hosted. */
function rowsOf(listed: readonly ListedSession[], origin: (sessionId: string) => SessionOrigin = () => "external") {
	return listed.map((session) => summaryOf(session, origin(session.sessionId)));
}

function fail(message: string): never {
	throw new Error(message);
}

function ids(page: ReturnType<typeof sessionsPage>): string[] {
	if (page.status !== "accepted") throw new Error(page.rejection.message);
	return page.page.items.map((item: SessionSummary) => item.session.sessionId);
}

describe("agy's session rows", () => {
	test("name the folder a percent-encoded or symlinked path stands for, and a deleted one as written", () => {
		const { root, project, link, real, voidDir } = tree();
		const rows = [
			{ sessionId: "encoded", cwd: project.replace(" ", "%20"), updatedAt: at(1) },
			{ sessionId: "linked", cwd: link, updatedAt: at(2) },
			{ sessionId: "realpathed", cwd: real, updatedAt: at(3) },
			{ sessionId: "gone", cwd: join(root, "deleted%20folder"), updatedAt: at(4) },
		];
		const listed = listedSessions(rows, voidDir);
		expect(Object.fromEntries(listed.map((session) => [session.sessionId, session.cwd]))).toEqual({
			encoded: real,
			linked: real,
			realpathed: real,
			gone: join(root, "deleted folder"),
		});
	});

	test("that report the lister's own folder have no cwd: left out of a project, listed with no cwd asked", () => {
		const { project, voidDir } = tree();
		const listed = listedSessions(
			[
				{ sessionId: "borrowed", cwd: voidDir, title: "No folder", updatedAt: at(5) },
				{ sessionId: "borrowed-real", cwd: realpathSync(voidDir), updatedAt: at(3) },
				{ sessionId: "mine", cwd: project, title: "Mine", updatedAt: at(4) },
			],
			voidDir,
		);
		expect(listed.find((session) => session.sessionId === "borrowed")).toEqual({
			sessionId: "borrowed",
			title: "No folder",
			updatedAt: Date.parse(at(5)),
		});
		expect(ids(sessionsPage(rowsOf(listed), { cwd: project }, { limit: 10 }))).toEqual(["mine"]);
		expect(ids(sessionsPage(rowsOf(listed), {}, { limit: 10 }))).toEqual(["borrowed", "mine", "borrowed-real"]);
		expect(listed.filter((session) => session.cwd === undefined).length).toBe(2);
	});

	test("are filtered by a cwd spelled any way, newest first, and paged without loss", () => {
		const { project, other, link, voidDir } = tree();
		const rows = [
			...[1, 2, 3, 4, 5].map((minute) => ({ sessionId: `p${minute}`, cwd: project, updatedAt: at(minute) })),
			{ sessionId: "elsewhere", cwd: other, updatedAt: at(9) },
			{ sessionId: "tie-a", cwd: project, updatedAt: at(3) },
		];
		const listed = rowsOf(listedSessions(rows, voidDir));
		const seen: string[] = [];
		let cursor: string | undefined;
		do {
			const page = sessionsPage(listed, { cwd: link }, { limit: 2, ...(cursor !== undefined && { cursor }) });
			if (page.status !== "accepted") throw new Error(page.rejection.message);
			seen.push(...ids(page));
			cursor = page.page.nextCursor;
		} while (cursor !== undefined);
		expect(seen).toEqual(["p5", "p4", "tie-a", "p3", "p2", "p1"]);

		const first = sessionsPage(listed, { cwd: project }, { limit: 2 });
		const foreign = first.status === "accepted" ? first.page.nextCursor : undefined;
		expect(foreign).toBeDefined();
		expect(sessionsPage(listed, { cwd: other }, { limit: 2, cursor: foreign ?? "" })).toMatchObject({
			status: "rejected",
			rejection: { code: "invalid_input" },
		});
	});

	test("are searched by title and folder name, and have no children", () => {
		const { project, other, voidDir } = tree();
		const listed = rowsOf(
			listedSessions(
				[
					{ sessionId: "a", cwd: project, title: "Fix the login flow", updatedAt: at(1) },
					{ sessionId: "b", cwd: other, title: "Write docs", updatedAt: at(2) },
				],
				voidDir,
			),
		);
		expect(ids(sessionsPage(listed, { search: "LOGIN" }, { limit: 10 }))).toEqual(["a"]);
		expect(ids(sessionsPage(listed, { search: "other" }, { limit: 10 }))).toEqual(["b"]);
		const children = { parent: { backend: "antigravity", sessionId: "a" } };
		expect(ids(sessionsPage(listed, children, { limit: 10 }))).toEqual([]);
	});

	test("of a session this bridge made are Broski's, and its host's row keeps agy's time until a later turn of its own ends", () => {
		const { root, project, voidDir } = tree();
		const made = new MadeSessions(journalsIn(join(root, "journals"), fail));
		made.note("mine", { cwd: project }, Date.parse(at(1)));
		const listed = listedSessions(
			[
				{ sessionId: "mine", cwd: project, title: "Mine", updatedAt: at(4) },
				{ sessionId: "theirs", cwd: project, updatedAt: at(3) },
			],
			voidDir,
		);
		const page = sessionsPage(
			rowsOf(listed, (sessionId) => made.origin(sessionId)),
			{},
			{ limit: 10 },
		);
		const rows = page.status === "accepted" ? page.page.items : [];
		expect(rows.map((row) => [row.session.sessionId, row.origin, row.updatedAt])).toEqual([
			["mine", "broski", Date.parse(at(4))],
			["theirs", "external", Date.parse(at(3))],
		]);
		const [mine] = listed;
		const [mineListed] = rows;
		if (mine === undefined || mineListed === undefined) throw new Error("nothing listed");
		let clock = Date.parse(at(2));
		const facts = { listed: mine, origin: made.origin(mine.sessionId) };
		const hosted = new HostRow(facts, emptySnapshot, { emit: () => undefined }, () => clock);
		expect(hosted.summary()).toEqual({ ...mineListed, status: "idle" });
		hosted.touched();
		hosted.ran();
		expect(hosted.summary().updatedAt).toBe(Date.parse(at(4)));
		clock = Date.parse(at(30));
		hosted.ran();
		expect(hosted.summary().updatedAt).toBe(clock);
	});

	test("of a hosted new chat stand under the journal's first prompt, announced, until agy names the session", () => {
		const { root, project } = tree();
		const made = new MadeSessions(journalsIn(join(root, "journals"), fail));
		made.note("new", { cwd: project }, Date.parse(at(1)));
		const journaled = () => {
			const record = made.get("new");
			if (record === undefined) throw new Error("the journal lost the chat");
			return unstoredRow("new", record);
		};
		const announced: SessionSummary[] = [];
		const catalog = {
			emit: (event: CatalogEvent) => {
				if (event.type === "session_updated") announced.push(event.summary);
			},
		};
		const hosted = new HostRow({ listed: journaled(), origin: "broski" }, emptySnapshot, catalog, () => 0);
		hosted.announceFromNow();
		expect(hosted.summary().title).toBeUndefined();

		made.prompted("new", "Fix the login redirect", { modes: [] });
		hosted.relisted(journaled());
		const firstPrompt = { text: "Fix the login redirect", source: "first_prompt" } as const;
		expect(hosted.summary().title).toEqual(firstPrompt);
		expect(hosted.summary()).toEqual(summaryOf(journaled(), "broski"));
		expect(announced.at(-1)).toEqual(hosted.summary());

		hosted.titled("Fix the login redirect");
		expect(hosted.summary().title).toEqual({ text: "Fix the login redirect", source: "generated" });
		hosted.titled("Login redirect fix");
		hosted.relisted(journaled());
		expect(hosted.summary().title).toEqual({ text: "Login redirect fix", source: "generated" });
		expect(announced.map((row) => row.title)).toEqual([
			undefined,
			firstPrompt,
			{ text: "Fix the login redirect", source: "generated" },
			{ text: "Login redirect fix", source: "generated" },
		]);
	});
});
