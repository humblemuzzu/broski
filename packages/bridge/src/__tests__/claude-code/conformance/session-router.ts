/**
 * Per-session scripts for the scripted Anthropic endpoint: the CLI names its session in every `/v1/messages`
 * request (`X-Claude-Code-Session-Id`, a string of the 2.1.316 binary), so each conformance session gets its own turns,
 * its own holds, and its own record of what reached the model. Side requests (subagent, compact, title) keep the
 * server's own routing, except a compaction a test holds.
 */

import type { ScriptedRequest, ScriptedRoute, ScriptedTurn } from "../../helpers/scripted-anthropic-server";
import { sideKind } from "../../helpers/scripted-anthropic-side";

export const SESSION_HEADER = "x-claude-code-session-id";

/** A turn, or one built from the request it answers (an echo of its model, a path its reminder names). */
export type ScriptStep = ScriptedTurn | ((request: ScriptedRequest) => ScriptedTurn);

const DEFAULT_TURN: ScriptedTurn = { text: ["Done."] };

export function sessionOf(request: ScriptedRequest): string | undefined {
	return request.headers[SESSION_HEADER];
}

export class SessionRouter {
	private readonly scripts = new Map<string, ScriptStep[]>();
	private readonly gates = new Map<string, { promise: Promise<void>; open: () => void }>();
	private readonly seen = new Map<string, ScriptedRequest[]>();

	/** Appends to the session's script; a session with none left is answered `Done.`. */
	script(sessionId: string, steps: readonly ScriptStep[]): void {
		this.scripts.set(sessionId, [...(this.scripts.get(sessionId) ?? []), ...steps]);
	}

	/**
	 * The session's next run is `steps`: what an earlier run left unconsumed goes (a Stop that reached the CLI before its
	 * message did leaves its whole scenario unread, D74).
	 */
	replace(sessionId: string, steps: readonly ScriptStep[]): void {
		this.scripts.set(sessionId, [...steps]);
	}

	/** Settles at the session's next `release`. */
	gate(sessionId: string): Promise<void> {
		const known = this.gates.get(sessionId);
		if (known) return known.promise;
		let open = () => {};
		const promise = new Promise<void>((resolve) => {
			open = resolve;
		});
		this.gates.set(sessionId, { promise, open });
		return promise;
	}

	release(sessionId: string): void {
		this.gates.get(sessionId)?.open();
		this.gates.delete(sessionId);
	}

	/** The session's main-thread requests, oldest first. */
	requests(sessionId: string): readonly ScriptedRequest[] {
		return this.seen.get(sessionId) ?? [];
	}

	routes(): ScriptedRoute[] {
		return [
			{ name: "session", when: (request) => sideKind(request.body) === null, turns: (request) => this.next(request) },
		];
	}

	private next(request: ScriptedRequest): ScriptedTurn {
		const sessionId = sessionOf(request);
		if (sessionId === undefined) return DEFAULT_TURN;
		this.seen.set(sessionId, [...this.requests(sessionId), request]);
		const step = this.scripts.get(sessionId)?.shift();
		if (step === undefined) return DEFAULT_TURN;
		return typeof step === "function" ? step(request) : step;
	}
}
