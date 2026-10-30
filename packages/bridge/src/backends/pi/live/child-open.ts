/**
 * Opening a child session (a tool call's sub-run, `mapping/sub-runs.ts`): the live view when the parent is hosted here
 * and has followed the call, else a quiet one over what the parent's file holds. A child is never controllable, and has
 * nothing to change: the person watches it.
 */

import { emptySnapshot, type OpenResult, type SessionRef, type SessionSink } from "../../../contract";
import type { ChildSessionPart } from "../ids";
import type { SessionStore } from "../ports";
import type { SessionHosts } from "./session-hosts";

export interface ChildOpenDeps {
	readonly hosts: Pick<SessionHosts, "openChild">;
	readonly store: Pick<SessionStore, "get">;
}

export async function openChildSession(
	deps: ChildOpenDeps,
	ref: SessionRef,
	part: ChildSessionPart,
	sink: SessionSink,
): Promise<OpenResult> {
	const live = deps.hosts.openChild(part, sink);
	if (live !== undefined) return live;
	const found = await deps.store.get(ref.sessionId, { row: () => undefined });
	if (found.status === "rejected") return found;
	return {
		status: "accepted",
		snapshot: emptySnapshot(),
		session: { session: ref, snapshot: emptySnapshot, close: async () => undefined },
	};
}
