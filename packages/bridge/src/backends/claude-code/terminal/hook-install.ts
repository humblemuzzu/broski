/**
 * Putting the terminal ask hook into the user's `settings.json` and taking it out (D26). A strict-JSON read-modify-write:
 * a file that does not parse is refused and left as it is, every other key survives, the new file is written beside the
 * old one and renamed over it, and a change made by someone else in between is not overwritten.
 */

import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isRecord } from "../json";
import { type HookSpec, type Settings, withHook, withoutHook } from "./hook-settings";

export type HookFileResult =
	| { readonly status: "installed" | "removed" | "unchanged"; readonly path: string }
	| { readonly status: "refused"; readonly path: string; readonly reason: string };

const ATTEMPTS = 3;
const NEW_FILE_MODE = 0o600;

/** `configRoot`: `CLAUDE_CONFIG_DIR`, else `~/.claude` (the SDK's `configRoot()`). */
export async function installTerminalHook(configRoot: string, spec: HookSpec): Promise<HookFileResult> {
	return edit(configRoot, (settings) => withHook(settings, spec), "installed");
}

export async function removeTerminalHook(configRoot: string, caCertPath?: string): Promise<HookFileResult> {
	return edit(configRoot, (settings) => withoutHook(settings, caCertPath), "removed");
}

type Change = (settings: Settings) => ReturnType<typeof withHook>;

async function edit(configRoot: string, change: Change, done: "installed" | "removed"): Promise<HookFileResult> {
	const path = await settingsPath(configRoot);
	try {
		return await editFile(path, change, done);
	} catch (error) {
		return {
			status: "refused",
			path,
			reason: `cannot write ${path}: ${error instanceof Error ? error.message : error}`,
		};
	}
}

async function editFile(path: string, change: Change, done: "installed" | "removed"): Promise<HookFileResult> {
	for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
		const before = await read(path);
		if (before.problem !== undefined) return { status: "refused", path, reason: before.problem };
		const edited = change(before.settings);
		if (!edited.ok) return { status: "refused", path, reason: edited.reason };
		if (JSON.stringify(edited.settings) === JSON.stringify(before.settings)) return { status: "unchanged", path };
		const text = serialize(edited.settings, before.indent);
		if (await replace(path, text, before.text, before.mode)) return { status: done, path };
	}
	return { status: "refused", path, reason: "the settings file keeps changing under the bridge" };
}

/** A settings file that is a symlink (a dotfiles manager's) is edited where it points, so the link stays. */
async function settingsPath(configRoot: string): Promise<string> {
	const path = join(configRoot, "settings.json");
	try {
		return await realpath(path);
	} catch {
		return path;
	}
}

interface Read {
	readonly settings: Settings;
	readonly text: string | undefined;
	readonly indent: string;
	readonly mode: number;
	readonly problem?: string;
}

async function read(path: string): Promise<Read> {
	let text: string;
	let mode = NEW_FILE_MODE;
	try {
		text = await readFile(path, "utf8");
		mode = (await stat(path)).mode & 0o777;
	} catch (error) {
		if (isMissing(error)) return { settings: {}, text: undefined, indent: "  ", mode };
		return { settings: {}, text: undefined, indent: "  ", mode, problem: `cannot read ${path}` };
	}
	if (text.trim() === "") return { settings: {}, text, indent: "  ", mode };
	const parsed = parse(text);
	if (!isRecord(parsed)) return { settings: {}, text, indent: "  ", mode, problem: `${path} is not a JSON object` };
	return { settings: parsed, text, indent: indentOf(text), mode };
}

function parse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function indentOf(text: string): string {
	const match = /^\n?([ \t]+)\S/m.exec(text);
	return match?.[1] ?? "  ";
}

function serialize(settings: Settings, indent: string): string {
	return `${JSON.stringify(settings, null, indent)}\n`;
}

/** False when the file is not what `expected` was read as: the caller reads again. */
async function replace(path: string, text: string, expected: string | undefined, mode: number): Promise<boolean> {
	await mkdir(dirname(path), { recursive: true });
	const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
	const handle = await open(temp, "wx", mode);
	try {
		await handle.writeFile(text, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		if ((await readOrNothing(path)) !== expected) {
			await unlink(temp);
			return false;
		}
		await rename(temp, path);
		return true;
	} catch (error) {
		await unlink(temp).catch(() => undefined);
		throw error;
	}
}

async function readOrNothing(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isMissing(error)) return undefined;
		throw error;
	}
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
