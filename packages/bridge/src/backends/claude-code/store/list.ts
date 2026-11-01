/** Lane A · a page of sessions (D15, D16, D17): `listSessions` rows, newest first, `(lastModified, sessionId)` keyset. */

import type { PageRequest, SessionQuery, SessionsListResult } from "../../../contract";
import type { StoreDeps } from "../ports/deps";
import type { LiveOverlay } from "../ports/store";
import { notBuilt } from "../rejections";

export async function listPage(
	_deps: StoreDeps,
	_query: SessionQuery,
	_page: PageRequest,
	_live: LiveOverlay,
): Promise<SessionsListResult> {
	return notBuilt("lane A: listPage");
}
