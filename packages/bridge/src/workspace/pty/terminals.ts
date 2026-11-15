import {
	type ActionResult,
	MAX_TERMINAL_OUTPUT_BYTES,
	MAX_TERMINALS,
	type Rejected,
	type TermAttachResult,
	type TerminalEvent,
	type TerminalSummary,
	type TermListResult,
	type TermOpenResult,
} from "../../contract";
import { ACCEPTED, rejected } from "../results";
import {
	type NativePtyConnection,
	nativeConnectPty,
	nativeCreatePty,
	nativeDeletePty,
	nativeResizePty,
	type PtyExit,
	type PtySize,
} from "./native-pty";
import { isNativePtyAvailable } from "./native-pty-library";
import { OutputRing } from "./output-ring";

/** Output is gathered this long before it is sent, so a burst travels as a few frames, not one per read. */
const FLUSH_MS = 8;
const MAX_EVENT_BYTES = 64 * 1024;
const UNAVAILABLE = "this machine cannot open terminals: the bridge's PTY helper is missing";

/** A terminal's columns and rows, and its cells' size in pixels when the client knows it. */
export type TerminalGeometry = { cols: number; rows: number; cellWidth?: number; cellHeight?: number };

interface Terminal {
	readonly id: string;
	readonly cwd: string;
	readonly createdAt: number;
	readonly ring: OutputRing;
	readonly connection: NativePtyConnection;
	readonly exited: Promise<void>;
	readonly markExited: () => void;
	cols: number;
	rows: number;
	exit: PtyExit | undefined;
	pending: Uint8Array[];
	pendingBytes: number;
	flushTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * The machine's terminals. Each is read from the moment it opens until its process ends, whether or not a
 * client is attached, into a ring of its newest output: a client that comes back is sent what it missed, and
 * the shell never blocks on a full PTY while the phone is away. An exited terminal is kept, with its output
 * and how it ended, until it is closed or a new terminal needs its place.
 */
export class Terminals {
	private readonly terminals = new Map<string, Terminal>();
	/** Opens under way, each holding a place before its terminal exists. */
	private opening = 0;

	constructor(private readonly sink: (event: TerminalEvent) => void) {}

	get available(): boolean {
		return isNativePtyAvailable();
	}

	async list(): Promise<TermListResult> {
		if (!this.available) return rejected("unsupported", UNAVAILABLE);
		const terminals = [...this.terminals.values()].sort((a, b) => b.createdAt - a.createdAt).map(summary);
		return { status: "accepted", terminals };
	}

	/** `cwd` has passed the path policy. */
	async open(cwd: string, geometry: TerminalGeometry): Promise<TermOpenResult> {
		if (!this.available) return rejected("unsupported", UNAVAILABLE);
		if (!this.makeRoom()) return rejected("busy", `${MAX_TERMINALS} terminals are running; close one first`);
		this.opening += 1;
		try {
			return await this.start(cwd, geometry);
		} finally {
			this.opening -= 1;
		}
	}

	private async start(cwd: string, geometry: TerminalGeometry): Promise<TermOpenResult> {
		const native = await nativeCreatePty({ cwd, ...ptySize(geometry) });
		const connection = native ? nativeConnectPty(native.id) : null;
		if (!native || !connection) {
			if (native) await nativeDeletePty(native.id);
			return rejected("backend_error", "the terminal could not be started");
		}
		const exited = Promise.withResolvers<void>();
		const terminal: Terminal = {
			id: native.id,
			cwd,
			createdAt: native.createdAt,
			ring: new OutputRing(MAX_TERMINAL_OUTPUT_BYTES),
			connection,
			exited: exited.promise,
			markExited: exited.resolve,
			cols: native.cols,
			rows: native.rows,
			exit: undefined,
			pending: [],
			pendingBytes: 0,
			flushTimer: undefined,
		};
		this.terminals.set(terminal.id, terminal);
		connection.onData((bytes) => this.gather(terminal, bytes));
		connection.onExit((exit) => this.ended(terminal, exit));
		return { status: "accepted", terminal: summary(terminal) };
	}

	/**
	 * The output held from `since` on and the terminal as it is. What is still gathered and not sent goes out
	 * after it as live output, starting where the replay ends.
	 */
	attach(id: string, since: number | undefined): TermAttachResult {
		const terminal = this.terminals.get(id);
		if (!terminal) return notFound(id);
		const replay = terminal.ring.since(since);
		return { status: "accepted", terminal: summary(terminal), seq: replay.seq, data: base64(replay.data) };
	}

	input(id: string, data: Uint8Array): ActionResult {
		const terminal = this.running(id);
		if ("status" in terminal) return terminal;
		terminal.connection.write(data);
		return ACCEPTED;
	}

	resize(id: string, geometry: TerminalGeometry): ActionResult {
		const terminal = this.running(id);
		if ("status" in terminal) return terminal;
		if (!nativeResizePty(id, ptySize(geometry))) return rejected("backend_error", "the terminal could not be resized");
		terminal.cols = geometry.cols;
		terminal.rows = geometry.rows;
		return ACCEPTED;
	}

	/** Ends the terminal's process if it still runs (its clients are told `term_exited`), then forgets it. */
	async close(id: string): Promise<ActionResult> {
		const terminal = this.terminals.get(id);
		if (!terminal) return notFound(id);
		if (terminal.exit === undefined) {
			await nativeDeletePty(id);
			await terminal.exited;
		}
		this.terminals.delete(id);
		return ACCEPTED;
	}

	async dispose(): Promise<void> {
		await Promise.all([...this.terminals.keys()].map((id) => this.close(id)));
	}

	private running(id: string): Terminal | Rejected {
		const terminal = this.terminals.get(id);
		if (!terminal) return notFound(id);
		return terminal.exit === undefined ? terminal : rejected("closed", `terminal ${JSON.stringify(id)} has exited`);
	}

	/** Frees the place of the oldest exited terminal when every place is taken; false when all of them run. */
	private makeRoom(): boolean {
		if (this.terminals.size + this.opening < MAX_TERMINALS) return true;
		const oldest = [...this.terminals.values()]
			.filter((terminal) => terminal.exit !== undefined)
			.sort((a, b) => a.createdAt - b.createdAt)[0];
		if (!oldest) return false;
		this.terminals.delete(oldest.id);
		return true;
	}

	private gather(terminal: Terminal, bytes: Uint8Array): void {
		terminal.pending.push(bytes);
		terminal.pendingBytes += bytes.length;
		if (terminal.pendingBytes >= MAX_EVENT_BYTES) this.flush(terminal);
		else terminal.flushTimer ??= setTimeout(() => this.flush(terminal), FLUSH_MS);
	}

	/** Sends what was gathered, in pieces no larger than an event carries, each recorded in the ring first. */
	private flush(terminal: Terminal): void {
		clearTimeout(terminal.flushTimer);
		terminal.flushTimer = undefined;
		const gathered = Buffer.concat(terminal.pending);
		terminal.pending = [];
		terminal.pendingBytes = 0;
		for (let at = 0; at < gathered.length; at += MAX_EVENT_BYTES) {
			const piece = gathered.subarray(at, at + MAX_EVENT_BYTES);
			const seq = terminal.ring.append(piece);
			this.sink({ type: "term_output", id: terminal.id, seq, data: base64(piece) });
		}
	}

	private ended(terminal: Terminal, exit: PtyExit): void {
		this.flush(terminal);
		terminal.exit = exit;
		this.sink({
			type: "term_exited",
			id: terminal.id,
			...(exit.code !== undefined && { exitCode: exit.code }),
			...(exit.signal !== undefined && { signal: exit.signal }),
		});
		void nativeDeletePty(terminal.id).finally(terminal.markExited);
	}
}

function summary(terminal: Terminal): TerminalSummary {
	return {
		id: terminal.id,
		cwd: terminal.cwd,
		cols: terminal.cols,
		rows: terminal.rows,
		createdAt: terminal.createdAt,
		status: terminal.exit === undefined ? "running" : "exited",
		...(terminal.exit?.code !== undefined && { exitCode: terminal.exit.code }),
		...(terminal.exit?.signal !== undefined && { signal: terminal.exit.signal }),
	};
}

function ptySize(geometry: TerminalGeometry): PtySize {
	return {
		cols: geometry.cols,
		rows: geometry.rows,
		widthPx: geometry.cols * (geometry.cellWidth ?? 0),
		heightPx: geometry.rows * (geometry.cellHeight ?? 0),
	};
}

function notFound(id: string): Rejected {
	return rejected("not_found", `no terminal ${JSON.stringify(id)}`);
}

function base64(bytes: Uint8Array): string {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString("base64");
}
