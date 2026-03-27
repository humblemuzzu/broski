import * as pi from "../connectors/pi";
import type { ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

export async function handle(message: any, reply: Reply): Promise<boolean> {
	const cwd =
		typeof message?.projectPath === "string" && message.projectPath.trim()
			? message.projectPath.trim()
			: typeof message?.cwd === "string" && message.cwd.trim()
				? message.cwd.trim()
				: undefined;

	switch (message.type) {
		case "pi_send_custom_message": {
			const instance = await pi.getOrCreateInstance(cwd);
			const customType = String(message.customType ?? "");
			const content = message.content ?? "";
			const display = message.display !== false; // default true
			const details = message.details ?? undefined;
			const triggerTurn = message.triggerTurn === true;
			const deliverAs = ["steer", "followUp", "nextTurn"].includes(message.deliverAs)
				? (message.deliverAs as "steer" | "followUp" | "nextTurn")
				: undefined;

			if (!customType) {
				reply({
					type: "pi_custom_message_sent",
					data: { success: false, error: "No customType provided" },
					requestId: message.requestId,
				});
				return true;
			}

			try {
				await instance.session.sendCustomMessage({ customType, content, display, details }, { triggerTurn, deliverAs });
				reply({ type: "pi_custom_message_sent", data: { success: true }, requestId: message.requestId });
			} catch (error) {
				reply({
					type: "pi_custom_message_sent",
					data: { success: false, error: error instanceof Error ? error.message : String(error) },
					requestId: message.requestId,
				});
			}
			return true;
		}

		default:
			return false;
	}
}
