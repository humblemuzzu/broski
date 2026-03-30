/**
 * OpenCode health check handler.
 *
 * Handles:
 *   - oc_health → oc_health_result (version + status)
 */
import type { ClientMessage, ServerMessage } from "../types";

type ReplyFn = (msg: ServerMessage) => void;

type OcHealthLike = {
	getHealth: () => Promise<{ healthy: boolean; version: string } | null>;
};

export async function handle(
	message: ClientMessage & { requestId?: string },
	reply: ReplyFn,
	requireOpenCode: () => OcHealthLike,
): Promise<boolean> {
	switch (message.type) {
		case "oc_health": {
			const oc = requireOpenCode();
			const data = await oc.getHealth();
			reply({ type: "oc_health_result", data, requestId: message.requestId });
			return true;
		}
		default:
			return false;
	}
}
