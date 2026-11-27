/**
 * agy's session rows as the bridge lists them, on real folders: percent-encoded and symlinked paths name the folder they
 * stand for, the lister's own folder means no `cwd`, and the bridge filters, orders and pages what agy returns at once.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listedSessions, sessionsPage } from "../../backends/antigravity/store/list";
import type { SessionSummary } from "../../contract";

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
		expect(ids(sessionsPage(listed, { cwd: project }, { limit: 10 }))).toEqual(["mine"]);
		expect(ids(sessionsPage(listed, {}, { limit: 10 }))).toEqual(["borrowed", "mine", "borrowed-real"]);
		expect(listed.filter((session) => session.cwd === undefined).length).toBe(2);
	});

	test("are filtered by a cwd spelled any way, newest first, and paged without loss", () => {
		const { project, other, link, voidDir } = tree();
		const rows = [
			...[1, 2, 3, 4, 5].map((minute) => ({ sessionId: `p${minute}`, cwd: project, updatedAt: at(minute) })),
			{ sessionId: "elsewhere", cwd: other, updatedAt: at(9) },
			{ sessionId: "tie-a", cwd: project, updatedAt: at(3) },
		];
		const listed = listedSessions(rows, voidDir);
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
		const listed = listedSessions(
			[
				{ sessionId: "a", cwd: project, title: "Fix the login flow", updatedAt: at(1) },
				{ sessionId: "b", cwd: other, title: "Write docs", updatedAt: at(2) },
			],
			voidDir,
		);
		expect(ids(sessionsPage(listed, { search: "LOGIN" }, { limit: 10 }))).toEqual(["a"]);
		expect(ids(sessionsPage(listed, { search: "other" }, { limit: 10 }))).toEqual(["b"]);
		const children = { parent: { backend: "antigravity", sessionId: "a" } };
		expect(ids(sessionsPage(listed, children, { limit: 10 }))).toEqual([]);
	});
});
