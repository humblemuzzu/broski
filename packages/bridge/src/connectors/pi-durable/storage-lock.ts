import { closeSync, constants, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export const PI_DURABLE_LOCK_FILE = ".broski-storage.lock";

export type PiDurableLockHolder = { pid: number; startedAtMs: number };

export type PiDurableStorageLock = {
	readonly path: string;
	readonly pid: number;
	readonly acquiredAtMs: number;
	release(): void;
};

export class PiDurableStorageLockedError extends Error {
	readonly directory: string;
	readonly holder: PiDurableLockHolder | undefined;

	constructor(directory: string, holder: PiDurableLockHolder | undefined) {
		super(`pi-durable storage ${directory} is locked by pid ${holder?.pid ?? "unknown"}`);
		this.name = "PiDurableStorageLockedError";
		this.directory = directory;
		this.holder = holder;
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return Object.fromEntries(Object.entries(value));
}

export function isPiDurableProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

export function readPiDurableLockHolder(directory: string): PiDurableLockHolder | undefined {
	let text: string;
	try {
		text = readFileSync(join(directory, PI_DURABLE_LOCK_FILE), "utf8");
	} catch {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	const record = asRecord(parsed);
	const pid = record?.pid;
	if (typeof pid !== "number") return undefined;
	const startedAtMs = record?.startedAtMs;
	return { pid, startedAtMs: typeof startedAtMs === "number" ? startedAtMs : 0 };
}

function reclaimable(holder: PiDurableLockHolder | undefined): boolean {
	if (holder === undefined) return true;
	if (holder.pid === process.pid) return false;
	return !isPiDurableProcessAlive(holder.pid);
}

/**
 * pi-durable has no cross-process guard of its own, so one `O_CREAT|O_EXCL` lock file per storage directory keeps a
 * second bridge (or `--attach`) out. A holder whose pid is gone is reclaimed once, so a SIGKILLed bridge cannot brick
 * a session.
 */
export function acquirePiDurableStorageLock(directory: string): PiDurableStorageLock {
	mkdirSync(directory, { recursive: true });
	const path = join(directory, PI_DURABLE_LOCK_FILE);
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
			const acquiredAtMs = Date.now();
			writeSync(fd, JSON.stringify({ pid: process.pid, startedAtMs: acquiredAtMs }));
			closeSync(fd);
			return {
				path,
				pid: process.pid,
				acquiredAtMs,
				release: () => {
					try {
						unlinkSync(path);
					} catch {}
				},
			};
		} catch (error) {
			const code = error instanceof Error && "code" in error ? error.code : undefined;
			if (code !== "EEXIST") throw error;
			const holder = readPiDurableLockHolder(directory);
			if (!reclaimable(holder)) throw new PiDurableStorageLockedError(directory, holder);
			try {
				unlinkSync(path);
			} catch {}
		}
	}
	throw new PiDurableStorageLockedError(directory, readPiDurableLockHolder(directory));
}
