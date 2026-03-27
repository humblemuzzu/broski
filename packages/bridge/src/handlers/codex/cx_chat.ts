/**
 * Codex chat flow handler.
 * Extracted from server.ts — cases: cx_chat, cx_abort,
 * cx_permission_response, cx_user_input_response
 */

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CodexAppServerClient } from "../../connectors/codex";
import type { AgentType, CodexStreamMessage, CodexThread, ServerMessage } from "../../types";

/** Pending approval / user-input waiter */
type ApprovalWaiter = {
	resolve: (value: any) => void;
	timer: Timer;
};

export type CxChatHandlerContext = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	safeString: (v: unknown) => string;
	logInfo: (message: string) => void;
	logError: (message: string, ...args: unknown[]) => void;
	logDebug: (message: string) => void;
	DEBUG_CX_GLOBAL: boolean;
	// Thread tracking
	cxThreadOwners: Map<string, any>;
	cxThreadCwds: Map<string, string>;
	cxActiveTurns: Map<string, string>;
	cxApprovalWaiters: Map<string, ApprovalWaiter>;
	// Helpers
	mapCodexThread: (thread: any, nameOverride?: string) => CodexThread & { threadName?: string };
	emitCxStream: (threadId: string, data: CodexStreamMessage, owner?: any) => void;
	send: (ws: any, msg: ServerMessage) => void;
	broadcastToSessionWatchers: (backend: AgentType, sessionId: string, msg: ServerMessage, excludeWs?: any) => void;
	buildCodexRuntimeState: (params: { threadId: string; cwd?: string; isStreaming: boolean }) => any;
	ws: any;
};

export async function handleCxChat(
	message: any,
	reply: (msg: any) => void,
	ctx: CxChatHandlerContext,
): Promise<boolean> {
	switch (message.type) {
		case "cx_chat": {
			const client = await ctx.ensureCodexClient();
			const explicitCwd = ctx.safeString(message.cwd).trim();
			const existingThreadId = ctx.safeString(message.threadId).trim();
			const storedCwd = existingThreadId ? ctx.cxThreadCwds.get(existingThreadId) : null;
			if (storedCwd && explicitCwd && storedCwd !== explicitCwd) {
				reply({ type: "error", message: "Access denied" });
				break;
			}
			const cwd = storedCwd || explicitCwd;
			if (!cwd) {
				reply({ type: "error", message: "Missing cwd" });
				break;
			}
			if (ctx.DEBUG_CX_GLOBAL) {
				ctx.logDebug(`[Codex cx_chat] model=${message.model ?? "default"}, threadId=${message.threadId ?? "new"}`);
			}

			let resolvedModel = ctx.safeString(message.model).trim();
			let threadId = existingThreadId || null;
			// Resolve personality (SDK Personality: "none" | "friendly" | "pragmatic")
			const personalityRaw = ctx.safeString(message.personality).trim().toLowerCase();
			const personality =
				personalityRaw === "none" || personalityRaw === "friendly" || personalityRaw === "pragmatic"
					? personalityRaw
					: null;

			if (!threadId) {
				const startRes: any = await client.request("thread/start", {
					cwd,
					model: message.model ?? null,
					approvalPolicy: message.approvalPolicy ?? null,
					sandbox: message.sandbox ?? null,
					config: message.config ?? null,
					baseInstructions: message.baseInstructions ?? null,
					developerInstructions: message.developerInstructions ?? null,
					...(personality ? { personality } : {}),
					serviceTier: message.serviceTier ?? null,
					experimentalRawEvents: false,
				});
				threadId = ctx.safeString(startRes?.thread?.id);
				if (!resolvedModel) {
					resolvedModel = ctx.safeString(startRes?.model).trim();
				}
				if (ctx.DEBUG_CX_GLOBAL) {
					ctx.logInfo(`[Codex cx_chat] thread/start result: threadId=${threadId}`);
				}
				if (threadId) {
					reply({
						type: "cx_thread_created",
						data: ctx.mapCodexThread(startRes.thread),
					});
				} else {
					ctx.logError(`[Codex cx_chat] thread/start failed - no threadId returned`);
				}
			} else {
				// Ensure we are subscribed to events for this thread.
				const resumeRes: any = await client.request("thread/resume", {
					threadId,
					model: message.model ?? null,
					cwd,
					approvalPolicy: message.approvalPolicy ?? null,
					sandbox: message.sandbox ?? null,
					config: message.config ?? null,
					baseInstructions: message.baseInstructions ?? null,
					developerInstructions: message.developerInstructions ?? null,
					serviceTier: message.serviceTier ?? null,
					...(personality ? { personality } : {}),
				});
				if (!resolvedModel) {
					resolvedModel = ctx.safeString(resumeRes?.model).trim();
				}
			}

			if (!threadId) {
				ctx.send(ctx.ws, {
					type: "cx_stream",
					threadId: "unknown",
					data: {
						type: "error",
						message: "Failed to create/resume Codex thread",
					},
				} as ServerMessage);
				break;
			}

			ctx.cxThreadOwners.set(threadId, ctx.ws);
			ctx.cxThreadCwds.set(threadId, cwd);

			// Prepare input (text + optional local images written to disk).
			// SDK UserInput type requires text_elements field (Array<TextElement>)
			const input: Array<any> = [{ type: "text", text: message.prompt, text_elements: [] }];
			if (message.fileAttachments && message.fileAttachments.length > 0) {
				const attachmentsDir = resolve(cwd, ".broski", "codex-attachments");
				await mkdir(attachmentsDir, { recursive: true });
				for (const a of message.fileAttachments) {
					if (a.base64Data && a.mimeType) {
						const token = randomBytes(6).toString("hex");
						const ext = a.mimeType.includes("png") ? ".png" : a.mimeType.includes("webp") ? ".webp" : ".jpg";
						const fileName = `${Date.now()}_${token}${ext}`;
						const outPath = resolve(attachmentsDir, fileName);
						await writeFile(outPath, Buffer.from(a.base64Data, "base64"));
						// Codex v2 UserInput uses camelCase type tags.
						input.push({ type: "localImage", path: outPath });
					} else if (a.path) {
						// File/directory references via prompt hint
						const ref = a.path.startsWith("@") ? a.path : `@${a.path}`;
						input[0].text = `${input[0].text}\n\nAttached context (via Broski):\n- ${a.isDirectory ? "Directory" : "File"}: ${ref}`;
					}
				}
			}
			// Structured skill mentions
			if (Array.isArray(message.skillMentions)) {
				for (const s of message.skillMentions) {
					if (s.name && s.path) {
						input.push({ type: "skill", name: s.name, path: s.path });
					}
				}
			}
			// Structured file mentions
			if (Array.isArray(message.fileMentions)) {
				for (const f of message.fileMentions) {
					if (f.name && f.path) {
						input.push({ type: "mention", name: f.name, path: f.path });
					}
				}
			}

			// Build collaboration mode object if specified.
			// Codex SDK ModeKind: "plan" | "default" (legacy code/pair_programming/execute/custom → "default")
			// CollaborationMode = { mode: ModeKind, settings: { model, reasoning_effort?, developer_instructions? } }
			let collaborationMode: any = null;
			const collabModeRaw = ctx.safeString(message.collaborationMode).trim();
			if (collabModeRaw) {
				const collabKey = collabModeRaw.replace(/[-_]/g, "").toLowerCase();
				// Map to SDK ModeKind: only "plan" and "default" are valid
				const normalizedMode: "plan" | "default" = collabKey === "plan" ? "plan" : "default";

				const model = resolvedModel;
				if (model) {
					const effortRaw = ctx.safeString(message.effort).trim().toLowerCase();
					const reasoningEffort =
						effortRaw === "none" ||
						effortRaw === "minimal" ||
						effortRaw === "low" ||
						effortRaw === "medium" ||
						effortRaw === "high" ||
						effortRaw === "xhigh"
							? effortRaw
							: null;

					const developerInstructions = ctx.safeString(message.developerInstructions).trim();
					collaborationMode = {
						mode: normalizedMode,
						settings: {
							model,
							reasoning_effort: reasoningEffort ?? null,
							developer_instructions: developerInstructions || null,
						},
					};
				} else {
					ctx.logInfo("[Codex cx_chat] collaborationMode ignored (missing model)");
				}
			}

			if (ctx.DEBUG_CX_GLOBAL) {
				ctx.logInfo(`[Codex cx_chat] Starting turn for threadId=${threadId}`);
			}

			try {
				const turnRes: any = await client.request("turn/start", {
					threadId,
					input,
					cwd,
					model: resolvedModel || null,
					effort: message.effort ?? null,
					summary: message.summary ?? null,
					approvalPolicy: message.approvalPolicy ?? null,
					sandboxPolicy: message.sandboxPolicy ?? null,
					...(personality ? { personality } : {}),
					serviceTier: message.serviceTier ?? null,
					collaborationMode,
					...(message.outputSchema ? { outputSchema: message.outputSchema } : {}),
				});

				const turnId = ctx.safeString(turnRes?.turn?.id);
				const turnStatus = ctx.safeString(turnRes?.turn?.status).toLowerCase();
				const turnError = turnRes?.turn?.error ?? turnRes?.error;

				if (ctx.DEBUG_CX_GLOBAL) {
					ctx.logInfo(`[Codex cx_chat] turn/start result: turnId=${turnId}, status=${turnStatus}`);
				}

				// Check if turn started with an error
				if (turnError || turnStatus === "failed") {
					const errorMessage =
						typeof turnError === "string"
							? turnError
							: (turnError?.message ?? turnError?.additionalDetails ?? "Turn failed to start");
					const errorCode = turnError?.codexErrorInfo ?? turnError?.code ?? "turn_start_failed";

					ctx.logError(`[Codex cx_chat] turn/start failed`);
					if (ctx.DEBUG_CX_GLOBAL) {
						try {
							ctx.logError(JSON.stringify(turnError ?? turnRes, null, 2));
						} catch {
							// ignore
						}
					}

					ctx.emitCxStream(
						threadId,
						{
							type: "error",
							message: errorMessage,
							code: typeof errorCode === "string" ? errorCode : JSON.stringify(errorCode),
							details: turnError,
						},
						ctx.ws,
					);

					// Emit runtime_state with isStreaming: false
					const turnFailedRuntimeState: ServerMessage = {
						type: "runtime_state",
						backend: "codex",
						data: ctx.buildCodexRuntimeState({
							threadId,
							cwd: ctx.cxThreadCwds.get(threadId),
							isStreaming: false,
						}),
					};
					ctx.send(ctx.ws, turnFailedRuntimeState);
					ctx.broadcastToSessionWatchers("codex", threadId, turnFailedRuntimeState, ctx.ws);

					// Send idle to reset UI
					ctx.send(ctx.ws, {
						type: "sdk_event",
						data: {
							payload: {
								type: "session.idle",
								properties: { sessionID: threadId },
							},
						},
					} as ServerMessage);
					break;
				}

				if (!turnId) {
					ctx.logError(`[Codex cx_chat] turn/start returned no turnId`);
					if (ctx.DEBUG_CX_GLOBAL) {
						try {
							ctx.logError(JSON.stringify(turnRes, null, 2));
						} catch {
							// ignore
						}
					}
					ctx.emitCxStream(
						threadId,
						{
							type: "error",
							message: "Turn failed to start - no turn ID returned",
							code: "turn_start_no_id",
							details: turnRes,
						},
						ctx.ws,
					);
					break;
				}

				ctx.cxActiveTurns.set(threadId, turnId);
			} catch (err: any) {
				// Handle request-level errors (network, timeout, app-server crash, etc.)
				const errorMessage = err?.message ?? String(err);
				ctx.logError(`[Codex cx_chat] turn/start threw error:`, errorMessage);

				ctx.emitCxStream(
					threadId,
					{
						type: "error",
						message: errorMessage,
						code: "turn_start_exception",
					},
					ctx.ws,
				);

				// Emit runtime_state with isStreaming: false
				const exceptionRuntimeState: ServerMessage = {
					type: "runtime_state",
					backend: "codex",
					data: ctx.buildCodexRuntimeState({
						threadId,
						cwd: ctx.cxThreadCwds.get(threadId),
						isStreaming: false,
					}),
				};
				ctx.send(ctx.ws, exceptionRuntimeState);
				ctx.broadcastToSessionWatchers("codex", threadId, exceptionRuntimeState, ctx.ws);

				// Send idle to reset UI
				ctx.send(ctx.ws, {
					type: "sdk_event",
					data: {
						payload: {
							type: "session.idle",
							properties: { sessionID: threadId },
						},
					},
				} as ServerMessage);
			}
			break;
		}

		case "cx_abort": {
			const client = await ctx.ensureCodexClient();
			const turnId = message.turnId ?? ctx.cxActiveTurns.get(message.threadId);
			if (turnId) {
				await client.request("turn/interrupt", {
					threadId: message.threadId,
					turnId,
				});
			}
			break;
		}

		case "cx_permission_response": {
			const waiter = ctx.cxApprovalWaiters.get(message.requestId);
			if (waiter) {
				clearTimeout(waiter.timer);
				ctx.cxApprovalWaiters.delete(message.requestId);
				waiter.resolve({
					response: message.response,
					execpolicyAmendment: message.execpolicyAmendment,
					networkPolicyAmendment: message.networkPolicyAmendment,
				});
			}
			break;
		}

		case "cx_user_input_response": {
			// Codex request_user_input response (SDK v0.87.0+)
			const waiter = ctx.cxApprovalWaiters.get(message.requestId);
			if (waiter) {
				clearTimeout(waiter.timer);
				ctx.cxApprovalWaiters.delete(message.requestId);
				waiter.resolve({ answers: message.answers });
			}
			break;
		}

		default:
			return false;
	}
	return true;
}
