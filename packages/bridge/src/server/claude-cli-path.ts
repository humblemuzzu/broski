/**
 * Where the user's `claude` executable is. The bridge carries no Claude Code binary of its own: it runs the
 * one the user installed, so the phone gets exactly the version, settings and plugins the terminal gets. In
 * order:
 * 1. the bridge config key `claudeCode.cliPath`, when it names an existing file;
 * 2. `claude` on `PATH`, which by the time this runs is the user's login-shell `PATH` (`platform/shell-env.ts`).
 * The answer is a value (a path, or why there is none); nothing here throws.
 */

import { existsSync, statSync } from "node:fs";
import { findBinary } from "../platform";

export type ClaudeCliSource = "config" | "path";

export type ClaudeCliPath =
	| { ok: true; path: string; source: ClaudeCliSource; notes: string[] }
	| { ok: false; reason: string; notes: string[] };

export type ClaudeCliEnvironment = {
	configured?: string;
	isFile: (path: string) => boolean;
	/** The executable `name` resolves to on `PATH`, or null. */
	which: (name: string) => string | null;
};

const NOT_FOUND =
	'Claude Code is not installed, or `claude` is not on your login shell\'s PATH. Install Claude Code, or set "claudeCode": {"cliPath": "/path/to/claude"} in ~/.broski/config.json';

export function resolveClaudeCliPath(env: ClaudeCliEnvironment): ClaudeCliPath {
	const notes: string[] = [];
	try {
		const configured = env.configured?.trim();
		if (configured) {
			if (env.isFile(configured)) return { ok: true, path: configured, source: "config", notes };
			notes.push(`claudeCode.cliPath ${configured} is not a file; ignored`);
		}
		const found = env.which("claude");
		if (found) return { ok: true, path: found, source: "path", notes };
		return { ok: false, reason: NOT_FOUND, notes };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, reason: `finding the Claude Code binary failed: ${message}`, notes };
	}
}

function isFile(path: string): boolean {
	try {
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
}

export function defaultClaudeCliEnvironment(configured?: string): ClaudeCliEnvironment {
	return { configured, isFile, which: findBinary };
}
