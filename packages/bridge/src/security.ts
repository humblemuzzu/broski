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

/** The bases every served path must lie in, each in both spellings (`expandAllowedBasePaths`), home first. */
export function allowedBasePaths(): readonly string[] {
	return SECURITY_ALLOWED_BASE_PATHS;
}

/** A path the policy allows, canonical, or why it refuses it: `outside` the bases (or a link leading out of them). */
export type SecurePath = { readonly path: string } | { readonly refused: "invalid" | "outside" | "missing" };

export async function resolveSecurePath(requestedPath: string): Promise<SecurePath> {
	if (!requestedPath || requestedPath.length > 4096) return { refused: "invalid" };
	// NUL would cut the path short where the OS reads it; the other control characters confuse what shows it.
	if (/[\u0000-\u001F]/.test(requestedPath)) return { refused: "invalid" };

	const expandedPath = requestedPath.startsWith("~") ? requestedPath.replace(/^~/, homedir()) : requestedPath;
	const abs = resolve(expandedPath);
	if (!isSecureBasePath(abs)) return { refused: "outside" };

	const rp = await realpath(abs).catch(() => null);
	if (!rp) return { refused: "missing" };
	return isSecureBasePath(rp) ? { path: rp } : { refused: "outside" };
}

export async function getSecurePath(requestedPath: string): Promise<string | null> {
	const secure = await resolveSecurePath(requestedPath);
	return "path" in secure ? secure.path : null;
}
