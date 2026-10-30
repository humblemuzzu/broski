import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

/** Long enough for a Trash that asks the user something, short enough that a hung command cannot hold a delete. */
const TRASH_TIMEOUT_MS = 15_000;

/**
 * Moves a session file to the system Trash with the `trash` command, as Pi's session picker tries first
 * (pi-coding-agent `src/modes/interactive/components/session-selector.ts:652-680`). The picker then removes the file
 * for good when that fails; this never does, so the file stays. Resolves with why it failed, or undefined.
 */
export function trashFile(path: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const child = spawn("trash", [path], { stdio: "ignore", timeout: TRASH_TIMEOUT_MS });
		child.once("error", (error) => resolve(`the trash command could not run: ${error.message}`));
		child.once("close", (code, signal) => {
			if (code === 0) resolve(undefined);
			else resolve(signal === null ? `the trash command failed (exit ${code})` : "the trash command did not finish");
		});
	});
}

/** Whether `path` is a regular file whose real location is inside one of `roots`: a symlinked directory cannot lead a write out. */
export async function isContainedFile(roots: readonly string[], path: string): Promise<boolean> {
	const real = await realpathOrUndefined(path);
	if (real === undefined || !(await isRegularFile(real))) return false;
	for (const root of roots) {
		const realRoot = await realpathOrUndefined(root);
		if (realRoot === undefined) continue;
		const inside = relative(realRoot, real);
		if (inside !== "" && inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) return true;
	}
	return false;
}

async function isRegularFile(path: string): Promise<boolean> {
	try {
		return (await lstat(path)).isFile();
	} catch {
		return false;
	}
}

async function realpathOrUndefined(path: string): Promise<string | undefined> {
	try {
		return await realpath(path);
	} catch {
		return undefined;
	}
}
