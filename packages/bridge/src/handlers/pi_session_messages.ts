/**
 * Fast Pi session message reader.
 *
 * Reads a Pi session JSONL file directly and returns mapped messages
 * WITHOUT creating a full AgentSession instance. This avoids the 2-4s
 * cost of buildInstance() (model resolution, extension loading, etc.)
 * and makes session opening feel instant.
 *
 * Uses the Pi SDK's parseSessionEntries + buildSessionContext to
 * properly handle tree traversal, compaction summaries, and branch
 * navigation — same logic the live session uses internally.
 */

import { readFile } from "node:fs/promises";
import {
	buildSessionContext,
	type FileEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { mapAgentMessages } from "../connectors/pi/pi-events";
import type { ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

/**
 * Resolve a session path from an ID by scanning the sessions directory.
 * This is independent of any live PiInstance.
 */
async function resolveSessionPath(sessionId: string): Promise<string | null> {
	try {
		const sessions = await SessionManager.listAll();
		for (const session of sessions) {
			if (session.id === sessionId && session.path) {
				return session.path;
			}
		}
	} catch {
		// ignore
	}
	return null;
}

/**
 * Read messages directly from a Pi session JSONL file.
 *
 * Returns the same mapped message format as pi_get_messages, but
 * without needing a live AgentSession instance. Supports an optional
 * limit to return only the last N messages (for pagination).
 */
async function readSessionMessages(sessionPath: string, limit?: number): Promise<ReturnType<typeof mapAgentMessages>> {
	const content = await readFile(sessionPath, "utf-8");
	const fileEntries = parseSessionEntries(content);

	// Separate header from session entries
	const entries: SessionEntry[] = [];
	for (const entry of fileEntries) {
		if ((entry as FileEntry).type !== "session") {
			entries.push(entry as SessionEntry);
		}
	}

	// Apply migrations (handles version upgrades in-place)
	migrateSessionEntries(fileEntries);

	// Build context using tree traversal — handles compaction, branching, etc.
	const context = buildSessionContext(entries);
	const messages = mapAgentMessages(context.messages);

	if (limit && limit > 0 && messages.length > limit) {
		return messages.slice(-limit);
	}

	return messages;
}

export async function handle(message: any, reply: Reply): Promise<boolean> {
	if (message.type !== "pi_read_session_messages") return false;

	const sessionPath =
		typeof message.sessionPath === "string" && message.sessionPath.trim() ? message.sessionPath.trim() : null;

	const sessionId = typeof message.sessionId === "string" && message.sessionId.trim() ? message.sessionId.trim() : null;

	const limit = typeof message.limit === "number" ? message.limit : undefined;

	// Resolve the file path — either from the explicit path or by looking up the session ID
	let resolvedPath = sessionPath;
	if (!resolvedPath && sessionId) {
		resolvedPath = await resolveSessionPath(sessionId);
	}

	if (!resolvedPath) {
		reply({
			type: "pi_session_messages",
			data: [],
			requestId: message.requestId,
		});
		return true;
	}

	try {
		const messages = await readSessionMessages(resolvedPath, limit);
		reply({
			type: "pi_session_messages",
			data: messages,
			requestId: message.requestId,
		});
	} catch (error) {
		// File might not exist or be corrupted — return empty
		console.warn(
			`[pi_read_session_messages] Failed to read ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
		reply({
			type: "pi_session_messages",
			data: [],
			requestId: message.requestId,
		});
	}

	return true;
}
