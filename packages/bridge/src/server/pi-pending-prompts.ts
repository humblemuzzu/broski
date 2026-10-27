import { listInstances } from "../connectors/pi";
import type { PiStreamMessage } from "../types/pi";

export type PiPendingPrompt = { sessionId: string; cwd: string; messages: PiStreamMessage[] };

/**
 * The Pi extension-UI dialogs still waiting for an answer, one entry per live session.
 *
 * Pi keeps them inside the agent session, so nothing else in the bridge knows what the phone was
 * asked. They are read at snapshot time rather than recorded, because the session owns their life.
 */
export function piPendingPrompts(): PiPendingPrompt[] {
	const found: PiPendingPrompt[] = [];
	for (const instance of listInstances()) {
		const sessionId = instance.session.sessionId?.trim() ?? "";
		if (!sessionId) continue;
		const messages = instance.extensionUiBridge.getPendingRequests();
		if (messages.length === 0) continue;
		found.push({ sessionId, cwd: instance.cwd, messages });
	}
	return found;
}
