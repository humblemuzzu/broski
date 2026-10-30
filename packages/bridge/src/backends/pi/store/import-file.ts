/**
 * Puts a checked session file into the sessions directory its project uses, as a new file named the way Pi names
 * them (`<time>_<id>.jsonl`), and makes the session this bridge's own: the file is new, so no terminal can have it
 * open. Nothing is replaced: a session id that is already here is refused, and the file is linked into place, which
 * fails where a file exists. Only a directory inside the roots a write may land in is written.
 */

import { constants } from "node:fs";
import { copyFile, link, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Rejected, SessionId } from "../../../contract";
import { errorText } from "../error-text";
import { rejected } from "../rejections";
import type { CheckedHeader } from "../transfer/session-check";
import { isInsideRoots } from "./contained-dir";
import { announceUpdate, claimStored, type MutationDeps, OUTSIDE, trustedRoots } from "./mutations";
import { isFileSystemError } from "./open-file";

/** The id of the session now in the list, or why the file was not taken in. */
export async function importStored(
	deps: MutationDeps,
	header: CheckedHeader,
	source: string,
): Promise<{ readonly sessionId: SessionId } | Rejected> {
	if ((await deps.index.find(header.id)) !== undefined) {
		return rejected("invalid_input", `a session with the id ${header.id} is already on this Mac; nothing was replaced`);
	}
	const adopted = deps.dirs.know(header.cwd);
	if (adopted !== undefined) deps.index.adopt(adopted);
	const directory = deps.dirs.forCwd(header.cwd);
	if (!(await isInsideRoots(trustedRoots(deps.dirs), directory))) return OUTSIDE;
	const path = join(directory, `${header.timestamp.replace(/[:.]/g, "-")}_${header.id}.jsonl`);
	const failure = await place(source, directory, path);
	if (failure !== undefined) return failure;
	if (!(await announceUpdate(deps, path))) {
		await unlink(path).catch(() => undefined);
		return rejected("backend_error", "the session was written but Pi cannot read it back, so it was removed");
	}
	const claimed = await claimStored(deps, header.id);
	if (claimed.status === "rejected") {
		return rejected(
			"backend_error",
			`the session was imported but could not be made yours (${claimed.rejection.message}); take it over from its row`,
		);
	}
	return { sessionId: header.id };
}

/** Copies `source` to `path` whole or not at all, and not over a file: the copy is hard-linked to its name. */
async function place(source: string, directory: string, path: string): Promise<Rejected | undefined> {
	const temporary = `${path}.tmp`;
	try {
		await mkdir(directory, { recursive: true });
		await copyFile(source, temporary, constants.COPYFILE_EXCL);
		await link(temporary, path);
		return undefined;
	} catch (error) {
		if (!isFileSystemError(error)) throw error;
		const exists = "code" in error && error.code === "EEXIST";
		return rejected(
			exists ? "invalid_input" : "backend_error",
			exists
				? "a session file of that name is already here; nothing was replaced"
				: `the session could not be written: ${errorText(error)}`,
		);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
}
