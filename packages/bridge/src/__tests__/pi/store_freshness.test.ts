/**
 * The store's caches against files that change under them and reads that fail: a build in flight is not served to a
 * caller that saw the file grow, a failed re-scan does not end the watch, a project setting Pi would reject breaks
 * nothing, an id no file holds is not looked for in every directory each time, only appended bytes are read again,
 * a read short of descriptors is remembered as nothing, and a file of too many entries is refused.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay } from "../../backends/pi/ports";
import { BranchItems } from "../../backends/pi/store/branch-items";
import { branchTo, lastEntryId, MAX_INDEXED_ENTRIES } from "../../backends/pi/store/jsonl-reader";
import { piSessionDirs, type SessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { createSessionStore } from "../../backends/pi/store/session-store";
import { SessionWatch } from "../../backends/pi/store/session-watch";
import type { CatalogEvent } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { runProbe } from "./helpers/probe";
import { itemsOfEntryStub, SessionBuilder, T0, textBlock, toolCall, writeSession } from "./store_fixtures";

let env: PiTestEnv;

const NOBODY: LiveOverlay = { row: () => undefined };

beforeEach(() => {
	env = createPiTestEnv();
});

afterEach(() => {
	mock.restore();
	env.dispose();
});

function chat(id: string, turns: number): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd: env.cwd, version: 3 });
	for (let turn = 0; turn < turns; turn += 1) builder.user(`turn ${turn}`, turn);
	return builder;
}

describe("a span index built while the file grows", () => {
	test("is not served to a caller that saw the file grow: it gets one with the new line", async () => {
		const path = writeSession(env.sessionDir, chat("growing", 300_000));
		const index = new SessionIndex(piSessionDirs(env.agentDir));

		const first = index.fileIndex(path);
		await Bun.sleep(3);
		appendFileSync(
			path,
			`${JSON.stringify({ type: "custom", customType: "x", id: "ffffffff", parentId: null, timestamp: "2026-03-01T10:00:00.000Z" })}\n`,
		);
		const second = await index.fileIndex(path);
		await first;

		expect(second !== undefined && second !== "too_large" && second.entries.length).toBe(300_001);
	}, 30_000);
});

describe("the watch, when a re-scan fails", () => {
	test("goes on: the failure is no unhandled rejection, and the next change is still announced", async () => {
		const events: CatalogEvent[] = [];
		const index = new SessionIndex(piSessionDirs(env.agentDir));
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		const watch = new SessionWatch({
			index,
			catalog: new CatalogFeed({ emit: (event) => events.push(event) }),
			roots: () => [{ dir: env.sessionDir, nested: false, trusted: true }],
		});
		try {
			spyOn(index, "refresh").mockRejectedValueOnce(Object.assign(new Error("EIO: i/o error"), { code: "EIO" }));
			watch.start(NOBODY);
			writeSession(env.sessionDir, chat("first", 1));
			const announced = () =>
				events.flatMap((event) => (event.type === "session_updated" ? [event.summary.session.sessionId] : []));
			// `fs.watch` on macOS starts asynchronously and may miss the first writes: the second file is written again
			// until a re-scan reports it, and the failing one is whichever re-scan ran first.
			const deadline = Date.now() + 5_000;
			while (!announced().includes("second") && Date.now() < deadline) {
				writeSession(env.sessionDir, chat("second", 1));
				const retry = Date.now() + 300;
				while (!announced().includes("second") && Date.now() < retry) await Bun.sleep(20);
			}

			expect(announced()).toEqual(expect.arrayContaining(["first", "second"]));
			expect(unhandled).toEqual([]);
		} finally {
			watch.stop();
			process.off("unhandledRejection", onUnhandled);
		}
	});
});

describe("a project whose settings name a sessionDir Pi itself would reject", () => {
	test("leaves every read of the store a value: a file: URL with a host names no directory", async () => {
		delete process.env.PI_CODING_AGENT_SESSION_DIR;
		mkdirSync(join(env.cwd, ".pi"), { recursive: true });
		writeFileSync(join(env.cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "file://elsewhere/x" }));
		const store = createSessionStore({
			agentDir: env.agentDir,
			catalog: new CatalogFeed({ emit: () => {} }),
			now: Date.now,
		});
		store.watch(NOBODY);
		try {
			const listed = await store.list({ cwd: env.cwd }, { limit: 5 }, NOBODY);
			expect(listed).toEqual({ status: "accepted", page: { items: [] } });
			expect((await store.get("nobody", NOBODY)).status).toBe("rejected");
			expect((await store.transcript("nobody", { limit: 5 }, NOBODY)).status).toBe("rejected");
			expect(await store.locate("nobody")).toMatchObject({ status: "rejected" });
			expect(store.sessionDirFor(env.cwd)).toContain(join(env.agentDir, "sessions"));
		} finally {
			store.dispose();
		}
	});
});

describe("an id no file holds", () => {
	test("is looked for in the directories once, until the index learns of a new session", async () => {
		const real = piSessionDirs(env.agentDir);
		let scans = 0;
		const dirs: SessionDirs = {
			forCwd: (cwd) => real.forCwd(cwd),
			toScan: (cwd) => {
				scans += 1;
				return real.toScan(cwd);
			},
			roots: () => real.roots(),
			know: (cwd) => real.know(cwd),
		};
		const index = new SessionIndex(dirs);
		writeSession(env.sessionDir, chat("known", 1));

		expect(await index.find("nobody")).toBeUndefined();
		const after = scans;
		expect(await index.find("nobody")).toBeUndefined();
		expect(scans).toBe(after);

		writeSession(env.sessionDir, chat("nobody", 1));
		await index.refresh(env.sessionDir);
		expect((await index.find("nobody"))?.sessionId).toBe("nobody");
	});
});

describe("a session's title and origin, after the file grew", () => {
	test("are read on from where the last read stopped, not from the start again", async () => {
		const builder = new SessionBuilder({ id: "titled", cwd: env.cwd, version: 3 });
		builder.sessionInfo("First name", 0);
		for (let turn = 1; turn <= 20; turn += 1) builder.user(`turn ${turn}`, turn);
		const path = writeSession(env.sessionDir, builder);
		const index = new SessionIndex(piSessionDirs(env.agentDir));
		const head = await index.find("titled");
		if (!head) throw new Error("not found");
		expect((await index.complete(head)).name).toBe("First name");

		const text = builder.text();
		writeFileSync(path, text.replace("First name", "Other name"));
		builder.custom("broski.origin", undefined, 20);
		appendFileSync(path, `${JSON.stringify(builder.lines.at(-1))}\n`);
		const grown = await index.headAt(path);
		if (!grown) throw new Error("gone");
		const read = await index.complete(grown);

		expect(read.origin).toBe("broski");
		expect(read.name).toBe("First name");
	});
});

describe("a page that reads the entries beside the one it maps", () => {
	test("reads each from the entries it already read, not from the file again", async () => {
		const builder = new SessionBuilder({ id: "tools", cwd: env.cwd, version: 3 });
		builder.user("go", 0);
		builder.assistant([textBlock("calling"), toolCall("call-1")], 1);
		builder.toolResult("call-1", "done", 2);
		builder.assistant([textBlock("after")], 3);
		const path = writeSession(env.sessionDir, builder);
		const index = new SessionIndex(piSessionDirs(env.agentDir));
		const file = await index.fileIndex(path);
		if (file === undefined || file === "too_large") throw new Error("not indexed");
		const items = new BranchItems(file, branchTo(file, lastEntryId(file)), itemsOfEntryStub);

		await items.itemsAt(3);
		renameSync(path, `${path}.moved`);
		const [result] = await items.itemsAt(2);

		expect(result).toMatchObject({ kind: "tool_result", toolCallId: "e0000002:1" });
	});
});

describe("a read the file system fails for want of descriptors", () => {
	test("is a backend_error, and the session is read again once descriptors are free: nothing remembers it as gone", async () => {
		const script = join(import.meta.dir, "helpers", "probe-descriptors.ts");
		const result = await runProbe([script], { timeoutMs: 20_000, maxRssMb: 1_500, maxOpenFiles: 256 });
		if (result.status !== "done") throw new Error(`the probe ended ${JSON.stringify(result)}`);
		expect(JSON.parse(result.output)).toEqual({ before: "kept", starved: "backend_error", after: "kept" });
	});
});

describe("a session of more entries than the index holds", () => {
	test("is refused as too large to read rather than indexed whole", async () => {
		const path = join(env.sessionDir, "many.jsonl");
		const header = JSON.stringify({
			type: "session",
			version: 3,
			id: "many",
			timestamp: new Date(T0).toISOString(),
			cwd: env.cwd,
		});
		const lines = [header];
		for (let entry = 0; entry <= MAX_INDEXED_ENTRIES; entry += 1) {
			lines.push(`{"type":"custom","id":"${entry.toString(16).padStart(8, "0")}","parentId":null,"timestamp":""}`);
		}
		writeFileSync(path, `${lines.join("\n")}\n`);
		const store = createSessionStore({
			agentDir: env.agentDir,
			catalog: new CatalogFeed({ emit: () => {} }),
			now: Date.now,
		});
		const read = await store.transcript("many", { limit: 5 }, NOBODY);
		expect(read).toMatchObject({
			status: "rejected",
			rejection: { code: "backend_error", message: expect.stringContaining("too large") },
		});
	}, 60_000);
});
