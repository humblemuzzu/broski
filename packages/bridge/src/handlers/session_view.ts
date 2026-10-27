import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { registerAll } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import type { AgentType, ConnectionType, ServerMessage } from "../types";
import * as piDurable from "./pi_durable";
import { getPendingExtensionUiRequests, stopPiExternalTail, syncPiExternalTail } from "./pi_features";
import {
	countPiWatchers,
	prunePiWatchers,
	registerPiWatcher,
	replayPendingExtensionUiRequests,
	unregisterPiWatcher,
} from "./pi_stream_delivery";

type ReplyFn = (msg: ServerMessage) => void;

export type SessionViewHandlerContext = {
	contexts: Map<
		ServerWebSocket<unknown>,
		{
			lastPongAt: number;
			lastRttMs: number;
			connectionType: ConnectionType;
			connectedAt: number;
			projectPath?: string;
			sessionId?: string;
			viewAgent?: AgentType;
			[key: string]: unknown;
		}
	>;
	sockets: Set<ServerWebSocket<unknown>>;
	send: (ws: ServerWebSocket<unknown>, msg: ServerMessage) => void;
	sendStatus: (ws: ServerWebSocket<unknown>) => Promise<void>;
	logInfo: (msg: string) => void;
	logDebug: (msg: string) => void;
	DEBUG_RTS: boolean;
	currentAgent: AgentType;
	ensureClaudeWatchDir: (
		path: string,
		kind: "skills" | "plugins" | "hooks" | "commands" | "mcp",
		cwd?: string,
		recursive?: boolean,
	) => void;
	makeSessionKey: (agent: AgentType | undefined, sessionId: string | undefined) => string | null;
	updateSessionWatchers: (ws: ServerWebSocket<unknown>, prevKey: string | null, nextKey: string | null) => void;
	sessionWatchers: Map<string, Set<ServerWebSocket<unknown>>>;
	// Claude Code
	claudeCode: {
		listActiveSessions: () => { sessionId: string; cwd: string; startedAt: number | undefined }[];
	};
	ccSessionOwners: Map<string, ServerWebSocket<unknown>>;
	ccSessionCwds: Map<string, string>;
	buildClaudeCodeRuntimeState: (params: {
		sessionId: string;
		cwd?: string;
		isStreaming: boolean;
	}) => Record<string, unknown>;
	// Codex
	cxActiveTurns: Map<string, string>;
	cxThreadOwners: Map<string, ServerWebSocket<unknown>>;
	cxThreadCwds: Map<string, string>;
	buildCodexRuntimeState: (params: { threadId: string; cwd?: string; isStreaming: boolean }) => Record<string, unknown>;
	// OpenCode
	ocSessionOwners: Map<string, ServerWebSocket<unknown>>;
	ocSessionProjectPaths: Map<string, string>;
	// Pi
	broadcast: (msg: ServerMessage) => void;
	findPiActiveRuntimeStateMessage: (sessionId: string) => ServerMessage | null;
	replayRuntimeEventsSince: (params: {
		ws: ServerWebSocket<unknown>;
		backend: AgentType;
		sessionId?: string;
		cwd?: string;
		lastSeq?: number;
	}) => number;
};

const SESSION_VIEW_OPS = ["set_view"] as const;

export const MODULE_TYPES = SESSION_VIEW_OPS;

export function register(router: MessageRouter, deps: ServerDeps): void {
	registerAll(router, SESSION_VIEW_OPS, async (message, c) => {
		// Pi Durable's attach/detach runs first and returns false so the shared
		// session-view bookkeeping below still executes (matches the old chain).
		await piDurable.handle(deps.piDurableSockets.for(c.ws), message, c.reply);
		await handle(c.ws, message, c.reply, {
			contexts: deps.contexts,
			sockets: deps.sockets,
			send: deps.send,
			sendStatus: deps.sendStatus,
			logInfo: deps.logInfo,
			logDebug: deps.logDebug,
			DEBUG_RTS: deps.DEBUG_RTS,
			currentAgent: deps.currentAgent,
			ensureClaudeWatchDir: deps.ensureClaudeWatchDir,
			makeSessionKey: deps.makeSessionKey,
			updateSessionWatchers: deps.updateSessionWatchers,
			sessionWatchers: deps.sessionWatchers,
			claudeCode: deps.claudeCode,
			ccSessionOwners: deps.ccSessionOwners,
			ccSessionCwds: deps.ccSessionCwds,
			buildClaudeCodeRuntimeState: deps.buildClaudeCodeRuntimeState,
			cxActiveTurns: deps.cxActiveTurns,
			cxThreadOwners: deps.cxThreadOwners,
			cxThreadCwds: deps.cxThreadCwds,
			buildCodexRuntimeState: deps.buildCodexRuntimeState,
			ocSessionOwners: deps.ocSessionOwners,
			ocSessionProjectPaths: deps.ocSessionProjectPaths,
			broadcast: deps.broadcast,
			findPiActiveRuntimeStateMessage: deps.findPiActiveRuntimeStateMessage,
			replayRuntimeEventsSince: deps.replayRuntimeEventsSince,
		});
	});
}

export async function handle(
	ws: ServerWebSocket<unknown>,
	message: Record<string, unknown>,
	_reply: ReplyFn,
	ctx: SessionViewHandlerContext,
): Promise<boolean> {
	if ((message.type as string) !== "set_view") return false;

	const existing = ctx.contexts.get(ws) ?? {
		lastPongAt: Date.now(),
		lastRttMs: 0,
		connectionType: "unknown" as const,
		connectedAt: Date.now(),
	};
	const prevKey = ctx.makeSessionKey(existing.viewAgent as AgentType | undefined, existing.sessionId);
	const prevPiSessionId = existing.viewAgent === "pi" ? existing.sessionId : undefined;
	const nextAgent =
		(message.agent as AgentType | undefined) ??
		existing.viewAgent ??
		(message.projectPath || message.sessionId ? ctx.currentAgent : undefined);
	const nextSessionId = (message.sessionId as string) || undefined;
	const lastRuntimeSeq = typeof message.lastRuntimeSeq === "number" ? message.lastRuntimeSeq : undefined;

	if (ctx.DEBUG_RTS) {
		ctx.logDebug(
			`[RTS] set_view: agent=${nextAgent}, sessionId=${nextSessionId}, projectPath=${message.projectPath}, prevKey=${prevKey}`,
		);
	}

	if (nextAgent === "claude-code") {
		const cwd = message.projectPath && message.projectPath !== "global" ? (message.projectPath as string) : undefined;
		if (cwd) {
			ctx.ensureClaudeWatchDir(join(cwd, ".claude", "skills"), "skills", cwd);
			ctx.ensureClaudeWatchDir(join(cwd, ".claude", "plugins"), "plugins", cwd);
			ctx.ensureClaudeWatchDir(join(cwd, ".claude", "commands"), "commands", cwd);
			ctx.ensureClaudeWatchDir(join(cwd, ".claude", "hooks"), "hooks", cwd);
			ctx.ensureClaudeWatchDir(join(cwd, ".mcp.json"), "mcp", cwd, false);
		}
	}

	ctx.contexts.set(ws, {
		...existing,
		projectPath: (message.projectPath as string) || undefined,
		sessionId: nextSessionId,
		viewAgent: nextAgent,
	});

	unregisterPiWatcher(ws);
	if (prevPiSessionId && prevPiSessionId !== nextSessionId && countPiWatchers(prevPiSessionId) === 0) {
		stopPiExternalTail(prevPiSessionId);
	}
	for (const orphanedSessionId of prunePiWatchers((sock) => ctx.sockets.has(sock))) {
		stopPiExternalTail(orphanedSessionId);
	}
	if (nextAgent === "pi" && nextSessionId) {
		registerPiWatcher(ws, nextSessionId);
		// Start external tail for Pi sessions running in terminal (not bridge-owned).
		// If the session IS bridge-owned, syncPiExternalTail is a no-op.
		void syncPiExternalTail(nextSessionId, ctx.broadcast, ctx.DEBUG_RTS, ctx.logDebug);
	}

	// Track project path for OpenCode external tails
	if (nextAgent === "opencode" && nextSessionId && message.projectPath) {
		ctx.ocSessionProjectPaths.set(nextSessionId, message.projectPath as string);
		if (ctx.DEBUG_RTS) {
			ctx.logDebug(`[RTS] set_view: Stored projectPath for OpenCode session ${nextSessionId}: ${message.projectPath}`);
		}
	}

	// Helper: consider a socket "stale" if it's gone from the sockets set OR
	// if its last pong is older than 30s (likely dead but TCP hasn't caught up).
	const isSocketStale = (sock: ServerWebSocket<unknown>): boolean => {
		if (!ctx.sockets.has(sock)) return true;
		const sockCtx = ctx.contexts.get(sock);
		if (!sockCtx) return true;
		return Date.now() - sockCtx.lastPongAt > 30_000;
	};

	// Re-bind ownership for active BRIDGE-OWNED sessions on reconnect.
	// IMPORTANT: Only re-bind if there was a previous owner (meaning the bridge
	// started this session via cc_chat/oc_chat/cx_chat). If there's no previous
	// owner, the session is running externally in the terminal, and the external
	// tail should handle streaming — setting ownership here would prevent it.
	if (nextAgent === "claude-code" && nextSessionId) {
		const ccActiveList = ctx.claudeCode.listActiveSessions();
		const activeSession = ccActiveList.find((s) => s.sessionId === nextSessionId);
		const isActive = activeSession != null;
		const prevOwner = ctx.ccSessionOwners.get(nextSessionId);
		const hadBridgeOwner = prevOwner != null;

		if (isActive && hadBridgeOwner) {
			// Bridge started this session — re-bind ownership on reconnect
			if (prevOwner !== ws && isSocketStale(prevOwner)) {
				ctx.ccSessionOwners.set(nextSessionId, ws);
				ctx.logInfo(`[RTS] set_view: Re-bound CC session ${nextSessionId} owner (stale socket)`);
			}
			ctx.send(ws, {
				type: "runtime_state",
				backend: "claude-code",
				data: ctx.buildClaudeCodeRuntimeState({
					sessionId: nextSessionId,
					cwd: activeSession?.cwd ?? ctx.ccSessionCwds.get(nextSessionId) ?? (message.projectPath as string),
					isStreaming: true,
				}),
			} as ServerMessage);
		} else if (isActive && !hadBridgeOwner) {
			// Session is active but NOT bridge-owned — running in Mac terminal.
			// Don't claim ownership; let external tail handle streaming.
			if (ctx.DEBUG_RTS) {
				ctx.logDebug(
					`[RTS] set_view: CC session ${nextSessionId} active but not bridge-owned, external tail will stream`,
				);
			}
		}
	}
	if (nextAgent === "codex" && nextSessionId) {
		const isActive = ctx.cxActiveTurns.has(nextSessionId);
		const prevOwner = ctx.cxThreadOwners.get(nextSessionId);
		const hadBridgeOwner = prevOwner != null;

		if (isActive && hadBridgeOwner) {
			// Bridge started this session — re-bind on reconnect
			if (prevOwner !== ws && isSocketStale(prevOwner)) {
				ctx.cxThreadOwners.set(nextSessionId, ws);
				ctx.logInfo(`[RTS] set_view: Re-bound CX thread ${nextSessionId} owner (stale socket)`);
			}
			ctx.send(ws, {
				type: "runtime_state",
				backend: "codex",
				data: ctx.buildCodexRuntimeState({
					threadId: nextSessionId,
					cwd: ctx.cxThreadCwds.get(nextSessionId),
					isStreaming: true,
				}),
			} as ServerMessage);
		} else if (isActive && !hadBridgeOwner) {
			if (ctx.DEBUG_RTS) {
				ctx.logDebug(
					`[RTS] set_view: CX thread ${nextSessionId} active but not bridge-owned, external tail will stream`,
				);
			}
		}
	}
	if (nextAgent === "opencode" && nextSessionId) {
		// NEVER set ownership on view. Ownership is set ONLY when the bridge
		// actively sends a prompt via oc_chat. Setting ownership here blocks
		// the external tail from starting (syncExternalTailForKey checks !owner).
		if (ctx.DEBUG_RTS) {
			const prevOwner = ctx.ocSessionOwners.get(nextSessionId);
			ctx.logDebug(
				`[RTS] set_view: OC session ${nextSessionId}, owner=${prevOwner ? "bridge" : "none (external tail)"}`,
			);
		}
	}
	if (nextAgent === "pi" && nextSessionId) {
		const runtimeStateMessage = ctx.findPiActiveRuntimeStateMessage(nextSessionId);
		if (runtimeStateMessage) {
			ctx.send(ws, runtimeStateMessage);
		}
		// Replay pending extension UI requests (select/confirm/input dialogs)
		const projectPath = (message.projectPath as string) || undefined;
		if (projectPath) {
			const pendingUi = getPendingExtensionUiRequests(projectPath);
			const replayedUi = replayPendingExtensionUiRequests(ws, nextSessionId, pendingUi, projectPath, ctx.send);
			if (replayedUi > 0) {
				ctx.logInfo(`[RTS] Replayed ${replayedUi} pending Pi extension UI requests for ${nextSessionId}`);
			}
		}
	}

	if (nextAgent && (nextSessionId || message.projectPath) && lastRuntimeSeq != null) {
		const replayed = ctx.replayRuntimeEventsSince({
			ws,
			backend: nextAgent,
			sessionId: nextSessionId,
			cwd: (message.projectPath as string | undefined) ?? existing.projectPath,
			lastSeq: lastRuntimeSeq,
		});
		if (replayed > 0) {
			ctx.logInfo(
				`[RTS] Replayed ${replayed} runtime events since seq=${lastRuntimeSeq} for ${nextAgent}:${nextSessionId ?? message.projectPath}`,
			);
		}
	}

	const nextKey = ctx.makeSessionKey(nextAgent, nextSessionId);
	if (prevKey !== nextKey) ctx.updateSessionWatchers(ws, prevKey, nextKey);

	if (ctx.DEBUG_RTS) {
		const watchers = ctx.sessionWatchers.get(nextKey ?? "");
		ctx.logDebug(`[RTS] set_view: nextKey=${nextKey}, watchers=${watchers?.size ?? 0}`);
	}

	void ctx.sendStatus(ws);
	return true;
}
