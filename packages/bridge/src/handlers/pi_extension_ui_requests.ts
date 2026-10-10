import * as pi from "../connectors/pi";
import type { PiMessage } from "../routing/messages";
import type { PiStreamMessage } from "../types/pi";
import type { PiHandlerContext } from "./pi_message_helpers";

/**
 * Get pending extension UI requests for a Pi instance at the given cwd.
 * Used by session_view to replay pending dialogs on reconnect.
 */
export function getPendingExtensionUiRequests(cwd: string): PiStreamMessage[] {
	const instance = pi.getInstance(cwd);
	if (!instance) return [];
	return instance.extensionUiBridge.getPendingRequests();
}

export async function handle(message: PiMessage, ctx: PiHandlerContext): Promise<boolean> {
	switch (message.type) {
		case "pi_extension_ui_response": {
			const handled = pi.respondToExtensionUi(ctx.cwd, {
				id: String(message.id ?? ""),
				...(Object.hasOwn(message, "value") ? { value: message.value } : {}),
				...(Object.hasOwn(message, "confirmed") ? { confirmed: message.confirmed === true } : {}),
				...(message.cancelled === true ? { cancelled: true } : {}),
			});

			ctx.reply({ type: "pi_extension_ui_responded", data: handled, requestId: message.requestId });
			return true;
		}

		default:
			return false;
	}
}
