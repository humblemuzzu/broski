/** Rule 5 and its neighbours against transcripts in a temp config dir: keyset pages, scoping, rows, cost. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type SessionQuery, SessionSummary, type SessionSummary as Summary } from "../../../contract";
import { projectKey } from "../helpers/fixture-transcripts";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";
import { TranscriptBuilder } from "./helpers/transcript-builder";

let world: StoreWorld;
beforeEach(async () => {
	world = await createStoreWorld();
});
afterEach(async () => {
	await world.dispose();
});

function seed(cwd: string, prompt: string, at: Date, sessionId: string = crypto.randomUUID()): string {
	const builder = new TranscriptBuilder(sessionId, cwd);
	builder.user(prompt);
	builder.text(`msg_${sessionId.slice(0, 8)}`, `Answer to ${prompt}`);
	const { path } = builder.write(world.home.configDir);
	utimesSync(path, at, at);
	return sessionId;
}

async function everyPage(query: SessionQuery, limit: number): Promise<Summary[]> {
	const rows: Summary[] = [];
	let cursor: string | undefined;
	do {
		const result = await world.store.list(query, { limit, ...(cursor !== undefined && { cursor }) }, world.live);
		if (result.status === "rejected") throw new Error(result.rejection.message);
		expect(result.page.items.length).toBeLessThanOrEqual(limit);
		rows.push(...result.page.items);
		cursor = result.page.nextCursor;
	} while (cursor !== undefined);
	return rows;
}

describe("listing", () => {
	test("pages concatenate newest first inside the requested cwd, equal to one listing", async () => {
		const here = world.project("here");
		const there = world.project("there");
		for (let n = 0; n < 7; n++) seed(here, `prompt ${n}`, new Date(Date.UTC(2026, 0, 1 + n)));
		for (let n = 0; n < 3; n++) seed(there, `other ${n}`, new Date(Date.UTC(2026, 0, 20 + n)));
		const query = { cwd: here };
		const paged = await everyPage(query, 2);
		const whole = await everyPage(query, 200);
		const ids = paged.map((row) => row.session.sessionId);
		expect(paged).toHaveLength(7);
		expect(new Set(ids).size).toBe(7);
		expect(ids).toEqual(whole.map((row) => row.session.sessionId));
		const times = paged.map((row) => row.updatedAt);
		expect(times).toEqual([...times].sort((a, b) => b - a));
		expect(paged.every((row) => row.cwd === here && SessionSummary.safeParse(row).success)).toBe(true);
		expect((await everyPage({ cwd: there }, 2)).length).toBe(3);
	});

	test("breaks a lastModified tie by sessionId descending, as listSessions does, on every page", async () => {
		const cwd = world.project("ties");
		const tied = new Date(Date.UTC(2026, 0, 1));
		const ids = ["1", "3", "2", "0", "4"].map(
			(d) => `${d.repeat(8)}-${d.repeat(4)}-4${d.repeat(3)}-8${d.repeat(3)}-${d.repeat(12)}`,
		);
		for (const id of ids) seed(cwd, "tie", tied, id);
		const sdkRows = await world.sdk.listSessions({ dir: cwd, includeWorktrees: false });
		const sdkOrder = sdkRows.map((row) => row.sessionId);
		for (const limit of [1, 2, 3, 200]) {
			const rows = await everyPage({ cwd }, limit);
			expect(rows.map((row) => row.session.sessionId)).toEqual(sdkOrder);
			expect(rows.map((row) => row.updatedAt)).toEqual(sdkRows.map((row) => row.lastModified));
		}
		expect(sdkOrder[0]).toBe(ids[4]);
	});

	test("lists the sessions of every project when no cwd is asked for, ordered like the SDK", async () => {
		for (const [index, name] of ["a", "b", "c"].entries())
			seed(world.project(name), name, new Date(Date.UTC(2026, 1, 1 + index)));
		const ours = (await everyPage({}, 2)).map((row) => row.session.sessionId);
		const sdk = (await world.sdk.listSessions({})).map((row) => row.sessionId);
		expect(ours).toEqual(sdk);
		expect(ours).toHaveLength(3);
	});

	test("refuses a cursor it did not mint and one minted for another listing", async () => {
		const cwd = world.project("cursors");
		for (let n = 0; n < 4; n++) seed(cwd, `p${n}`, new Date(Date.UTC(2026, 0, 1 + n)));
		const first = await world.store.list({ cwd }, { limit: 2 }, world.live);
		if (first.status !== "accepted" || first.page.nextCursor === undefined) throw new Error("expected a second page");
		for (const cursor of ["not-a-cursor", "AAAA", first.page.nextCursor]) {
			const query = cursor === first.page.nextCursor ? { cwd: world.project("other") } : { cwd };
			const result = await world.store.list(query, { limit: 2, cursor }, world.live);
			expect(result.status === "rejected" && result.rejection.code).toBe("invalid_input");
		}
	});

	test("a page reads at most limit + 32 rows, however deep it is", async () => {
		const cwd = world.project("cost");
		for (let n = 0; n < 130; n++) seed(cwd, `p${n}`, new Date(Date.UTC(2026, 0, 1) + n * 60_000));
		let cursor: string | undefined;
		const costs: number[] = [];
		do {
			const before = world.calls.getSessionInfo;
			const result = await world.store.list(
				{ cwd },
				{ limit: 20, ...(cursor !== undefined && { cursor }) },
				world.live,
			);
			if (result.status !== "accepted") throw new Error("rejected");
			costs.push(world.calls.getSessionInfo - before);
			cursor = result.page.nextCursor;
		} while (cursor !== undefined);
		expect(costs.length).toBe(7);
		expect(Math.max(...costs)).toBeLessThanOrEqual(20 + 32);
		expect(world.calls.listSessions).toBe(0);
	});

	test("skips the project directories of other cwds once it has seen them", async () => {
		const mine = world.project("mine");
		for (let n = 0; n < 3; n++) seed(mine, `m${n}`, new Date(Date.UTC(2026, 0, 1 + n)));
		for (const name of ["x", "y", "z"])
			for (let n = 0; n < 6; n++) seed(world.project(name), `${name}${n}`, new Date(Date.UTC(2026, 5, 1 + n)));
		const query = { cwd: mine };
		await everyPage(query, 50);
		const before = world.calls.getSessionInfo;
		const again = await everyPage(query, 50);
		expect(again).toHaveLength(3);
		expect(world.calls.getSessionInfo - before).toBe(3);
	});
});

describe("rows", () => {
	test("a row carries the SDK's title, its source, the journal's origin and the live facts", async () => {
		const cwd = world.project("rows");
		const first = seed(cwd, "the first prompt", new Date(Date.UTC(2026, 0, 1)));
		const owned = seed(cwd, "mine", new Date(Date.UTC(2026, 0, 2)));
		await world.ownership.claim(owned);
		world.live.rows.set(owned, { status: "running", modelId: "opus" });
		const rows = await everyPage({ cwd }, 10);
		const byId = new Map(rows.map((row) => [row.session.sessionId, row]));
		expect(byId.get(first)).toMatchObject({
			title: { text: "the first prompt", source: "first_prompt" },
			origin: "external",
			status: "unknown",
		});
		expect(byId.get(owned)).toMatchObject({
			origin: "broski",
			status: "running",
			modelId: "opus",
		});
		const found = await world.store.get(first, world.live);
		expect(found.status === "accepted" && found.summary.session.sessionId).toBe(first);
		const missing = await world.store.get(crypto.randomUUID(), world.live);
		expect(missing.status === "rejected" && missing.rejection.code).toBe("not_found");
		const odd = await world.store.get("not-a-uuid", world.live);
		expect(odd.status === "rejected" && odd.rejection.code).toBe("not_found");
	});

	test("a session of a git worktree is listed under the worktree, never under the repository it belongs to", async () => {
		const repo = world.project("repo");
		const git = (...args: string[]) => Bun.spawnSync(["git", "-C", repo, ...args], { stderr: "ignore" });
		git("init", "-q");
		git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "one");
		const tree = join(dirname(repo), "repo-tree");
		expect(git("worktree", "add", "-q", tree).exitCode).toBe(0);
		const inRepo = seed(repo, "in the repo", new Date(Date.UTC(2026, 0, 1)));
		const inTree = seed(tree, "in the worktree", new Date(Date.UTC(2026, 0, 2)));
		const ids = async (cwd: string) => (await everyPage({ cwd }, 10)).map((row) => row.session.sessionId);
		expect(await ids(repo)).toEqual([inRepo]);
		expect(await ids(tree)).toEqual([inTree]);
	});

	test("an AI title is generated, a /rename or the custom-title sidecar is the user's, whatever the SDK folds", async () => {
		const cwd = world.project("titles");
		const titleOf = async (sessionId: string) => {
			const found = await world.store.get(sessionId, world.live);
			return found.status === "accepted" ? found.summary.title : undefined;
		};
		const at = new Date(Date.UTC(2026, 0, 1));
		const ai = seed(cwd, "fix the login bug please", at);
		appendFileSync(
			transcriptOf(cwd, ai),
			`${JSON.stringify({ type: "ai-title", aiTitle: "Fix login bug", sessionId: ai })}\n`,
		);
		expect(await titleOf(ai)).toEqual({ text: "Fix login bug", source: "generated" });

		const renamed = seed(cwd, "something", at);
		const entries = [
			{ type: "ai-title", aiTitle: "Something", sessionId: renamed },
			{ type: "custom-title", customTitle: "My name", sessionId: renamed },
		];
		appendFileSync(transcriptOf(cwd, renamed), entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
		expect(await titleOf(renamed)).toEqual({ text: "My name", source: "user" });

		const sidecar = seed(cwd, "another", at);
		appendFileSync(
			transcriptOf(cwd, sidecar),
			`${JSON.stringify({ type: "ai-title", aiTitle: "Another", sessionId: sidecar })}\n`,
		);
		mkdirSync(join(dirname(transcriptOf(cwd, sidecar)), sidecar), { recursive: true });
		writeFileSync(
			join(dirname(transcriptOf(cwd, sidecar)), sidecar, "custom-title.json"),
			JSON.stringify({ customTitle: "From the sidecar" }),
		);
		expect(await titleOf(sidecar)).toEqual({ text: "From the sidecar", source: "user" });
	});
});

function transcriptOf(cwd: string, sessionId: string): string {
	return join(world.home.configDir, "projects", projectKey(cwd), `${sessionId}.jsonl`);
}
