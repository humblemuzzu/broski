/**
 * The real Pi backend behind the contract, with every session it opens remembered by id, so the conformance driver
 * can reach a session the rule opened (to set its permissions mode before a scenario) through the same control the
 * rule holds: the contract's own surface, nothing of the adapter's insides. Held weakly, so a session a test let go
 * is still collected.
 */

import type { AgentBackend, SessionControl, SessionId } from "../../../contract";

export interface ObservedBackend {
	readonly backend: AgentBackend;
	/** The control of the latest view opened on `sessionId`, while the world lives. */
	controlOf(sessionId: SessionId): SessionControl | undefined;
}

export function observeOpens(backend: AgentBackend): ObservedBackend {
	const controls = new Map<SessionId, WeakRef<SessionControl>>();
	return {
		backend: {
			...backend,
			open: async (target, sink) => {
				const opened = await backend.open(target, sink);
				if (opened.status === "accepted" && opened.session.control) {
					controls.set(opened.session.session.sessionId, new WeakRef(opened.session.control));
				}
				return opened;
			},
		},
		controlOf: (sessionId) => controls.get(sessionId)?.deref(),
	};
}
