/**
 * OpenCode external session tail.
 *
 * Polls OC session messages to detect changes from external TUI sessions.
 * When the TUI runs, events don't reach global.event() stream, so we poll.
 *
 * Extracted from server.ts (~312 lines) to reduce file size.
 */

export type OcExternalTailContext = {
	enqueueSdkEvent: (event: unknown) => void;
	/** Broadcast a raw message to all sockets (used for external-user-message). */
	broadcastRaw?: (message: Record<string, unknown>) => void;
	oc: any;
	logDebug: (msg: string) => void;
	DEBUG_RTS: boolean;
};

/**
 * Messages fetched per poll. The OpenCode SDK has no `since` cursor, only a `limit` that returns the
 * newest page, and a busy session polls every 150 ms: re-fetching a whole long transcript that often
 * was the cost this avoids. A saturated page that no longer holds the previous poll's last message
 * means more than a page arrived in one interval, and that poll reads the whole transcript instead.
 */
export const OC_TAIL_MESSAGE_LIMIT = 50;

function messageIdOf(message: unknown): string | null {
	const info = (message as { info?: { id?: unknown } } | null | undefined)?.info;
	return typeof info?.id === "string" ? info.id : null;
}

export function startOpenCodeExternalTail(
	sessionId: string,
	projectPath: string,
	ctx: OcExternalTailContext,
): { stop: () => void } {
	// OC connector passed via context
	let stopped = false;
	let pollTimer: Timer | null = null;
	let initialSyncDone = false; // Skip emitting events on first poll (historical messages)
	const lastTextByPartId = new Map<string, string>();
	const lastToolStateByPartId = new Map<string, string>();
	const seenMessageIds = new Set<string>();
	const seenPartIds = new Set<string>();
	const seenPermissionIds = new Set<string>();
	const seenQuestionIds = new Set<string>();
	let lastSessionStatus: "idle" | "busy" | "retry" = "idle";
	let lastEmittedStatus: "idle" | "busy" = "idle"; // What we last told the app (based on content changes, not API)
	let idleCount = 0; // Track consecutive idle polls for adaptive polling
	let lastChangeTime = Date.now(); // Track when we last detected content changes
	let wasEverBusy = false; // Track if we've ever seen activity (to avoid false idle on startup)
	let lastPageTailId: string | null = null; // Newest message of the previous poll, for gap detection

	const poll = async () => {
		if (stopped) return;
		try {
			// Get session status
			const statusMap = await ctx.oc.getSessionStatus(projectPath).catch((): Record<string, any> => ({}));
			const status = statusMap[sessionId];
			const newStatus = status?.type ?? "idle";

			// Debug: Log raw status response on first few polls or when it changes
			if (ctx.DEBUG_RTS && (idleCount < 3 || newStatus !== lastSessionStatus)) {
				const sessionIds = Object.keys(statusMap);
				ctx.logDebug(
					`[RTS] OC External: getSessionStatus returned ${sessionIds.length} sessions: ${sessionIds.join(", ") || "(none)"}`,
				);
				if (status) {
					ctx.logDebug(`[RTS] OC External: Session ${sessionId} raw status: ${JSON.stringify(status)}`);
				} else {
					ctx.logDebug(`[RTS] OC External: Session ${sessionId} NOT in status map, defaulting to idle`);
				}
			}

			// Track idle state for adaptive polling
			if (newStatus === "idle") {
				idleCount++;
			} else {
				idleCount = 0;
			}

			if (newStatus !== lastSessionStatus) {
				if (ctx.DEBUG_RTS) {
					ctx.logDebug(`[RTS] OC External: Session ${sessionId} status changed: ${lastSessionStatus} -> ${newStatus}`);
				}
				lastSessionStatus = newStatus;

				// Always emit session status events (important for UI state)
				ctx.enqueueSdkEvent({
					directory: projectPath,
					payload: {
						type: "session.status",
						properties: {
							sessionID: sessionId,
							status: { type: newStatus },
						},
					},
				});
			}

			// Get the newest page of session messages, widening it to the whole transcript when the page
			// is saturated and the previous poll's last message has already fallen off it.
			const newestPage = await ctx.oc
				.getSessionMessages(sessionId, projectPath, OC_TAIL_MESSAGE_LIMIT)
				.catch(() => null);
			if (!newestPage || !Array.isArray(newestPage)) return;
			const pageLostTheTail =
				initialSyncDone &&
				newestPage.length >= OC_TAIL_MESSAGE_LIMIT &&
				lastPageTailId !== null &&
				!newestPage.some((message: unknown) => messageIdOf(message) === lastPageTailId);
			const widened = pageLostTheTail
				? await ctx.oc.getSessionMessages(sessionId, projectPath).catch(() => null)
				: null;
			const messages = Array.isArray(widened) ? widened : newestPage;
			lastPageTailId = messages.length > 0 ? messageIdOf(messages[messages.length - 1]) : lastPageTailId;

			let hadChanges = false;

			for (const msg of messages) {
				if (!msg?.info?.id) continue;
				const msgId = msg.info.id;
				const isNewMessage = !seenMessageIds.has(msgId);

				if (isNewMessage) {
					seenMessageIds.add(msgId);

					// Only emit events AFTER initial sync
					if (initialSyncDone) {
						hadChanges = true;
						if (ctx.DEBUG_RTS) {
							ctx.logDebug(`[RTS] OC External: New message ${msgId} in session ${sessionId}`);
						}

						ctx.enqueueSdkEvent({
							directory: projectPath,
							payload: {
								type: "message.updated",
								properties: {
									info: {
										...msg.info,
										sessionID: sessionId,
									},
								},
							},
						});

						// Emit user text so the phone shows the prompt typed on Mac
						if (ctx.broadcastRaw && msg.info.role === "user") {
							const userText = typeof msg.text === "string" ? msg.text : "";
							if (userText) {
								ctx.broadcastRaw({
									type: "runtime_event",
									backend: "opencode",
									data: {
										type: "backend_event",
										backend: "opencode",
										kind: "external-user-message",
										timestampMs: Date.now(),
										sessionId,
										payload: { content: userText, timestamp: Date.now() },
									},
								});
							}
						}
					}
				}

				// Check parts for updates
				const parts = Array.isArray(msg.parts) ? msg.parts : [];
				for (const part of parts) {
					if (!part?.id) continue;
					const partId = part.id;
					const isNewPart = !seenPartIds.has(partId);

					// For text and reasoning parts, check for content changes
					if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
						const prevText = lastTextByPartId.get(partId) ?? "";
						const textChanged = part.text !== prevText;

						if (textChanged) {
							lastTextByPartId.set(partId, part.text);

							// Only emit events AFTER initial sync
							if (initialSyncDone) {
								hadChanges = true;
								// Compute delta: if text was appended (not replaced), extract the new portion
								const delta = prevText && part.text.startsWith(prevText) ? part.text.slice(prevText.length) : undefined;

								if (ctx.DEBUG_RTS) {
									ctx.logDebug(`[RTS] OC External: Text part ${partId} updated, delta=${delta?.length ?? "full"}`);
								}

								if (delta) {
									// Lightweight delta event — Flutter appends text incrementally (SDK v1.2.1)
									ctx.enqueueSdkEvent({
										directory: projectPath,
										payload: {
											type: "message.part.delta",
											properties: {
												sessionID: sessionId,
												messageID: msgId,
												partID: partId,
												field: "text",
												delta,
											},
										},
									});
								} else {
									// Full replacement — text was edited, not appended
									ctx.enqueueSdkEvent({
										directory: projectPath,
										payload: {
											type: "message.part.updated",
											properties: {
												part: {
													...part,
													sessionID: sessionId,
													messageID: msgId,
												},
											},
										},
									});
								}
							}
						}
					}

					// For tool parts, check for state changes
					if (part.type === "tool" && part.state) {
						const stateOutput = "output" in part.state ? (part.state as { output?: unknown }).output : undefined;
						const stateKey = `${part.state.status}:${JSON.stringify(stateOutput ?? "")}`;
						const prevState = lastToolStateByPartId.get(partId);
						const stateChanged = stateKey !== prevState;

						if (stateChanged) {
							lastToolStateByPartId.set(partId, stateKey);

							// Only emit events AFTER initial sync
							if (initialSyncDone) {
								hadChanges = true;
								if (ctx.DEBUG_RTS) {
									ctx.logDebug(`[RTS] OC External: Tool part ${partId} state changed to ${part.state.status}`);
								}

								ctx.enqueueSdkEvent({
									directory: projectPath,
									payload: {
										type: "message.part.updated",
										properties: {
											part: {
												...part,
												sessionID: sessionId,
												messageID: msgId,
											},
										},
									},
								});
							}
						}
					}

					// Track new parts
					if (isNewPart) {
						seenPartIds.add(partId);

						// Only emit events AFTER initial sync, and for non-text/reasoning parts (both handled above)
						if (initialSyncDone && part.type !== "text" && part.type !== "reasoning") {
							hadChanges = true;
							ctx.enqueueSdkEvent({
								directory: projectPath,
								payload: {
									type: "message.part.updated",
									properties: {
										part: {
											...part,
											sessionID: sessionId,
											messageID: msgId,
										},
									},
								},
							});
						}
					}
				}
			}

			// Poll for pending permissions
			try {
				const pendingPerms = await ctx.oc.listPendingPermissions(projectPath);
				for (const perm of pendingPerms) {
					const permId =
						typeof perm.id === "string"
							? perm.id
							: typeof (perm as any).requestID === "string"
								? (perm as any).requestID
								: "";
					if (!permId || seenPermissionIds.has(permId)) continue;
					seenPermissionIds.add(permId);
					if (!initialSyncDone) continue;
					hadChanges = true;
					if (ctx.DEBUG_RTS) {
						ctx.logDebug(`[RTS] OC External: New permission request ${permId} in session ${sessionId}`);
					}
					ctx.enqueueSdkEvent({
						directory: projectPath,
						payload: {
							type: "permission.asked",
							properties: {
								...perm,
								sessionID: sessionId,
							},
						},
					});
				}
			} catch {
				// ignore permission poll errors
			}

			// Poll for pending questions
			try {
				const pendingQuestions = await ctx.oc.listPendingQuestions(projectPath);
				for (const q of pendingQuestions) {
					const qId =
						typeof q.id === "string" ? q.id : typeof (q as any).requestID === "string" ? (q as any).requestID : "";
					if (!qId || seenQuestionIds.has(qId)) continue;
					seenQuestionIds.add(qId);
					if (!initialSyncDone) continue;
					hadChanges = true;
					if (ctx.DEBUG_RTS) {
						ctx.logDebug(`[RTS] OC External: New question request ${qId} in session ${sessionId}`);
					}
					ctx.enqueueSdkEvent({
						directory: projectPath,
						payload: {
							type: "question.asked",
							properties: {
								...q,
								sessionID: sessionId,
							},
						},
					});
				}
			} catch {
				// ignore question poll errors
			}

			// Mark initial sync as done after first poll
			if (!initialSyncDone) {
				initialSyncDone = true;
				if (ctx.DEBUG_RTS) {
					ctx.logDebug(
						`[RTS] OC External: Initial sync complete for session ${sessionId}, ${seenMessageIds.size} messages, ${seenPartIds.size} parts, ${seenPermissionIds.size} perms, ${seenQuestionIds.size} questions`,
					);
				}
			}

			// Track when we last had changes for idle detection
			if (hadChanges) {
				idleCount = 0;
				lastChangeTime = Date.now();

				// Mark as busy when we see content changes (since API doesn't report status)
				if (!wasEverBusy || lastEmittedStatus !== "busy") {
					wasEverBusy = true;
					lastEmittedStatus = "busy";
					if (ctx.DEBUG_RTS) {
						ctx.logDebug(`[RTS] OC External: Content changes detected, emitting busy status`);
					}
					ctx.enqueueSdkEvent({
						directory: projectPath,
						payload: {
							type: "session.status",
							properties: {
								sessionID: sessionId,
								status: { type: "busy" },
							},
						},
					});
				}
			}

			// Fallback idle detection: if we had changes before but none for 1.5 seconds, emit idle
			// This is needed because getSessionStatus returns 0 sessions (doesn't track external sessions)
			const timeSinceLastChange = Date.now() - lastChangeTime;
			if (wasEverBusy && lastEmittedStatus === "busy" && timeSinceLastChange > 1500 && !hadChanges) {
				if (ctx.DEBUG_RTS) {
					ctx.logDebug(
						`[RTS] OC External: Fallback idle detection - no changes for ${timeSinceLastChange}ms, emitting idle status`,
					);
				}
				lastEmittedStatus = "idle";
				ctx.enqueueSdkEvent({
					directory: projectPath,
					payload: {
						type: "session.status",
						properties: {
							sessionID: sessionId,
							status: { type: "idle" },
						},
					},
				});
			}
		} catch (err) {
			if (ctx.DEBUG_RTS) {
				ctx.logDebug(`[RTS] OC External: Poll error for session ${sessionId}: ${err}`);
			}
		}
	};

	// Adaptive polling: faster when busy, slower when idle
	const scheduleNextPoll = () => {
		if (stopped) return;
		// 150ms when active, up to 2000ms when idle for 10+ consecutive polls
		const interval = idleCount > 10 ? 2000 : idleCount > 5 ? 1000 : 150;
		pollTimer = setTimeout(() => {
			void poll().then(scheduleNextPoll);
		}, interval);
	};

	// Do initial poll, then start adaptive polling
	void poll().then(scheduleNextPoll);

	if (ctx.DEBUG_RTS) {
		ctx.logDebug(`[RTS] OC External: Started polling for session ${sessionId} in ${projectPath}`);
	}

	return {
		stop: () => {
			stopped = true;
			if (pollTimer) {
				clearTimeout(pollTimer);
				pollTimer = null;
			}
			if (ctx.DEBUG_RTS) {
				ctx.logDebug(`[RTS] OC External: Stopped polling for session ${sessionId}`);
			}
		},
	};
}
