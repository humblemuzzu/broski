/**
 * `flock(2)` locks through libSystem, which adapters reach as the kit's `FileLock` port. A lock belongs to its open
 * file, so the kernel drops it when the file is closed or the process exits, however it exits.
 */

import { dlopen, FFIType, type Library } from "bun:ffi";
import { closeSync, constants, openSync } from "node:fs";
import type { FileLock, LockFile } from "../adapter-kit/ports";

const LIB_SYSTEM = "/usr/lib/libSystem.B.dylib";
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

const SYMBOLS = { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } } as const;

let libSystem: Library<typeof SYMBOLS> | undefined;

function flock(fd: number, operation: number): boolean {
	libSystem ??= dlopen(LIB_SYSTEM, SYMBOLS);
	return libSystem.symbols.flock(fd, operation) === 0;
}

function openLockFile(path: string): LockFile {
	let fd: number | undefined = openSync(path, constants.O_RDWR | constants.O_CREAT, 0o600);
	return {
		tryLock: () => fd !== undefined && flock(fd, LOCK_EX | LOCK_NB),
		release: () => {
			if (fd === undefined) return;
			flock(fd, LOCK_UN);
			closeSync(fd);
			fd = undefined;
		},
	};
}

export const fileLock: FileLock = { open: openLockFile };
