/** Lane A · the `SessionStore` (`ports/store.ts`) `backend.ts` builds; every read goes through the SDK (D15). */

import type { SessionId } from "../../../contract";
import { parseChildRef } from "../ids";
import type { StoreDeps } from "../ports/deps";
import type { LiveOverlay, SessionStore } from "../ports/store";
import { isRejected } from "../rejections";
import { readImage } from "./attachments";
import { entryOf, lastChainUuid } from "./chain-lookup";
import { locateChild } from "./children";
import { createStoreContext, type StoreContext } from "./context";
import { announceSession, getSession } from "./get";
import { locateSession } from "./info";
import { listPage } from "./list";
import { forkStored, removeStored, renameStored } from "./mutations";
import { transcriptPage } from "./transcript-page";

export function createSessionStore(deps: StoreDeps): SessionStore {
	const ctx = createStoreContext(deps);
	const remember = (live: LiveOverlay): LiveOverlay => {
		ctx.live = live;
		return live;
	};
	return {
		list: (query, page, live) => listPage(ctx, query, page, remember(live)),
		get: (sessionId, live) => getSession(ctx, sessionId, remember(live)),
		transcript: (sessionId, page, live) => transcriptPage(ctx, sessionId, page, remember(live)),
		attachment: (sessionId, attachment) => readImage(ctx, sessionId, attachment),
		locate: (sessionId) => locate(ctx, sessionId),
		lastChainUuid: (sessionId) => lastChainUuid(ctx, sessionId),
		entryOf: (sessionId, itemId) => entryOf(ctx, sessionId, itemId),
		rename: (sessionId, title) => renameStored(ctx, sessionId, title),
		fork: (sessionId, at, live) => forkStored(ctx, sessionId, at, remember(live)),
		remove: (sessionId) => removeStored(ctx, sessionId),
		announce: (sessionId, live) => announceSession(ctx, sessionId, remember(live)),
		invalidate: (sessionId) => invalidate(ctx, sessionId),
		dispose: () => ctx.index.clear(),
	};
}

async function locate(ctx: StoreContext, sessionId: SessionId): ReturnType<SessionStore["locate"]> {
	const child = parseChildRef(sessionId);
	if (child === undefined) return locateSession(ctx, sessionId);
	const located = await locateChild(ctx, child);
	if (isRejected(located)) return located;
	const { parent, file } = located;
	return {
		sessionId,
		cwd: parent.cwd,
		path: file.path,
		origin: parent.origin,
		lastModified: file.mtimeMs,
	};
}

function invalidate(ctx: StoreContext, sessionId: SessionId): void {
	const parent = parseChildRef(sessionId)?.parentId ?? sessionId;
	ctx.index.drop(parent);
	ctx.locator.forget(parent);
}
