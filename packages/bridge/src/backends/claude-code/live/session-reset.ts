/** `/clear` and its kin: the conversation goes on under a new session id, and the old one keeps its history. */

import type { SessionId } from "../../../contract";
import { isUuid } from "../ids";
import type { SessionEmitter } from "../ports/live";
import type { Ownership } from "../ports/store";
import type { ChildRouter } from "./child-router";
import type { MappedRouting } from "./mapped-routing";
import type { RunTracker } from "./run-tracker";

export interface ResetDeps {
	readonly routing: MappedRouting;
	readonly children: ChildRouter;
	readonly runs: RunTracker;
	readonly ownership: Ownership;
	readonly live: SessionEmitter;
}

/** Starts the new conversation's state; false when the id is not one this bridge can use (the session stays as it was). */
export function startNewConversation(deps: ResetDeps, next: SessionId): boolean {
	if (!isUuid(next)) {
		deps.live.emit({
			type: "notice",
			level: "error",
			text: "Claude Code began a conversation under an id this bridge cannot use",
		});
		return false;
	}
	deps.routing.restart(next);
	deps.children.reset();
	deps.runs.resetChain();
	deps.ownership.claim(next).catch(() => undefined);
	return true;
}
