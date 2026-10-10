import type { Library } from "bun:ffi";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { logDaemonError } from "../logging/daemon-log";
import { isCompiledBinary } from "../platform";
import type { PtySession } from "../types";
import { createPtyReader } from "./native-pty-reader";
import { createPtyWriter } from "./native-pty-writer";

/** sha256 of the built PTY sidecar, injected by scripts/build.sh via `bun build --define`. Absent in dev. */
declare const BROSKI_PTY_LIB_HASH: string | undefined;
const EXPECTED_PTY_LIB_HASH = typeof BROSKI_PTY_LIB_HASH === "string" ? BROSKI_PTY_LIB_HASH : "";
const MAX_NATIVE_PTY_SESSIONS = 20;

const SIGWINCH = 28;
const SIGTERM = 15;
const SIGKILL = 9;

const SYMBOLS = {
	pty_create: {
		returns: FFIType.int,
		args: [
			FFIType.ptr,
			FFIType.ptr,
			FFIType.int,
			FFIType.u16,
			FFIType.u16,
			FFIType.ptr,
			FFIType.ptr,
			FFIType.ptr,
			FFIType.ptr,
		],
	},
	pty_resize: { returns: FFIType.int, args: [FFIType.int, FFIType.u16, FFIType.u16] },
	pty_write: { returns: FFIType.int, args: [FFIType.int, FFIType.ptr, FFIType.int] },
	pty_close: { returns: FFIType.int, args: [FFIType.int] },
	pty_kill: { returns: FFIType.int, args: [FFIType.int, FFIType.int] },
	pty_waitpid: { returns: FFIType.int, args: [FFIType.int] },
	pty_errno: { returns: FFIType.int, args: [] },
} as const;

type NativeLib = Library<typeof SYMBOLS>;

export type NativePtySession = PtySession & {
	masterFd: number;
	slavePath: string;
	rows: number;
	cols: number;
	createdAt: number;
	closed: boolean;
};

export type NativePtyConnection = {
	onData: (cb: (data: string) => void) => void;
	onExit: (cb: (exitCode?: number) => void) => void;
	write: (data: string) => void;
	resize: (rows: number, cols: number) => void;
	disconnect: () => void;
};

const sessions = new Map<string, NativePtySession>();
const sessionReaders = new Map<string, () => Promise<void>>();
let libHandle: NativeLib | null = null;

function clampDimension(value: number | undefined, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(1, Math.min(500, Math.floor(n)));
}

function toCString(input: string | null | undefined): Buffer | null {
	if (!input) return null;
	return Buffer.from(`${input}\0`, "utf8");
}

function getLibName(): string {
	if (process.platform === "darwin") return "libbroski_pty.dylib";
	if (process.platform === "linux") return "libbroski_pty.so";
	return "";
}

function findLibraryPath(): string | null {
	if (process.platform !== "darwin" && process.platform !== "linux") return null;

	const name = getLibName();
	if (!name) return null;

	try {
		const compiledDir = dirname(process.execPath);
		const candidate = resolve(compiledDir, name);
		if (existsSync(candidate)) return candidate;
	} catch {
		// ignore
	}

	try {
		const here = dirname(fileURLToPath(import.meta.url));
		const distCandidate = resolve(here, "..", "..", "dist", name);
		if (existsSync(distCandidate)) return distCandidate;

		const devCandidate = resolve(here, "..", "..", "native", "pty", name);
		if (existsSync(devCandidate)) return devCandidate;
	} catch {
		// ignore
	}

	return null;
}

const loggedPtyRejections = new Set<string>();

function reportPtyRejection(libPath: string, detail: string): void {
	if (loggedPtyRejections.has(libPath)) return;
	loggedPtyRejections.add(libPath);
	logDaemonError(`[pty] Refusing to load ${libPath}: ${detail}. Terminal sessions are disabled.`);
}

function verifyLibraryHash(libPath: string): boolean {
	if (!isCompiledBinary()) return true;

	try {
		const bytes = readFileSync(libPath);
		const actual = createHash("sha256").update(bytes).digest("hex");
		if (actual === EXPECTED_PTY_LIB_HASH) return true;
		reportPtyRejection(
			libPath,
			EXPECTED_PTY_LIB_HASH
				? `sha256 ${actual} does not match the hash baked at build time (${EXPECTED_PTY_LIB_HASH})`
				: "the binary has no baked PTY library hash",
		);
	} catch (error) {
		reportPtyRejection(libPath, error instanceof Error ? error.message : String(error));
	}
	return false;
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

async function refreshExitState(session: NativePtySession, lib: NativeLib): Promise<void> {
	if (session.status === "exited") return;

	const result = lib.symbols.pty_waitpid(session.pid);
	if (result === -1) return;

	session.status = "exited";
	if (result >= 0) {
		session.exitCode = result;
	}
	await stopReader(session.id);
	closeMasterFd(session, lib);
}

function getLib(): NativeLib {
	if (libHandle) return libHandle;

	const libPath = findLibraryPath();
	if (!libPath) {
		throw new Error("Native PTY library not found");
	}
	if (!verifyLibraryHash(libPath)) {
		throw new Error("Native PTY library hash mismatch");
	}

	libHandle = dlopen(libPath, SYMBOLS);
	return libHandle;
}

export function isNativePtyAvailable(): boolean {
	try {
		const path = findLibraryPath();
		if (!path) return false;
		if (!verifyLibraryHash(path)) return false;
		return true;
	} catch {
		return false;
	}
}

export async function nativeListPty(projectPath?: string): Promise<NativePtySession[]> {
	const lib = getLib();
	const project = projectPath ? resolve(projectPath) : null;
	const out: NativePtySession[] = [];

	for (const session of sessions.values()) {
		await refreshExitState(session, lib);

		if (project) {
			const cwd = resolve(session.cwd);
			if (cwd !== project && !cwd.startsWith(`${project}${sep}`)) {
				continue;
			}
		}

		out.push({ ...session });
	}

	out.sort((a, b) => b.createdAt - a.createdAt);
	return out;
}

export async function nativeCreatePty(opts: {
	command?: string;
	args?: string[];
	cwd?: string;
	title?: string;
	rows?: number;
	cols?: number;
}): Promise<NativePtySession | null> {
	if (sessions.size >= MAX_NATIVE_PTY_SESSIONS) {
		return null;
	}

	const lib = getLib();
	const rows = clampDimension(opts.rows, 24);
	const cols = clampDimension(opts.cols, 80);

	const pidOut = new Int32Array(1);
	const slavePathOut = Buffer.alloc(256);

	const shell = process.env.SHELL || "/bin/sh";
	const shellBuf = toCString(shell);
	const cwdBuf = toCString(opts.cwd || process.cwd());
	const termBuf = toCString("xterm-256color");
	const commandString = buildCommandString(opts.command, opts.args);
	const commandBuf = toCString(commandString);

	const fd = lib.symbols.pty_create(
		ptr(pidOut),
		ptr(slavePathOut),
		slavePathOut.length,
		rows,
		cols,
		shellBuf ? ptr(shellBuf) : null,
		cwdBuf ? ptr(cwdBuf) : null,
		termBuf ? ptr(termBuf) : null,
		commandBuf ? ptr(commandBuf) : null,
	);

	if (fd < 0) {
		return null;
	}

	const commandTitle = commandString ?? shell;
	const id = `native-pty-${randomBytes(8).toString("hex")}`;
	const session: NativePtySession = {
		id,
		title: opts.title?.trim() || commandTitle,
		command: opts.command?.trim() || shell,
		args: opts.args ?? [],
		cwd: opts.cwd || process.cwd(),
		status: "running",
		pid: pidOut[0] ?? 0,
		masterFd: fd,
		slavePath: slavePathOut.toString("utf8").replace(/\0.*$/, ""),
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

	const lib = getLib();
	await refreshExitState(session, lib);
	return { ...session };
}

export async function nativeUpdatePty(
	id: string,
	opts: { title?: string; rows?: number; cols?: number },
): Promise<NativePtySession | null> {
	const session = sessions.get(id);
	if (!session) return null;

	if (typeof opts.title === "string" && opts.title.trim()) {
		session.title = opts.title.trim();
	}

	if (typeof opts.rows === "number" && typeof opts.cols === "number") {
		nativeResizePty(id, opts.rows, opts.cols);
	}

	return { ...session };
}

async function waitForProcessExit(lib: NativeLib, pid: number, timeoutMs: number): Promise<number | null> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const result = lib.symbols.pty_waitpid(pid);
		if (result >= 0) return result;
		if (result === -2) return null;
		if (Date.now() >= deadline) return null;
		await Bun.sleep(20);
	}
}

export async function nativeDeletePty(id: string): Promise<boolean> {
	const session = sessions.get(id);
	if (!session) return true;

	const lib = getLib();

	if (session.status === "running") {
		try {
			lib.symbols.pty_kill(session.pid, SIGTERM);
		} catch {
			// ignore
		}

		const termResult = await waitForProcessExit(lib, session.pid, 300);
		if (termResult != null) {
			session.status = "exited";
			session.exitCode = termResult;
		} else {
			try {
				lib.symbols.pty_kill(session.pid, SIGKILL);
			} catch {
				// ignore
			}
			const killResult = await waitForProcessExit(lib, session.pid, 300);
			session.status = "exited";
			if (killResult != null) session.exitCode = killResult;
		}
	}

	await stopReader(session.id);
	closeMasterFd(session, lib);
	sessions.delete(id);
	return true;
}

export function nativeResizePty(id: string, rows: number, cols: number): boolean {
	const session = sessions.get(id);
	if (!session || session.closed || session.status !== "running") return false;

	const lib = getLib();
	const nextRows = clampDimension(rows, session.rows);
	const nextCols = clampDimension(cols, session.cols);
	const result = lib.symbols.pty_resize(session.masterFd, nextRows, nextCols);

	if (result !== 0) return false;

	session.rows = nextRows;
	session.cols = nextCols;
	try {
		lib.symbols.pty_kill(session.pid, SIGWINCH);
	} catch {
		// ignore
	}
	return true;
}

export function nativeConnectPty(id: string): NativePtyConnection | null {
	const session = sessions.get(id);
	if (!session || session.status !== "running" || session.closed) return null;

	const lib = getLib();
	let onData: ((data: string) => void) | null = null;
	let onExit: ((exitCode?: number) => void) | null = null;
	let connected = true;

	const isActive = () => connected && session.status === "running" && !session.closed;

	const reader = createPtyReader({
		fd: session.masterFd,
		onData: (text) => {
			onData?.(text);
		},
		onEnd: () => {
			sessionReaders.delete(id);
			void (async () => {
				await refreshExitState(session, lib);
				onExit?.(session.exitCode);
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
		resize: (rows, cols) => {
			nativeResizePty(id, rows, cols);
		},
		disconnect: () => {
			connected = false;
			void reader.stop();
		},
	};
}

export async function nativeShutdown(): Promise<void> {
	const ids = Array.from(sessions.keys());
	for (const id of ids) {
		await nativeDeletePty(id);
	}
}
