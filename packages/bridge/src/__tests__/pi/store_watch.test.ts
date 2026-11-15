/** The catalog follows session files other processes write, change and delete, and goes quiet at dispose. */

import { afterEach, beforeEach, describe, expect, mock, setDefaultTimeout, spyOn, test } from "bun:test";
import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay } from "../../backends/pi/ports";
import { piSessionDirs, type SessionRoot } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { SessionWatch } from "../../backends/pi/store/session-watch";
import { type CatalogEvent, SessionSummary } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { SessionBuilder, textBlock, writeSession } from "./store_fixtures";

let env: PiTestEnv;
let events: CatalogEvent[];
let watch: SessionWatch;
let index: SessionIndex;

setDefaultTimeout(15_000);

const NOBODY: LiveOverlay = { row: () => undefined };

function startWatching(
	roots: () => SessionRoot[] = () => [{ dir: env.sessionDir, nested: false, trusted: true }],
): SessionWatch {
	index = new SessionIndex(piSessionDirs(env.agentDir));
	watch = new SessionWatch({ index, catalog: new CatalogFeed({ emit: (event) => events.push(event) }), roots });
	watch.start(NOBODY);
	return watch;
}

beforeEach(() => {
	env = createPiTestEnv();
	events = [];
});

afterEach(() => {
	mock.restore();
	watch?.stop();
	env.dispose();
});

async function until(check: () => boolean, what: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!check()) {
		if (Date.now() > deadline)
			throw new Error(`timed out waiting for ${what}; saw ${JSON.stringify(events.map((e) => e.type))}`);
		await Bun.sleep(20);
	}
}

const quiet = () => Bun.sleep(600);

/**
 * `fs.watch` on macOS starts asynchronously and misses what is written in its first moments. A session file is written
 * again until the watch reports it, so a test's own writes come once the watch is known to see them.
 */
async function writeUntilReported(dir: string, builder: SessionBuilder, reported: () => boolean): Promise<string> {
	const deadline = Date.now() + 5_000;
	for (;;) {
		const path = writeSession(dir, builder);
		const retry = Date.now() + 300;
		while (Date.now() < retry) {
			if (reported()) return path;
			await Bun.sleep(20);
		}
		if (Date.now() > deadline) throw new Error(`the watch never reported ${path}`);
	}
}

/** The watch sees writes from now on; what it reported to show so is forgotten. */
async function watching(dir = env.sessionDir): Promise<void> {
	await writeUntilReported(dir, chat("ready", 500), () => updates("ready").length > 0);
	events.length = 0;
}

function chat(id: string, lastAt: number, prompt = `prompt of ${id}`): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd: env.cwd, version: 3, createdAt: lastAt - 10 });
	builder.user(prompt, lastAt - 5);
	builder.assistant([textBlock("answer")], lastAt);
	return builder;
}

function updates(id: string) {
	return events.flatMap((event) =>
		event.type === "session_updated" && event.summary.session.sessionId === id ? [event.summary] : [],
	);
}

const removals = (id: string) =>
	events.filter((event) => event.type === "session_removed" && event.session.sessionId === id);

describe("watching the session directory", () => {
	test("files that were already there are not news", async () => {
		writeSession(env.sessionDir, chat("old", 1_000));
		startWatching();

		await quiet();

		expect(events).toEqual([]);
	});

	test("files that were already there stay quiet when a listing reads them", async () => {
		writeSession(env.sessionDir, chat("old", 1_000));
		startWatching();

		await index.scan(undefined);
		watch.notify();
		await quiet();

		expect(events).toEqual([]);
	});

	test("a file another process writes, changes and deletes is session_updated, session_updated, session_removed", async () => {
		writeSession(env.sessionDir, chat("old", 1_000));
		startWatching();
		await watching();

		const builder = chat("fresh", 5_000, "a brand new prompt");
		const path = writeSession(env.sessionDir, builder);
		await until(() => updates("fresh").length >= 1, "the new file");
		const created = updates("fresh").at(-1);
		expect(SessionSummary.safeParse(created).success).toBe(true);
		expect(created).toMatchObject({
			title: { text: "a brand new prompt", source: "first_prompt" },
			origin: "external",
			status: "unknown",
		});

		builder.user("again", 8_000);
		builder.assistant([textBlock("more")], 9_000);
		appendFileSync(
			path,
			builder.lines
				.slice(-2)
				.map((line) => `${JSON.stringify(line)}\n`)
				.join(""),
		);
		await until(() => updates("fresh").at(-1)?.updatedAt !== created?.updatedAt, "the appended file");

		rmSync(path);
		await until(() => removals("fresh").length >= 1, "the deleted file");

		expect(events.some((event) => event.type === "session_updated" && event.summary.session.sessionId === "old")).toBe(
			false,
		);
		expect(events.at(-1)).toEqual({ type: "session_removed", session: { backend: "pi", sessionId: "fresh" } });
	});

	test("a file that was already there and is then changed is news", async () => {
		const path = writeSession(env.sessionDir, chat("old", 1_000));
		startWatching();
		await watching();

		const builder = chat("old", 1_000);
		builder.user("later", 7_000);
		writeFileSync(path, builder.text());

		await until(() => updates("old").length >= 1, "the change");
		expect(updates("old").at(-1)?.updatedAt).toBe(Date.parse("2026-03-01T10:00:07.000Z"));
	});

	test("a file moved to another name is the same session updated, never removed", async () => {
		const path = writeSession(env.sessionDir, chat("moving", 1_000));
		startWatching();
		await index.scan(undefined);
		await watching();

		renameSync(path, join(env.sessionDir, "renamed-by-hand.jsonl"));

		await until(() => updates("moving").length >= 1, "the move");
		await quiet();
		expect(removals("moving")).toEqual([]);
	});

	test("a file a listing found first is still announced, and so is its removal after a listing pruned it", async () => {
		startWatching();
		await watching();

		const path = writeSession(env.sessionDir, chat("listed-first", 1_000));
		await index.scan(undefined);
		watch.notify();
		await until(() => updates("listed-first").length >= 1, "the file found by a listing");

		rmSync(path);
		await index.scan(undefined);
		watch.notify();
		await until(() => removals("listed-first").length >= 1, "the removal found by a listing");
		await quiet();
		expect(removals("listed-first")).toHaveLength(1);
	});

	test("a burst of appends is a few events, and the last one has the final state", async () => {
		const builder = chat("burst", 1_000);
		const path = writeSession(env.sessionDir, builder);
		startWatching();
		await watching();

		for (let n = 0; n < 30; n += 1) {
			builder.user(`more ${n}`, 2_000 + n);
			appendFileSync(path, `${JSON.stringify(builder.lines.at(-1))}\n`);
		}
		await until(() => updates("burst").at(-1)?.updatedAt === Date.parse("2026-03-01T10:00:02.029Z"), "the last append");
		await quiet();

		expect(updates("burst").length).toBeLessThan(10);
	});

	test("a directory made under the root with a session already in it is found", async () => {
		const root = join(env.agentDir, "sessions");
		mkdirSync(root, { recursive: true });
		delete process.env.PI_CODING_AGENT_SESSION_DIR;
		startWatching(() => [{ dir: root, nested: true, trusted: true }]);
		await watching(join(root, "--ready--"));

		await writeUntilReported(
			join(root, "--new-project--"),
			chat("in-new-dir", 3_000),
			() => updates("in-new-dir").length >= 1,
		);
	});

	test("a root that does not exist yet is watched once a later call finds it", async () => {
		const root = join(env.root, "later-sessions");
		process.env.PI_CODING_AGENT_SESSION_DIR = root;
		startWatching(() => [{ dir: root, nested: false, trusted: true }]);
		await quiet();
		mkdirSync(root);
		watch.attach();

		await writeUntilReported(root, chat("late", 1_000), () => updates("late").length >= 1);
	});

	test("a file that is not a session is not news", async () => {
		startWatching();
		await watching();

		writeFileSync(join(env.sessionDir, "notes.jsonl"), "just notes\n");
		writeFileSync(join(env.sessionDir, "other.txt"), "x");
		await quiet();

		expect(events).toEqual([]);
	});

	test("nothing is emitted after stop, stopping twice is fine, and a stopped watch does not start again", async () => {
		startWatching();
		await watching();

		watch.stop();
		watch.stop();
		writeSession(env.sessionDir, chat("after", 1_000));
		watch.start(NOBODY);
		watch.attach();
		await quiet();

		expect(events).toEqual([]);
	});

	test("a re-scan under way when stop comes emits nothing, and the directories after it are not scanned", async () => {
		delete process.env.PI_CODING_AGENT_SESSION_DIR;
		const root = join(env.agentDir, "sessions");
		mkdirSync(root, { recursive: true });
		startWatching(() => [{ dir: root, nested: true, trusted: true }]);
		await watching(join(root, "--ready--"));
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const real = index.refresh.bind(index);
		let scanned = 0;
		spyOn(index, "refresh").mockImplementation(async (dir) => {
			scanned += 1;
			await gate;
			return real(dir);
		});

		writeSession(join(root, "--one--"), chat("one", 1_000));
		writeSession(join(root, "--two--"), chat("two", 2_000));
		await until(() => scanned > 0, "the first re-scan to begin");
		watch.stop();
		release();
		await quiet();

		expect(scanned).toBe(1);
		expect(events).toEqual([]);
	});

	test("a summary being read when stop comes is not emitted", async () => {
		startWatching();
		await watching();
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const real = index.complete.bind(index);
		let reading = 0;
		spyOn(index, "complete").mockImplementation(async (head) => {
			reading += 1;
			await gate;
			return real(head);
		});

		writeSession(env.sessionDir, chat("slow", 1_000));
		await until(() => reading > 0, "the summary to be read");
		watch.stop();
		release();
		await quiet();

		expect(events).toEqual([]);
	});

	test("an event already scheduled when stop comes is dropped", async () => {
		startWatching();
		await watching();

		writeSession(env.sessionDir, chat("racing", 1_000));
		await Bun.sleep(30);
		watch.stop();
		await quiet();

		expect(events).toEqual([]);
	});
});
