import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PI_DURABLE_META_FILE,
	PiDurableContainmentError,
	PiDurableSessionNotFoundError,
	PiDurableSessionStore,
} from "../../connectors/pi-durable/session-store";
import { PI_DURABLE_LOCK_FILE, PiDurableStorageLockedError } from "../../connectors/pi-durable/storage-lock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "pi-durable-store-"));
}

function storeWithClock(root: string, clock: { nowMs: number }): PiDurableSessionStore {
	return new PiDurableSessionStore({ root, now: () => clock.nowMs });
}

describe("pi-durable session store", () => {
	test("creates a session directory with a uuid id and its meta", async () => {
		const root = tempRoot();
		const store = new PiDurableSessionStore({ root });
		const meta = await store.create({ cwd: "/tmp/project", title: "First" });

		expect(meta.id).toMatch(UUID);
		expect(meta.cwd).toBe("/tmp/project");
		expect(meta.title).toBe("First");
		expect(meta.createdAtMs).toBe(meta.updatedAtMs);
		expect(JSON.parse(readFileSync(join(root, meta.id, PI_DURABLE_META_FILE), "utf8"))).toEqual(meta);
		expect(await store.read(meta.id)).toEqual(meta);
		expect(await store.list()).toEqual([meta]);
	});

	test("round-trips model and thinking level", async () => {
		const root = tempRoot();
		const store = new PiDurableSessionStore({ root });
		const meta = await store.create({
			cwd: "/tmp/project",
			model: { provider: "anthropic", modelId: "claude-haiku-4-5" },
			thinkingLevel: "high",
		});

		expect(await store.read(meta.id)).toEqual(meta);
		expect(meta.model).toEqual({ provider: "anthropic", modelId: "claude-haiku-4-5" });
		expect(meta.thinkingLevel).toBe("high");
	});

	test("lists newest first and never opens a storage", async () => {
		const root = tempRoot();
		const clock = { nowMs: 1_000 };
		const store = storeWithClock(root, clock);
		const older = await store.create({ cwd: "/tmp/a" });
		clock.nowMs = 2_000;
		const newer = await store.create({ cwd: "/tmp/b" });

		writeFileSync(join(root, older.id, "main.jsonl"), "corrupt, but listing must not care\n");
		writeFileSync(join(root, "not-a-session.txt"), "ignored\n");
		mkdirSync(join(root, "not-a-session"), { recursive: true });

		const listed = await store.list();
		expect(listed.map((meta) => meta.id)).toEqual([newer.id, older.id]);
		expect(listed.map((meta) => meta.updatedAtMs)).toEqual([2_000, 1_000]);
	});

	test("updates meta and stamps a new updatedAtMs", async () => {
		const root = tempRoot();
		const clock = { nowMs: 1_000 };
		const store = storeWithClock(root, clock);
		const meta = await store.create({ cwd: "/tmp/project" });

		clock.nowMs = 5_000;
		const updated = await store.update(meta.id, { title: "Renamed", thinkingLevel: "low" });
		expect(updated.title).toBe("Renamed");
		expect(updated.thinkingLevel).toBe("low");
		expect(updated.createdAtMs).toBe(1_000);
		expect(updated.updatedAtMs).toBe(5_000);
		expect(await store.read(meta.id)).toEqual(updated);
	});

	test("returns undefined for an unknown or corrupt session", async () => {
		const root = tempRoot();
		const store = new PiDurableSessionStore({ root });
		expect(await store.read("11111111-1111-1111-1111-111111111111")).toBeUndefined();

		const meta = await store.create({ cwd: "/tmp/project" });
		writeFileSync(join(root, meta.id, PI_DURABLE_META_FILE), "{");
		expect(await store.read(meta.id)).toBeUndefined();
	});

	test("refuses a session id that could escape the root", async () => {
		const root = tempRoot();
		const store = new PiDurableSessionStore({ root });
		expect(() => store.sessionDir("../escape")).toThrow(PiDurableSessionNotFoundError);
		expect(() => store.sessionDir("a/b")).toThrow(PiDurableSessionNotFoundError);
		expect(() => store.sessionDir("")).toThrow(PiDurableSessionNotFoundError);
		expect(await store.read("../escape")).toBeUndefined();
	});

	test("deletes a session directory", async () => {
		const root = tempRoot();
		const store = new PiDurableSessionStore({ root });
		const meta = await store.create({ cwd: "/tmp/project" });
		await store.delete(meta.id);
		expect(await store.read(meta.id)).toBeUndefined();
		expect(await store.list()).toEqual([]);
	});

	test("refuses to delete a session whose lock is held by a live pid", async () => {
		const root = tempRoot();
		const store = new PiDurableSessionStore({ root });
		const meta = await store.create({ cwd: "/tmp/project" });
		writeFileSync(join(root, meta.id, PI_DURABLE_LOCK_FILE), JSON.stringify({ pid: process.pid, startedAtMs: 0 }));

		await expect(store.delete(meta.id)).rejects.toBeInstanceOf(PiDurableStorageLockedError);
		expect(await store.read(meta.id)).toEqual(meta);
	});

	test("reclaims the lock of a dead pid and then deletes", async () => {
		const root = tempRoot();
		const store = new PiDurableSessionStore({ root });
		const meta = await store.create({ cwd: "/tmp/project" });
		writeFileSync(join(root, meta.id, PI_DURABLE_LOCK_FILE), JSON.stringify({ pid: 999_999, startedAtMs: 0 }));

		await store.delete(meta.id);
		expect(await store.read(meta.id)).toBeUndefined();
	});

	test("refuses to escape the root through a session symlink", async () => {
		const root = tempRoot();
		const outside = mkdtempSync(join(tmpdir(), "pi-durable-outside-"));
		const store = new PiDurableSessionStore({ root });
		const meta = await store.create({ cwd: "/tmp/project" });

		rmSync(join(root, meta.id), { recursive: true, force: true });
		writeFileSync(join(outside, PI_DURABLE_META_FILE), JSON.stringify(meta));
		symlinkSync(outside, join(root, meta.id));

		await expect(store.delete(meta.id)).rejects.toBeInstanceOf(PiDurableContainmentError);
		expect(readFileSync(join(outside, PI_DURABLE_META_FILE), "utf8")).toContain(meta.id);
		rmSync(outside, { recursive: true, force: true });
	});
});
