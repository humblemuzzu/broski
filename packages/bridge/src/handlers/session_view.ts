import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import type { AgentType, ServerMessage } from "../types";
import { registerPiWatcher, replayPiRuntimeEvents, unregisterPiWatcher } from "./pi_stream_delivery";
import { syncPiExternalTail, stopPiExternalTail } from "./pi_features";

type ReplyFn = (msg: ServerMessage) => void;

export type SessionViewHandlerContext = {
	contexts: Map<
		ServerWebSocket<unknown>,
		{
			lastPongAt: number;
			lastRttMs: number;
			connectionType: "local" | "tailscale" | "unknown";
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
	replayBufferedEvents: (ws: ServerWebSocket<unknown>, agent: "claude-code" | "codex", sessionId: string) => void;
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

	// Re-bind ownership for active sessions on reconnect
	if (nextAgent === "claude-code" && nextSessionId) {
		const ccActiveList = ctx.claudeCode.listActiveSessions();
		const activeSession = ccActiveList.find((s) => s.sessionId === nextSessionId);
		const isActive = activeSession != null;
		if (isActive) {
			const prevOwner = ctx.ccSessionOwners.get(nextSessionId);
			if (!prevOwner || !ctx.sockets.has(prevOwner)) {
				ctx.ccSessionOwners.set(nextSessionId, ws);
				ctx.logInfo(
					`[RTS] set_view: Re-bound CC session ${nextSessionId} owner (was ${prevOwner ? "stale" : "absent"})`,
				);
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
			ctx.replayBufferedEvents(ws, "claude-code", nextSessionId);
		}
	}
	if (nextAgent === "codex" && nextSessionId) {
		const isActive = ctx.cxActiveTurns.has(nextSessionId);
		if (isActive) {
			const prevOwner = ctx.cxThreadOwners.get(nextSessionId);
			if (!prevOwner || !ctx.sockets.has(prevOwner)) {
				ctx.cxThreadOwners.set(nextSessionId, ws);
				ctx.logInfo(
					`[RTS] set_view: Re-bound CX thread ${nextSessionId} owner (was ${prevOwner ? "stale" : "absent"})`,
				);
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
			ctx.replayBufferedEvents(ws, "codex", nextSessionId);
		}
	}
	if (nextAgent === "opencode" && nextSessionId) {
		const prevOwner = ctx.ocSessionOwners.get(nextSessionId);
		if (!prevOwner || !ctx.sockets.has(prevOwner)) {
			ctx.ocSessionOwners.set(nextSessionId, ws);
			if (ctx.DEBUG_RTS) {
				ctx.logDebug(`[RTS] set_view: Re-bound OC session ${nextSessionId} owner`);
			}
		}
	}
	let replayedPiBufferedEvents = 0;
	if (nextAgent === "pi" && nextSessionId) {
		const runtimeStateMessage = ctx.findPiActiveRuntimeStateMessage(nextSessionId);
		if (runtimeStateMessage) {
			ctx.send(ws, runtimeStateMessage);
		}
		replayedPiBufferedEvents = replayPiRuntimeEvents(ws, nextSessionId);
		if (replayedPiBufferedEvents > 0) {
			ctx.logInfo(`[RTS] Replayed ${replayedPiBufferedEvents} buffered Pi events for ${nextSessionId}`);
		}
	}

	if (
		nextAgent &&
		(nextSessionId || message.projectPath) &&
		lastRuntimeSeq != null &&
		!(nextAgent === "pi" && replayedPiBufferedEvents > 0)
	) {
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
	ctx.updateSessionWatchers(ws, prevKey, nextKey);

	if (ctx.DEBUG_RTS) {
		const watchers = ctx.sessionWatchers.get(nextKey ?? "");
		ctx.logDebug(`[RTS] set_view: nextKey=${nextKey}, watchers=${watchers?.size ?? 0}`);
	}

	void ctx.sendStatus(ws);
	return true;
}
