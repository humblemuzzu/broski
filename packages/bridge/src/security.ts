/**
 * Security utilities: network address classification, input validation,
 * path traversal protection, and filesystem access control.
 *
 * Extracted from server.ts — pure functions and module-level constants
 * with no closure dependencies.
 */
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { getDefaultAllowedPaths, isCompiledBinary } from "./platform";

// ── Network address classification ──────────────────────────────────

export function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) return false;
	if (address === "127.0.0.1" || address === "::1") return true;
	if (address.startsWith("::ffff:127.")) return true;
	return false;
}

// ── Input validation ────────────────────────────────────────────────

export function hasPrototypePoisonKeys(value: unknown, depth = 0): boolean {
	if (!value || typeof value !== "object") return false;
	if (depth > 50) return true;
	if (Array.isArray(value)) {
		for (const v of value) {
			if (hasPrototypePoisonKeys(v, depth + 1)) return true;
		}
		return false;
	}
	const obj = value as Record<string, unknown>;
	// Disallow keys commonly used for prototype pollution.
	if (Object.hasOwn(obj, "__proto__")) return true;
	if (Object.hasOwn(obj, "prototype")) return true;
	if (Object.hasOwn(obj, "constructor")) return true;
	for (const k of Object.keys(obj)) {
		if (hasPrototypePoisonKeys(obj[k], depth + 1)) return true;
	}
	return false;
}

// ── Claude Code command file validation ─────────────────────────────

export function isSafeClaudeCommandName(name: string): boolean {
	const trimmed = (name || "").trim();
	if (trimmed.length < 1 || trimmed.length > 128) return false;
	if (trimmed.includes("/") || trimmed.includes("\\")) return false;
	return trimmed === basename(trimmed);
}

export function resolveClaudeCommandFilePath(params: {
	cwd: string;
	source: "project" | "user";
	name: string;
}): string | null {
	const baseDir =
		params.source === "project" ? join(params.cwd, ".claude", "commands") : join(homedir(), ".claude", "commands");

	const parts = params.name.split(":");
	if (parts.some((p) => p.length === 0)) return null;

	const file = parts.length > 0 ? parts[parts.length - 1] : undefined;
	if (!file) return null;

	const dirParts = parts.slice(0, -1);
	const filePath = join(baseDir, ...dirParts, `${file}.md`);

	const resolvedBase = resolve(baseDir);
	const resolvedFile = resolve(filePath);
	if (resolvedFile !== resolvedBase && !resolvedFile.startsWith(resolvedBase + sep)) return null;
	return resolvedFile;
}

// ── Filesystem access control (path traversal protection) ───────────

const SECURITY_ALLOWED_BASE_PATHS = (() => {
	const defaults = getDefaultAllowedPaths();
	// In compiled binaries, NEVER allow env var to override allowed paths.
	// An attacker could set BROSKI_ALLOWED_BASE_PATHS=/ to read any file.
	if (isCompiledBinary()) return defaults.map((p) => resolve(p));
	const raw = (process.env.BROSKI_ALLOWED_BASE_PATHS ?? "").trim();
	const bases = raw
		? raw
				.split(",")
				.map((p) => p.trim())
				.filter(Boolean)
		: defaults;
	return bases.map((p) => resolve(p));
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
