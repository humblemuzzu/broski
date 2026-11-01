/** Writing a config file the way it can never be left half written or written over a change made meanwhile. */

import { link, mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { writeTempBeside } from "../files/atomic-write";
import { isRejected } from "../rejections";
import { moveToTrash, type TrashTarget } from "../trash";
import { ABSENT_REVISION, readFileState } from "./file-state";
import { serialized } from "./serialized";

export type WriteOutcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: "stale" | "failed"; readonly message: string };

const STALE: WriteOutcome = { ok: false, reason: "stale", message: "the file changed since it was read" };

function failed(error: unknown): WriteOutcome {
	return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
}

/** Replaces `real` with `text` only while it still holds `revision` (`ABSENT_REVISION`: only while it does not exist). */
export function writeIfUnchanged(real: string, text: string, revision: string): Promise<WriteOutcome> {
	return serialized(real, async () => {
		try {
			return await replace(real, text, revision);
		} catch (error) {
			return failed(error);
		}
	});
}

async function replace(real: string, text: string, revision: string): Promise<WriteOutcome> {
	const before = await readFileState(real);
	if (before.revision !== revision) return STALE;
	if (before.exists && !before.faithful) return failed(new Error(`${basename(real)} cannot be rewritten without loss`));
	await mkdir(dirname(real), { recursive: true });
	const mode = before.exists ? (await stat(real)).mode & 0o7777 : undefined;
	const temp = await writeTempBeside(real, text, mode);
	try {
		return revision === ABSENT_REVISION ? await create(temp, real) : await swap(temp, real, revision);
	} finally {
		await unlink(temp).catch(() => undefined);
	}
}

const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "ENOSYS", "EXDEV"]);

/** Makes the file appear whole and only if nothing is there yet: a hard link fails when the name is taken. */
async function create(temp: string, real: string): Promise<WriteOutcome> {
	try {
		await link(temp, real);
		return { ok: true };
	} catch (error) {
		const code = error instanceof Error && "code" in error ? String(error.code) : "";
		if (code === "EEXIST") return STALE;
		if (!NO_HARD_LINKS.has(code)) throw error;
		return swap(temp, real, ABSENT_REVISION);
	}
}

async function swap(temp: string, real: string, revision: string): Promise<WriteOutcome> {
	if ((await readFileState(real)).revision !== revision) return STALE;
	await rename(temp, real);
	return { ok: true };
}

/** Moves `real` to the OS trash while it still holds `revision`; the file stays when that fails. */
export function trashIfUnchanged(
	real: string,
	revision: string,
	target: TrashTarget | undefined,
): Promise<WriteOutcome> {
	return serialized(real, async () => {
		if ((await readFileState(real)).revision !== revision) return STALE;
		const moved = await moveToTrash([real], target);
		return isRejected(moved) ? failed(new Error(moved.rejection.message)) : { ok: true };
	});
}
