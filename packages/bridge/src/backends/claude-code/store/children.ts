/** Lane A · subagent child sessions (D20): `listSubagents` + the `.meta.json` sidecar, `getSubagentMessages`. */

import type { PageRequest, SessionId, SessionsListResult } from "../../../contract";
import type { StoreDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function childrenPage(
	_deps: StoreDeps,
	_parentId: SessionId,
	_page: PageRequest,
): Promise<SessionsListResult> {
	return notBuilt("lane A: childrenPage");
}
