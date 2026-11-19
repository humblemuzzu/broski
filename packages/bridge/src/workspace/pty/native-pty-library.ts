import type { Library } from "bun:ffi";
import { dlopen, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logDaemonError } from "../../logging/daemon-log";
import { isCompiledBinary } from "../../platform";

/** sha256 of the built PTY sidecar, injected by scripts/build.sh via `bun build --define`. Absent in dev. */
declare const BROSKI_PTY_LIB_HASH: string | undefined;
const EXPECTED_PTY_LIB_HASH = typeof BROSKI_PTY_LIB_HASH === "string" ? BROSKI_PTY_LIB_HASH : "";

const SYMBOLS = {
	pty_create: {
		returns: FFIType.int,
		args: [
			FFIType.ptr,
			FFIType.ptr,
			FFIType.int,
			FFIType.u16,
			FFIType.u16,
			FFIType.u16,
			FFIType.u16,
			FFIType.ptr,
			FFIType.ptr,
			FFIType.ptr,
			FFIType.ptr,
			FFIType.ptr,
		],
	},
	pty_resize: { returns: FFIType.int, args: [FFIType.int, FFIType.u16, FFIType.u16, FFIType.u16, FFIType.u16] },
	pty_write: { returns: FFIType.int, args: [FFIType.int, FFIType.ptr, FFIType.int] },
	pty_close: { returns: FFIType.int, args: [FFIType.int] },
	pty_kill: { returns: FFIType.int, args: [FFIType.int, FFIType.int] },
	pty_waitpid: { returns: FFIType.int, args: [FFIType.int] },
	pty_errno: { returns: FFIType.int, args: [] },
} as const;

export type NativeLib = Library<typeof SYMBOLS>;

let libHandle: NativeLib | null = null;

function getLibName(): string {
	return process.platform === "darwin" ? "libbroski_pty.dylib" : "";
}

function findLibraryPath(): string | null {
	const name = getLibName();
	if (!name) return null;

	const compiledCandidate = resolve(dirname(process.execPath), name);
	if (existsSync(compiledCandidate)) return compiledCandidate;

	const bridgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
	const distCandidate = resolve(bridgeRoot, "dist", name);
	if (existsSync(distCandidate)) return distCandidate;

	const devCandidate = resolve(bridgeRoot, "native", "pty", name);
	return existsSync(devCandidate) ? devCandidate : null;
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

/** The loaded helper; throws when there is none this bridge may load. */
export function nativeLib(): NativeLib {
	if (libHandle) return libHandle;

	const libPath = findLibraryPath();
	if (!libPath) throw new Error("Native PTY library not found");
	if (!verifyLibraryHash(libPath)) throw new Error("Native PTY library hash mismatch");

	libHandle = dlopen(libPath, SYMBOLS);
	return libHandle;
}

export function isNativePtyAvailable(): boolean {
	const path = findLibraryPath();
	return path !== null && verifyLibraryHash(path);
}
