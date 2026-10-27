import type { Model } from "@earendil-works/pi-ai/compat";
import * as pi from "../connectors/pi";
import type { Msg, PiMessage } from "../routing/messages";
import { type PiHandlerContext, parseThinkingLevel } from "./pi_message_helpers";
import { broadcastPiSessionDelta, ensureStreamBridge, removeStreamBridge } from "./pi_stream_bridge";

async function handleNewSession(message: Msg<"pi_new_session">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);

	// Collect desired overrides before creating the session
	const desiredName = typeof message.name === "string" && message.name.trim() ? message.name.trim() : undefined;
	let desiredModel: Model<any> | undefined;
	if (typeof message.provider === "string" && typeof message.modelId === "string") {
		desiredModel = await pi.findModel(message.provider, message.modelId);
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

	await ensureStreamBridge(ctx.cwd, ctx.broadcast);
	ctx.viewSession(instance.session.sessionId);
	ctx.reply({ type: "pi_session_created", data: !result.cancelled, requestId: message.requestId });
	void broadcastPiSessionDelta(ctx.broadcast, ctx.cwd, instance.session.sessionId);
}

async function handleSwitchSession(message: Msg<"pi_switch_session">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const result = await pi.switchToSession(instance, String(message.sessionPath ?? ""));
	ctx.viewSession(instance.session.sessionId);
	ctx.reply({ type: "pi_session_switched", data: !result.cancelled, requestId: message.requestId });
	void broadcastPiSessionDelta(ctx.broadcast, ctx.cwd, instance.session.sessionId);
}

async function handleDeleteSession(message: Msg<"pi_delete_session">, ctx: PiHandlerContext): Promise<void> {
	const sessionPath = String(message.sessionPath ?? "");
	const sessionId = (await pi.listSessions(ctx.optionalCwd)).find((session) => session.path === sessionPath)?.id;
	const deleted = await pi.deleteSession(sessionPath);
	ctx.reply({ type: "pi_session_deleted", data: deleted, requestId: message.requestId });
	if (deleted && sessionId) ctx.broadcast({ type: "runtime_session_removed", backend: "pi", sessionId });
}

async function handleSetSessionName(message: Msg<"pi_set_session_name">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	instance.session.setSessionName(String(message.name ?? "").trim());
	ctx.reply({ type: "pi_session_name_set", data: true, requestId: message.requestId });
}

async function handleFork(message: Msg<"pi_fork">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const result = await pi.forkSession(instance, String(message.entryId ?? ""));
	ctx.reply({
		type: "pi_fork_result",
		data: { text: result.selectedText, cancelled: result.cancelled },
		requestId: message.requestId,
	});
}

async function handleGetForkMessages(message: Msg<"pi_get_fork_messages">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	ctx.reply({
		type: "pi_fork_messages",
		data: pi.mapForkMessages(instance),
		requestId: message.requestId,
	});
}

async function handleNavigateTree(message: Msg<"pi_navigate_tree">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const result = await instance.session.navigateTree(String(message.targetId ?? ""), {
		summarize: message.summarize === true,
		customInstructions: typeof message.customInstructions === "string" ? message.customInstructions : undefined,
		replaceInstructions: message.replaceInstructions === true,
		label: typeof message.label === "string" ? message.label : undefined,
	});
	ctx.reply({
		type: "pi_tree_navigated",
		data: {
			...(typeof result.editorText === "string" ? { editorText: result.editorText } : {}),
			cancelled: result.cancelled,
			...(result.aborted ? { aborted: true } : {}),
		},
		requestId: message.requestId,
	});
}

async function handleCompact(message: Msg<"pi_compact">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const result = await instance.session.compact(
		typeof message.customInstructions === "string" ? message.customInstructions : undefined,
	);
	ctx.reply({ type: "pi_compacted", data: result, requestId: message.requestId });
}

async function handleExportHtml(message: Msg<"pi_export_html">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const outputPath = await instance.session.exportToHtml(
		typeof message.outputPath === "string" ? message.outputPath : undefined,
	);
	ctx.reply({ type: "pi_export_result", data: { path: outputPath, format: "html" }, requestId: message.requestId });
}

async function handleExportJsonl(message: Msg<"pi_export_jsonl">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const outputPath = instance.session.exportToJsonl(
		typeof message.outputPath === "string" ? message.outputPath : undefined,
	);
	ctx.reply({ type: "pi_export_result", data: { path: outputPath, format: "jsonl" }, requestId: message.requestId });
}

async function handleImportJsonl(message: Msg<"pi_import_jsonl">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const inputPath = String(message.inputPath ?? "");
	if (!inputPath) {
		throw new Error("No inputPath provided for JSONL import");
	}
	const result = await pi.importFromJsonl(instance, inputPath);
	ctx.reply({ type: "pi_jsonl_imported", data: { success: !result.cancelled }, requestId: message.requestId });
}

async function handleDisposeInstance(message: Msg<"pi_dispose_instance">, ctx: PiHandlerContext): Promise<void> {
	removeStreamBridge(ctx.cwd);
	pi.disposeInstance(ctx.cwd);
	ctx.reply({ type: "pi_instance_disposed", data: true, requestId: message.requestId });
}

export async function handle(message: PiMessage, ctx: PiHandlerContext): Promise<boolean> {
	switch (message.type) {
		case "pi_new_session":
			await handleNewSession(message, ctx);
			return true;
		case "pi_switch_session":
			await handleSwitchSession(message, ctx);
			return true;
		case "pi_delete_session":
			await handleDeleteSession(message, ctx);
			return true;
		case "pi_set_session_name":
			await handleSetSessionName(message, ctx);
			return true;
		case "pi_fork":
			await handleFork(message, ctx);
			return true;
		case "pi_get_fork_messages":
			await handleGetForkMessages(message, ctx);
			return true;
		case "pi_navigate_tree":
			await handleNavigateTree(message, ctx);
			return true;
		case "pi_compact":
			await handleCompact(message, ctx);
			return true;
		case "pi_export_html":
			await handleExportHtml(message, ctx);
			return true;
		case "pi_export_jsonl":
			await handleExportJsonl(message, ctx);
			return true;
		case "pi_import_jsonl":
			await handleImportJsonl(message, ctx);
			return true;
		case "pi_dispose_instance":
			await handleDisposeInstance(message, ctx);
			return true;
		default:
			return false;
	}
}
