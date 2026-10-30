/**
 * The trust decision `<agentDir>/trust.json` holds for a directory, read as Pi's `ProjectTrustStore.get` reads it
 * (pi-coding-agent `src/core/trust-manager.ts:45-59, 99-124, 217-226`) but without its lock: Pi's store creates the
 * agent directory and a `trust.json.lock` beside the file, and spins on the event loop while another process holds
 * it (`:138-179`). Reading needs neither, and a read path must write nothing.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** `null`: no decision for the directory or any parent. `unreadable`: Pi would throw reading the file. */
export type SavedTrust = boolean | null | "unreadable";

export function savedTrust(cwd: string, agentDir: string): SavedTrust {
	const data = readTrustFile(join(resolve(agentDir), "trust.json"));
	if (data === "unreadable") return data;
	let directory = canonical(resolve(cwd));
	for (;;) {
		const value = data.get(directory);
		if (value === true || value === false) return value;
		const parent = dirname(directory);
		if (parent === directory) return null;
		directory = parent;
	}
}

function readTrustFile(path: string): Map<string, boolean | null> | "unreadable" {
	if (!existsSync(path)) return new Map();
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
	} catch {
		return "unreadable";
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "unreadable";
	const data = new Map<string, boolean | null>();
	for (const [key, value] of Object.entries(parsed)) {
		if (value !== true && value !== false && value !== null) return "unreadable";
		data.set(key, value);
	}
	return data;
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}
