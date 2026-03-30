/**
 * Claude Code chat flow handler.
 * Extracted from server.ts — case: cc_chat
 */

import { randomBytes } from "node:crypto";
import type { ServerWebSocket } from "bun";
import type { ClaudeCodeStreamMessage, ServerMessage } from "../types";
import type { ClaudeElicitationReply } from "./cc_elicitation";

type ClaudePermissionReply = {
	response: "once" | "always" | "reject";
	updatedInput?: Record<string, unknown>;
};

export type CcChatHandlerContext = {
	/** The Claude Code connector module */
	claudeCode: any;
	safeString: (v: unknown) => string;
	log: (message: string) => void;
	ws: ServerWebSocket<unknown>;
	send: (ws: ServerWebSocket<unknown>, msg: ServerMessage) => void;
	ccSessionOwners: Map<string, ServerWebSocket<unknown>>;
	ccSessionCwds: Map<string, string>;
	ccPermissionWaiters: Map<string, { resolve: (response: ClaudePermissionReply) => void; timer: Timer }>;
	ccElicitationWaiters: Map<string, { resolve: (response: ClaudeElicitationReply) => void; timer: Timer }>;
	ccEventBuffers: Map<string, Array<{ event: any; ts: number }>>;
	PERMISSION_TIMEOUT_MS: number;
	buildClaudeCodeRuntimeState: (params: {
		sessionId: string;
		cwd: string;
		isStreaming: boolean;
		model?: string;
	}) => any;
	broadcastToSessionWatchers: (
		backend: any,
		sessionId: string,
		msg: ServerMessage,
		excludeWs?: ServerWebSocket<unknown> | null,
	) => void;
	emitCcStream: (
		sessionId: string,
		streamMsg: ClaudeCodeStreamMessage,
		owner?: ServerWebSocket<unknown> | null,
	) => void;
	enqueueSdkEvent: (event: unknown) => void;
	syncExternalTailForKey: (key: string | null) => void;
	makeSessionKey: (agent: any, sessionId: any) => string | null;
};

export async function handleCcChat(
	message: any,
	reply: (msg: any) => void,
	ctx: CcChatHandlerContext,
): Promise<boolean> {
	if (message.type !== "cc_chat") return false;

	const {
		claudeCode,
		safeString,
		log,
		ws,
		send,
		ccSessionOwners,
		ccSessionCwds,
		ccPermissionWaiters,
		ccElicitationWaiters,
		ccEventBuffers,
		PERMISSION_TIMEOUT_MS,
		buildClaudeCodeRuntimeState,
		broadcastToSessionWatchers,
		emitCcStream,
		enqueueSdkEvent,
		syncExternalTailForKey,
		makeSessionKey,
	} = ctx;

	const cwd = safeString(message.cwd).trim();
	if (!cwd) {
		reply({ type: "error", message: "Missing cwd" });
		return true;
	}

	let actualSessionId = message.sessionId ?? "";
	const cfg = await claudeCode.getConfig(cwd);
	const model = message.model || cfg.model || "sonnet";
	const permissionMode = message.permissionMode || cfg.permissionMode;
	const allowedTools = message.allowedTools || cfg.allowedTools;
	const disallowedTools = message.disallowedTools || cfg.disallowedTools;
	// Stable per-turn identifier so watchers on other devices can keep CC turns separated.
	const ccMessageId = `cc-msg-${randomBytes(8).toString("hex")}`;
	let sentBusyStatus = false;

	if (message.sessionId) {
		ccSessionOwners.set(message.sessionId, ws);
		ccSessionCwds.set(message.sessionId, cwd);
	}

	// Use dynamic owner lookup instead of captured `ws` to survive reconnects.
	// When the app disconnects and reconnects, `ws` is dead but
	// `ccSessionOwners.get(sessionId)` points to the new socket.
	const getOwnerSocket = (sessionId: string): ServerWebSocket<unknown> | null => ccSessionOwners.get(sessionId) ?? null;

	const sendSessionBusy = (sessionId: string) => {
		if (!sessionId || sentBusyStatus) return;
		sentBusyStatus = true;
		const target = getOwnerSocket(sessionId) ?? ws;
		send(target, {
			type: "runtime_state",
			backend: "claude-code",
			data: buildClaudeCodeRuntimeState({
				sessionId,
				cwd: ccSessionCwds.get(sessionId) ?? cwd,
				isStreaming: true,
				model,
			}),
		});
		// Legacy sdk_event removed in Phase 4 — runtime_state (above) drives UI state.
	};

	const sendSessionIdle = (sessionId: string) => {
		if (!sessionId) return;
		const runtimeStatePayload: ServerMessage = {
			type: "runtime_state",
			backend: "claude-code",
			data: buildClaudeCodeRuntimeState({
				sessionId,
				cwd: ccSessionCwds.get(sessionId) ?? cwd,
				isStreaming: false,
				model,
			}),
		};
		const owner = getOwnerSocket(sessionId);
		if (owner) {
			send(owner, runtimeStatePayload);
		}
		broadcastToSessionWatchers("claude-code", sessionId, runtimeStatePayload, owner);
		// Broadcast idle to all watchers, not just the owner.
		// On reconnect the owner may have changed; on disconnect the
		// owner may be gone — enqueueSdkEvent handles both cases.
		enqueueSdkEvent({
			payload: {
				type: "session.idle",
				properties: {
					sessionID: sessionId,
				},
			},
		});
	};

	const available = await claudeCode.checkClaudeCodeAvailable();
	if (!available) {
		const err =
			'Claude Code is not signed in. Run "claude login" in your terminal on the Mac, or set ANTHROPIC_API_KEY.';
		log(`[Claude Code] ${err}`);
		// Use a fallback sessionId so the error reaches the app via runtime_event.
		const sid = actualSessionId || message.sessionId || "unknown";
		emitCcStream(sid, { type: "error", message: err, code: "cc_auth_missing" }, ws);
		return true;
	}

	log(
		`[Claude Code] chat: ${message.sessionId ? "resume" : "new"} cwd=${cwd} model=${model} permissionMode=${permissionMode}`,
	);
	log(`[Claude Code] tools: allowed=${allowedTools.length} disallowed=${disallowedTools.length}`);

	const prompt = await claudeCode.preparePromptWithAttachments(message.prompt, cwd, message.fileAttachments);

	// If we're resuming an existing session, mark it busy immediately.
	// For new sessions, we'll mark busy once we receive session-created.
	if (message.sessionId) {
		sendSessionBusy(message.sessionId);
	}

	claudeCode.queryClaudeCode(
		prompt,
		{
			cwd,
			sessionId: message.sessionId,
			model,
			permissionMode,
			allowedTools,
			disallowedTools,
			maxThinkingTokens: message.maxThinkingTokens,
			maxTurns: message.maxTurns ?? cfg.maxTurns,
			maxBudgetUsd: message.maxBudgetUsd ?? cfg.maxBudgetUsd,
			betas: message.betas ?? cfg.betas,
			variant: message.variant,
			thinking: message.thinking ?? cfg.thinking,
			effort: message.effort ?? cfg.effort,
			agent: message.agent,
			systemPrompt: message.systemPrompt ?? cfg.systemPrompt,
			resumeSessionAt: message.resumeSessionAt,
			outputFormat: message.outputFormat ?? cfg.outputFormat,
			sandbox: message.sandbox ?? cfg.sandbox,
			enableAgentTeams: message.enableAgentTeams ?? cfg.enableAgentTeams,
			activeSubagent: message.activeSubagent,
			persistSession: message.persistSession,
			promptSuggestions: message.promptSuggestions ?? cfg.promptSuggestions,
			enableClaudeAiMcpServers: message.enableClaudeAiMcpServers ?? cfg.enableClaudeAiMcpServers,
			fallbackModel: message.fallbackModel ?? cfg.fallbackModel,
			additionalDirectories: message.additionalDirectories,
			agentProgressSummaries: message.agentProgressSummaries ?? cfg.agentProgressSummaries,
			// SDK 0.2.87: Continue most recent session or fork on resume
			...(message.continueSession ? { continueSession: true } : {}),
			...(message.forkOnResume ? { forkOnResume: true } : {}),
		},
		(streamMsg: ClaudeCodeStreamMessage) => {
			const streamMsgWithId = (() => {
				const t = streamMsg.type;
				if (
					t === "assistant-message" ||
					t === "assistant-message-delta" ||
					t === "thinking-delta" ||
					t === "tool-call" ||
					t === "tool-result" ||
					t === "subagent-invocation" ||
					t === "token-usage" ||
					t === "task-started" ||
					t === "task-progress" ||
					t === "task-notification" ||
					t === "tool-use-summary" ||
					t === "files-persisted" ||
					t === "hook-started" ||
					t === "hook-progress" ||
					t === "hook-response" ||
					t === "assistant-error" ||
					t === "result-complete" ||
					t === "rate-limit-info" ||
					t === "prompt-suggestion"
				) {
					return { ...streamMsg, messageId: ccMessageId };
				}
				return streamMsg;
			})();
			if (streamMsg.type === "session-created") {
				actualSessionId = streamMsg.sessionId;
				// Set the CURRENT ws as owner (may be stale later, but set_view will update)
				ccSessionOwners.set(actualSessionId, ws);
				ccSessionCwds.set(actualSessionId, cwd);
				log(`[Claude Code] session created: ${actualSessionId}`);
				sendSessionBusy(actualSessionId);
			}

			// Route through emitCcStream (uses dynamic owner lookup + runtime_event mapping).
			// Fallback to "unknown" sessionId if actual session hasn't been created yet.
			const streamSid = actualSessionId || "unknown";
			emitCcStream(streamSid, streamMsgWithId);
		},
		(completedSessionId: any) => {
			const sid = completedSessionId || actualSessionId || message.sessionId || "";
			log(`Claude Code session ${sid} completed`);
			sendSessionIdle(sid);
			// Clear ownership — any socket that was the owner
			ccSessionOwners.delete(sid);
			ccSessionCwds.delete(sid);
			// Clear event buffer for this session (no longer streaming)
			ccEventBuffers.delete(sid);
			syncExternalTailForKey(makeSessionKey("claude-code", sid));
		},
		(error: any) => {
			log(`[Claude Code] error: ${error.message}`);
			// Fallback to "unknown" sessionId if actual session hasn't been resolved yet.
			const sid = actualSessionId || message.sessionId || "unknown";
			emitCcStream(sid, {
				type: "error",
				message: error.message,
				code: "cc_error",
			});
			sendSessionIdle(sid);
			ccSessionOwners.delete(sid);
			ccSessionCwds.delete(sid);
			ccEventBuffers.delete(sid);
			syncExternalTailForKey(makeSessionKey("claude-code", sid));
		},
		async (req: any) => {
			const sid = req.sessionId || actualSessionId;
			if (sid) actualSessionId = sid;
			// Use dynamic lookup: if the app reconnected, the owner may be a new socket
			const ownerWs = (sid ? ccSessionOwners.get(sid) : null) ?? ws;
			if (sid) ccSessionOwners.set(sid, ownerWs);
			if (sid) ccSessionCwds.set(sid, cwd);

			// Ask the current owner socket for approval (mobile UI shows prompt).
			// If the owner is disconnected, this will buffer via emitCcStream.
			emitCcStream(sid ?? "", {
				type: "permission-request",
				sessionId: sid,
				toolUseId: req.toolUseId,
				tool: req.tool,
				input: req.input,
				decisionReason: req.decisionReason,
				blockedPath: req.blockedPath,
				hasSuggestions: req.hasSuggestions,
				// SDK 0.2.87: Forward full suggestions for "Always Allow" rule persistence
				...(Array.isArray(req.suggestions) && req.suggestions.length > 0 ? { suggestions: req.suggestions } : {}),
				// SDK 0.2.87: Human-readable fields from SDK
				...(req.title ? { title: req.title } : {}),
				...(req.displayName ? { displayName: req.displayName } : {}),
				description: req.description,
				agentId: req.agentId,
			} as ClaudeCodeStreamMessage);

			// Wait for a response from the client
			const key = `${sid}:${req.toolUseId}`;
			const existing = ccPermissionWaiters.get(key);
			if (existing) {
				// If we somehow re-request, default to deny to avoid deadlocks
				return { response: "reject" } as const;
			}

			return await new Promise<ClaudePermissionReply>((resolve) => {
				const timer = setTimeout(() => {
					ccPermissionWaiters.delete(key);
					resolve({ response: "reject" });
				}, PERMISSION_TIMEOUT_MS);
				ccPermissionWaiters.set(key, { resolve, timer });
			});
		},
		async (req: any) => {
			const sid = req.sessionId || actualSessionId || message.sessionId || "";
			if (sid) actualSessionId = sid;

			const requestId = req.requestId;
			const elicitationStreamMsg: Extract<ClaudeCodeStreamMessage, { type: "elicitation-request" }> = {
				type: "elicitation-request",
				sessionId: sid,
				requestId,
				mcpServerName: req.mcpServerName,
				message: req.message,
				mode: req.mode,
				url: req.url,
				elicitationId: req.elicitationId,
				requestedSchema: req.requestedSchema,
			};

			// Fallback to "unknown" if sessionId not resolved yet.
			emitCcStream(sid || "unknown", elicitationStreamMsg);

			const elicitKey = `${sid}:${requestId}`;
			const existingElicitation = ccElicitationWaiters.get(elicitKey);
			if (existingElicitation) {
				// Preserve the original waiter and reject duplicate requests.
				return { action: "cancel" } as const;
			}

			return await new Promise<ClaudeElicitationReply>((resolve) => {
				const timer = setTimeout(() => {
					ccElicitationWaiters.delete(elicitKey);
					resolve({ action: "cancel" });
				}, PERMISSION_TIMEOUT_MS);
				ccElicitationWaiters.set(elicitKey, { resolve, timer });
			});
		},
	);

	return true;
}
