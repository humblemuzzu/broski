import type { ServerWebSocket } from "bun";
import { normalizeCwd } from "../connectors/pi/pi-cwd";
import type { PiMessage } from "../routing/messages";
import { registerAll } from "../routing/registry";
import type { MessageRouter, Reply, ServerDeps } from "../routing/types";
import * as piAbort from "./pi_abort";
import * as piBash from "./pi_bash";
import * as piChat from "./pi_chat";
import * as piCustomMessage from "./pi_custom_message";
import * as piExtensionUiRequests from "./pi_extension_ui_requests";
import * as piLabels from "./pi_labels";
import { type PiHandlerContext, resolveOptionalCwd } from "./pi_message_helpers";
import * as piModels from "./pi_models";
import * as piSessionData from "./pi_session_data";
import * as piSessionLifecycle from "./pi_session_lifecycle";
import * as piSessionMessages from "./pi_session_messages";
import * as piSettings from "./pi_settings";
import { ensureStreamBridge } from "./pi_stream_bridge";
import * as piSubagentMessages from "./pi_subagent_messages";
import * as piTools from "./pi_tools";
import * as piTree from "./pi_tree";
import { claimPiView } from "./pi_view_binding";

export { getPendingExtensionUiRequests } from "./pi_extension_ui_requests";
export { stopAllPiExternalTails, stopPiExternalTail, syncPiExternalTail } from "./pi_external_tail_sync";
export { prunePiWatchers } from "./pi_stream_delivery";

const SUBAGENT_OPS = ["pi_get_subagent_invocation"] as const;
const SESSION_MESSAGES = ["pi_read_session_messages"] as const;
const TOOL_OPS = [
	"pi_get_tools",
	"pi_get_active_tools",
	"pi_set_active_tools",
	"pi_get_thinking_capabilities",
	"pi_list_all_models",
	"pi_refresh_models",
	"pi_clear_queue",
	"pi_get_queue",
	"pi_get_last_assistant_text",
] as const;
const ABORT_OPS = ["pi_abort_compaction", "pi_abort_branch_summary", "pi_abort_bash"] as const;
const BASH_OPS = ["pi_execute_bash"] as const;
const LABEL_OPS = ["pi_set_label", "pi_get_label", "pi_get_labels"] as const;
const TREE_OPS = ["pi_get_tree"] as const;
const CUSTOM_MESSAGE_OPS = ["pi_send_custom_message"] as const;
const CHAT_OPS = ["pi_chat", "pi_steer", "pi_follow_up", "pi_abort"] as const;
const MODEL_OPS = [
	"pi_list_models",
	"pi_set_model",
	"pi_set_thinking_level",
	"pi_cycle_thinking_level",
	"pi_cycle_model",
] as const;
const SETTINGS_OPS = [
	"pi_set_steering_mode",
	"pi_set_follow_up_mode",
	"pi_set_auto_retry",
	"pi_abort_retry",
	"pi_set_auto_compaction",
	"pi_get_settings",
	"pi_set_settings",
] as const;
const LIFECYCLE_OPS = [
	"pi_new_session",
	"pi_switch_session",
	"pi_delete_session",
	"pi_set_session_name",
	"pi_fork",
	"pi_get_fork_messages",
	"pi_navigate_tree",
	"pi_compact",
	"pi_export_html",
	"pi_export_jsonl",
	"pi_import_jsonl",
	"pi_dispose_instance",
] as const;
const SESSION_DATA_OPS = [
	"pi_get_state",
	"pi_list_sessions",
	"pi_list_projects",
	"pi_get_session_stats",
	"pi_get_modified_files",
	"pi_get_messages",
	"pi_get_system_prompt",
	"pi_list_commands",
] as const;
const EXTENSION_UI_OPS = ["pi_extension_ui_response"] as const;

export const MODULE_TYPES = [
	...SUBAGENT_OPS,
	...SESSION_MESSAGES,
	...TOOL_OPS,
	...ABORT_OPS,
	...BASH_OPS,
	...LABEL_OPS,
	...TREE_OPS,
	...CUSTOM_MESSAGE_OPS,
	...CHAT_OPS,
	...MODEL_OPS,
	...SETTINGS_OPS,
	...LIFECYCLE_OPS,
	...SESSION_DATA_OPS,
	...EXTENSION_UI_OPS,
] as const;

function piContext(deps: ServerDeps, message: PiMessage, reply: Reply, ws: ServerWebSocket<unknown>): PiHandlerContext {
	const optionalCwd = resolveOptionalCwd(message);
	const cwd = optionalCwd ?? normalizeCwd();
	return {
		cwd,
		optionalCwd,
		reply,
		broadcast: deps.broadcast,
		viewSession: (sessionId) => claimPiView(deps, ws, sessionId, cwd),
	};
}

export function register(router: MessageRouter, deps: ServerDeps): void {
	registerAll(router, SUBAGENT_OPS, async (message, ctx) => {
		await piSubagentMessages.handle(message, ctx.reply);
	});
	registerAll(router, SESSION_MESSAGES, async (message, ctx) => {
		await piSessionMessages.handle(message, ctx.reply);
	});
	registerAll(router, TOOL_OPS, async (message, ctx) => {
		await piTools.handle(message, ctx.reply);
	});
	registerAll(router, ABORT_OPS, async (message, ctx) => {
		await piAbort.handle(message, ctx.reply);
	});
	registerAll(router, BASH_OPS, async (message, ctx) => {
		const piCtx = piContext(deps, message, ctx.reply, ctx.ws);
		await ensureStreamBridge(piCtx.cwd, deps.broadcast);
		await piBash.handle(message, ctx.reply);
	});
	registerAll(router, LABEL_OPS, async (message, ctx) => {
		await piLabels.handle(message, ctx.reply);
	});
	registerAll(router, TREE_OPS, async (message, ctx) => {
		await piTree.handle(message, ctx.reply);
	});
	registerAll(router, CUSTOM_MESSAGE_OPS, async (message, ctx) => {
		await piCustomMessage.handle(message, ctx.reply);
	});

	registerAll(router, CHAT_OPS, async (message, ctx) => {
		await piChat.handle(message, piContext(deps, message, ctx.reply, ctx.ws));
	});
	registerAll(router, MODEL_OPS, async (message, ctx) => {
		await piModels.handle(message, piContext(deps, message, ctx.reply, ctx.ws));
	});
	registerAll(router, SETTINGS_OPS, async (message, ctx) => {
		await piSettings.handle(message, piContext(deps, message, ctx.reply, ctx.ws));
	});
	registerAll(router, LIFECYCLE_OPS, async (message, ctx) => {
		await piSessionLifecycle.handle(message, piContext(deps, message, ctx.reply, ctx.ws));
	});
	registerAll(router, SESSION_DATA_OPS, async (message, ctx) => {
		await piSessionData.handle(message, piContext(deps, message, ctx.reply, ctx.ws));
	});
	registerAll(router, EXTENSION_UI_OPS, async (message, ctx) => {
		await piExtensionUiRequests.handle(message, piContext(deps, message, ctx.reply, ctx.ws));
	});
}
