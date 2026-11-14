/** Network address classification and the bridge's directory policy (path traversal protection). */
import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { getDefaultAllowedPaths, isCompiledBinary } from "./platform";

// ── Network address classification ──────────────────────────────────

export function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) return false;
	if (address === "127.0.0.1" || address === "::1") return true;
	if (address.startsWith("::ffff:127.")) return true;
	return false;
}

// ── Filesystem access control (path traversal protection) ───────────

/**
 * Each base in both spellings: `/tmp` is `/private/tmp` once resolved on macOS, and a request may
 * arrive either way.
 */
export function expandAllowedBasePaths(bases: string[]): string[] {
	return bases.flatMap((base) => {
		const resolved = resolve(base);
		try {
			const real = realpathSync.native(resolved);
			return real === resolved ? [resolved] : [resolved, real];
		} catch {
			return [resolved];
		}
	});
}

const SECURITY_ALLOWED_BASE_PATHS = (() => {
	const defaults = getDefaultAllowedPaths();
	// In compiled binaries, NEVER allow env var to override allowed paths.
	// An attacker could set BROSKI_ALLOWED_BASE_PATHS=/ to read any file.
	if (isCompiledBinary()) return expandAllowedBasePaths(defaults);
	const raw = (process.env.BROSKI_ALLOWED_BASE_PATHS ?? "").trim();
	const bases = raw
		? raw
				.split(",")
				.map((p) => p.trim())
				.filter(Boolean)
		: defaults;
	return expandAllowedBasePaths(bases);
})();

function isSecureBasePath(realPath: string): boolean {
	return SECURITY_ALLOWED_BASE_PATHS.some((base) => realPath === base || realPath.startsWith(base + sep));
}

export async function getSecurePath(requestedPath: string): Promise<string | null> {
	try {
		if (!requestedPath || typeof requestedPath !== "string") return null;
		if (requestedPath.length > 4096) return null;
		if (requestedPath.includes("\0")) return null;
		// Reject ASCII control chars (helps avoid odd filesystem edge cases).
		if (/[\u0000-\u001F]/.test(requestedPath)) return null;

		const expandedPath = requestedPath.startsWith("~") ? requestedPath.replace(/^~/, homedir()) : requestedPath;

		const abs = resolve(expandedPath);
		// Check the logical path (pre-symlink resolution) is within allowed bases.
		if (!isSecureBasePath(abs)) return null;

		const rp = await realpath(abs).catch(() => null);
		if (!rp) return null;

		// Check the real path (post-symlink resolution) is still within allowed bases.
		return isSecureBasePath(rp) ? rp : null;
	} catch {
		return null;
	}
}
