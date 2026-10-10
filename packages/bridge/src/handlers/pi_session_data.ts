import * as pi from "../connectors/pi";
import type { Msg, PiMessage } from "../routing/messages";
import type { PiHandlerContext } from "./pi_message_helpers";
import { emitPiRuntimeState, ensureStreamBridge } from "./pi_stream_bridge";

async function handleGetState(message: Msg<"pi_get_state">, ctx: PiHandlerContext): Promise<void> {
	await ensureStreamBridge(ctx.cwd, ctx.broadcast);
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const state = pi.mapStatePayload(instance);
	ctx.reply({ type: "pi_state", data: state, requestId: message.requestId });
	emitPiRuntimeState(ctx.reply, ctx.cwd, state);
}

async function handleListSessions(message: Msg<"pi_list_sessions">, ctx: PiHandlerContext): Promise<void> {
	// Ensure stream bridges exist for all bridge-owned Pi instances.
	// Force re-registration to pick up fresh broadcast function after reconnect.
	for (const { cwd: existingCwd } of pi.listActiveRuntimeStates()) {
		await ensureStreamBridge(existingCwd, ctx.broadcast, true);
	}
	const sessions = await pi.listSessions(ctx.optionalCwd);
	ctx.reply({ type: "pi_sessions", data: sessions, requestId: message.requestId });
	// NOTE: Do NOT broadcast runtime_sessions here. Flutter's runtimeSessions
	// stream would pick it up, triggering a piSessionsProvider invalidation,
	// which fires another pi_list_sessions — creating an infinite polling loop.
	// Real-time updates are handled by broadcastPiRuntimeSessions() on actual
	// state changes (agent-end, new session, etc.).
}

async function handleListProjects(message: Msg<"pi_list_projects">, ctx: PiHandlerContext): Promise<void> {
	const projects = await pi.listProjects();
	ctx.reply({ type: "pi_projects", data: projects, requestId: message.requestId });
}

async function handleGetSessionStats(message: Msg<"pi_get_session_stats">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const stats = instance.session.getSessionStats();
	const contextUsage = instance.session.getContextUsage();
	ctx.reply({
		type: "pi_session_stats",
		data: {
			...stats,
			contextUsage: contextUsage ?? null,
		},
		requestId: message.requestId,
	});
}

async function handleGetModifiedFiles(message: Msg<"pi_get_modified_files">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	const sessionPath = instance.session.sessionFile;
	let files: Array<{ file: string; additions: number; deletions: number }> = [];
	if (sessionPath) {
		const { getPiModifiedFiles } = await import("../connectors/pi/pi-session-stats");
		files = await getPiModifiedFiles(sessionPath);
	}
	ctx.reply({
		type: "pi_modified_files",
		data: files,
		requestId: message.requestId,
	});
}

async function handleGetMessages(message: Msg<"pi_get_messages">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	ctx.reply({
		type: "pi_messages",
		data: pi.mapAgentMessages(instance.session.messages),
		requestId: message.requestId,
	});
}

async function handleGetSystemPrompt(message: Msg<"pi_get_system_prompt">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	ctx.reply({
		type: "pi_system_prompt",
		data: { systemPrompt: instance.session.systemPrompt },
		requestId: message.requestId,
	});
}

async function handleListCommands(message: Msg<"pi_list_commands">, ctx: PiHandlerContext): Promise<void> {
	const instance = await pi.getOrCreateInstance(ctx.cwd);
	ctx.reply({ type: "pi_commands", data: pi.listCommands(instance), requestId: message.requestId });
}

export async function handle(message: PiMessage, ctx: PiHandlerContext): Promise<boolean> {
	switch (message.type) {
		case "pi_get_state": {
			await handleGetState(message, ctx);
			return true;
		}

		case "pi_list_sessions": {
			await handleListSessions(message, ctx);
			return true;
		}

		case "pi_list_projects": {
			await handleListProjects(message, ctx);
			return true;
		}

		case "pi_get_session_stats": {
			await handleGetSessionStats(message, ctx);
			return true;
		}

		case "pi_get_modified_files": {
			await handleGetModifiedFiles(message, ctx);
			return true;
		}

		case "pi_get_messages": {
			await handleGetMessages(message, ctx);
			return true;
		}

		case "pi_get_system_prompt": {
			await handleGetSystemPrompt(message, ctx);
			return true;
		}

		case "pi_list_commands": {
			await handleListCommands(message, ctx);
			return true;
		}

		default:
			return false;
	}
}
