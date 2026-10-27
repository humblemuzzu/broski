import type { ServerWebSocket } from "bun";
import type { ConnectionContext, ServerDeps } from "../routing/types";
import { stopPiExternalTail, syncPiExternalTail } from "./pi_external_tail_sync";
import type { Broadcast } from "./pi_message_helpers";
import { countPiWatchers, prunePiWatchers, registerPiWatcher, unregisterPiWatcher } from "./pi_stream_delivery";

export type PiViewEnv = {
	sockets: Set<ServerWebSocket<unknown>>;
	broadcast: Broadcast;
	debugRts: boolean;
	logDebug: (msg: string) => void;
};

/**
 * Moves a socket's Pi watch from the session it was viewing to the one it views now, and runs the
 * session-file tail for whichever Pi sessions still have a watcher. `next` is undefined when the socket
 * stopped viewing Pi.
 */
export function bindPiWatcher(
	ws: ServerWebSocket<unknown>,
	previous: string | undefined,
	next: string | undefined,
	env: PiViewEnv,
): void {
	unregisterPiWatcher(ws);
	if (previous && previous !== next && countPiWatchers(previous) === 0) stopPiExternalTail(previous);
	for (const orphaned of prunePiWatchers((socket) => env.sockets.has(socket))) stopPiExternalTail(orphaned);
	if (!next) return;
	registerPiWatcher(ws, next);
	void syncPiExternalTail(next, env.broadcast, env.debugRts, env.logDebug);
}

export function piSessionViewedBy(
	context: Pick<ConnectionContext, "viewAgent" | "sessionId"> | undefined,
): string | undefined {
	return context?.viewAgent === "pi" ? context.sessionId : undefined;
}

type ViewClaimDeps = Pick<ServerDeps, "contexts" | "sockets" | "broadcast" | "DEBUG_RTS" | "logDebug"> &
	Pick<ServerDeps, "makeSessionKey" | "updateSessionWatchers">;

/**
 * The socket that prompts or creates a Pi session is looking at it, whether or not the app sent a
 * `set_view` yet — a draft chat does not know its session id until the bridge has made it. Without this the
 * session's deltas, tool output and answer go to no one: they are only delivered to the sockets viewing it.
 */
export function claimPiView(
	deps: ViewClaimDeps,
	ws: ServerWebSocket<unknown>,
	sessionId: string,
	projectPath: string,
): void {
	const existing = deps.contexts.get(ws);
	if (!existing || piSessionViewedBy(existing) === sessionId) return;
	const previousKey = deps.makeSessionKey(existing.viewAgent, existing.sessionId);
	deps.contexts.set(ws, { ...existing, viewAgent: "pi", sessionId, projectPath });
	bindPiWatcher(ws, piSessionViewedBy(existing), sessionId, {
		sockets: deps.sockets,
		broadcast: deps.broadcast,
		debugRts: deps.DEBUG_RTS,
		logDebug: deps.logDebug,
	});
	const nextKey = deps.makeSessionKey("pi", sessionId);
	if (previousKey !== nextKey) deps.updateSessionWatchers(ws, previousKey, nextKey);
}
