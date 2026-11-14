/** The `ChainSource` of a session and of a subagent child (D20): which SDK reader and which file. */

import type { Rejected, SessionId } from "../../../contract";
import { parseChildRef } from "../ids";
import type { StoredSession } from "../ports/store";
import { isRejected } from "../rejections";
import type { ChainSource } from "./chain-reader";
import { locateChild } from "./children";
import type { StoreContext } from "./context";
import { locateSession } from "./info";

export interface OpenedSource {
	readonly source: ChainSource;
	/** The session whose files hold the chain; for a child, its parent. */
	readonly owner: StoredSession;
	readonly isChild: boolean;
}

export async function sourceOf(ctx: StoreContext, sessionId: SessionId): Promise<OpenedSource | Rejected> {
	const { sdk } = ctx.deps.services;
	const child = parseChildRef(sessionId);
	if (child !== undefined) {
		const location = await locateChild(ctx, child);
		if (isRejected(location)) return location;
		const source: ChainSource = {
			key: sessionId,
			path: location.file.path,
			read: (offset, limit) =>
				sdk.getSubagentMessages(child.parentId, child.agentId, {
					offset,
					...(limit !== undefined && { limit }),
				}),
		};
		return { source, owner: location.parent, isChild: true };
	}
	const stored = await locateSession(ctx, sessionId);
	if (isRejected(stored)) return stored;
	const source: ChainSource = {
		key: sessionId,
		path: stored.path,
		read: (offset, limit) =>
			sdk.getSessionMessages(sessionId, {
				offset,
				includeSystemMessages: true,
				...(limit !== undefined && { limit }),
			}),
	};
	return { source, owner: stored, isChild: false };
}
