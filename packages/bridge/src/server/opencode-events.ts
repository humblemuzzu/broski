import type { ServerWebSocket } from "bun";
import type { OpenCodeConnector } from "../connectors/opencode";
import { startOpenCodeExternalTail as _startOpenCodeExternalTail } from "../oc-external-tail";
import {
	createOpenCodeMapperContext,
	mapOpenCodeSdkEventToRuntimeEvent,
} from "../runtime/opencode-runtime-event-mapper";
import type { ServerMessage } from "../types";
import { recordRuntimeEvent } from "../utils/runtime-replay-buffer";
import type { LeveledLogger } from "./logger";
import { observeRuntimeEvent } from "./runtime-observers";
import { makeSessionKey } from "./session-keys";
import type { BridgeState } from "./state";
import type { Streams } from "./streams";
import { safeString } from "./util";

export type OpenCodeEvents = {
	enqueueSdkEvent: (event: unknown) => void;
	filterEventForSocket: (ws: ServerWebSocket<unknown>, event: unknown) => boolean;
	startOpenCodeExternalTail: (sessionId: string, projectPath: string) => { stop: () => void };
};

export type OpenCodeEventsDeps = {
	state: BridgeState;
	streams: Streams;
	log: LeveledLogger;
	debugRts: boolean;
	requireOpenCode: () => OpenCodeConnector;
	syncExternalTailForKey: (key: string | null) => void;
};

/**
 * The OpenCode event subscription: SDK events arrive on one global stream, are mapped to runtime
 * events once, recorded for replay, and fanned out to the sockets whose view matches the event.
 */
export function createOpenCodeEvents(deps: OpenCodeEventsDeps): OpenCodeEvents {
	const { state } = deps;

	// Context for the OC runtime event mapper — tracks reasoning partIDs so that
	// message.part.delta events for reasoning parts are routed as thinking deltas
	// instead of leaking into the visible response text.
	const ocMapperCtx = createOpenCodeMapperContext();

	const extractSessionId = (event: any): string | null => {
		const payload = event?.payload ?? null;
		const properties = payload?.properties ?? null;
		const info = properties?.info ?? null;
		const part = properties?.part ?? null;

		// Try all possible sessionId field locations and formats
		const sessionId =
			// Standard SDK locations
			(typeof info?.sessionID === "string" && info.sessionID) ||
			(typeof info?.sessionId === "string" && info.sessionId) ||
			(typeof properties?.sessionID === "string" && properties.sessionID) ||
			(typeof properties?.sessionId === "string" && properties.sessionId) ||
			(typeof part?.sessionID === "string" && part.sessionID) ||
			(typeof part?.sessionId === "string" && part.sessionId) ||
			// Root level (some events have sessionId at root)
			(typeof event?.sessionID === "string" && event.sessionID) ||
			(typeof event?.sessionId === "string" && event.sessionId) ||
			// Payload level (some events have sessionId directly in payload)
			(typeof payload?.sessionID === "string" && payload.sessionID) ||
			(typeof payload?.sessionId === "string" && payload.sessionId);

		return sessionId ? String(sessionId) : null;
	};

	const getEventType = (event: any): string => {
		const payload = event?.payload ?? null;
		return typeof payload?.type === "string" ? payload.type : "";
	};

	const filterEventForSocket = (ws: ServerWebSocket<unknown>, event: unknown): boolean => {
		const ctx = state.contexts.get(ws);
		if (!ctx || (!ctx.projectPath && !ctx.sessionId)) {
			if (deps.debugRts) {
				deps.log.logDebug("[RTS] filterEventForSocket: No context, passing through");
			}
			return true;
		}

		const e = event as {
			directory?: string;
			payload?: { type?: string; properties?: Record<string, unknown> };
			sessionID?: string;
			sessionId?: string;
		};
		const safeDecode = (s: string) => {
			try {
				return decodeURIComponent(s);
			} catch {
				return s;
			}
		};

		const normalizeDirectory = (dir: string) => safeDecode(dir).replace(/\/+$/, "");
		const directoryRaw = (typeof e?.directory === "string" ? e.directory : null) ?? "global";
		const directory = directoryRaw === "global" ? "global" : normalizeDirectory(directoryRaw);
		const projectPath =
			ctx.projectPath && ctx.projectPath !== "global" ? normalizeDirectory(ctx.projectPath) : ctx.projectPath;

		if (ctx.projectPath === "global") {
			// Global view = receive ALL events (enables multi-device real-time sync)
			if (deps.debugRts) {
				deps.log.logDebug("[RTS] filterEventForSocket: Global view, passing all events");
			}
			return true;
		}

		if (ctx.sessionId) {
			const sid = extractSessionId(event);
			// If the event is scoped to a session, prioritize session routing over directory routing.
			// This keeps cross-device streaming working even if directory strings differ (e.g. symlinks).
			if (sid) {
				const match = sid === ctx.sessionId;
				if (deps.debugRts) {
					const eventType = getEventType(event);
					deps.log.logDebug(
						`[RTS] filterEventForSocket: Session match check - eventSessionId=${sid}, ctxSessionId=${ctx.sessionId}, match=${match}, eventType=${eventType}`,
					);
				}
				return match;
			}
		}

		if (projectPath && directory !== "global" && directory !== projectPath) {
			if (deps.debugRts) {
				deps.log.logDebug(
					`[RTS] filterEventForSocket: Directory mismatch - eventDir=${directory}, ctxDir=${projectPath}`,
				);
			}
			return false;
		}

		if (deps.debugRts) {
			deps.log.logDebug("[RTS] filterEventForSocket: Passing through (default)");
		}
		return true;
	};

	const enqueueSdkEvent = (event: unknown): void => {
		const runtimeEvent = mapOpenCodeSdkEventToRuntimeEvent(event, ocMapperCtx);

		if (deps.debugRts) {
			const eventType = getEventType(event);
			const sid = extractSessionId(event);
			const e = event as {
				directory?: string;
				payload?: { type?: string; properties?: Record<string, unknown> };
				sessionID?: string;
				sessionId?: string;
			};
			const directory = typeof e?.directory === "string" ? e.directory : "global";
			deps.log.logDebug(
				`[RTS] enqueueSdkEvent: type=${eventType}, sessionId=${sid || "none"}, dir=${directory}, sockets=${state.sockets.size}`,
			);
		}

		const runtimePayload = runtimeEvent
			? ({
					type: "runtime_event",
					backend: "opencode",
					data: runtimeEvent,
				} as ServerMessage)
			: null;
		if (runtimeEvent) observeRuntimeEvent(runtimeEvent);
		if (runtimePayload) {
			recordRuntimeEvent(runtimePayload);
		}

		let deliveredCount = 0;
		for (const ws of state.sockets) {
			if (!filterEventForSocket(ws, event)) continue;
			deliveredCount++;

			// Phase 4: Only send runtime_event. Legacy sdk_event/sdk_event_batch removed.
			// Flutter only reads runtime_event for OpenCode events.
			if (runtimePayload) {
				deps.streams.send(ws, runtimePayload);
			}
		}

		if (deps.debugRts && deliveredCount === 0 && state.sockets.size > 0) {
			deps.log.logDebug(`[RTS] enqueueSdkEvent: WARNING - Event not delivered to any socket!`);
		}

		// Keep the hot path lean: forward SDK events first, then do any heavier work.
		queueMicrotask(() => {
			try {
				const e = event as {
					directory?: string;
					payload?: {
						type?: string;
						properties?: Record<string, unknown> & {
							branch?: string;
							sessionID?: string;
							status?: { type?: string };
						};
					};
				};
				const directory = safeString(e?.directory);
				const payloadType = safeString(e?.payload?.type);

				if (payloadType === "vcs.branch.updated" && directory) {
					const branch = safeString(e?.payload?.properties?.branch);
					if (branch) state.lastGitBranchByProject.set(directory, branch);
				}

				// Release OpenCode session ownership when the session goes idle.
				// This allows the external polling tail to resume for picking up
				// activity from the TUI or other external sources.
				if (payloadType === "session.idle" || payloadType === "session.status") {
					const props = e?.payload?.properties;
					const sid = safeString(props?.sessionID);
					const isIdle = payloadType === "session.idle" || props?.status?.type === "idle";
					if (sid && isIdle && state.ocSessionOwners.has(sid)) {
						state.ocSessionOwners.delete(sid);
						deps.syncExternalTailForKey(makeSessionKey("opencode", sid));
						if (deps.debugRts) {
							deps.log.logDebug(`[RTS] OC owner released on idle for session ${sid}, external tail may resume`);
						}
					}
				}
			} catch (err) {
				deps.log.logError("[server] Failed to process SDK event microtask:", err);
			}
		});
	};

	/**
	 * OpenCode External Tail: Polls session messages to detect changes from external TUI sessions.
	 * When the TUI runs, events don't reach global.event() stream, so we poll the API instead.
	 */
	const startOpenCodeExternalTail = (sessionId: string, projectPath: string): { stop: () => void } => {
		return _startOpenCodeExternalTail(sessionId, projectPath, {
			oc: deps.requireOpenCode(),
			enqueueSdkEvent,
			broadcastRaw: deps.streams.broadcast as (message: Record<string, unknown>) => void,
			logDebug: deps.log.logDebug,
			DEBUG_RTS: deps.debugRts,
		});
	};

	return { enqueueSdkEvent, filterEventForSocket, startOpenCodeExternalTail };
}
