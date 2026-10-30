import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * How far back from the leaf the entry of a message that just ended may lie: Pi persists it right after its
 * listeners return (pi-coding-agent `src/core/agent-session.ts:1144-1166`), but a continuation queued before it in the
 * same task may append first, such as `setModel`'s `model_change` (`:2541-2549`) or the gate's `broski.permissions`.
 */
const LOOK_BACK = 8;

/** The id of the entry that holds `message`, found from the leaf up its parents; throws when it is not there. */
export function persistedEntryId(manager: SessionManager, message: AgentMessage): string {
	let id = manager.getLeafId();
	for (let step = 0; id !== null && step < LOOK_BACK; step += 1) {
		const entry = manager.getEntry(id);
		if (entry === undefined) break;
		if (entry.type === "message" && entry.message === message) return entry.id;
		id = entry.parentId;
	}
	throw new Error("the message that just ended is not among the session's newest entries");
}
