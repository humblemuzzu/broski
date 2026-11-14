/**
 * Putting the terminal ask hook into the user's `settings.json` and taking it out (D29). A strict-JSON
 * read-modify-write: a file that does not parse is refused and left as it is, every other key survives, the new file is
 * written beside the old one and renamed over it, and a change made by someone else in between is not overwritten.
 */

import { open, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../files/atomic-write";
import { indentOf, jsonFileText, parseObject } from "../files/json-object";
import { roundTripProblem } from "../files/json-round-trip";
import { isMissing } from "../files/missing";
import { type HookSpec, type Settings, withHook, withoutHook } from "./hook-settings";

export type HookFileResult =
	| { readonly status: "installed" | "removed" | "unchanged"; readonly path: string }
	| { readonly status: "refused"; readonly path: string; readonly reason: string };

const ATTEMPTS = 3;
/** A settings file this bridge creates holds the loopback bearer token, so only its owner may read it. */
const NEW_FILE_MODE = 0o600;
export const MAX_SETTINGS_BYTES = 4 * 1024 * 1024;

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
		const text = jsonFileText(edited.settings, before.indent);
		const unchangedMeanwhile = async () => (await readOrNothing(path)) === before.text;
		if (await writeAtomic(path, text, { mode: before.mode, stillWanted: unchangedMeanwhile }))
			return { status: done, path };
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
	readonly indent: string | undefined;
	readonly mode: number;
	readonly problem?: string;
}

async function read(path: string): Promise<Read> {
	const nothing = { settings: {}, text: undefined, indent: "  ", mode: NEW_FILE_MODE };
	let text: string;
	let mode: number;
	try {
		const handle = await open(path, "r");
		try {
			const info = await handle.stat();
			if (info.size > MAX_SETTINGS_BYTES)
				return { ...nothing, problem: `${path} is larger than ${MAX_SETTINGS_BYTES} bytes; it is left as it is` };
			mode = info.mode & 0o777;
			text = await handle.readFile("utf8");
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (isMissing(error)) return nothing;
		return { ...nothing, problem: `cannot read ${path}` };
	}
	if (text.trim() === "") return { settings: {}, text, indent: "  ", mode };
	const parsed = parseObject(text);
	if ("problem" in parsed)
		return { ...nothing, text, mode, problem: `${path} is not a JSON object: ${parsed.problem}` };
	const lossy = roundTripProblem(text);
	if (lossy !== undefined)
		return { ...nothing, text, mode, problem: `${path} cannot be rewritten without changing it: ${lossy}` };
	return { settings: parsed.value, text, indent: indentOf(text), mode };
}

async function readOrNothing(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isMissing(error)) return undefined;
		throw error;
	}
}
