/**
 * Rename, delete and fork of sessions no hosted `pi` runs: an appended `session_info` line,
 * a contained delete, and a new file holding the branch to the fork point. The source is never opened
 * with `SessionManager`.
 */

import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { ActionResult, ForkPoint, NewSessionResult, Rejected, SessionId } from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import { errorText } from "../error-text";
import { parseEntryPart } from "../ids";
import type { LiveOverlay } from "../ports";
import { ACCEPTED, rejected } from "../rejections";
import type { BranchItems, ItemsOfEntry } from "./branch-items";
import { isContainedFile, trashFile } from "./discard-file";
import { CURRENT_SESSION_VERSION, type SessionHeader } from "./entries";
import { freshEntryId } from "./fork-entries";
import { holdsOrigin, writeForkFile } from "./fork-file";
import { lastEntryId, type SessionFileIndex } from "./jsonl-reader";
import { NO_LIVE, summaryFor } from "./list";
import { isFileSystemError } from "./open-file";
import type { SessionDirs } from "./session-dir";
import { isRejection, openFileIndex, type SessionIndex } from "./session-index";
import { openBranch } from "./transcript";
import { uuidv7 } from "./uuidv7";

export interface MutationDeps {
	readonly index: SessionIndex;
	readonly dirs: SessionDirs;
	readonly catalog: CatalogFeed;
	readonly now: () => number;
	readonly itemsOf: ItemsOfEntry;
}

/** Emits `session_updated` with `title.source: "user"`. `name` is already `sessionName`'s. */
export async function renameStored(deps: MutationDeps, sessionId: SessionId, name: string): Promise<ActionResult> {
	const head = await deps.index.find(sessionId);
	if (head === undefined) return rejected("not_found", `no Pi session ${sessionId}`);
	if (!(await isContainedFile(trustedRoots(deps.dirs), head.path))) return OUTSIDE;
	const file = await openFileIndex(deps.index, head.path);
	if (isRejection(file)) return file;
	const entry = {
		type: "session_info",
		id: freshEntryId(file.byId),
		parentId: file.version >= 2 ? lastEntryId(file) : null,
		timestamp: new Date(deps.now()).toISOString(),
		name,
	};
	try {
		if (!(await appendLine(head.path, `${JSON.stringify(entry)}\n`))) {
			return rejected("not_found", "the session file is no longer a regular file");
		}
	} catch (error) {
		return writeFailure(error);
	}
	await announceUpdate(deps, head.path);
	return ACCEPTED;
}

/**
 * Emits `session_removed`. `release` runs once the file is known to be deletable, before it goes to the Trash: the
 * session's host ends then, and a refused delete leaves it running.
 */
export async function removeStored(
	deps: MutationDeps,
	sessionId: SessionId,
	release: () => Promise<void>,
): Promise<ActionResult> {
	const head = await deps.index.find(sessionId);
	if (head === undefined) return rejected("not_found", `no Pi session ${sessionId}`);
	if (!(await isContainedFile(trustedRoots(deps.dirs), head.path))) return OUTSIDE;
	await release();
	const failure = await trashFile(head.path);
	if (failure !== undefined) {
		return rejected("backend_error", `the session was not deleted: ${failure}. Delete it in a terminal.`);
	}
	deps.index.forget(head.path);
	deps.catalog.emit({ type: "session_removed", session: { backend: "pi", sessionId } });
	return ACCEPTED;
}

/** Emits `session_updated` for the fork, whose `parent` is `{kind: "fork", session}`. */
export async function forkStored(
	deps: MutationDeps,
	sessionId: SessionId,
	at: ForkPoint | undefined,
	live: LiveOverlay,
): Promise<NewSessionResult> {
	const opened = await openBranch(deps.index, sessionId, live, deps.itemsOf);
	if ("rejection" in opened) return opened;
	const end = await forkEnd(opened.items, at);
	if (typeof end !== "number") return end;
	const spans = opened.items.branch.slice(0, end);
	const header = forkHeader(opened.file, opened.head.path, deps.now);
	const ownedAlready = await holdsOrigin(opened.file, spans);
	const directory = opened.head.cwd === undefined ? dirname(opened.head.path) : deps.dirs.forCwd(opened.head.cwd);
	const originId = ownedAlready ? undefined : freshEntryId(new Set(spans.map((span) => span.entryId)));
	const written = await writeForkFile({ source: opened.file, spans, directory, header, originId });
	if ("failure" in written) return rejected("backend_error", `the fork could not be written: ${written.failure}`);
	const created = await announceUpdate(deps, written.path);
	return created
		? { status: "accepted", session: { backend: "pi", sessionId: header.id } }
		: rejected("backend_error", "the fork was written but cannot be read back");
}

function forkHeader(source: SessionFileIndex, sourcePath: string, now: () => number): SessionHeader {
	return {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: uuidv7(now()),
		timestamp: new Date(now()).toISOString(),
		cwd: source.header.cwd,
		parentSession: sourcePath,
	};
}

/**
 * How many entries of the branch the fork keeps. Pi forks at whole entries, so an item is a fork point only
 * where its entry's items begin (`before`) or end (`through`).
 */
async function forkEnd(items: BranchItems, at: ForkPoint | undefined): Promise<number | Rejected> {
	if (at === undefined) return items.branch.length;
	const part = parseEntryPart(at.itemId);
	const position = part === undefined ? -1 : items.positionOf(part.entryId);
	const entryItems = position < 0 ? [] : await items.itemsAt(position);
	const place = entryItems.findIndex((item) => item.id === at.itemId);
	if (place < 0) return rejected("not_found", `no item ${at.itemId} on the branch of this session`);
	const fits = at.position === "through" ? place === entryItems.length - 1 : place === 0;
	if (!fits) return rejected("invalid_input", "Pi forks at whole messages, not inside one");
	return at.position === "through" ? position + 1 : position;
}

/** Emits `session_updated` for the file at `path` as it is now; false when it cannot be read. */
async function announceUpdate(deps: MutationDeps, path: string): Promise<boolean> {
	const head = await deps.index.headAt(path);
	if (head === undefined) return false;
	deps.catalog.emit({ type: "session_updated", summary: await summaryFor(deps.index, head, NO_LIVE) });
	return true;
}

/**
 * Appends one line to an existing regular file in one write, after a newline when the file's last line lacks one;
 * false when the path is no longer a regular file (opened without blocking, as `openRegularFile` explains).
 */
async function appendLine(path: string, line: string): Promise<boolean> {
	const handle = await open(path, constants.O_RDWR | constants.O_APPEND | constants.O_NONBLOCK);
	try {
		if (!(await handle.stat()).isFile()) return false;
		const needsBreak = !(await endsWithNewline(handle));
		await handle.write(needsBreak ? `\n${line}` : line);
		return true;
	} finally {
		await handle.close();
	}
}

async function endsWithNewline(handle: FileHandle): Promise<boolean> {
	const { size } = await handle.stat();
	if (size === 0) return true;
	const last = Buffer.alloc(1);
	await handle.read(last, 0, 1, size - 1);
	return last[0] === 0x0a;
}

const OUTSIDE = rejected(
	"unsupported",
	"this session file lies outside the sessions directories this bridge may change; change it in a terminal",
);

/** Where a write may land: not a directory only an untrusted project names (`SessionRoot.trusted`). */
function trustedRoots(dirs: SessionDirs): string[] {
	return dirs
		.roots()
		.filter((root) => root.trusted)
		.map((root) => root.dir);
}

function writeFailure(error: unknown): Rejected {
	if (!isFileSystemError(error)) throw error;
	const gone = error instanceof Error && "code" in error && error.code === "ENOENT";
	return rejected(gone ? "not_found" : "backend_error", errorText(error));
}
