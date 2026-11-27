/**
 * A bridge's end of a holder's socket (`holder.ts`), as the transport an `RpcClient` reads a hosted `pi` through. The
 * holder's own frames are read here: `hello` and `live` bracket the replay, `exit` is `pi`'s end, and `replaced` or a
 * socket that closes without `exit` is this bridge losing the session, not `pi` ending. Nothing here signals a process:
 * a pid read from disk may be anyone's by now.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { type JsonlItem, JsonlSplitter } from "../../../adapter-kit/jsonl";
import { STOP_BUDGET_MS } from "../../../adapter-kit/stdio-child";
import type { PiEnd, PiTransport, TransportItem, TransportSink } from "../rpc/transport";
import { controlLine, controlOf, type HelloFrame, type HolderSpec, holderDirOf, socketOf } from "./protocol";

/** Where holders live, and the command that starts one: the bridge binary with `HOLDER_SUBCOMMAND`. */
export interface HolderSetup {
	readonly root: string;
	readonly command: readonly string[];
}

const HELLO_DEADLINE_MS = 3_000;
const LAUNCH_DEADLINE_MS = 10_000;
/** The holder's own ladder, and its answer after it; the holder finishes the ladder whether or not this bridge waits. */
const STOP_DEADLINE_MS = STOP_BUDGET_MS + 250;
/** What the holder process itself runs with; `pi`'s environment reaches it on stdin. */
const HOLDER_ENV = ["PATH", "HOME", "TMPDIR", "LANG"];

type Held = TransportItem | { readonly kind: "end" };

/**
 * What a connect found: a holder that greeted, `absent` when nothing listens on the socket (a holder that is gone), or
 * `silent` when something accepted the connection but sent no hello in time, which may be a live holder under load.
 */
export type Reached = { readonly link: HolderLink; readonly hello: HelloFrame } | "absent" | "silent";

export class HolderLink implements PiTransport {
	readonly ended: Promise<PiEnd>;
	private readonly end = Promise.withResolvers<PiEnd>();
	private readonly splitter = new JsonlSplitter();
	private readonly hello = Promise.withResolvers<HelloFrame | undefined>();
	private sink: TransportSink | undefined;
	private held: Held[] = [];
	private finished: PiEnd | undefined;
	private starting = false;
	private stopping = false;
	private connected = false;

	private constructor(private readonly socket: Socket) {
		this.ended = this.end.promise;
		socket.on("data", (chunk: Buffer) => {
			for (const item of this.splitter.push(chunk)) this.item(item);
		});
		socket.on("error", () => undefined);
		socket.once("connect", () => {
			this.connected = true;
		});
		socket.on("close", () => {
			this.hello.resolve(undefined);
			this.finish({ kind: "detached", replaced: false });
		});
	}

	static async connect(dir: string): Promise<Reached> {
		const link = new HolderLink(createConnection(socketOf(dir)));
		const timer = setTimeout(() => link.socket.destroy(), HELLO_DEADLINE_MS);
		const hello = await link.hello.promise;
		clearTimeout(timer);
		if (hello !== undefined) return { link, hello };
		return link.connected ? "silent" : "absent";
	}

	/** Starts a holder for `spec` and attaches to it; a string says why it could not. */
	static async launch(setup: HolderSetup, spec: HolderSpec): Promise<{ link: HolderLink; hello: HelloFrame } | string> {
		const dir = holderDirOf(setup.root, spec.sessionId);
		mkdirSync(setup.root, { recursive: true, mode: 0o700 });
		const [command = "", ...args] = setup.command;
		const env: Record<string, string> = {};
		for (const name of HOLDER_ENV) if (process.env[name] !== undefined) env[name] = process.env[name] ?? "";
		const child = spawn(command, [...args, dir], {
			detached: true,
			stdio: ["pipe", "ignore", "ignore"],
			env,
			cwd: "/",
		});
		let failed: string | undefined;
		child.on("error", (error) => {
			failed = `the Pi holder could not start: ${error.message}`;
		});
		child.on("exit", (code, signal) => {
			failed ??= `the Pi holder exited (${signal ?? `code ${code}`}) before it listened`;
		});
		child.stdin.on("error", () => undefined);
		child.stdin.end(`${JSON.stringify(spec)}\n`);
		child.unref();
		const until = Date.now() + LAUNCH_DEADLINE_MS;
		while (failed === undefined && Date.now() < until) {
			const attached = existsSync(socketOf(dir)) ? await HolderLink.connect(dir) : "absent";
			if (typeof attached !== "string") return attached;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		if (failed === undefined) child.kill("SIGTERM");
		return failed ?? "the Pi holder did not start in time";
	}

	get running(): boolean {
		return this.finished === undefined;
	}

	/** Records reach `sink` from the next turn on, the replay first. */
	start(sink: TransportSink): this {
		this.starting = true;
		setImmediate(() => {
			this.sink = sink;
			const held = this.held;
			this.held = [];
			for (const item of held) this.pass(item);
		});
		return this;
	}

	write(record: string): void {
		if (this.finished === undefined && !this.stopping) this.socket.write(record);
	}

	pause(): void {
		this.socket.pause();
	}

	resume(): void {
		this.socket.resume();
	}

	/** The holder runs the shutdown ladder; past its budget this bridge lets go instead of waiting on. */
	async stop(): Promise<void> {
		if (!this.starting) this.start(() => undefined);
		if (this.finished !== undefined || this.stopping) {
			await this.ended;
			return;
		}
		this.socket.write(controlLine({ holder: "stop" }));
		this.stopping = true;
		const timer = setTimeout(() => this.socket.destroy(), STOP_DEADLINE_MS);
		await this.ended;
		clearTimeout(timer);
	}

	detach(): void {
		this.socket.destroy();
	}

	private item(item: JsonlItem): void {
		if (item.kind === "oversized") {
			this.pass(item);
			return;
		}
		const control = controlOf(item.text);
		if (control === undefined) this.pass(item);
		else this.control(control);
	}

	private control(frame: Readonly<Record<string, unknown>>): void {
		switch (frame.holder) {
			case "hello":
				this.hello.resolve(helloOf(frame));
				this.pass({ kind: "replay", replaying: true });
				return;
			case "live":
				this.pass({ kind: "replay", replaying: false });
				return;
			case "oversized":
				this.pass({ kind: "oversized", bytes: Number(frame.bytes) });
				return;
			case "exit":
				this.finish({ kind: "exit", exit: exitOf(frame), stderr: String(frame.stderr ?? "") });
				this.socket.destroy();
				return;
			case "replaced":
				this.finish({ kind: "detached", replaced: true });
				this.socket.destroy();
				return;
		}
	}

	private finish(end: PiEnd): void {
		if (this.finished !== undefined) return;
		this.finished = end;
		this.pass({ kind: "end" });
	}

	private pass(item: Held): void {
		if (this.sink === undefined) this.held.push(item);
		else if (item.kind === "end") this.end.resolve(this.finished ?? { kind: "detached", replaced: false });
		else this.sink(item);
	}
}

function helloOf(frame: Readonly<Record<string, unknown>>): HelloFrame {
	const runStartedAt =
		typeof frame.runStartedAt === "number" && Number.isFinite(frame.runStartedAt) && frame.runStartedAt >= 0
			? Math.trunc(frame.runStartedAt)
			: undefined;
	return {
		holder: "hello",
		version: Number(frame.version),
		sessionId: String(frame.sessionId),
		extension: String(frame.extension),
		replayed: Number(frame.replayed),
		truncated: frame.truncated === true,
		...(runStartedAt !== undefined && { runStartedAt }),
	};
}

function exitOf(frame: Readonly<Record<string, unknown>>) {
	const code = typeof frame.code === "number" ? frame.code : null;
	const signal = typeof frame.signal === "string" ? frame.signal : null;
	return { code, signal, ...(typeof frame.error === "string" && { error: frame.error }) };
}
