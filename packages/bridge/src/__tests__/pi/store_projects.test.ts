/**
 * A session under a project's own `sessionDir` (absolute or relative) is found by id, listed with every
 * cwd and watched, once the store knows the project; a project it has never heard of is the one miss.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay, SessionStore } from "../../backends/pi/ports";
import { createSessionStore } from "../../backends/pi/store/session-store";
import type { CatalogEvent } from "../../contract";
import { installFakeTrash } from "./helpers/fake-trash";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { SessionBuilder, textBlock, writeSession } from "./store_fixtures";

setDefaultTimeout(15_000);

let env: PiTestEnv;
let events: CatalogEvent[];
let store: SessionStore;

const NOBODY: LiveOverlay = { row: () => undefined };

function newStore(): SessionStore {
	return createSessionStore({
		agentDir: env.agentDir,
		catalog: new CatalogFeed({ emit: (event) => events.push(event) }),
		now: () => Date.parse("2026-03-02T00:00:00.000Z"),
	});
}

beforeEach(() => {
	env = createPiTestEnv();
	delete process.env.PI_CODING_AGENT_SESSION_DIR;
	events = [];
	store = newStore();
});

afterEach(() => {
	store.dispose();
	env.dispose();
});

function chat(id: string, cwd: string, lastAt = 1_000): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd, version: 3, createdAt: lastAt - 10 });
	builder.user(`prompt of ${id}`, lastAt - 5);
	builder.assistant([textBlock("answer")], lastAt);
	return builder;
}

function useProjectDir(cwd: string, sessionDir: string): void {
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir }));
}

const until = async (check: () => boolean): Promise<void> => {
	const deadline = Date.now() + 5_000;
	while (!check() && Date.now() < deadline) await Bun.sleep(20);
	expect(check()).toBe(true);
};

describe.each([
	{ label: "an absolute", setting: (cwd: string) => join(cwd, "own-sessions") },
	{ label: "a relative", setting: () => "own-sessions" },
])("with $label project sessionDir", ({ setting }) => {
	test("a session in it is found by id once the project is asked about, by a listing of that cwd", async () => {
		useProjectDir(env.cwd, setting(env.cwd));
		writeSession(join(env.cwd, "own-sessions"), chat("own", env.cwd));

		const unknown = await store.get("own", NOBODY);
		expect(unknown.status === "rejected" && unknown.rejection.code).toBe("not_found");

		const listed = await store.list({ cwd: env.cwd }, { limit: 10 }, NOBODY);
		expect(listed.status === "accepted" && listed.page.items.map((row) => row.session.sessionId)).toEqual(["own"]);
		const found = await store.get("own", NOBODY);
		expect(found.status).toBe("accepted");
		expect((await store.transcript("own", { limit: 10 }, NOBODY)).status).toBe("accepted");
		const located = await store.locate("own");
		expect("path" in located && located.path.startsWith(join(env.cwd, "own-sessions"))).toBe(true);
		const everything = await store.list({}, { limit: 10 }, NOBODY);
		expect(everything.status === "accepted" && everything.page.items.map((row) => row.session.sessionId)).toEqual([
			"own",
		]);
	});

	test("after a restart the project is found again from a session of it in the global tree, with no listing", async () => {
		useProjectDir(env.cwd, setting(env.cwd));
		writeSession(join(env.agentDir, "sessions", "--old--"), chat("older", env.cwd, 500));
		writeSession(join(env.cwd, "own-sessions"), chat("own", env.cwd, 2_000));

		const found = await store.get("own", NOBODY);
		const transcript = await store.transcript("own", { limit: 10 }, NOBODY);

		expect(found.status).toBe("accepted");
		expect(transcript.status).toBe("accepted");
		const located = await store.locate("own");
		expect("cwd" in located && located.cwd).toBe(env.cwd);
	});

	test("found while the watch runs, a project's earlier sessions are not news", async () => {
		useProjectDir(env.cwd, setting(env.cwd));
		writeSession(join(env.agentDir, "sessions", "--old--"), chat("older", env.cwd, 500));
		writeSession(join(env.cwd, "own-sessions"), chat("own", env.cwd, 2_000));
		store.watch(NOBODY);

		expect((await store.get("own", NOBODY)).status).toBe("accepted");
		await store.list({}, { limit: 10 }, NOBODY);
		await Bun.sleep(500);

		expect(events).toEqual([]);
	});

	test("a new session in it, written by the terminal, is announced; the ones already there are not", async () => {
		useProjectDir(env.cwd, setting(env.cwd));
		const dir = join(env.cwd, "own-sessions");
		writeSession(dir, chat("already", env.cwd));
		store.watch(NOBODY);
		await store.list({ cwd: env.cwd }, { limit: 10 }, NOBODY);
		await Bun.sleep(400);
		expect(events).toEqual([]);

		writeSession(dir, chat("from-the-terminal", env.cwd, 5_000));

		await until(() =>
			events.some(
				(event) => event.type === "session_updated" && event.summary.session.sessionId === "from-the-terminal",
			),
		);
		expect(
			events.some((event) => event.type === "session_updated" && event.summary.session.sessionId === "already"),
		).toBe(false);
	});

	test("a project's own directory is changed only once the project is trusted: Pi uses it either way", async () => {
		useProjectDir(env.cwd, setting(env.cwd));
		const path = writeSession(join(env.cwd, "own-sessions"), chat("doomed", env.cwd));
		await store.list({ cwd: env.cwd }, { limit: 10 }, NOBODY);
		const trash = installFakeTrash(env);
		const before = readFileSync(path, "utf8");

		const renamed = await store.rename("doomed", "x");
		const removed = await store.remove("doomed", async () => {});

		expect([renamed, removed].map((result) => result.status === "rejected" && result.rejection.code)).toEqual([
			"unsupported",
			"unsupported",
		]);
		expect(readFileSync(path, "utf8")).toBe(before);
		expect(trash.calls()).toEqual([]);

		writeFileSync(join(env.agentDir, "trust.json"), JSON.stringify({ [realpathSync(env.cwd)]: true }));
		expect(await store.remove("doomed", async () => {})).toEqual({ status: "accepted" });
		const gone = await store.get("doomed", NOBODY);
		expect(gone.status === "rejected" && gone.rejection.code).toBe("not_found");
	});
});

describe("projects the store has never heard of", () => {
	test("a session only in an unknown project's own directory is not found by id: nothing names that directory", async () => {
		useProjectDir(env.cwd, join(env.cwd, "own-sessions"));
		writeSession(join(env.cwd, "own-sessions"), chat("hidden", env.cwd));

		const result = await store.get("hidden", NOBODY);

		expect(result.status === "rejected" && result.rejection.code).toBe("not_found");
	});

	test("sessionDirFor teaches the store the project, so a session created there is found", async () => {
		useProjectDir(env.cwd, join(env.cwd, "own-sessions"));

		const dir = store.sessionDirFor(env.cwd);
		writeSession(dir, chat("created", env.cwd));

		expect(dir).toBe(join(env.cwd, "own-sessions"));
		expect((await store.get("created", NOBODY)).status).toBe("accepted");
	});
});
