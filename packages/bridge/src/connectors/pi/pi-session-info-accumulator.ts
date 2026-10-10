/**
 * The exact `SessionInfo` accumulation the Pi SDK performs, split from the reading so a fast head
 * scanner and a whole-file JSON parse can both feed it.
 *
 * `applyEntryExact` mirrors `buildSessionInfo` line for line, including the two ways it can throw —
 * a `message` entry with no message object, and a content value that is neither a string nor an array.
 * A throw there makes the SDK return `null` for the whole file, so both builders report it the same way.
 */

import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionEntryHead } from "./pi-session-head-scan";

export type RawRecord = Record<string, unknown>;

export type SessionInfoAccumulator = {
	messageCount: number;
	firstMessage: string;
	lastActivityTime: number | undefined;
	name: string | undefined;
};

export function createSessionInfoAccumulator(): SessionInfoAccumulator {
	return { messageCount: 0, firstMessage: "", lastActivityTime: undefined, name: undefined };
}

export function asRecord(value: unknown): RawRecord | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RawRecord) : null;
}

/** The SDK's `entry.name?.trim() || undefined`. */
export function applySessionName(acc: SessionInfoAccumulator, value: unknown): void {
	acc.name = typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function applyActivityTime(acc: SessionInfoAccumulator, time: number | undefined): void {
	if (typeof time !== "number") return;
	acc.lastActivityTime = Math.max(acc.lastActivityTime ?? 0, time);
}

/** `getMessageActivityTime`: the message's own numeric timestamp, else the entry's ISO timestamp. */
function activityTime(message: RawRecord, entryTimestamp: unknown): number | undefined {
	const own = message.timestamp;
	if (typeof own === "number") return own;
	return timestampAsTime(entryTimestamp);
}

function timestampAsTime(value: unknown): number | undefined {
	const parsed = new Date(value as string).getTime();
	return Number.isNaN(parsed) ? undefined : parsed;
}

/** Null where the SDK's `content.filter(...)` would throw, which nulls the whole file. */
function extractTextContent(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return null;

	const parts: string[] = [];
	for (const block of content) {
		const record = asRecord(block);
		if (!record || record.type !== "text") continue;
		const text = record.text;
		parts.push(text === null || text === undefined ? "" : typeof text === "string" ? text : String(text));
	}
	return parts.join(" ");
}

/** False when the SDK would have thrown, i.e. the whole file's SessionInfo is null. */
export function applyEntryExact(acc: SessionInfoAccumulator, entry: RawRecord | null): boolean {
	if (!entry) return true;
	if (entry.type === "session_info") applySessionName(acc, entry.name);
	if (entry.type !== "message") return true;

	acc.messageCount++;
	const message = entry.message;
	if (message === null || message === undefined) return false;
	if (typeof message !== "object") return true;

	const record = message as RawRecord;
	const role = record.role;
	if (typeof role !== "string" || !("content" in record)) return true;
	if (role === "user" || role === "assistant") applyActivityTime(acc, activityTime(record, entry.timestamp));

	const text = extractTextContent(record.content);
	if (text === null) return false;
	if (!text) return true;
	if (role === "user" && !acc.firstMessage) acc.firstMessage = text;
	return true;
}

export type MessageHeadDecision =
	| { kind: "applied"; activity: number | undefined; text: string | null; role: string }
	| { kind: "fatal" }
	| { kind: "recompute"; reason: "timestamp" | "other" };

function appliedHead(activity: number | undefined, text: string | null, role: string): MessageHeadDecision {
	return { kind: "applied", activity, text, role };
}

/**
 * Decides a `message` entry from its head alone. `recompute` means a field the file's result depends
 * on was still outside the head, so only that one line is read in full. `needsUserText` is the one
 * piece of accumulator state a decision depends on: the first user message's text.
 */
export function decideMessageHead(fields: SessionEntryHead, needsUserText: boolean): MessageHeadDecision {
	if (!fields.messageKindResolved) return { kind: "recompute", reason: "other" };
	if (fields.messageKind === "missing" || fields.messageKind === "null") return { kind: "fatal" };
	if (fields.messageKind !== "object" || !fields.message) return appliedHead(undefined, null, "");

	const message = fields.message;
	if (!message.roleResolved) return { kind: "recompute", reason: "other" };
	if (typeof message.role !== "string") return appliedHead(undefined, null, "");
	if (message.contentKind === "unknown") return { kind: "recompute", reason: "other" };
	if (message.contentKind === "other") return { kind: "fatal" };

	const role = message.role;
	let activity: number | undefined;
	if (role === "user" || role === "assistant") {
		if (!message.timestampResolved) return { kind: "recompute", reason: "timestamp" };
		if (typeof message.timestamp === "number") activity = message.timestamp;
		else if (fields.timestampResolved) activity = timestampAsTime(fields.timestamp);
		else return { kind: "recompute", reason: "other" };
	}

	if (message.contentKind === "absent") return appliedHead(activity, null, role);
	if (message.role === "user" && needsUserText && !message.textResolved) return { kind: "recompute", reason: "other" };
	return appliedHead(activity, message.text, role);
}

export function applyMessageHead(acc: SessionInfoAccumulator, decision: MessageHeadDecision): void {
	if (decision.kind !== "applied") return;
	acc.messageCount++;
	applyActivityTime(acc, decision.activity);
	if (decision.text && decision.role === "user" && !acc.firstMessage) acc.firstMessage = decision.text;
}

/** The first parseable entry of a file, or null when that entry is not a session header. */
export function readSessionHeader(entry: unknown): RawRecord | null {
	const record = asRecord(entry);
	return record && record.type === "session" ? record : null;
}

export function finalizeSessionInfo(
	acc: SessionInfoAccumulator,
	header: RawRecord,
	fileMtime: Date,
	path: string,
): SessionInfo {
	const headerTimestamp = header.timestamp;
	const headerTime = typeof headerTimestamp === "string" ? new Date(headerTimestamp).getTime() : Number.NaN;
	const lastActivity = acc.lastActivityTime;
	const modified =
		typeof lastActivity === "number" && lastActivity > 0
			? new Date(lastActivity)
			: !Number.isNaN(headerTime)
				? new Date(headerTime)
				: fileMtime;

	return {
		path,
		id: header.id as string,
		cwd: typeof header.cwd === "string" ? header.cwd : "",
		name: acc.name,
		parentSessionPath: header.parentSession as string | undefined,
		created: new Date(headerTimestamp as string),
		modified,
		messageCount: acc.messageCount,
		firstMessage: acc.firstMessage || "(no messages)",
		allMessagesText: "",
	};
}
