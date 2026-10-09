import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { openPiDurableSessionRuntime } from "../../connectors/pi-durable/session-runtime";
import {
	acquirePiDurableStorageLock,
	isPiDurableProcessAlive,
	PI_DURABLE_LOCK_FILE,
	PiDurableStorageLockedError,
	readPiDurableLockHolder,
} from "../../connectors/pi-durable/storage-lock";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-durable-lock-"));
}

function deadPid(): number {
	for (let pid = 999_990; pid < 1_000_000; pid++) {
		if (!isPiDurableProcessAlive(pid)) return pid;
	}
	throw new Error("no dead pid found in the probe range");
}

describe("pi-durable storage lock", () => {
	test("writes its own pid and refuses a second holder while it is held", () => {
		const directory = tempDir();
		const lock = acquirePiDurableStorageLock(directory);

		expect(lock.pid).toBe(process.pid);
		expect(JSON.parse(readFileSync(join(directory, PI_DURABLE_LOCK_FILE), "utf8"))).toEqual({
			pid: process.pid,
			startedAtMs: lock.acquiredAtMs,
		});
		expect(readPiDurableLockHolder(directory)).toEqual({ pid: process.pid, startedAtMs: lock.acquiredAtMs });

		let refusal: unknown;
		try {
			acquirePiDurableStorageLock(directory);
		} catch (error) {
			refusal = error;
		}
		expect(refusal).toBeInstanceOf(PiDurableStorageLockedError);
		expect(refusal instanceof PiDurableStorageLockedError ? refusal.holder?.pid : undefined).toBe(process.pid);
		expect(refusal instanceof PiDurableStorageLockedError ? refusal.message : "").toContain("locked by pid");

		lock.release();
	});

	test("reclaims a lock left behind by a dead pid, once", () => {
		const directory = tempDir();
		const stale = deadPid();
		writeFileSync(join(directory, PI_DURABLE_LOCK_FILE), JSON.stringify({ pid: stale, startedAtMs: 0 }));
		expect(readPiDurableLockHolder(directory)).toEqual({ pid: stale, startedAtMs: 0 });

		const lock = acquirePiDurableStorageLock(directory);
		expect(lock.pid).toBe(process.pid);
		expect(readPiDurableLockHolder(directory)?.pid).toBe(process.pid);

		lock.release();
		expect(readPiDurableLockHolder(directory)).toBeUndefined();
	});

	test("release removes the lock file and is idempotent", () => {
		const directory = tempDir();
		const lock = acquirePiDurableStorageLock(directory);
		lock.release();
		expect(readPiDurableLockHolder(directory)).toBeUndefined();
		lock.release();
		expect(readPiDurableLockHolder(directory)).toBeUndefined();

		const reacquired = acquirePiDurableStorageLock(directory);
		expect(reacquired.pid).toBe(process.pid);
		reacquired.release();
	});

	test("creates the directory it locks and tolerates a missing or broken lock file", () => {
		const directory = join(tempDir(), "nested", "session");
		expect(readPiDurableLockHolder(directory)).toBeUndefined();

		const lock = acquirePiDurableStorageLock(directory);
		writeFileSync(join(directory, PI_DURABLE_LOCK_FILE), "not json");
		expect(readPiDurableLockHolder(directory)).toBeUndefined();
		writeFileSync(join(directory, PI_DURABLE_LOCK_FILE), JSON.stringify({ startedAtMs: 5 }));
		expect(readPiDurableLockHolder(directory)).toBeUndefined();
		lock.release();
	});

	test("knows when a pid is alive", () => {
		expect(isPiDurableProcessAlive(process.pid)).toBe(true);
		expect(isPiDurableProcessAlive(deadPid())).toBe(false);
		expect(isPiDurableProcessAlive(0)).toBe(false);
		expect(isPiDurableProcessAlive(-1)).toBe(false);
	});

	test("releases the lock when opening the storage fails", async () => {
		const directory = tempDir();
		writeFileSync(join(directory, "main.jsonl"), "this is not a commit log\n", "utf8");

		await expect(
			openPiDurableSessionRuntime({
				sessionId: "broken",
				directory,
				cwd: directory,
				models: createModels(),
				agent: { model: { provider: "faux", modelId: "faux-1" } },
				context: BACKGROUND_CONTEXT,
			}),
		).rejects.toThrow();

		expect(readPiDurableLockHolder(directory)).toBeUndefined();
	});
});
