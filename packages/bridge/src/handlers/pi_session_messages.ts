/**
 * Handler for `pi_read_session_messages`: the Pi chat-open path.
 *
 * The transcript itself is built by `readPiSessionTranscript`; this file only resolves the session
 * file and shapes the reply.
 */

import { resolveSessionFilePath } from "../connectors/pi/pi-session-queries";
import { readPiSessionTranscript } from "../connectors/pi/pi-session-transcript";
import type { ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

const nonEmpty = (value: unknown): string | null => {
	const text = typeof value === "string" ? value.trim() : "";
	return text ? text : null;
};

export async function handle(message: Record<string, unknown>, reply: Reply): Promise<boolean> {
	if (message.type !== "pi_read_session_messages") return false;

	const requestId = nonEmpty(message.requestId) ?? undefined;
	const sessionId = nonEmpty(message.sessionId);
	const limit = typeof message.limit === "number" ? message.limit : undefined;

	const resolvedPath = nonEmpty(message.sessionPath) ?? (sessionId ? await resolveSessionFilePath(sessionId) : null);

	if (!resolvedPath) {
		reply({ type: "pi_session_messages", data: [], requestId });
		return true;
	}

	try {
		const messages = await readPiSessionTranscript(resolvedPath, limit);
		reply({ type: "pi_session_messages", data: messages, requestId });
	} catch (error) {
		console.warn(
			`[pi_read_session_messages] Failed to read ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
		reply({ type: "pi_session_messages", data: [], requestId });
	}

	return true;
}
