/**
 * Extraction of the PTY library embedded in a compiled bridge binary.
 *
 * The build bakes the library bytes into the entry point and its sha256 into `native-pty.ts`,
 * which refuses to dlopen anything else. An in-place binary upgrade leaves the previous release's
 * sidecar on disk, so presence alone is not enough to decide: the bytes on disk are compared with
 * the embedded ones and replaced when they differ.
 */

import { createHash } from "node:crypto";
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PtySidecarOutcome = "written" | "unchanged" | "skipped";

/** The sidecar filename for a platform, or null where no native helper is built. */
export function ptySidecarName(platform: NodeJS.Platform = process.platform): string | null {
	if (platform === "darwin") return "libbroski_pty.dylib";
	if (platform === "linux") return "libbroski_pty.so";
	return null;
}

export function sha256Hex(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function matchesEmbedded(path: string, bytes: Buffer): boolean {
	try {
		return sha256Hex(readFileSync(path)) === sha256Hex(bytes);
	} catch {
		return false;
	}
}

/**
 * Writes `embeddedBase64` next to `binDir` when the sidecar is missing or stale. The swap is
 * atomic (temp + rename) so a truncated library is never dlopen'd, and the result is executable.
 */
export function extractPtySidecar(options: {
	binDir: string;
	embeddedBase64: string;
	platform?: NodeJS.Platform;
}): PtySidecarOutcome {
	const name = ptySidecarName(options.platform ?? process.platform);
	if (!name) return "skipped";

	const libPath = join(options.binDir, name);
	const bytes = Buffer.from(options.embeddedBase64, "base64");
	if (matchesEmbedded(libPath, bytes)) return "unchanged";

	const tempPath = `${libPath}.tmp-${process.pid}`;
	try {
		writeFileSync(tempPath, bytes, { mode: 0o755 });
		chmodSync(tempPath, 0o755);
		renameSync(tempPath, libPath);
		return "written";
	} catch {
		try {
			rmSync(tempPath, { force: true });
		} catch {
			// The temp file is the OS's problem if it is still busy.
		}
		return "skipped";
	}
}
