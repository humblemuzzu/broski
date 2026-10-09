import { normalizeCwd } from "../connectors/pi/pi-cwd";
import * as piAbort from "./pi_abort";
import * as piBash from "./pi_bash";
import * as piChat from "./pi_chat";
import * as piCustomMessage from "./pi_custom_message";
import * as piExtensionUiRequests from "./pi_extension_ui_requests";
import * as piLabels from "./pi_labels";
import { type Broadcast, type PiHandlerContext, type Reply, resolveOptionalCwd } from "./pi_message_helpers";
import * as piModels from "./pi_models";
import * as piSessionData from "./pi_session_data";
import * as piSessionLifecycle from "./pi_session_lifecycle";
import * as piSessionMessages from "./pi_session_messages";
import * as piSettings from "./pi_settings";
import { ensureStreamBridge } from "./pi_stream_bridge";
import * as piTools from "./pi_tools";
import * as piTree from "./pi_tree";

export { getPendingExtensionUiRequests } from "./pi_extension_ui_requests";
export { stopAllPiExternalTails, stopPiExternalTail, syncPiExternalTail } from "./pi_external_tail_sync";

export async function handle(message: any, reply: Reply, broadcast: Broadcast): Promise<boolean> {
	if (typeof message?.type !== "string" || !message.type.startsWith("pi_")) {
		return false;
	}

	const optionalCwd = resolveOptionalCwd(message);
	const cwd = optionalCwd ?? normalizeCwd();
	const ctx: PiHandlerContext = { cwd, optionalCwd, reply, broadcast };

	// Delegate to sub-handlers first
	if (await piSessionMessages.handle(message, reply)) return true;
	if (await piTools.handle(message, reply)) return true;
	if (await piAbort.handle(message, reply)) return true;
	if (message.type === "pi_execute_bash") await ensureStreamBridge(cwd, broadcast);
	if (await piBash.handle(message, reply)) return true;
	if (await piLabels.handle(message, reply)) return true;
	if (await piTree.handle(message, reply)) return true;
	if (await piCustomMessage.handle(message, reply)) return true;

	if (await piChat.handle(message, ctx)) return true;
	if (await piModels.handle(message, ctx)) return true;
	if (await piSettings.handle(message, ctx)) return true;
	if (await piSessionLifecycle.handle(message, ctx)) return true;
	if (await piSessionData.handle(message, ctx)) return true;
	if (await piExtensionUiRequests.handle(message, ctx)) return true;

	return false;
}
