/**
 * A holder (`backends/pi/holder/`) over the fake `pi` of `fake-pi.ts`, in a short temp dir (a unix socket path must
 * fit 103 bytes), and a raw client of its socket that reads every line and writes what a test gives it.
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HolderClock } from "../../../backends/pi/holder/holder";
import { HOLDER_VERSION, type HolderSpec, holderDirOf, socketOf } from "../../../backends/pi/holder/protocol";

const FAKE_PI = resolve(import.meta.dir, "fake-pi.ts");

export interface HolderWorld {
	readonly root: string;
	/** Where holders live. */
	readonly holders: string;
	/** Where the fake `pi` leaves its pid, argv and `eof`. */
	readonly piDir: string;
	readonly sessionId: string;
	readonly dir: string;
	spec(start?: readonly unknown[], cliPath?: string): HolderSpec;
	piPid(): number;
	sawEof(): boolean;
	dispose(): void;
}

export function holderWorld(): HolderWorld {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "bph-")));
	const holders = join(root, "h");
	const piDir = join(root, "pi");
	mkdirSync(piDir);
	const cli = join(root, "fake-pi");
	writeFileSync(cli, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_PI}' "$@"\n`);
	chmodSync(cli, 0o755);
	const sessionId = crypto.randomUUID();
	return {
		root,
		holders,
		piDir,
		sessionId,
		dir: holderDirOf(holders, sessionId),
		spec: (start = [], cliPath = cli) => ({
			version: HOLDER_VERSION,
			sessionId,
			file: join(root, "session.jsonl"),
			cwd: root,
			cliPath,
			args: ["--session", join(root, "session.jsonl")],
			env: {
				PATH: process.env.PATH ?? "",
				HOME: root,
				FAKE_PI_DIR: piDir,
				FAKE_PI_START: JSON.stringify(start),
				FAKE_SECRET: "sk-holder-secret-0123456789",
			},
			extension: "test-extension",
		}),
		piPid: () => (existsSync(join(piDir, "pid")) ? Number(readFileSync(join(piDir, "pid"), "utf8")) : 0),
		sawEof: () => existsSync(join(piDir, "eof")),
		dispose: () => rmSync(root, { recursive: true, force: true }),
	};
}

/** One connection to a holder's socket: every line it got, and the lines it sends. */
export class RawClient {
	readonly lines: string[] = [];
	closed = false;
	private partial = "";
	private readonly waiters = new Set<() => void>();

	private constructor(readonly socket: Socket) {
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			this.partial += chunk;
			const parts = this.partial.split("\n");
			this.partial = parts.pop() ?? "";
			this.lines.push(...parts);
			this.wake();
		});
		socket.on("error", () => undefined);
		socket.on("close", () => {
			this.closed = true;
			this.wake();
		});
	}

	static connect(dir: string): Promise<RawClient> {
		return new Promise((resolve, reject) => {
			const socket = createConnection(socketOf(dir));
			socket.once("connect", () => resolve(new RawClient(socket)));
			socket.once("error", reject);
		});
	}

	/** Every line parsed. */
	records(): Record<string, unknown>[] {
		return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	/** The Pi records between `hello` and `live`. */
	replay(): Record<string, unknown>[] {
		const records = this.records();
		const live = records.findIndex((record) => record.holder === "live");
		return records.slice(1, live);
	}

	send(text: string): void {
		this.socket.write(text);
	}

	async until(done: (client: RawClient) => boolean, what: string, ms = 10_000): Promise<void> {
		const deadline = Date.now() + ms;
		while (!done(this)) {
			if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; got ${this.lines.join("\n")}`);
			await new Promise<void>((resolve) => {
				const wake = () => {
					this.waiters.delete(wake);
					resolve();
				};
				this.waiters.add(wake);
				setTimeout(wake, 50);
			});
		}
	}

	untilRecord(match: (record: Record<string, unknown>) => boolean, what: string): Promise<void> {
		return this.until((client) => client.records().some(match), what);
	}

	close(): void {
		this.socket.destroy();
	}

	private wake(): void {
		for (const wake of [...this.waiters]) wake();
	}
}

/** A clock a test moves by hand. */
export class FakeClock implements HolderClock {
	private time = 0;
	private timers: { at: number; fire: () => void; live: boolean }[] = [];

	now(): number {
		return this.time;
	}

	after(ms: number, fire: () => void): () => void {
		const timer = { at: this.time + ms, fire, live: true };
		this.timers.push(timer);
		return () => {
			timer.live = false;
		};
	}

	advance(ms: number): void {
		this.time += ms;
		const due = this.timers.filter((timer) => timer.live && timer.at <= this.time).sort((a, b) => a.at - b.at);
		this.timers = this.timers.filter((timer) => !due.includes(timer));
		for (const timer of due) if (timer.live) timer.fire();
	}
}

export async function eventually(check: () => boolean, what: string, ms = 10_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(20);
	}
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
