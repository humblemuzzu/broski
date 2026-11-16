/**
 * The CLI's own register of the `claude` processes that run (D28). Each writes `<configRoot>/sessions/<pid>.json`
 * while it runs and removes it at exit (CLI 2.1.325: `pid`, `sessionId`, `procStart`, `kind`, `entrypoint`, `status`
 * of `busy | shell | idle | waiting`, and more). A session held by a live process the SDK did not start
 * (`entrypoint` not `sdk-*`) is a terminal's, however quiet its transcript: it opens watch-only, and its status is the
 * session's in the list. A CLI that keeps no register leaves this empty, and the transcript's mtime decides alone.
 */

import { execFile } from "node:child_process";
import { type FSWatcher, watch } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SessionId, SessionStatus } from "../../../contract";
import type { LiveRow } from "../ports/store";
import type { Clock } from "../ports/time";

/** A dropped file is caught by the watch; a killed process, which leaves its file, by this sweep. */
const SWEEP_MS = 5_000;
const SETTLE_MS = 200;
const MAX_RECORDS = 1_000;
/** An entry is under a kilobyte; one past this is not the CLI's. */
const MAX_RECORD_BYTES = 64 * 1024;
const RECORD_FILE = /^\d+\.json$/;

const Entry = z.object({
	pid: z.int().positive(),
	sessionId: z.string().min(1).max(256),
	entrypoint: z.string().max(256).optional(),
	status: z.string().max(64).optional(),
	procStart: z.string().max(64).optional(),
});
type Entry = z.infer<typeof Entry>;

/** `shell` is idle with a shell of the person's still running. */
const STATUS = new Map<string, SessionStatus>([
	["busy", "running"],
	["waiting", "waiting_for_user"],
	["idle", "idle"],
	["shell", "idle"],
]);
const URGENCY: readonly (SessionStatus | undefined)[] = [undefined, "unknown", "idle", "running", "waiting_for_user"];

export interface CliProcess {
	readonly pid: number;
	readonly status: SessionStatus | undefined;
}

/** How a process's start reads to `ps -o lstart=` in UTC, as the CLI wrote it into `procStart`; undefined when unknown. */
export type StartOf = (pid: number) => Promise<string | undefined>;

export function processStart(pid: number): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(
			"ps",
			["-o", "lstart=", "-p", String(pid)],
			{ timeout: 1_000, env: { ...process.env, LC_ALL: "C", TZ: "UTC" } },
			(error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
		);
	});
}

function exists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

/** The file's text, or undefined when it is longer than an entry can be. */
async function readBounded(path: string): Promise<string | undefined> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		return bytesRead > MAX_RECORD_BYTES ? undefined : buffer.toString("utf8", 0, bytesRead);
	} finally {
		await handle.close();
	}
}

function sdkStarted(record: Entry): boolean {
	return record.entrypoint?.startsWith("sdk-") === true;
}

export class CliProcesses {
	private held = new Map<SessionId, CliProcess>();
	/** `pid:procStart` → whether that process is the one running now, so `ps` runs once per process. */
	private verified = new Map<string, boolean>();
	private watcher: FSWatcher | undefined;
	private cancelSweep: (() => void) | undefined;
	private cancelSettle: (() => void) | undefined;
	private scans = 0;
	private applied = 0;
	private stopped = true;

	constructor(
		private readonly dir: string,
		private readonly clock: Clock,
		private readonly changed: (sessionId: SessionId) => void,
		private readonly startOf: StartOf = processStart,
	) {}

	/** The live terminal process that holds `sessionId`, read afresh. */
	async holder(sessionId: SessionId): Promise<CliProcess | undefined> {
		await this.scan();
		return this.held.get(sessionId);
	}

	/** What the list shows of `sessionId` while a terminal process holds it, as last read. */
	row(sessionId: SessionId): LiveRow | undefined {
		const status = this.held.get(sessionId)?.status;
		return status === undefined ? undefined : { status };
	}

	start(): void {
		if (!this.stopped) return;
		this.stopped = false;
		void this.sweep();
	}

	dispose(): void {
		this.stopped = true;
		this.watcher?.close();
		this.watcher = undefined;
		this.cancelSweep?.();
		this.cancelSettle?.();
		this.held = new Map();
		this.verified.clear();
	}

	private async sweep(): Promise<void> {
		await this.scan();
		if (!this.stopped) this.cancelSweep = this.clock.after(SWEEP_MS, () => void this.sweep());
	}

	private watchDir(): void {
		if (this.watcher || this.stopped) return;
		try {
			const watcher = watch(this.dir, { persistent: false }, () => this.settle());
			watcher.on("error", () => {
				watcher.close();
				if (this.watcher === watcher) this.watcher = undefined;
			});
			this.watcher = watcher;
		} catch {
			// No register yet: the sweep tries again.
		}
	}

	/** A burst of writes is read once. */
	private settle(): void {
		if (this.stopped || this.cancelSettle) return;
		this.cancelSettle = this.clock.after(SETTLE_MS, () => {
			this.cancelSettle = undefined;
			if (!this.stopped) void this.scan();
		});
	}

	private async scan(): Promise<void> {
		this.watchDir();
		const scan = ++this.scans;
		const held = await this.read();
		if (scan < this.applied) return;
		this.applied = scan;
		const before = this.held;
		this.held = held;
		if (this.stopped) return;
		for (const sessionId of new Set([...before.keys(), ...held.keys()])) {
			const was = before.get(sessionId);
			const now = held.get(sessionId);
			if (was?.status !== now?.status || (was === undefined) !== (now === undefined)) this.changed(sessionId);
		}
	}

	private async read(): Promise<Map<SessionId, CliProcess>> {
		let names: string[];
		try {
			names = (await readdir(this.dir)).filter((name) => RECORD_FILE.test(name)).slice(0, MAX_RECORDS);
		} catch {
			return new Map();
		}
		const records = await Promise.all(names.map((name) => this.record(name)));
		const seen = new Set<string>();
		const held = new Map<SessionId, CliProcess>();
		for (const record of records) {
			if (record === undefined || sdkStarted(record)) continue;
			const key = `${record.pid}:${record.procStart ?? ""}`;
			seen.add(key);
			if (!(await this.alive(record, key))) continue;
			const found: CliProcess = {
				pid: record.pid,
				status: record.status === undefined ? undefined : STATUS.get(record.status),
			};
			const other = held.get(record.sessionId);
			if (!other || URGENCY.indexOf(found.status) > URGENCY.indexOf(other.status)) held.set(record.sessionId, found);
		}
		for (const key of [...this.verified.keys()]) if (!seen.has(key)) this.verified.delete(key);
		return held;
	}

	private async record(name: string): Promise<Entry | undefined> {
		try {
			const text = await readBounded(join(this.dir, name));
			if (text === undefined) return undefined;
			const parsed = Entry.safeParse(JSON.parse(text));
			return parsed.success && `${parsed.data.pid}.json` === name ? parsed.data : undefined;
		} catch {
			return undefined;
		}
	}

	/** The pid lives and, when the CLI noted its start, is still that process and not a later one given its number. */
	private async alive(record: Entry, key: string): Promise<boolean> {
		if (!exists(record.pid)) return false;
		if (record.procStart === undefined) return true;
		const known = this.verified.get(key);
		if (known !== undefined) return known;
		const start = await this.startOf(record.pid);
		if (start === undefined) return true;
		this.verified.set(key, start === record.procStart);
		return start === record.procStart;
	}
}
