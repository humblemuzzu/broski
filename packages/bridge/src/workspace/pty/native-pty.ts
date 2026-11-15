import { ptr } from "bun:ffi";
import { randomBytes } from "node:crypto";
import { constants } from "node:os";
import { MAX_TERMINAL_DIMENSION, MAX_TERMINALS } from "../../contract";
import { type NativeLib, nativeLib } from "./native-pty-library";
import { createPtyReader } from "./native-pty-reader";
import { createPtyWriter } from "./native-pty-writer";

const SIGWINCH = 28;
const SIGTERM = 15;
const SIGKILL = 9;
/** How long a child whose terminal closed may take to be reaped, so its exit status is not lost. */
const REAP_AFTER_EOF_MS = 300;

/** How a terminal's process ended: its exit status, or the signal that ended it, such as `SIGKILL`. */
export type PtyExit = { readonly code?: number; readonly signal?: string };

/** Columns and rows, and the whole grid's size in pixels (0 when the client did not say). */
export type PtySize = {
	readonly rows: number;
	readonly cols: number;
	readonly widthPx?: number;
	readonly heightPx?: number;
};

export type NativePtySession = {
	id: string;
	command: string;
	args: string[];
	cwd: string;
	status: "running" | "exited";
	pid: number;
	exit?: PtyExit;
	masterFd: number;
	rows: number;
	cols: number;
	createdAt: number;
	closed: boolean;
};

export type NativePtyConnection = {
	onData: (cb: (data: Uint8Array) => void) => void;
	onExit: (cb: (exit: PtyExit) => void) => void;
	write: (data: Uint8Array) => void;
	disconnect: () => void;
};

const sessions = new Map<string, NativePtySession>();
const sessionReaders = new Map<string, () => Promise<void>>();

function clampDimension(value: number | undefined, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(1, Math.min(MAX_TERMINAL_DIMENSION, Math.floor(n)));
}

/** A pixel extent as the kernel's `winsize` holds it: an unsigned 16-bit number. */
function pixels(value: number | undefined): number {
	return Math.max(0, Math.min(0xffff, Math.floor(value ?? 0)));
}

function toCString(input: string | null | undefined): Buffer | null {
	if (!input) return null;
	return Buffer.from(`${input}\0`, "utf8");
}

/**
 * `env` as a NULL-terminated array of `NAME=value` C strings, for the child to start with: Bun keeps
 * `process.env` (the login shell's environment the bridge imported at start) apart from the C environment a
 * forked child would otherwise inherit. `strings` holds the bytes the pointers point at.
 */
function environmentBlock(env: NodeJS.ProcessEnv): { pointers: BigUint64Array; strings: Buffer[] } {
	const strings = Object.entries(env).flatMap(([name, value]) =>
		value === undefined ? [] : [Buffer.from(`${name}=${value}\0`, "utf8")],
	);
	const pointers = new BigUint64Array(strings.length + 1);
	strings.forEach((string, index) => {
		pointers[index] = BigInt(ptr(string));
	});
	return { pointers, strings };
}

function shellEscape(input: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(input)) return input;
	return `'${input.replace(/'/g, `'"'"'`)}'`;
}

function buildCommandString(command?: string, args?: string[]): string | null {
	const cmd = (command ?? "").trim();
	if (!cmd) return null;
	const escaped = [shellEscape(cmd), ...(args ?? []).map((arg) => shellEscape(String(arg)))];
	return escaped.join(" ");
}

/** `pty_waitpid`'s answer for a reaped child: an exit status 0-255, or 256 plus the signal's number. */
function decodeWait(status: number): PtyExit {
	if (status < 256) return { code: status };
	const number = status - 256;
	const name = Object.entries(constants.signals).find(([, value]) => value === number)?.[0];
	return { signal: name ?? `signal ${number}` };
}

async function stopReader(id: string): Promise<void> {
	const stop = sessionReaders.get(id);
	sessionReaders.delete(id);
	if (!stop) return;
	try {
		await stop();
	} catch {
		// A reader that already finished has nothing left to cancel.
	}
}

function closeMasterFd(session: NativePtySession, lib: NativeLib): void {
	if (session.closed) return;
	try {
		lib.symbols.pty_close(session.masterFd);
	} catch {
		// ignore
	}
	session.closed = true;
}

/** Reaps the child if it has exited, waiting up to `waitMs` for it to. */
async function refreshExitState(session: NativePtySession, lib: NativeLib, waitMs = 0): Promise<void> {
	if (session.status === "exited") return;
	const result = await waitForProcessExit(lib, session.pid, waitMs);
	if (result === null) return;
	session.status = "exited";
	if (result >= 0) session.exit = decodeWait(result);
	await stopReader(session.id);
	closeMasterFd(session, lib);
}

export async function nativeListPty(): Promise<NativePtySession[]> {
	const lib = nativeLib();
	for (const session of sessions.values()) await refreshExitState(session, lib);
	return [...sessions.values()].map((session) => ({ ...session })).sort((a, b) => b.createdAt - a.createdAt);
}

type PtySpawn = { shell: string; cwd: string; command: string | null; rows: number; cols: number } & Partial<PtySize>;

/** Forks the shell on a new PTY; its master descriptor and pid, or null when the helper could not. */
function spawnPty(lib: NativeLib, spawn: PtySpawn): { fd: number; pid: number } | null {
	const pidOut = new Int32Array(1);
	const slavePathOut = Buffer.alloc(256);
	const shellBuf = toCString(spawn.shell);
	const cwdBuf = toCString(spawn.cwd);
	const termBuf = toCString("xterm-256color");
	const commandBuf = toCString(spawn.command);
	const environment = environmentBlock(process.env);
	const fd = lib.symbols.pty_create(
		ptr(pidOut),
		ptr(slavePathOut),
		slavePathOut.length,
		spawn.rows,
		spawn.cols,
		pixels(spawn.widthPx),
		pixels(spawn.heightPx),
		shellBuf ? ptr(shellBuf) : null,
		cwdBuf ? ptr(cwdBuf) : null,
		termBuf ? ptr(termBuf) : null,
		commandBuf ? ptr(commandBuf) : null,
		ptr(environment.pointers),
	);
	return fd < 0 ? null : { fd, pid: pidOut[0] ?? 0 };
}

export async function nativeCreatePty(
	opts: { command?: string; args?: string[]; cwd?: string } & Partial<PtySize>,
): Promise<NativePtySession | null> {
	if (sessions.size >= MAX_TERMINALS) return null;
	const rows = clampDimension(opts.rows, 24);
	const cols = clampDimension(opts.cols, 80);
	const shell = process.env.SHELL || "/bin/sh";
	const cwd = opts.cwd || process.cwd();
	const command = buildCommandString(opts.command, opts.args);
	const spawned = spawnPty(nativeLib(), { ...opts, shell, cwd, command, rows, cols });
	if (!spawned) return null;

	const id = `native-pty-${randomBytes(8).toString("hex")}`;
	const session: NativePtySession = {
		id,
		command: opts.command?.trim() || shell,
		args: opts.args ?? [],
		cwd,
		status: "running",
		pid: spawned.pid,
		masterFd: spawned.fd,
		rows,
		cols,
		createdAt: Date.now(),
		closed: false,
	};
	sessions.set(id, session);
	return { ...session };
}

export async function nativeGetPty(id: string): Promise<NativePtySession | null> {
	const session = sessions.get(id);
	if (!session) return null;
	await refreshExitState(session, nativeLib());
	return { ...session };
}

/**
 * The child's wait status once reaped within `timeoutMs`, `-2` when it is no child of this process any more
 * (reaped elsewhere, its status lost), null while it still runs.
 */
async function waitForProcessExit(lib: NativeLib, pid: number, timeoutMs: number): Promise<number | null> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const result = lib.symbols.pty_waitpid(pid);
		if (result !== -1) return result;
		if (Date.now() >= deadline) return null;
		await Bun.sleep(20);
	}
}

async function endProcess(session: NativePtySession, lib: NativeLib): Promise<void> {
	for (const signal of [SIGTERM, SIGKILL]) {
		try {
			lib.symbols.pty_kill(session.pid, signal);
		} catch {
			// ignore
		}
		const result = await waitForProcessExit(lib, session.pid, 300);
		if (result !== null) {
			if (result >= 0) session.exit = decodeWait(result);
			break;
		}
	}
	session.status = "exited";
}

export async function nativeDeletePty(id: string): Promise<boolean> {
	const session = sessions.get(id);
	if (!session) return true;

	const lib = nativeLib();
	if (session.status === "running") await endProcess(session, lib);
	await stopReader(session.id);
	closeMasterFd(session, lib);
	sessions.delete(id);
	return true;
}

export function nativeResizePty(id: string, size: PtySize): boolean {
	const session = sessions.get(id);
	if (!session || session.closed || session.status !== "running") return false;

	const lib = nativeLib();
	const rows = clampDimension(size.rows, session.rows);
	const cols = clampDimension(size.cols, session.cols);
	if (lib.symbols.pty_resize(session.masterFd, rows, cols, pixels(size.widthPx), pixels(size.heightPx)) !== 0) {
		return false;
	}

	session.rows = rows;
	session.cols = cols;
	try {
		lib.symbols.pty_kill(session.pid, SIGWINCH);
	} catch {
		// ignore
	}
	return true;
}

/**
 * Reads the session's output and writes its input. Its end is reported once, with how the child ended: the
 * child may close its terminal a moment before it can be reaped, so the status is waited for briefly.
 */
export function nativeConnectPty(id: string): NativePtyConnection | null {
	const session = sessions.get(id);
	if (!session || session.status !== "running" || session.closed) return null;

	const lib = nativeLib();
	let onData: ((data: Uint8Array) => void) | null = null;
	let onExit: ((exit: PtyExit) => void) | null = null;
	let connected = true;

	const isActive = () => connected && session.status === "running" && !session.closed;

	const reader = createPtyReader({
		fd: session.masterFd,
		onData: (bytes) => {
			onData?.(bytes);
		},
		onEnd: () => {
			sessionReaders.delete(id);
			void (async () => {
				await refreshExitState(session, lib, REAP_AFTER_EOF_MS);
				onExit?.(session.exit ?? {});
			})();
		},
	});
	sessionReaders.set(id, reader.stop);

	const writer = createPtyWriter({ fd: session.masterFd, symbols: lib.symbols, isActive });

	return {
		onData: (cb) => {
			onData = cb;
		},
		onExit: (cb) => {
			onExit = cb;
		},
		write: (data) => {
			writer.write(data);
		},
		disconnect: () => {
			connected = false;
			void reader.stop();
		},
	};
}

export async function nativeShutdown(): Promise<void> {
	await Promise.all([...sessions.keys()].map((id) => nativeDeletePty(id)));
}
