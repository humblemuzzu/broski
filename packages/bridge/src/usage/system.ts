/** What the plan readers reach on the machine. Tests hand in their own, so no test reads a real sign-in. */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface UsageSystem {
	readonly platform: NodeJS.Platform;
	/** Pi's agent directory, where `auth.json` keeps Pi's own sign-ins. */
	readonly piAgentDir: string;
	/** Claude Code's configuration directory: `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
	readonly claudeDir: string;
	now(): number;
	fetch(url: string, init: RequestInit): Promise<Response>;
	/** The file's text, or undefined when it cannot be read. */
	readText(path: string): Promise<string | undefined>;
	/** The command's stdout when it exits 0 within `timeoutMs`, else undefined. */
	run(argv: readonly string[], timeoutMs: number): Promise<string | undefined>;
}

export function machineSystem(piAgentDir: string): UsageSystem {
	const home = process.env.HOME || homedir();
	return {
		platform: process.platform,
		piAgentDir,
		claudeDir: process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
		now: () => Date.now(),
		fetch: (url, init) => fetch(url, init),
		readText: (path) => readFile(path, "utf8").catch(() => undefined),
		run,
	};
}

async function run(argv: readonly string[], timeoutMs: number): Promise<string | undefined> {
	let proc: Bun.Subprocess<"ignore", "pipe", "ignore">;
	try {
		proc = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
	} catch {
		return undefined;
	}
	const timer = setTimeout(() => proc.kill(), timeoutMs);
	try {
		const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		return code === 0 ? stdout : undefined;
	} finally {
		clearTimeout(timer);
	}
}

/** macOS's generic password for `service` and `account`, read with `security`; undefined elsewhere or when none. */
export async function keychainSecret(
	system: UsageSystem,
	service: string,
	account?: string,
): Promise<string | undefined> {
	if (system.platform !== "darwin") return undefined;
	const argv = ["security", "find-generic-password", "-s", service, ...(account ? ["-a", account] : []), "-w"];
	const secret = (await system.run(argv, 10_000))?.trim();
	return secret || undefined;
}

/** A JSON file's value, or undefined when it is missing or not JSON. */
export async function readJson(system: UsageSystem, path: string): Promise<unknown> {
	const text = await system.readText(path);
	if (text === undefined) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}
