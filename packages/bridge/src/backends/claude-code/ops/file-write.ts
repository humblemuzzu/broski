/** Writing a config file the way it can never be left half written or written over a change made meanwhile. */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { link, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
	const temp = join(dirname(real), `.${basename(real)}.${randomBytes(6).toString("hex")}.tmp`);
	try {
		await writeTemp(temp, text, mode);
		return revision === ABSENT_REVISION ? await create(temp, real) : await swap(temp, real, revision);
	} finally {
		await unlink(temp).catch(() => undefined);
	}
}

async function writeTemp(temp: string, text: string, mode: number | undefined): Promise<void> {
	const handle = await open(temp, "wx", mode ?? 0o644);
	try {
		await handle.writeFile(text, "utf8");
		if (mode !== undefined) await handle.chmod(mode);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function create(temp: string, real: string): Promise<WriteOutcome> {
	try {
		await link(temp, real);
		return { ok: true };
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") return STALE;
		throw error;
	}
}

async function swap(temp: string, real: string, revision: string): Promise<WriteOutcome> {
	if ((await readFileState(real)).revision !== revision) return STALE;
	await rename(temp, real);
	return { ok: true };
}

const TRASH_TIMEOUT_MS = 15_000;

/** Moves `real` to the system Trash with the `trash` command found on `env`'s PATH; the file stays when that fails. */
export function trashIfUnchanged(
	real: string,
	revision: string,
	env: Readonly<Record<string, string>>,
): Promise<WriteOutcome> {
	return serialized(real, async () => {
		if ((await readFileState(real)).revision !== revision) return STALE;
		return moveToTrash(real, env);
	});
}

function moveToTrash(real: string, env: Readonly<Record<string, string>>): Promise<WriteOutcome> {
	return new Promise((resolve) => {
		const child = spawn("trash", [real], { stdio: "ignore", timeout: TRASH_TIMEOUT_MS, env: { ...env } });
		child.once("error", (error) => resolve(failed(new Error(`the trash command could not run: ${error.message}`))));
		child.once("close", (code, signal) => {
			if (code === 0) return resolve({ ok: true });
			const why = signal === null ? `the trash command failed (exit ${code})` : "the trash command did not finish";
			resolve(failed(new Error(why)));
		});
	});
}
