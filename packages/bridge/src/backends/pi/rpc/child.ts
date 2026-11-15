/**
 * One `pi --mode rpc` process: stdout read without pause into strict JSONL records, stdin written as fast as the pipe
 * takes it, stderr kept as a bounded tail for diagnostics and never read as protocol (pi-coding-agent 1.5.2
 * `docs/rpc.md:50-56, 89`). It leads a process group of its own, so a kill reaches what it started.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { clipEnd } from "../bounds";
import { type JsonlItem, JsonlSplitter } from "./jsonl";

export interface PiLaunch {
	readonly cliPath: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
}

export interface PiExit {
	readonly code: number | null;
	readonly signal: string | null;
	/** Why the process could not start at all. */
	readonly error?: string;
}

/** The last characters of stderr kept, for the reason a process failed. */
const STDERR_KEPT_CHARS = 8 * 1024;

/**
 * The shutdown ladder of `docs/rpc.md:91-97`: stdin closed, then SIGTERM, then SIGKILL. Pi disposes its session and
 * finishes pending work on EOF; a second signal during that shutdown exits at once, so SIGTERM is sent once.
 *
 * The total is bounded by the bridge's own shutdown: a host lets its run settle for `SETTLE_DEADLINE_MS`, then `stop()`
 * runs, and all of it must end inside the teardown's 5 s (`lifecycle/teardown.ts`), since a `pi` that outlives the bridge
 * and is stuck is never killed by anyone. Inside that bound a healthy `pi` is gone in a few hundred ms. What a longer wait
 * could save is an OAuth refresh in flight, whose rotated token Pi saves before it exits (pi-coding-agent 1.5.2
 * `CHANGELOG.md:75`); a refresh round trip takes well under a second. Session files are appended synchronously
 * (`dist/core/session-manager.js:813`), so no timing cuts one.
 */
export const EXIT_AFTER_EOF_MS = 1_500;
export const EXIT_AFTER_TERM_MS = 750;
const EXIT_AFTER_KILL_MS = 250;
/** The longest `stop()` takes. */
export const STOP_BUDGET_MS = EXIT_AFTER_EOF_MS + EXIT_AFTER_TERM_MS + EXIT_AFTER_KILL_MS;

export type RecordSink = (item: JsonlItem) => void;

export class PiProcess {
	readonly exited: Promise<PiExit>;
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly splitter = new JsonlSplitter();
	private stderr = "";
	private readonly outbox: string[] = [];
	private waitingForDrain = false;
	private inputClosing = false;
	private finished: PiExit | undefined;

	constructor(launch: PiLaunch, records: RecordSink) {
		this.child = spawn(launch.cliPath, ["--mode", "rpc", ...launch.args], {
			cwd: launch.cwd,
			env: { ...launch.env },
			detached: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.exited = new Promise((resolve) => {
			const finish = (exit: PiExit) => {
				if (this.finished !== undefined) return;
				this.finished = exit;
				for (const item of this.splitter.end()) records(item);
				resolve(exit);
			};
			this.child.on("error", (error) => finish({ code: null, signal: null, error: error.message }));
			this.child.on("close", (code, signal) => finish({ code, signal }));
		});
		this.child.stdout.on("data", (chunk: Buffer) => {
			for (const item of this.splitter.push(chunk)) records(item);
		});
		this.child.stderr.on("data", (chunk: Buffer) => {
			this.stderr = clipEnd(this.stderr + chunk.toString("utf8"), STDERR_KEPT_CHARS);
		});
		this.child.stdin.on("error", () => undefined);
	}

	get pid(): number | undefined {
		return this.child.pid;
	}

	get running(): boolean {
		return this.finished === undefined;
	}

	/** What the process wrote on stderr lately, trimmed. */
	stderrTail(): string {
		return this.stderr.trim();
	}

	/** One record, after the ones before it; nothing once stdin is closing. */
	write(record: string): void {
		if (this.inputClosing || this.finished !== undefined) return;
		this.outbox.push(record);
		this.flush();
	}

	/** Stops reading stdout until `resume`, so Pi waits on the pipe instead of the bridge holding what it cannot use yet. */
	pause(): void {
		this.child.stdout.pause();
	}

	resume(): void {
		this.child.stdout.resume();
	}

	/** Ends the process however long it takes to go, within the ladder's budget. */
	async stop(): Promise<PiExit> {
		this.inputClosing = true;
		this.flush();
		if (await this.exitsWithin(EXIT_AFTER_EOF_MS)) return this.exited;
		this.signal("SIGTERM");
		if (await this.exitsWithin(EXIT_AFTER_TERM_MS)) return this.exited;
		this.signal("SIGKILL");
		await this.exitsWithin(EXIT_AFTER_KILL_MS);
		return this.finished ?? { code: null, signal: "SIGKILL" };
	}

	private flush(): void {
		while (!this.waitingForDrain && this.outbox.length > 0) {
			const record = this.outbox.shift() ?? "";
			if (this.child.stdin.write(record)) continue;
			this.waitingForDrain = true;
			this.child.stdin.once("drain", () => {
				this.waitingForDrain = false;
				this.flush();
			});
		}
		if (this.inputClosing && !this.waitingForDrain && this.outbox.length === 0 && !this.child.stdin.writableEnded) {
			this.child.stdin.end();
		}
	}

	private async exitsWithin(ms: number): Promise<boolean> {
		if (this.finished !== undefined) return true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<false>((resolve) => {
			timer = setTimeout(() => resolve(false), ms);
		});
		try {
			return await Promise.race([this.exited.then(() => true), timedOut]);
		} finally {
			clearTimeout(timer);
		}
	}

	/** The whole group; the process alone when it leads none (it never started, or already went). */
	private signal(signal: "SIGTERM" | "SIGKILL"): void {
		const pid = this.child.pid;
		try {
			if (pid !== undefined) process.kill(-pid, signal);
		} catch {
			try {
				this.child.kill(signal);
			} catch {
				// Already gone.
			}
		}
	}
}
