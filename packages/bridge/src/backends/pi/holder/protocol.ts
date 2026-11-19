/**
 * What a bridge and the holder of a hosted session's `pi` say to each other over the holder's unix socket, one JSON
 * line at a time. Pi's own records travel as Pi wrote them; the holder's carry a `holder` key first, which no Pi record
 * has (every one starts with `type`). The holder outlives the bridge that started it and runs that bridge's code, so a
 * bridge talks only to a holder of its own `HOLDER_VERSION`.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

export const HOLDER_VERSION = 1;

/** The argument a bridge binary is started with to be a holder; the holder's directory follows it. */
export const HOLDER_SUBCOMMAND = "__pi-holder";

export const SOCKET_FILE = "sock";
export const META_FILE = "holder.json";

/** What the bridge writes once on the holder's stdin: the environment holds secrets, so never argv nor a file. */
export interface HolderSpec {
	readonly version: number;
	readonly sessionId: string;
	readonly file: string;
	readonly cwd: string;
	readonly cliPath: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	/** The bridge extension's hash, which tells a later bridge whether this `pi` runs its own extension. */
	readonly extension: string;
}

/** `holder.json`, for a later bridge to find the holder by; the bridge never signals a pid it reads here. */
export interface HolderMeta {
	readonly holderVersion: number;
	readonly pid: number;
	readonly piPid?: number;
	readonly sessionId: string;
	readonly file: string;
	readonly cwd: string;
	readonly startedAt: number;
	readonly extension: string;
}

export interface HelloFrame {
	readonly holder: "hello";
	readonly version: number;
	readonly sessionId: string;
	readonly extension: string;
	/** Pi records the replay holds, which follow before `live`. */
	readonly replayed: number;
	/** The replay lost the start of the run under way. */
	readonly truncated: boolean;
	/** Wall-clock epoch ms when the active run or compaction started, if one is under way. */
	readonly runStartedAt?: number;
}

export interface ExitFrame {
	readonly holder: "exit";
	readonly code: number | null;
	readonly signal: string | null;
	readonly error?: string;
	readonly stderr: string;
}

export type HolderFrame =
	| HelloFrame
	| ExitFrame
	| { readonly holder: "live" }
	| { readonly holder: "replaced" }
	| { readonly holder: "oversized"; readonly bytes: number };

export type BridgeControl = { readonly holder: "stop" };

export const CONTROL_PREFIX = '{"holder":';

export function controlLine(frame: HolderFrame | BridgeControl): string {
	return `${JSON.stringify(frame)}\n`;
}

/**
 * Short and hashed: a unix socket path is at most 103 bytes on macOS, and the directory sits under `~/.broski` or a
 * test's temp dir.
 */
export function holderDirOf(root: string, sessionId: string): string {
	return join(root, createHash("sha256").update(sessionId).digest("hex").slice(0, 12));
}

export function socketOf(dir: string): string {
	return join(dir, SOCKET_FILE);
}

export function metaOf(dir: string): string {
	return join(dir, META_FILE);
}

/** The control frame `line` holds; undefined for a Pi record. */
export function controlOf(line: string): Readonly<Record<string, unknown>> | undefined {
	if (!line.startsWith(CONTROL_PREFIX)) return undefined;
	try {
		const value: unknown = JSON.parse(line);
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSpec(text: string): HolderSpec | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	const { version, sessionId, file, cwd, cliPath, args, env, extension } = value;
	if (version !== HOLDER_VERSION || !isStringList(args) || !isStringMap(env)) return undefined;
	if (typeof sessionId !== "string" || typeof file !== "string" || typeof cwd !== "string") return undefined;
	if (typeof cliPath !== "string" || typeof extension !== "string") return undefined;
	return { version, sessionId, file, cwd, cliPath, args, env, extension };
}

function isStringList(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringMap(value: unknown): value is Readonly<Record<string, string>> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}
