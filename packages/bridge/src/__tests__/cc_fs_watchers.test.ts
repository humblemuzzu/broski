import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CcFsChange, CcFsWatcherRegistry } from "../handlers/cc_fs_watchers";

const registries: CcFsWatcherRegistry[] = [];
const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-ccfs-"));
	dirs.push(dir);
	return dir;
}

function makeRegistry(deps: Partial<ConstructorParameters<typeof CcFsWatcherRegistry>[0]> = {}): CcFsWatcherRegistry {
	const registry = new CcFsWatcherRegistry({ onChange: () => {}, debounceMs: 20, ...deps });
	registries.push(registry);
	return registry;
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return true;
		await Bun.sleep(25);
	}
	return condition();
}

afterEach(() => {
	for (const registry of registries) registry.closeAll();
	registries.length = 0;
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe("CcFsWatcherRegistry", () => {
	test("watches each directory once and reports changes once per burst", async () => {
		const dir = tempDir();
		const changes: CcFsChange[] = [];
		const registry = makeRegistry({ onChange: (change) => changes.push(change) });

		registry.ensure(dir, "skills", "/repo");
		registry.ensure(dir, "skills", "/repo");
		expect(registry.size).toBe(1);
		expect(registry.has(dir)).toBe(true);

		await Bun.sleep(50);
		writeFileSync(join(dir, "skill.md"), "hello");
		expect(await waitFor(() => changes.length > 0)).toBe(true);

		expect(changes[0]?.kind).toBe("skills");
		expect(changes[0]?.dir).toBe(dir);
		expect(changes[0]?.cwd).toBe("/repo");
	});

	test("closeAll releases every watcher and stops notifications", async () => {
		const dir = tempDir();
		const changes: CcFsChange[] = [];
		const registry = makeRegistry({ onChange: (change) => changes.push(change) });

		registry.ensure(dir, "hooks");
		await Bun.sleep(50);
		writeFileSync(join(dir, "hook.json"), "{}");
		expect(await waitFor(() => changes.length > 0)).toBe(true);

		registry.closeAll();
		expect(registry.size).toBe(0);
		changes.length = 0;

		writeFileSync(join(dir, "hook2.json"), "{}");
		await Bun.sleep(300);
		expect(changes.length).toBe(0);
	});

	test("ignores a missing directory instead of throwing", () => {
		const registry = makeRegistry();
		expect(() => registry.ensure(join(tempDir(), "does-not-exist"), "commands")).not.toThrow();
		expect(registry.size).toBe(0);
	});

	test("prunes watchers that nobody requested within the idle window", () => {
		const dirA = tempDir();
		const dirB = tempDir();
		let clock = 0;
		const registry = makeRegistry({
			idleMs: 600_000,
			now: () => clock,
			pruneIntervalMs: 3_600_000,
		});
		mkdirSync(dirA, { recursive: true });
		mkdirSync(dirB, { recursive: true });

		registry.ensure(dirA, "skills");
		clock = 599_000;
		registry.ensure(dirB, "plugins");

		expect(registry.prune()).toBe(0);
		expect(registry.size).toBe(2);

		clock = 1_000_000;
		expect(registry.prune()).toBe(1);
		expect(registry.has(dirA)).toBe(false);
		expect(registry.has(dirB)).toBe(true);
	});

	test("caps the number of watchers by evicting the least recently used dir", () => {
		const dirA = tempDir();
		const dirB = tempDir();
		const dirC = tempDir();
		let clock = 0;
		const registry = makeRegistry({ maxWatchers: 2, now: () => clock, pruneIntervalMs: 3_600_000 });

		registry.ensure(dirA, "skills");
		clock = 10;
		registry.ensure(dirB, "plugins");
		expect(registry.size).toBe(2);

		clock = 20;
		registry.ensure(dirA, "skills");
		clock = 30;
		registry.ensure(dirC, "hooks");

		expect(registry.size).toBe(2);
		expect(registry.has(dirB)).toBe(false);
		expect(registry.has(dirA)).toBe(true);
		expect(registry.has(dirC)).toBe(true);
	});
});
