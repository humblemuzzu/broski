/** Lane A · rename (`renameSession`) and fork (`forkSession`, D19) of a session nobody hosts. */

import type { ActionResult, ForkPoint, NewSessionResult, SessionId } from "../../../contract";
import type { StoreDeps } from "../ports/deps";
import type { LiveOverlay } from "../ports/store";
import { notBuilt } from "../rejections";

export async function renameStored(_deps: StoreDeps, _sessionId: SessionId, _title: string): Promise<ActionResult> {
	return notBuilt("lane A: renameStored");
}

export async function forkStored(
	_deps: StoreDeps,
	_sessionId: SessionId,
	_at: ForkPoint | undefined,
	_live: LiveOverlay,
): Promise<NewSessionResult> {
	return notBuilt("lane A: forkStored");
}
