import type { ServerWebSocket } from "bun";
import { startClaudeCodeExternalTail as _startClaudeCodeExternalTail } from "../cc-external-tail";
import * as claudeCode from "../connectors/claude-code";
import type { OpenCodeConnector } from "../connectors/opencode";
import { startCodexExternalTail as _startCodexExternalTail } from "../cx-external-tail";
import type { AgentType, ServerMessage } from "../types";
import type { LeveledLogger } from "./logger";
import { makeSessionKey, parseSessionKey } from "./session-keys";
import type { BridgeState } from "./state";
import type { Streams } from "./streams";
import { safeString } from "./util";

export type Sessions = {
	updateSessionWatchers: (ws: ServerWebSocket<unknown>, prevKey: string | null, nextKey: string | null) => void;
	syncExternalTailForKey: (key: string | null) => void;
	broadcastToSessionWatchers: (
		agent: AgentType,
		sessionId: string,
		message: ServerMessage,
		owner?: ServerWebSocket<unknown> | null,
	) => void;
	stopCcExternalTail: (sessionId: string) => void;
	stopCxExternalTail: (threadId: string) => void;
	stopOcExternalTail: (sessionId: string) => void;
};

export type SessionsDeps = {
	state: BridgeState;
	streams: Streams;
	log: LeveledLogger;
	debugRts: boolean;
	getOpenCode: () => OpenCodeConnector | null;
	startOpenCodeExternalTail: (sessionId: string, projectPath: string) => { stop: () => void };
};

/**
 * Who is watching which session. Watchers decide whether a backend's external tail (reading a
 * session the bridge does not own) should run, so a session viewed on the phone keeps streaming
 * even when another process is driving the agent.
 */
export function createSessions(deps: SessionsDeps): Sessions {
	const { state } = deps;

	const stopExternalTail = (map: Map<string, { stop: () => void }>, id: string): void => {
		const existing = map.get(id);
		if (!existing) return;
		try {
			existing.stop();
		} catch {
			// ignore
		}
		map.delete(id);
	};
	const stopCcExternalTail = (sessionId: string): void => stopExternalTail(state.ccExternalTails, sessionId);
	const stopCxExternalTail = (threadId: string): void => stopExternalTail(state.cxExternalTails, threadId);
	const stopOcExternalTail = (sessionId: string): void => stopExternalTail(state.ocExternalTails, sessionId);

	const broadcastRaw = deps.streams.broadcast as (message: Record<string, unknown>) => void;

	const startClaudeCodeExternalTail = (sessionId: string): { stop: () => void } => {
		return _startClaudeCodeExternalTail(sessionId, {
			claudeCode,
			emitCcStream: deps.streams.emitCcStream,
			broadcastRaw,
			safeString,
			logDebug: deps.log.logDebug,
			DEBUG_RTS: deps.debugRts,
		});
	};

	const startCodexExternalTail = (threadId: string): { stop: () => void } => {
		return _startCodexExternalTail(threadId, {
			emitCxStream: deps.streams.emitCxStream,
			broadcastRaw,
			safeString,
			logDebug: deps.log.logDebug,
			DEBUG_RTS: deps.debugRts,
		});
	};

	const syncExternalTailForKey = (key: string | null): void => {
		if (!key) return;
		const parsed = parseSessionKey(key);
		if (!parsed) return;
		const { agent, id } = parsed;
		const watchers = state.sessionWatchers.get(key);
		const watcherCount = watchers?.size ?? 0;

		if (agent === "claude-code") {
			const owner = state.ccSessionOwners.get(id) ?? null;
			const shouldRun = watcherCount > 0 && !owner;
			if (deps.debugRts) {
				deps.log.logDebug(
					`[RTS] syncExternalTail(CC): id=${id}, watchers=${watcherCount}, owner=${!!owner}, shouldRun=${shouldRun}, alreadyRunning=${state.ccExternalTails.has(id)}`,
				);
			}
			if (shouldRun) {
				if (!state.ccExternalTails.has(id)) {
					if (deps.debugRts) {
						deps.log.logDebug(`[RTS] Starting Claude Code external tail for session ${id}`);
					}
					state.ccExternalTails.set(id, startClaudeCodeExternalTail(id));
				}
			} else {
				stopCcExternalTail(id);
			}
			return;
		}

		if (agent === "codex") {
			const owner = state.cxThreadOwners.get(id) ?? null;
			const shouldRun = watcherCount > 0 && !owner;
			if (deps.debugRts) {
				deps.log.logDebug(
					`[RTS] syncExternalTail(CX): id=${id}, watchers=${watcherCount}, owner=${!!owner}, shouldRun=${shouldRun}, alreadyRunning=${state.cxExternalTails.has(id)}`,
				);
			}
			if (shouldRun) {
				if (!state.cxExternalTails.has(id)) {
					if (deps.debugRts) {
						deps.log.logDebug(`[RTS] Starting Codex external tail for thread ${id}`);
					}
					state.cxExternalTails.set(id, startCodexExternalTail(id));
				}
			} else {
				stopCxExternalTail(id);
			}
			return;
		}

		if (agent === "opencode") {
			// OpenCode external tail: poll session messages API when TUI is running externally.
			// When the bridge itself owns the session (sent a prompt via the SDK), the global
			// SSE event stream already delivers events — running the polling tail at the same
			// time would cause every event to be emitted twice (the double-send bug).
			const owner = state.ocSessionOwners.get(id) ?? null;
			const projectPath = state.ocSessionProjectPaths.get(id);
			const shouldRun = watcherCount > 0 && !owner && !!deps.getOpenCode() && !!projectPath;
			if (deps.debugRts) {
				deps.log.logDebug(
					`[RTS] syncExternalTail(OC): id=${id}, watchers=${watcherCount}, owner=${!!owner}, shouldRun=${shouldRun}, alreadyRunning=${state.ocExternalTails.has(id)}`,
				);
			}
			if (shouldRun) {
				if (!state.ocExternalTails.has(id)) {
					state.ocExternalTails.set(id, deps.startOpenCodeExternalTail(id, projectPath));
					if (deps.debugRts) {
						deps.log.logDebug(`[RTS] Starting OpenCode external tail for session ${id}`);
					}
				}
			} else {
				stopOcExternalTail(id);
			}
		}
	};

	const updateSessionWatchers = (
		ws: ServerWebSocket<unknown>,
		prevKey: string | null,
		nextKey: string | null,
	): void => {
		if (prevKey) {
			const prevSet = state.sessionWatchers.get(prevKey);
			if (prevSet) {
				prevSet.delete(ws);
				if (prevSet.size === 0) state.sessionWatchers.delete(prevKey);
			}
			syncExternalTailForKey(prevKey);
		}
		if (nextKey) {
			let nextSet = state.sessionWatchers.get(nextKey);
			if (!nextSet) {
				nextSet = new Set();
				state.sessionWatchers.set(nextKey, nextSet);
			}
			nextSet.add(ws);
			syncExternalTailForKey(nextKey);
		}
	};

	const broadcastToSessionWatchers = (
		agent: AgentType,
		sessionId: string,
		message: ServerMessage,
		owner?: ServerWebSocket<unknown> | null,
	): void => {
		const key = makeSessionKey(agent, sessionId);
		if (!key) return;
		const watchers = state.sessionWatchers.get(key);
		if (!watchers) return;
		for (const ws of watchers) {
			if (owner && ws === owner) continue;
			deps.streams.send(ws, message);
		}
	};

	return {
		updateSessionWatchers,
		syncExternalTailForKey,
		broadcastToSessionWatchers,
		stopCcExternalTail,
		stopCxExternalTail,
		stopOcExternalTail,
	};
}
