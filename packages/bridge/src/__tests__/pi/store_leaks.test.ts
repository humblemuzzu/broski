/** A store that is watched and disposed over and over leaves no descriptor, timer or event behind. */

import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { type FSWatcher, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay } from "../../backends/pi/ports";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { createSessionStore } from "../../backends/pi/store/session-store";
import { SessionWatch } from "../../backends/pi/store/session-watch";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { SessionBuilder, textBlock, writeSession } from "./store_fixtures";

setDefaultTimeout(120_000);

const NOBODY: LiveOverlay = { row: () => undefined };

let env: PiTestEnv;

beforeEach(() => {
	env = createPiTestEnv();
});

afterEach(() => {
	env.dispose();
});

function openDescriptors(): number {
	for (const dir of ["/dev/fd", "/proc/self/fd"]) {
		try {
			return readdirSync(dir).length;
		} catch {
			// the other platform's path
		}
	}
	throw new Error("no way to count descriptors here");
}

function timers(): number | undefined {
	return process.getActiveResourcesInfo?.().filter((name) => name === "Timeout").length;
}

function session(id: string): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd: env.cwd, version: 3 });
	builder.user("hello", 10);
	builder.assistant([textBlock("hi")], 20);
	return builder;
}

test("100 cycles of watch, list, a write and dispose, over a flat root and a nested one", async () => {
	const nested = join(env.agentDir, "sessions");
	mkdirSync(join(nested, "--project--"), { recursive: true });
	let late = 0;
	const before = { descriptors: openDescriptors(), timers: timers() };

	for (let cycle = 0; cycle < 100; cycle += 1) {
		if (cycle % 2 === 0) process.env.PI_CODING_AGENT_SESSION_DIR = env.sessionDir;
		else delete process.env.PI_CODING_AGENT_SESSION_DIR;
		let disposed = false;
		const store = createSessionStore({
			agentDir: env.agentDir,
			catalog: new CatalogFeed({
				emit: () => {
					if (disposed) late += 1;
				},
			}),
			now: Date.now,
		});
		store.watch(NOBODY);
		await store.list({ archived: false }, { limit: 5 }, NOBODY);
		writeSession(cycle % 2 === 0 ? env.sessionDir : join(nested, "--project--"), session(`cycle-${cycle}`));
		store.dispose();
		disposed = true;
		store.dispose();
	}
	await Bun.sleep(500);

	expect(late).toBe(0);
	expect(openDescriptors() - before.descriptors).toBeLessThanOrEqual(3);
	if (before.timers !== undefined) expect((timers() ?? 0) - before.timers).toBeLessThanOrEqual(1);
});

test("every watcher a watch opens is closed by stop, over 100 cycles and a lost watcher", async () => {
	const nested = join(env.agentDir, "sessions");
	mkdirSync(join(nested, "--project--"), { recursive: true });
	const before = openDescriptors();
	let lost = 0;

	for (let cycle = 0; cycle < 100; cycle += 1) {
		const dirs = piSessionDirs(env.agentDir);
		const index = new SessionIndex(dirs);
		const roots = [
			{ dir: env.sessionDir, nested: false, trusted: true },
			{ dir: nested, nested: true, trusted: true },
		];
		const watcher = new SessionWatch({
			index,
			catalog: new CatalogFeed({ emit: () => undefined }),
			roots: () => roots,
		});
		watcher.start(NOBODY);
		watcher.attach();
		const open: Map<string, FSWatcher> = Reflect.get(watcher, "watchers");
		expect(open.size).toBe(2);
		if (cycle % 10 === 0) {
			open.get(env.sessionDir)?.emit("error", new Error("lost"));
			expect(open.has(env.sessionDir)).toBe(false);
			lost += 1;
		}
		watcher.stop();
		watcher.stop();
		expect(open.size).toBe(0);
	}
	await Bun.sleep(200);

	expect(lost).toBe(10);
	expect(openDescriptors() - before).toBeLessThanOrEqual(3);
});

test("a store disposed before its first listing never opens a watcher", async () => {
	const before = openDescriptors();
	for (let cycle = 0; cycle < 50; cycle += 1) {
		const store = createSessionStore({
			agentDir: env.agentDir,
			catalog: new CatalogFeed({ emit: () => undefined }),
			now: Date.now,
		});
		store.watch(NOBODY);
		store.dispose();
		await store.list({ archived: false }, { limit: 5 }, NOBODY);
	}
	await Bun.sleep(200);

	expect(openDescriptors() - before).toBeLessThanOrEqual(3);
});
