/**
 * The holder of one hosted session's `pi`: a process of its own session, started by a bridge and outliving it, that
 * keeps `pi`'s stdin open, reads its stdout without pause and passes both through to whichever bridge is attached on
 * its socket, one at a time, the newest winning. A bridge that attaches is first given what it missed (`ReplayLog`).
 * It ends with its `pi`: asked to (`stop`, by the shutdown ladder of `rpc/child.ts`), by `pi` itself, when it has been
 * unattached for too long (`orphan-policy.ts`), or when its directory is gone.
 */

import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { PiProcess } from "../rpc/child";
import { isRunDump, type JsonlItem } from "../rpc/jsonl";
import { BACKLOG_LIMITS, type BacklogLimits, BacklogWatch } from "./backlog";
import { ORPHAN_LIMITS, type OrphanLimits, orphanDeadline } from "./orphan-policy";
import {
	controlLine,
	controlOf,
	type ExitFrame,
	HOLDER_VERSION,
	type HolderMeta,
	type HolderSpec,
	metaOf,
	socketOf,
} from "./protocol";
import { ReplayLog } from "./replay-log";

export interface HolderClock {
	now(): number;
	/** Runs `fire` after `ms`; the returned function cancels it. */
	after(ms: number, fire: () => void): () => void;
}

const REAL_CLOCK: HolderClock = {
	now: () => performance.now(),
	after: (ms, fire) => {
		const timer = setTimeout(fire, ms);
		return () => clearTimeout(timer);
	},
};

export interface HolderOptions {
	readonly dir: string;
	readonly spec: HolderSpec;
	readonly clock?: HolderClock;
	readonly limits?: OrphanLimits;
	/** How long a `pi` that ended before any bridge attached waits for one to hear why. */
	readonly lingerMs?: number;
	/** How often the holder looks for its own directory. */
	readonly watchMs?: number;
	/** When a bridge that has fallen behind is dropped (`backlog.ts`). */
	readonly backlog?: BacklogLimits;
}

export class Holder {
	private readonly clock: HolderClock;
	private readonly limits: OrphanLimits;
	private readonly log: ReplayLog;
	private readonly server: Server;
	private readonly finished = Promise.withResolvers<void>();
	private pi: PiProcess | undefined;
	private client: Socket | undefined;
	private backlog: BacklogWatch | undefined;
	private everAttached = false;
	private exit: ExitFrame | undefined;
	private orphanedAt: number;
	private idleSince: number;
	private wasRunning = false;
	private deadline: number | undefined;
	private cancelOrphan: (() => void) | undefined;
	private watch: ReturnType<typeof setInterval> | undefined;
	private stopping = false;
	private ending = false;

	constructor(private readonly options: HolderOptions) {
		this.clock = options.clock ?? REAL_CLOCK;
		this.limits = options.limits ?? ORPHAN_LIMITS;
		this.log = new ReplayLog(() => this.clock.now());
		this.orphanedAt = this.clock.now();
		this.idleSince = this.orphanedAt;
		this.server = createServer((socket) => this.attached(socket));
	}

	/** Resolves once `pi` has ended and the holder's directory is gone. */
	get done(): Promise<void> {
		return this.finished.promise;
	}

	/** Listens first, so a bridge can reach the holder whatever `pi` does; then writes `holder.json`, then starts `pi`. */
	async start(): Promise<void> {
		const { dir, spec } = this.options;
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		chmodSync(dir, 0o700);
		const socket = socketOf(dir);
		if (existsSync(socket)) unlinkSync(socket);
		await new Promise<void>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(socket, () => resolve());
		});
		chmodSync(socket, 0o600);
		this.writeMeta(undefined);
		const pi = new PiProcess({ cliPath: spec.cliPath, args: spec.args, cwd: spec.cwd, env: spec.env }, (item) =>
			this.fromPi(item),
		);
		this.pi = pi;
		this.writeMeta(pi.pid);
		void pi.ended.then(
			(end) => end.kind === "exit" && this.piEnded({ holder: "exit", ...end.exit, stderr: end.stderr }),
		);
		this.review();
		const watchMs = this.options.watchMs ?? 2_000;
		this.watch = setInterval(() => {
			if (!existsSync(metaOf(dir))) this.stop();
		}, watchMs);
		this.watch.unref();
	}

	/**
	 * Ends `pi` by the shutdown ladder; the holder ends after it. A dialog still open gets Pi's default first, as a
	 * bridge's own stop gives it (`InteractionDesk.expireAll`): no human can answer it any more, and an extension that
	 * waits on it would otherwise hold Pi's shutdown until the ladder kills it.
	 */
	stop(): void {
		if (this.stopping) return;
		this.stopping = true;
		const pi = this.pi;
		if (pi === undefined) {
			this.end();
			return;
		}
		for (const id of this.log.openAsks()) {
			this.log.resolved(id);
			pi.write(`${JSON.stringify({ type: "extension_ui_response", id, cancelled: true })}\n`);
		}
		void pi.stop();
	}

	private attached(socket: Socket): void {
		const previous = this.client;
		if (previous !== undefined) {
			this.client = undefined;
			this.send(previous, controlLine({ holder: "replaced" }));
			previous.end();
		}
		this.client = socket;
		this.everAttached = true;
		this.review();
		const { lines, truncated, runStartedAt } = this.log.replay();
		const { sessionId, extension } = this.options.spec;
		const hello = { holder: "hello" as const, version: HOLDER_VERSION, sessionId, extension };
		socket.write(
			controlLine({ ...hello, replayed: lines.length, truncated, ...(runStartedAt !== undefined && { runStartedAt }) }),
		);
		for (const line of lines) socket.write(`${line}\n`);
		socket.write(controlLine({ holder: "live" }));
		this.backlog?.stop();
		this.backlog = new BacklogWatch(socket, this.clock, this.options.backlog ?? BACKLOG_LIMITS, () => socket.destroy());
		socket.setEncoding("utf8");
		let partial = "";
		socket.on("data", (chunk: string) => {
			if (this.client === socket) partial = this.fromBridge(partial + chunk);
		});
		socket.on("error", () => undefined);
		socket.on("close", () => {
			if (this.client !== socket) return;
			this.client = undefined;
			this.backlog?.stop();
			this.backlog = undefined;
			this.orphanedAt = this.clock.now();
			this.review();
		});
		if (this.exit !== undefined) this.tellAndEnd(socket, this.exit);
	}

	/** Complete lines go to `pi`; what follows the last newline waits for the rest, and goes if this bridge does. */
	private fromBridge(text: string): string {
		let start = 0;
		for (let newline = text.indexOf("\n"); newline !== -1; newline = text.indexOf("\n", start)) {
			this.fromBridgeLine(text.slice(start, newline));
			start = newline + 1;
		}
		return text.slice(start);
	}

	private fromBridgeLine(line: string): void {
		const control = controlOf(line);
		if (control !== undefined) {
			if (control.holder === "stop") this.stop();
			return;
		}
		if (line.includes('"extension_ui_response"')) {
			const id = answeredId(line);
			if (id !== undefined) this.log.resolved(id);
		}
		this.pi?.write(`${line}\n`);
	}

	private fromPi(item: JsonlItem): void {
		const client = this.client;
		if (item.kind === "oversized") {
			if (client !== undefined && !isRunDump(item)) {
				this.send(client, controlLine({ holder: "oversized", bytes: item.bytes }));
			}
			return;
		}
		this.log.take(item.text);
		if (client !== undefined) this.send(client, `${item.text}\n`);
		const { running } = this.log.state();
		if (this.wasRunning && !running) this.idleSince = this.clock.now();
		this.wasRunning = running;
		if (client === undefined) this.review();
	}

	private send(socket: Socket, data: string): void {
		if (socket.destroyed) return;
		socket.write(data);
		if (socket === this.client) this.backlog?.wrote();
	}

	private piEnded(exit: ExitFrame): void {
		this.exit = exit;
		this.cancelOrphan?.();
		const client = this.client;
		if (client !== undefined) this.tellAndEnd(client, exit);
		else if (this.everAttached || this.stopping) this.end();
		else this.clock.after(this.options.lingerMs ?? 10_000, () => this.end());
	}

	private tellAndEnd(socket: Socket, exit: ExitFrame): void {
		this.send(socket, controlLine(exit));
		socket.end(() => this.end());
		this.clock.after(5_000, () => this.end());
	}

	/** While a bridge is attached nothing is due; otherwise `pi` is stopped at the policy's deadline. */
	private review(): void {
		if (this.client !== undefined || this.exit !== undefined) {
			this.cancelOrphan?.();
			this.cancelOrphan = undefined;
			this.deadline = undefined;
			return;
		}
		const at = { orphanedAt: this.orphanedAt, idleSince: this.idleSince };
		const deadline = orphanDeadline(this.log.state(), at, this.limits);
		if (deadline === this.deadline) return;
		this.cancelOrphan?.();
		this.deadline = deadline;
		this.cancelOrphan = this.clock.after(Math.max(0, deadline - this.clock.now()), () => this.stop());
	}

	private writeMeta(piPid: number | undefined): void {
		const { dir, spec } = this.options;
		const meta: HolderMeta = {
			holderVersion: HOLDER_VERSION,
			pid: process.pid,
			...(piPid !== undefined && { piPid }),
			sessionId: spec.sessionId,
			file: spec.file,
			cwd: spec.cwd,
			startedAt: Date.now(),
			extension: spec.extension,
		};
		const temporary = `${metaOf(dir)}.tmp`;
		writeFileSync(temporary, JSON.stringify(meta), { mode: 0o600 });
		renameSync(temporary, metaOf(dir));
	}

	private end(): void {
		if (this.ending) return;
		this.ending = true;
		this.cancelOrphan?.();
		clearInterval(this.watch);
		this.backlog?.stop();
		this.client?.destroy();
		this.server.close();
		rmSync(this.options.dir, { recursive: true, force: true });
		this.finished.resolve();
	}
}

function answeredId(line: string): string | undefined {
	try {
		const value: unknown = JSON.parse(line);
		const id = typeof value === "object" && value !== null ? Reflect.get(value, "id") : undefined;
		return typeof id === "string" ? id : undefined;
	} catch {
		return undefined;
	}
}
