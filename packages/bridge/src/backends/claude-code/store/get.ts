/** One session's row: `get`, and the `session_updated` that announces it. */

import { isRejected, rejected } from "../../../adapter-kit/rejections";
import type { SessionGetResult, SessionId } from "../../../contract";
import { parseChildRef } from "../ids";
import type { LiveOverlay } from "../ports/store";
import { getChild } from "./children";
import type { StoreContext } from "./context";
import { rowOfInfo, sessionInfo } from "./info";

export async function getSession(
	ctx: StoreContext,
	sessionId: SessionId,
	live: LiveOverlay,
): Promise<SessionGetResult> {
	const child = parseChildRef(sessionId);
	if (child !== undefined) return getChild(ctx, child, live);
	const info = await sessionInfo(ctx, sessionId);
	if (info !== undefined && isRejected(info)) return info;
	const summary = info === undefined ? undefined : await rowOfInfo(ctx, info, live.row(sessionId));
	return summary === undefined
		? rejected("not_found", `no Claude Code session ${sessionId}`)
		: { status: "accepted", summary };
}

/** Emits the session's row; nothing when it cannot be read. Never throws. */
export async function announceSession(ctx: StoreContext, sessionId: SessionId, live: LiveOverlay): Promise<void> {
	try {
		const found = await getSession(ctx, sessionId, live);
		if (found.status === "accepted")
			ctx.deps.catalog.emit({
				type: "session_updated",
				summary: found.summary,
			});
	} catch {
		return;
	}
}
