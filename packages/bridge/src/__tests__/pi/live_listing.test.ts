/**
 * On the real adapter: which sessions a directory lists (by the header's cwd, through
 * symlinks), where Pi's session files are looked for and written, and a session another process writes,
 * changes or removes showing up without a restart.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SessionSummary } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { allRows } from "./helpers/paging";
import { conversation, findSessionFile, writeSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function listed(rig: LiveRig, cwd: string | undefined): Promise<SessionSummary[]> {
	return allRows(rig.backend, { ...(cwd !== undefined && { cwd }) }, 50);
}

const idsOf = (rows: readonly SessionSummary[]) => rows.map((row) => row.session.sessionId).sort();

describe("which sessions a directory lists", () => {
	test("those whose header names it; a trailing slash is the same directory", async () => {
		t = await LiveRig.create();
		const root = t.world.sessionsRoot;
		writeSessionFile(root, { id: "here-flat", cwd: t.cwd, version: 3 }, conversation(["a", "b"]));
		writeSessionFile(root, { id: "elsewhere-flat", cwd: t.world.env.otherCwd, version: 3 }, conversation(["a", "b"]));
		writeSessionFile(root, { id: "here-slash", cwd: `${t.cwd}/`, version: 3 }, conversation(["a", "b"]));

		expect(idsOf(await listed(t, t.cwd))).toEqual(["here-flat", "here-slash"]);
		expect(idsOf(await listed(t, t.world.env.otherCwd))).toEqual(["elsewhere-flat"]);
		expect(idsOf(await listed(t, undefined))).toEqual(["elsewhere-flat", "here-flat", "here-slash"]);
		const row = (await listed(t, t.cwd)).find((candidate) => candidate.session.sessionId === "here-slash");
		expect(row?.cwd).toBe(`${t.cwd}/`);
		expect(row?.origin).toBe("external");
		expect(await listed(t, t.world.env.root)).toEqual([]);
	});

	test("through a symlink to it, both ways", async () => {
		t = await LiveRig.create();
		const link = join(t.world.env.root, "link-to-project");
		symlinkSync(t.cwd, link);
		writeSessionFile(t.world.sessionsRoot, { id: "by-real-path", cwd: t.cwd, version: 3 }, conversation(["a", "b"]));
		const live = await t.rig.openNew({ cwd: link });
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Made through the link.");

		const want = ["by-real-path", live.ref.sessionId].sort();
		expect(idsOf(await listed(t, t.cwd))).toEqual(want);
		expect(idsOf(await listed(t, link))).toEqual(want);
		const made = (await listed(t, t.cwd)).find((row) => row.session.sessionId === live.ref.sessionId);
		expect(made?.cwd).toBe(link);
	});
});

describe("where session files live", () => {
	test.each(["env", "setting", "default"] as const)(
		"with the directory chosen by %s, sessions are written there and listed from there",
		async (at) => {
			t = await LiveRig.create({ sessionsAt: at });
			const expected = {
				env: t.world.env.sessionDir,
				setting: join(t.world.env.root, "sessions-by-setting"),
				default: join(t.world.env.agentDir, "sessions"),
			}[at];
			const live = await t.rig.openNew();
			await t.rig.arrange(live.ref, { kind: "reply" });
			await live.run("Where do I go?");
			const file = findSessionFile(expected, live.ref.sessionId);
			expect(file).toBeDefined();
			if (at !== "env") expect(findSessionFile(t.world.env.sessionDir, live.ref.sessionId)).toBeUndefined();

			writeSessionFile(
				dirname(file ?? ""),
				{ id: "from-the-terminal", cwd: t.cwd, version: 3 },
				conversation(["a", "b"]),
			);
			expect(idsOf(await listed(t, t.cwd))).toEqual(["from-the-terminal", live.ref.sessionId].sort());
		},
	);

	test("the environment variable beats the setting, as in the pi command", async () => {
		const decoy = join(tmpdir(), `broski-pi-setting-must-lose-${crypto.randomUUID()}`);
		t = await LiveRig.create({ settings: { sessionDir: decoy } });
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Which wins?");
		expect(findSessionFile(t.world.env.sessionDir, live.ref.sessionId)).toBeDefined();
		expect(existsSync(decoy)).toBe(false);
	});
});

describe("a session another process writes", () => {
	const named = "Named in the terminal";

	test("appears at the next listing and is announced; a rename and a removal follow, without a restart", async () => {
		t = await LiveRig.create();
		expect(await listed(t, t.cwd)).toEqual([]);
		const id = "written-later";
		const path = writeSessionFile(
			t.world.sessionsRoot,
			{ id, cwd: t.cwd, version: 3 },
			conversation(["from the terminal", "terminal answer"]),
		);
		const rig = t;
		const saw = (matches: (event: (typeof rig.catalog.items)[number]) => boolean, what: string) =>
			rig.catalog.waitFor((events) => events.find(matches), what);

		const announced = await saw(
			(event) => event.type === "session_updated" && event.summary.session.sessionId === id,
			"the new file announced",
		);
		expect(announced.type === "session_updated" && announced.summary.origin).toBe("external");
		const added = (await listed(t, t.cwd)).find((row) => row.session.sessionId === id);
		expect(added).toMatchObject({ origin: "external", cwd: t.cwd });
		expect(added?.title?.source).toBe("first_prompt");

		const info = { type: "session_info", id: "e3", parentId: "e2", timestamp: "2026-06-01T00:00:00.000Z", name: named };
		appendFileSync(path, `${JSON.stringify(info)}\n`);
		await saw(
			(event) => event.type === "session_updated" && event.summary.title?.text === named,
			"the rename announced",
		);
		const renamed = (await listed(t, t.cwd)).find((row) => row.session.sessionId === id);
		expect(renamed?.title).toEqual({ text: named, source: "user" });

		unlinkSync(path);
		await saw((event) => event.type === "session_removed" && event.session.sessionId === id, "the removal announced");
		expect((await listed(t, t.cwd)).some((row) => row.session.sessionId === id)).toBe(false);
		expect(await t.backend.getSession({ backend: "pi", sessionId: id })).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
	});
});

describe("a session this bridge hosts, as its files change", () => {
	test("is announced by its host alone, so the time a row shows never goes back", async () => {
		t = await LiveRig.create();
		await t.backend.listSessions({}, { limit: 10 });
		const live = await t.rig.openNew();
		for (const text of ["one", "two"]) {
			await t.rig.arrange(live.ref, { kind: "reply" });
			await live.run(text);
		}
		await Bun.sleep(600);

		const times = t.catalog.items.flatMap((event) =>
			event.type === "session_updated" && event.summary.session.sessionId === live.ref.sessionId
				? [event.summary.updatedAt]
				: [],
		);
		expect(times.length).toBeGreaterThan(1);
		expect(times).toEqual([...times].sort((a, b) => a - b));
	});
});
