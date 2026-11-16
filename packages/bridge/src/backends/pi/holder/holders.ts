/** The holders under one root, as a bridge finds them at start and as `broski stop` ends them all. */

import { readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HolderLink } from "./link";
import { HOLDER_VERSION, type HolderMeta, isRecord, metaOf } from "./protocol";

/** `~/.broski/pi-hosts`. */
export function defaultHoldersRoot(): string {
	return join(homedir(), ".broski", "pi-hosts");
}

export function holderDirs(root: string): string[] {
	try {
		return readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(root, entry.name));
	} catch {
		return [];
	}
}

/** `holder.json` of a holder this bridge can talk to; undefined when it is unreadable or another version's. */
export function readMeta(dir: string): HolderMeta | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(metaOf(dir), "utf8"));
		if (!isRecord(value) || value.holderVersion !== HOLDER_VERSION) return undefined;
		const { pid, sessionId, file, cwd, startedAt, extension } = value;
		if (typeof sessionId !== "string" || typeof file !== "string" || typeof cwd !== "string") return undefined;
		if (typeof pid !== "number" || typeof startedAt !== "number" || typeof extension !== "string") return undefined;
		return { holderVersion: HOLDER_VERSION, pid, sessionId, file, cwd, startedAt, extension };
	} catch {
		return undefined;
	}
}

/**
 * The processes the holders under `root` say they and their `pi` are, for a sweep of stray bridge processes to leave
 * alone. Only ever read to spare a process, never to signal one: a pid on disk may belong to anyone by now.
 */
export function holderPids(root: string): ReadonlySet<number> {
	const pids = new Set<number>();
	for (const dir of holderDirs(root)) {
		try {
			const value: unknown = JSON.parse(readFileSync(metaOf(dir), "utf8"));
			if (!isRecord(value)) continue;
			if (typeof value.pid === "number") pids.add(value.pid);
			if (typeof value.piPid === "number") pids.add(value.piPid);
		} catch {
			// Unreadable: nothing to spare.
		}
	}
	return pids;
}

/** A directory whose holder answers nothing is left over from one that is gone: removed, and nobody is signalled. */
export function removeStale(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// A holder that was ending removes it at the same moment.
	}
}

/** Asks every holder under `root` to stop its `pi`, whatever version it is, and waits until each has. */
/** How many holders were running and were stopped. */
export async function stopHolders(root: string): Promise<number> {
	const stopped = await Promise.all(
		holderDirs(root).map(async (dir) => {
			const attached = await HolderLink.connect(dir);
			if (attached === "absent") removeStale(dir);
			if (typeof attached === "string") return false;
			await attached.link.stop();
			return true;
		}),
	);
	return stopped.filter(Boolean).length;
}
