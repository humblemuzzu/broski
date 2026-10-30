/**
 * The tree ops (contract README §13): `read_tree` reads the file, so any session answers; `label_entry` appends a
 * `label` entry through Pi's session manager, as the terminal's `/tree` does, under the session lock like
 * `navigate_tree`; `abort_branch_summary` skips the lock on purpose, because the call it cancels holds it.
 */

import type { AbortBranchSummaryOp, BackendCallResult, LabelEntryOp, ReadTreeOp } from "../../../contract";
import { errorText } from "../error-text";
import type { HostAccess, HostedPeek, SessionStore } from "../ports";
import { rejected } from "../rejections";

export interface SessionTreeDeps {
	readonly store: Pick<SessionStore, "tree" | "locate">;
	readonly hosts: HostAccess & HostedPeek;
}

const LABELLED: BackendCallResult = { status: "accepted", result: { kind: "label_entry" } };
const ABORTED: BackendCallResult = { status: "accepted", result: { kind: "abort_branch_summary" } };

export async function readTreeOp(deps: SessionTreeDeps, op: ReadTreeOp): Promise<BackendCallResult> {
	const tree = await deps.store.tree(op.sessionId, op.page);
	return "rejection" in tree ? tree : { status: "accepted", result: tree };
}

export function labelEntryOp(deps: SessionTreeDeps, op: LabelEntryOp): Promise<BackendCallResult> {
	const label = op.label?.trim() || undefined;
	return deps.hosts.withIdleSession(op.sessionId, async (session): Promise<BackendCallResult> => {
		const manager = session.sessionManager;
		if (manager.getEntry(op.entryId) === undefined)
			return rejected("not_found", `no entry ${op.entryId} in the session`);
		try {
			manager.appendLabelChange(op.entryId, label);
			return LABELLED;
		} catch (error) {
			return rejected("backend_error", `the label was not saved: ${errorText(error)}`);
		}
	});
}

export async function abortBranchSummaryOp(
	deps: SessionTreeDeps,
	op: AbortBranchSummaryOp,
): Promise<BackendCallResult> {
	const hosted = deps.hosts.session(op.sessionId);
	if (hosted) {
		hosted.abortBranchSummary();
		return ABORTED;
	}
	const stored = await deps.store.locate(op.sessionId);
	return "status" in stored ? stored : ABORTED;
}
