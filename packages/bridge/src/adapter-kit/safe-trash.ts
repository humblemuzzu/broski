/**
 * The one way an adapter deletes a file: a move to the macOS Trash, `~/.Trash`. A move never copies and never
 * removes, so on a failure the files stay where they are. The Trash is found from the `HOME` the agent is given,
 * so a test's temp `HOME` keeps it off the real one.
 */

import { lstat, mkdir, rename } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import type { ActionResult, RejectionCode } from "../contract";

export interface TrashTarget {
	readonly platform: NodeJS.Platform;
	readonly home: string;
	/** Stands in for `rename`, as a test refuses a move the way macOS refuses a service without Full Disk Access. */
	readonly rename?: (from: string, to: string) => Promise<void>;
}

const DIR_MODE = 0o700;
const MAX_NAME_TRIES = 1_000;

/** Undefined when `HOME` is not an absolute path: the process's own home is never assumed. */
export function trashTargetOf(
	env: Readonly<Record<string, string | undefined>>,
	platform: NodeJS.Platform = process.platform,
): TrashTarget | undefined {
	const home = env.HOME;
	if (home === undefined || !isAbsolute(home)) return undefined;
	return { platform, home };
}

/** Moves every path into the Trash in turn; the first that cannot move stops the rest and says why. */
export async function moveToTrash(paths: readonly string[], target: TrashTarget | undefined): Promise<ActionResult> {
	if (target === undefined)
		return rejected("backend_error", "the trash location is unknown: no HOME in the environment");
	if (target.platform !== "darwin") {
		return rejected("unsupported", `moving to the trash is not supported on ${target.platform}`);
	}
	for (const path of paths) {
		try {
			await moveToMacTrash(path, target);
		} catch (error) {
			return rejected("backend_error", refusalText(basename(path), error));
		}
	}
	return { status: "accepted" };
}

async function moveToMacTrash(path: string, target: TrashTarget): Promise<void> {
	const trash = join(target.home, ".Trash");
	await mkdir(trash, { recursive: true, mode: DIR_MODE });
	for (let attempt = 1; attempt <= MAX_NAME_TRIES; attempt++) {
		const destination = join(trash, candidateName(basename(path), attempt));
		if (await exists(destination)) continue;
		await (target.rename ?? rename)(path, destination);
		return;
	}
	throw new Error("no free name in the trash");
}

/** `name`, else `stem 2.ext`, `stem 3.ext`…: Finder's way of keeping both. */
function candidateName(name: string, attempt: number): string {
	if (attempt === 1) return name;
	const extension = extname(name);
	return `${name.slice(0, name.length - extension.length)} ${attempt}${extension}`;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

function refusalText(name: string, error: unknown): string {
	const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
	if (code === "EPERM" || code === "EACCES") {
		return `macOS did not let the bridge move ${name} into the Trash (${code}): a background service needs Full Disk Access to reach ~/.Trash. Grant it in System Settings, Privacy & Security, Full Disk Access, or delete the file on the Mac. It was left where it is.`;
	}
	const why = error instanceof Error ? error.message : String(error);
	return `${name} could not be moved to the trash, and was left where it is: ${why}`;
}

function rejected(code: RejectionCode, message: string): ActionResult {
	return { status: "rejected", rejection: { code, message } };
}
