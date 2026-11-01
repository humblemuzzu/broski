/** Lane A · rename (`renameSession`), fork (`forkSession`, D19) and delete (the OS trash) of a session nobody hosts. */

import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type ActionResult,
	type ForkPoint,
	MAX_NAME_CHARS,
	type NewSessionResult,
	type Rejected,
	type SessionId,
} from "../../../contract";
import { clip } from "../bounds";
import { parseChildRef } from "../ids";
import type { LiveOverlay } from "../ports/store";
import { ACCEPTED, isRejected, rejected } from "../rejections";
import { finishedEnd, positionOfItem } from "./chain-lookup";
import { openChain } from "./chain-reader";
import { sourceOf } from "./chain-sources";
import type { StoreContext } from "./context";
import { announceSession } from "./get";
import { attempt, attemptDone } from "./guard";
import { locateSession } from "./info";
import { moveToTrash, trashTargetOf } from "./trash";

const CHILD_REFUSAL = "a subagent's session cannot be renamed, forked or deleted: it belongs to its parent";

export async function renameStored(ctx: StoreContext, sessionId: SessionId, title: string): Promise<ActionResult> {
	if (parseChildRef(sessionId) !== undefined) return rejected("unsupported", CHILD_REFUSAL);
	const text = clip(title.trim(), MAX_NAME_CHARS);
	if (text === "") return rejected("invalid_input", "a title cannot be empty");
	const located = await locateSession(ctx, sessionId);
	if (isRejected(located)) return located;
	const failed = await attemptDone(() => ctx.deps.services.sdk.renameSession(sessionId, text));
	if (failed !== undefined) return failed;
	ctx.index.drop(sessionId);
	await announceSession(ctx, sessionId, ctx.live);
	return ACCEPTED;
}

export async function forkStored(
	ctx: StoreContext,
	sessionId: SessionId,
	at: ForkPoint | undefined,
	live: LiveOverlay,
): Promise<NewSessionResult> {
	if (parseChildRef(sessionId) !== undefined) return rejected("unsupported", CHILD_REFUSAL);
	const located = await locateSession(ctx, sessionId);
	if (isRejected(located)) return located;
	const upTo = await forkEnd(ctx, sessionId, at, live);
	if (isRejected(upTo)) return upTo;
	const options = upTo.uuid === undefined ? undefined : { upToMessageId: upTo.uuid };
	const forked = await attempt(() => ctx.deps.services.sdk.forkSession(sessionId, options));
	if (isRejected(forked)) return forked;
	await ctx.deps.ownership.claim(forked.sessionId);
	await ctx.forks.link(forked.sessionId, sessionId);
	await announceSession(ctx, forked.sessionId, live);
	return {
		status: "accepted",
		session: { backend: "claude-code", sessionId: forked.sessionId },
	};
}

/** The last entry a fork keeps; undefined keeps the whole chain. */
async function forkEnd(
	ctx: StoreContext,
	sessionId: SessionId,
	at: ForkPoint | undefined,
	live: LiveOverlay,
): Promise<{ uuid: string | undefined } | Rejected> {
	const cut = live.row(sessionId)?.cut;
	if (at === undefined) {
		if (cut === undefined) return { uuid: undefined };
		return cut.lastUuidBefore === null
			? rejected("invalid_input", "the session has nothing finished to fork yet")
			: { uuid: cut.lastUuidBefore };
	}
	const opened = await sourceOf(ctx, sessionId);
	if (isRejected(opened)) return opened;
	const snapshot = await openChain(ctx, opened.source);
	if (isRejected(snapshot)) return snapshot;
	const { index } = snapshot;
	const found = positionOfItem(index, at.itemId);
	if (found === undefined) return rejected("not_found", `no transcript item ${at.itemId}`);
	const answered = at.position === "through" ? index.toolResults.get(at.itemId) : undefined;
	const position = at.position === "through" ? (answered ?? found) : found - 1;
	const uuid = index.uuids[position];
	if (uuid === undefined) return rejected("invalid_input", "nothing comes before the first item");
	const limit = finishedEnd(index, cut?.lastUuidBefore);
	return position < limit ? { uuid } : rejected("invalid_input", "the item belongs to the run in progress");
}

export async function removeStored(ctx: StoreContext, sessionId: SessionId): Promise<ActionResult> {
	if (parseChildRef(sessionId) !== undefined) return rejected("unsupported", CHILD_REFUSAL);
	const located = await locateSession(ctx, sessionId);
	if (isRejected(located)) return located;
	const directory = join(dirname(located.path), sessionId);
	const target = trashTargetOf(ctx.deps.services);
	const moved = await moveToTrash([located.path], target);
	if (isRejected(moved)) return moved;
	if (await isDirectory(directory)) await moveToTrash([directory], target);
	ctx.index.drop(sessionId);
	ctx.locator.forget(sessionId);
	ctx.deps.catalog.emit({
		type: "session_removed",
		session: { backend: "claude-code", sessionId },
	});
	return ACCEPTED;
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}
