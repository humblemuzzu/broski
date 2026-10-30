/** `changed_files`: the files a session's tool calls changed, from the file the transcript is read from. */

import type { BackendCallResult, ChangedFilesOp } from "../../../contract";
import type { LiveOverlay, SessionStore } from "../ports";

export interface ChangedFilesDeps {
	readonly store: Pick<SessionStore, "changedFiles">;
	readonly live: LiveOverlay;
}

export async function changedFiles(deps: ChangedFilesDeps, op: ChangedFilesOp): Promise<BackendCallResult> {
	const read = await deps.store.changedFiles(op.sessionId, deps.live);
	return "rejection" in read ? read : { status: "accepted", result: read };
}
