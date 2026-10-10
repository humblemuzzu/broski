import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname } from "node:path";

const SOCKET_FILE_MODE = 0o600;
const PARENT_DIR_MODE = 0o700;
const PROBE_TIMEOUT_MS = 3000;

/**
 * Makes the path bindable: creates a missing parent directory, then clears a leftover socket file
 * or a plain file. A path something still answers on is left alone and reported to the caller.
 */
export async function prepareLinkSocketPath(socketPath: string): Promise<void> {
	mkdirSync(dirname(socketPath), { recursive: true, mode: PARENT_DIR_MODE });
	if (!existsSync(socketPath)) return;
	if (await isServing(socketPath)) throw new Error(`another bridge is already serving ${socketPath}`);
	unlinkSync(socketPath);
}

/** Only the owning user may talk to the socket; `Bun.serve` creates it world-readable. */
export function hardenLinkSocketFile(socketPath: string): void {
	chmodSync(socketPath, SOCKET_FILE_MODE);
}

export function removeLinkSocketFile(socketPath: string): void {
	try {
		unlinkSync(socketPath);
	} catch {
		// Stopping the listener already removes the file; absent is the normal case.
	}
}

function isServing(socketPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ path: socketPath });
		// A listener whose backlog is full neither accepts nor refuses; treat it as live.
		const timer = setTimeout(() => finish(true), PROBE_TIMEOUT_MS);
		function finish(serving: boolean): void {
			clearTimeout(timer);
			socket.removeAllListeners();
			socket.destroy();
			resolve(serving);
		}
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}
