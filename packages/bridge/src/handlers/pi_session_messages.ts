/**
 * Handler for `pi_read_session_messages`: the Pi chat-open path.
 *
 * A paged request is always answered with a page, never widened to the whole transcript: a
 * transcript too large for one reply is exactly what the page is for.
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
			const page = (await readPiSessionTranscriptPage(resolvedPath, {
				limit: pageLimit ?? DEFAULT_TRANSCRIPT_PAGE_LIMIT,
				before,
			})) ?? { messages: [], hasMore: false };
			reply({
				type: "pi_session_messages",
				data: page.messages,
				requestId,
				...transcriptPageFields(page),
			});
			return true;
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
