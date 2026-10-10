/**
 * Handler for `pi_read_session_messages`: the Pi chat-open path.
 *
 * The transcript itself is built by `readPiSessionTranscript`; this file only resolves the session
 * file and shapes the reply. With a `limit` or `before` the bounded page reader answers instead,
 * and falls back to the whole transcript when it cannot page.
 */

import { readPiSessionTranscriptPage } from "../connectors/pi/pi-session-page";
import { resolveSessionFilePath } from "../connectors/pi/pi-session-queries";
import { readPiSessionTranscript } from "../connectors/pi/pi-session-transcript";
import type { ServerMessage } from "../types";
import {
	DEFAULT_TRANSCRIPT_PAGE_LIMIT,
	transcriptCursor,
	transcriptPageFields,
	transcriptPageLimit,
} from "../types/transcript-page";

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
	const pageLimit = transcriptPageLimit(message.limit);
	const before = transcriptCursor(message.before);

	const resolvedPath = nonEmpty(message.sessionPath) ?? (sessionId ? await resolveSessionFilePath(sessionId) : null);

	if (!resolvedPath) {
		reply({ type: "pi_session_messages", data: [], requestId });
		return true;
	}

	try {
		if (pageLimit !== undefined || before !== undefined) {
			const page = await readPiSessionTranscriptPage(resolvedPath, {
				limit: pageLimit ?? DEFAULT_TRANSCRIPT_PAGE_LIMIT,
				before,
			});
			if (page) {
				reply({
					type: "pi_session_messages",
					data: page.messages,
					requestId,
					...transcriptPageFields(page),
				});
				return true;
			}
		}

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
