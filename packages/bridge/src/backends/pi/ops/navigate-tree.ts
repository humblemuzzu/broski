/**
 * `backend.call` `navigate_tree` (contract README §13): moves the session's leaf to an item of its
 * transcript, summarising the branch left when asked; without a summary a `label` entry makes the
 * move survive a reopen, for us and for a terminal `pi` (D8). Followed by `transcript_invalidated`.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { BackendCallResult, NavigateTreeOp } from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import { errorText } from "../error-text";
import type { HostAccess, LiveOverlay, SessionStore } from "../ports";
import { rejected } from "../rejections";

export interface NavigateDeps {
	readonly hosts: HostAccess;
	readonly store: Pick<SessionStore, "entryOf">;
	readonly live: LiveOverlay;
	readonly catalog: CatalogFeed;
}

const NAVIGATED: BackendCallResult = { status: "accepted", result: { kind: "navigate_tree" } };

export async function navigateTree(deps: NavigateDeps, op: NavigateTreeOp): Promise<BackendCallResult> {
	const entryId = await deps.store.entryOf(op.sessionId, op.itemId, deps.live);
	if (entryId === undefined) return rejected("not_found", `no item ${op.itemId} on the session's branch`);
	if (typeof entryId !== "string") return entryId;
	const result = await deps.hosts.withIdleSession(op.sessionId, (session) => moveLeaf(session, entryId, op.summarize));
	if (result.status === "accepted") {
		deps.catalog.emit({ type: "transcript_invalidated", session: { backend: "pi", sessionId: op.sessionId } });
	}
	return result;
}

async function moveLeaf(session: AgentSession, entryId: string, summarize: boolean): Promise<BackendCallResult> {
	const manager = session.sessionManager;
	if (session.isStreaming || session.isCompacting) return rejected("busy", "the session is busy");
	if (manager.getEntry(entryId) === undefined) return rejected("not_found", `no entry ${entryId} in the session`);
	const leafBefore = manager.getLeafId();
	try {
		const moved = await session.navigateTree(entryId, { summarize });
		if (moved.cancelled) {
			return rejected(
				"backend_error",
				moved.aborted ? "summarizing the branch was cancelled" : "an extension cancelled the move",
			);
		}
		if (moved.summaryEntry === undefined && manager.getLeafId() !== leafBefore) {
			manager.appendLabelChange(entryId, manager.getLabel(entryId));
		}
		return NAVIGATED;
	} catch (error) {
		return rejected("backend_error", await failureText(session, leafBefore, error));
	}
}

/**
 * Pi moves its leaf in memory before it writes (`_appendEntry`), so a write that fails leaves the session
 * on a branch the file does not hold; moving back through Pi restores the leaf and the model's context.
 */
async function failureText(session: AgentSession, leafBefore: string | null, error: unknown): Promise<string> {
	const reason = errorText(error);
	const manager = session.sessionManager;
	if (manager.getLeafId() === leafBefore) return reason;
	if (leafBefore !== null) await session.navigateTree(leafBefore, { summarize: false }).catch(() => undefined);
	return manager.getLeafId() === leafBefore
		? `${reason} (the session stays where it was)`
		: `the leaf moved in memory but could not be saved: ${reason}`;
}
