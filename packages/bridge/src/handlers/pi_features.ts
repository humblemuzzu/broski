import { resolve } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import * as pi from "../connectors/pi";
import { mapPiStreamToRuntimeEvent } from "../runtime/pi-runtime-event-mapper";
import {
	mapPiModelToSummary,
	mapPiSessionsToRuntimeSessions,
	mapPiStateToRuntimeState,
} from "../runtime/pi-runtime-read-models";
import type { FileAttachment, ServerMessage } from "../types";
import type { PiModelPayload, PiStatePayload, PiStreamMessage } from "../types/pi";
import * as piAbort from "./pi_abort";
import * as piBash from "./pi_bash";
import * as piCustomMessage from "./pi_custom_message";
import * as piLabels from "./pi_labels";
import * as piTools from "./pi_tools";
import * as piTree from "./pi_tree";
import * as piSessionMessages from "./pi_session_messages";
import { sendPiRuntimeEvent } from "./pi_stream_delivery";
import { recordRuntimeEvent } from "../utils/runtime-replay-buffer";
import { startPiExternalTail, type PiExternalTailContext } from "../connectors/pi/pi-external-tail";

type Reply = (message: ServerMessage) => void;

type Broadcast = (message: ServerMessage) => void;

const streamUnsubscribers = new Map<string, () => void>();
const externalTails = new Map<string, { stop: () => void }>();

const normalizeCwd = (cwd?: string): string => resolve((cwd || "").trim() || process.cwd());

const resolveOptionalCwd = (message: any): string | undefined => {
	const projectPath = typeof message?.projectPath === "string" ? message.projectPath : undefined;
	if (projectPath && projectPath.trim().length > 0) {
		return normalizeCwd(projectPath);
	}

	const cwd = typeof message?.cwd === "string" ? message.cwd : undefined;
	if (cwd && cwd.trim().length > 0) {
		return normalizeCwd(cwd);
	}

	return undefined;
};

const _resolveCwd = (message: any): string => resolveOptionalCwd(message) ?? normalizeCwd();

const parseThinkingLevel = (value: unknown): ThinkingLevel => {
	const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
	switch (normalized) {
		case "off":
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
			return normalized;
		default:
			throw new Error(`Invalid Pi thinking level: ${String(value)}`);
	}
};

const extractImages = (attachments: FileAttachment[] | undefined) => {
	if (!attachments || attachments.length === 0) return undefined;

	const images = attachments
		.filter((attachment) => attachment.mimeType?.startsWith("image/") && attachment.base64Data)
		.map((attachment) => ({
			type: "image" as const,
			data: attachment.base64Data!,
			mimeType: attachment.mimeType!,
		}));

	return images.length > 0 ? images : undefined;
};

const extractTaggedPaths = (attachments: FileAttachment[] | undefined): string[] => {
	if (!attachments || attachments.length === 0) return [];

	return attachments
		.filter((attachment) => !attachment.base64Data && typeof attachment.path === "string")
		.map((attachment) => attachment.path.trim())
		.filter((path) => path.length > 0);
};

const composePromptWithTaggedPaths = (prompt: string, taggedPaths: string[]): string => {
	if (taggedPaths.length === 0) return prompt;

	const tags = taggedPaths.map((path) => `@${path}`).join("\n");
	if (prompt.includes(tags)) return prompt;

	return `${prompt}\n\nReferenced project paths:\n${tags}`;
};

const parseQueueMode = (value: unknown): "all" | "one-at-a-time" => {
	if (value === "all" || value === "one-at-a-time") {
		return value;
	}
	throw new Error(`Invalid Pi queue mode: ${String(value)}`);
};

function broadcastPiStreamMessage(
	broadcast: Broadcast,
	cwd: string,
	sessionId: string,
	streamMessage: PiStreamMessage,
): void {
	const runtimeEvent = mapPiStreamToRuntimeEvent(streamMessage, {
		backend: "pi",
		sessionId,
		cwd,
	});
	if (!runtimeEvent) return;

	const payload: ServerMessage = {
		type: "runtime_event",
		backend: "pi",
		data: runtimeEvent,
	};
	recordRuntimeEvent(payload);
	console.log(`[Pi RTS DEBUG] Broadcasting pi runtime_event: type=${runtimeEvent.type}, sessionId=${sessionId}, seq=${(runtimeEvent as any).seq}`);
	broadcast(payload);
}

function emitPiRuntimeState(reply: Reply, cwd: string, state: PiStatePayload): void {
	reply({
		type: "runtime_state",
		backend: "pi",
		data: {
			...mapPiStateToRuntimeState(state),
			cwd,
		},
	});
}

function emitPiRuntimeModels(reply: Reply, models: PiModelPayload[]): void {
	reply({
		type: "runtime_models",
		backend: "pi",
		data: models.map(mapPiModelToSummary),
	});
}

async function broadcastPiRuntimeSessions(broadcast: Broadcast): Promise<void> {
	try {
		const sessions = await pi.listSessions(undefined);
		const summaries = mapPiSessionsToRuntimeSessions(sessions, pi.listActiveRuntimeStates());
		broadcast({
			type: "runtime_sessions",
			backend: "pi",
			data: summaries,
		});
	} catch {
		// Non-critical — don't crash on broadcast failures
	}
}

async function ensureStreamBridge(cwd: string, broadcast: Broadcast, force = false): Promise<void> {
	if (streamUnsubscribers.has(cwd) && !force) return;
	// If forcing, remove the stale bridge first
	if (force && streamUnsubscribers.has(cwd)) {
		const oldUnsub = streamUnsubscribers.get(cwd)!;
		streamUnsubscribers.delete(cwd);
		oldUnsub();
	}

	// Create/get the instance to register with, but use dynamic lookup in the
	// event callback so session switches are reflected immediately.
	await pi.getOrCreateInstance(cwd);
	console.log(`[Pi RTS DEBUG] ensureStreamBridge: setting up event listener for cwd=${cwd}`);
	const unsubscribe = await pi.addEventListener(cwd, (event) => {
		const streamMessage = pi.translateEvent(event);
		if (!streamMessage) return;

		// Re-resolve the live instance on every event rather than using a captured
		// reference, so session switches are reflected immediately.
		const liveInstance = pi.getInstance(cwd);
		if (!liveInstance) return;

		broadcastPiStreamMessage(broadcast, cwd, liveInstance.session.sessionId, streamMessage);

		// Keep runtime_state authoritative. On start/end/error we publish a fresh
		// snapshot so the client never gets stuck in streaming state.
		if (streamMessage.type === "agent-end" || streamMessage.type === "agent-start" || streamMessage.type === "error") {
			const state = pi.mapStatePayload(liveInstance);
			broadcast({
				type: "runtime_state",
				backend: "pi",
				data: {
					...mapPiStateToRuntimeState(state),
					cwd,
				},
			});
			void broadcastPiRuntimeSessions(broadcast);
		}
	});

	streamUnsubscribers.set(cwd, unsubscribe);
}

function removeStreamBridge(cwd: string): void {
	const key = normalizeCwd(cwd);
	const unsubscribe = streamUnsubscribers.get(key);
	if (!unsubscribe) return;

	streamUnsubscribers.delete(key);
	unsubscribe();
}

/**
 * Start an external tail for a Pi session running in the terminal.
 * The tail watches the JSONL file and emits runtime events as new
 * messages appear, so the phone sees conversation updates live.
 *
 * Only starts if the session is NOT owned by the bridge (i.e. running
 * externally in pi CLI/TUI). If the bridge owns it, we already get
 * events via session.subscribe().
 */
export async function syncPiExternalTail(
	sessionId: string,
	broadcast: Broadcast,
	debugRts: boolean,
	logDebug: (msg: string) => void,
): Promise<void> {
	// Already tailing this session
	if (externalTails.has(sessionId)) {
		console.log(`[Pi tail] Already tailing session ${sessionId}`);
		return;
	}

	// Only skip the external tail if the bridge is ACTIVELY streaming for
	// this session. Having a bridge instance alone isn't enough — after a
	// bridge restart pi_get_state creates an idle instance that never
	// generates events, but isSessionOwnedByBridge would still return true,
	// causing the external tail to be skipped and leaving the app with zero
	// event delivery.
	if (pi.isSessionActivelyStreaming(sessionId)) {
		console.log(`[Pi tail] Session ${sessionId} is actively streaming via bridge, skipping external tail`);
		return;
	}

	const filePath = await pi.resolveSessionFilePath(sessionId);
	if (!filePath) {
		console.log(`[Pi tail] Cannot resolve file for session ${sessionId}`);
		return;
	}

	console.log(`[Pi tail] Starting external tail for ${sessionId} → ${filePath}`);

	const tail = startPiExternalTail(filePath, {
		emitPiStream: (streamMsg) => {
			broadcastPiStreamMessage(broadcast, "", sessionId, streamMsg);
		},
		logDebug,
		DEBUG_RTS: debugRts,
	});

	externalTails.set(sessionId, tail);
}

/** Stop an external tail for a Pi session. */
export function stopPiExternalTail(sessionId: string): void {
	const tail = externalTails.get(sessionId);
	if (!tail) return;
	tail.stop();
	externalTails.delete(sessionId);
}

/** Stop all active external tails. */
export function stopAllPiExternalTails(): void {
	for (const [id, tail] of externalTails) {
		tail.stop();
	}
	externalTails.clear();
}

/**
 * Get pending extension UI requests for a Pi instance at the given cwd.
 * Used by session_view to replay pending dialogs on reconnect.
 */
export function getPendingExtensionUiRequests(cwd: string): import("../types/pi").PiStreamMessage[] {
	const instance = pi.getInstance(cwd);
	if (!instance) return [];
	return instance.extensionUiBridge.getPendingRequests();
}

export async function handle(message: any, reply: Reply, broadcast: Broadcast): Promise<boolean> {
	if (typeof message?.type !== "string" || !message.type.startsWith("pi_")) {
		return false;
	}

	const optionalCwd = resolveOptionalCwd(message);
	const cwd = optionalCwd ?? normalizeCwd();

	// Delegate to sub-handlers first
	if (await piSessionMessages.handle(message, reply)) return true;
	if (await piTools.handle(message, reply)) return true;
	if (await piAbort.handle(message, reply)) return true;
	if (await piBash.handle(message, reply, broadcast)) return true;
	if (await piLabels.handle(message, reply)) return true;
	if (await piTree.handle(message, reply)) return true;
	if (await piCustomMessage.handle(message, reply)) return true;

	switch (message.type) {
		case "pi_chat": {
			await ensureStreamBridge(cwd, broadcast);
			// Also ensure any other active Pi sessions have stream bridges
			for (const { cwd: existingCwd } of pi.listActiveRuntimeStates()) {
				if (existingCwd !== cwd) {
					await ensureStreamBridge(existingCwd, broadcast, true);
				}
			}
			const instance = await pi.getOrCreateInstance(cwd);
			const basePrompt = typeof message.prompt === "string" ? message.prompt : "";
			const attachments = message.fileAttachments as FileAttachment[] | undefined;
			const prompt = composePromptWithTaggedPaths(basePrompt, extractTaggedPaths(attachments));
			const streamingBehavior =
				message.streamingBehavior === "steer" || message.streamingBehavior === "followUp"
					? message.streamingBehavior
					: undefined;

			void instance.session
				.prompt(prompt, {
					images: extractImages(attachments),
					streamingBehavior,
					source: "rpc",
				})
				.catch((error) => {
					broadcastPiStreamMessage(broadcast, cwd, instance.session.sessionId, {
						type: "error",
						message: error instanceof Error ? error.message : String(error),
					});
					const state = pi.mapStatePayload(instance);
					broadcast({
						type: "runtime_state",
						backend: "pi",
						data: {
							...mapPiStateToRuntimeState(state),
							cwd,
						},
					});
				});

			reply({ type: "pi_chat_started", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_steer": {
			await ensureStreamBridge(cwd, broadcast);
			const instance = await pi.getOrCreateInstance(cwd);
			const basePrompt = typeof message.message === "string" ? message.message : "";
			const attachments = message.fileAttachments as FileAttachment[] | undefined;
			const prompt = composePromptWithTaggedPaths(basePrompt, extractTaggedPaths(attachments));
			await instance.session.steer(prompt, extractImages(attachments));
			reply({ type: "pi_steered", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_follow_up": {
			await ensureStreamBridge(cwd, broadcast);
			const instance = await pi.getOrCreateInstance(cwd);
			const basePrompt = typeof message.message === "string" ? message.message : "";
			const attachments = message.fileAttachments as FileAttachment[] | undefined;
			const prompt = composePromptWithTaggedPaths(basePrompt, extractTaggedPaths(attachments));
			await instance.session.followUp(prompt, extractImages(attachments));
			reply({ type: "pi_followed_up", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_abort": {
			const instance = await pi.getOrCreateInstance(cwd);
			await instance.session.abort();
			reply({ type: "pi_aborted", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_set_steering_mode": {
			const instance = await pi.getOrCreateInstance(cwd);
			const mode = parseQueueMode(message.mode);
			instance.session.setSteeringMode(mode);
			reply({
				type: "pi_steering_mode_set",
				data: { mode: instance.session.steeringMode },
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_set_follow_up_mode": {
			const instance = await pi.getOrCreateInstance(cwd);
			const mode = parseQueueMode(message.mode);
			instance.session.setFollowUpMode(mode);
			reply({
				type: "pi_follow_up_mode_set",
				data: { mode: instance.session.followUpMode },
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_set_auto_retry": {
			const instance = await pi.getOrCreateInstance(cwd);
			instance.session.setAutoRetryEnabled(message.enabled === true);
			reply({ type: "pi_auto_retry_set", data: instance.session.autoRetryEnabled, requestId: message.requestId });
			return true;
		}

		case "pi_abort_retry": {
			const instance = await pi.getOrCreateInstance(cwd);
			instance.session.abortRetry();
			reply({ type: "pi_retry_aborted", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_get_state": {
			await ensureStreamBridge(cwd, broadcast);
			const instance = await pi.getOrCreateInstance(cwd);
			const state = pi.mapStatePayload(instance);
			reply({ type: "pi_state", data: state, requestId: message.requestId });
			emitPiRuntimeState(reply, cwd, state);
			return true;
		}

		case "pi_list_models": {
			const models = pi.listAvailableModels();
			reply({ type: "pi_models", data: models, requestId: message.requestId });
			// Use broadcast (not reply) for runtime_models so the message doesn't
			// carry the request-specific requestId, which would pollute the Flutter
			// bridge service's early-response cache with unhandled messages.
			emitPiRuntimeModels(broadcast, models);
			return true;
		}

		case "pi_set_model": {
			const model = pi.getModelRegistry().find(String(message.provider ?? ""), String(message.modelId ?? ""));
			if (!model) {
				throw new Error(`Pi model not found: ${String(message.provider ?? "")}/${String(message.modelId ?? "")}`);
			}

			const instance = await pi.getOrCreateInstance(cwd);
			await instance.session.setModel(model);
			reply({ type: "pi_model_set", data: pi.mapModel(model), requestId: message.requestId });
			return true;
		}

		case "pi_set_thinking_level": {
			const instance = await pi.getOrCreateInstance(cwd);
			const level = parseThinkingLevel(message.level);
			instance.session.setThinkingLevel(level);
			reply({
				type: "pi_thinking_level",
				data: { level: instance.session.thinkingLevel },
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_cycle_thinking_level": {
			const instance = await pi.getOrCreateInstance(cwd);
			const level = instance.session.cycleThinkingLevel();
			reply({
				type: "pi_thinking_level",
				data: { level: level ?? instance.session.thinkingLevel },
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_cycle_model": {
			const instance = await pi.getOrCreateInstance(cwd);
			const direction = message.direction === "backward" ? "backward" : "forward";
			const result = await instance.session.cycleModel(direction);
			reply({
				type: "pi_model_set",
				data: result?.model ? pi.mapModel(result.model) : null,
				isScoped: result?.isScoped ?? false,
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_list_sessions": {
			// Ensure stream bridges exist for all bridge-owned Pi instances.
			// Force re-registration to pick up fresh broadcast function after reconnect.
			for (const { cwd: existingCwd } of pi.listActiveRuntimeStates()) {
				await ensureStreamBridge(existingCwd, broadcast, true);
			}
			const sessions = await pi.listSessions(optionalCwd);
			reply({ type: "pi_sessions", data: sessions, requestId: message.requestId });
			// NOTE: Do NOT call emitPiRuntimeSessions(reply, sessions) here.
			// That sends runtime_sessions via reply, which Flutter's runtimeSessions
			// stream picks up, triggering a piSessionsProvider invalidation, which
			// fires another pi_list_sessions — creating an infinite polling loop.
			// Real-time updates are handled by broadcastPiRuntimeSessions() on
			// actual state changes (agent-end, new session, etc.).
			return true;
		}

		case "pi_list_projects": {
			const projects = await pi.listProjects();
			reply({ type: "pi_projects", data: projects, requestId: message.requestId });
			return true;
		}

		case "pi_new_session": {
			const instance = await pi.getOrCreateInstance(cwd);

			// Collect desired overrides before creating the session
			const desiredName = typeof message.name === "string" && message.name.trim() ? message.name.trim() : undefined;
			let desiredModel: Model<any> | undefined;
			if (typeof message.provider === "string" && typeof message.modelId === "string") {
				desiredModel = pi.getModelRegistry().find(message.provider, message.modelId);
			}
			const desiredThinkingLevel =
				typeof message.thinkingLevel === "string" ? parseThinkingLevel(message.thinkingLevel) : undefined;

			const result = await pi.createNewSession(instance);

			if (!result.cancelled) {
				try {
					if (desiredModel) await instance.session.setModel(desiredModel);
					if (desiredThinkingLevel) instance.session.setThinkingLevel(desiredThinkingLevel);
					if (desiredName) instance.session.setSessionName(desiredName);
				} catch {
					// Overrides failed (e.g. no API key for model) — session was created with defaults
				}
			}

			await ensureStreamBridge(cwd, broadcast);
			reply({ type: "pi_session_created", data: !result.cancelled, requestId: message.requestId });
			void broadcastPiRuntimeSessions(broadcast);
			return true;
		}

		case "pi_switch_session": {
			const instance = await pi.getOrCreateInstance(cwd);
			const result = await pi.switchToSession(instance, String(message.sessionPath ?? ""));
			reply({ type: "pi_session_switched", data: !result.cancelled, requestId: message.requestId });
			void broadcastPiRuntimeSessions(broadcast);
			return true;
		}

		case "pi_delete_session": {
			const deleted = await pi.deleteSession(String(message.sessionPath ?? ""));
			reply({ type: "pi_session_deleted", data: deleted, requestId: message.requestId });
			void broadcastPiRuntimeSessions(broadcast);
			return true;
		}

		case "pi_get_session_stats": {
			const instance = await pi.getOrCreateInstance(cwd);
			const stats = instance.session.getSessionStats();
			const contextUsage = instance.session.getContextUsage();
			reply({
				type: "pi_session_stats",
				data: {
					...stats,
					contextUsage: contextUsage ?? null,
				},
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_get_modified_files": {
			const instance = await pi.getOrCreateInstance(cwd);
			const sessionPath = instance.session.sessionFile;
			let files: Array<{ file: string; additions: number; deletions: number }> = [];
			if (sessionPath) {
				const { getPiModifiedFiles } = await import("../connectors/pi/pi-session-stats");
				files = await getPiModifiedFiles(sessionPath);
			}
			reply({
				type: "pi_modified_files",
				data: files,
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_get_messages": {
			const instance = await pi.getOrCreateInstance(cwd);
			reply({
				type: "pi_messages",
				data: instance.session.messages.map(pi.mapAgentMessage),
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_set_session_name": {
			const instance = await pi.getOrCreateInstance(cwd);
			instance.session.setSessionName(String(message.name ?? "").trim());
			reply({ type: "pi_session_name_set", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_fork": {
			const instance = await pi.getOrCreateInstance(cwd);
			const result = await pi.forkSession(instance, String(message.entryId ?? ""));
			reply({
				type: "pi_fork_result",
				data: { text: result.selectedText, cancelled: result.cancelled },
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_get_fork_messages": {
			const instance = await pi.getOrCreateInstance(cwd);
			reply({
				type: "pi_fork_messages",
				data: pi.mapForkMessages(instance),
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_navigate_tree": {
			const instance = await pi.getOrCreateInstance(cwd);
			const result = await instance.session.navigateTree(String(message.targetId ?? ""), {
				summarize: message.summarize === true,
				customInstructions: typeof message.customInstructions === "string" ? message.customInstructions : undefined,
				replaceInstructions: message.replaceInstructions === true,
				label: typeof message.label === "string" ? message.label : undefined,
			});
			reply({
				type: "pi_tree_navigated",
				data: {
					...(typeof result.editorText === "string" ? { editorText: result.editorText } : {}),
					cancelled: result.cancelled,
					...(result.aborted ? { aborted: true } : {}),
				},
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_list_commands": {
			const instance = await pi.getOrCreateInstance(cwd);
			reply({ type: "pi_commands", data: pi.listCommands(instance), requestId: message.requestId });
			return true;
		}

		case "pi_compact": {
			const instance = await pi.getOrCreateInstance(cwd);
			const result = await instance.session.compact(
				typeof message.customInstructions === "string" ? message.customInstructions : undefined,
			);
			reply({ type: "pi_compacted", data: result, requestId: message.requestId });
			return true;
		}

		case "pi_set_auto_compaction": {
			const instance = await pi.getOrCreateInstance(cwd);
			instance.session.setAutoCompactionEnabled(message.enabled === true);
			reply({
				type: "pi_auto_compaction_set",
				data: instance.session.autoCompactionEnabled,
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_export_html": {
			const instance = await pi.getOrCreateInstance(cwd);
			const outputPath = await instance.session.exportToHtml(
				typeof message.outputPath === "string" ? message.outputPath : undefined,
			);
			reply({ type: "pi_export_result", data: { path: outputPath, format: "html" }, requestId: message.requestId });
			return true;
		}

		case "pi_export_jsonl": {
			const instance = await pi.getOrCreateInstance(cwd);
			const outputPath = instance.session.exportToJsonl(
				typeof message.outputPath === "string" ? message.outputPath : undefined,
			);
			reply({ type: "pi_export_result", data: { path: outputPath, format: "jsonl" }, requestId: message.requestId });
			return true;
		}

		case "pi_import_jsonl": {
			const instance = await pi.getOrCreateInstance(cwd);
			const inputPath = String(message.inputPath ?? "");
			if (!inputPath) {
				throw new Error("No inputPath provided for JSONL import");
			}
			const result = await pi.importFromJsonl(instance, inputPath);
			reply({ type: "pi_jsonl_imported", data: { success: !result.cancelled }, requestId: message.requestId });
			return true;
		}

		case "pi_get_system_prompt": {
			const instance = await pi.getOrCreateInstance(cwd);
			reply({
				type: "pi_system_prompt",
				data: { systemPrompt: instance.session.systemPrompt },
				requestId: message.requestId,
			});
			return true;
		}

		case "pi_get_settings": {
			const instance = await pi.getOrCreateInstance(cwd);
			reply({ type: "pi_settings", data: pi.getSettings(instance), requestId: message.requestId });
			return true;
		}

		case "pi_set_settings": {
			const instance = await pi.getOrCreateInstance(cwd);
			await pi.applySettings(
				instance,
				(message.settings && typeof message.settings === "object" ? message.settings : {}) as Record<string, unknown>,
			);
			reply({ type: "pi_settings_updated", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_dispose_instance": {
			removeStreamBridge(cwd);
			pi.disposeInstance(cwd);
			reply({ type: "pi_instance_disposed", data: true, requestId: message.requestId });
			return true;
		}

		case "pi_extension_ui_response": {
			const handled = pi.respondToExtensionUi(cwd, {
				id: String(message.id ?? ""),
				...(Object.hasOwn(message, "value") ? { value: message.value } : {}),
				...(Object.hasOwn(message, "confirmed") ? { confirmed: message.confirmed === true } : {}),
				...(message.cancelled === true ? { cancelled: true } : {}),
			});

			reply({ type: "pi_extension_ui_responded", data: handled, requestId: message.requestId });
			return true;
		}

		default:
			return false;
	}
}
