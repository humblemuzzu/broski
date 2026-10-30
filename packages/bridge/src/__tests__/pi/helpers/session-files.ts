/** Pi session files as a test reads them back, and as a terminal `pi` or an old version would have written them. */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FileEntry, parseSessionEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";

/** The file of a session under `root` (Pi names it `<timestamp>_<id>.jsonl`, in a directory of its own choosing). */
export function findSessionFile(root: string, sessionId: string): string | undefined {
	const name = readdirSync(root, { recursive: true, encoding: "utf8" }).find((entry) =>
		entry.endsWith(`_${sessionId}.jsonl`),
	);
	return name === undefined ? undefined : join(root, name);
}

export function readEntries(path: string): FileEntry[] {
	return parseSessionEntries(readFileSync(path, "utf8"));
}

export function sessionEntries(path: string): SessionEntry[] {
	return readEntries(path).filter((entry): entry is SessionEntry => entry.type !== "session");
}

interface MessageLike {
	readonly role: string;
	readonly content?: unknown;
}

function textOf(message: MessageLike): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content.flatMap((block) => (block?.type === "text" ? [String(block.text)] : [])).join("");
}

/** `[role, text]` of every message entry, in file order. */
export function messagesIn(path: string): [string, string][] {
	return sessionEntries(path).flatMap((entry): [string, string][] =>
		entry.type === "message" ? [[entry.message.role, textOf(entry.message)]] : [],
	);
}

/** The text of every user message, in file order. */
export function userTexts(path: string): string[] {
	return messagesIn(path).flatMap(([role, text]) => (role === "user" ? [text] : []));
}

export interface ExternalHeader {
	readonly id: string;
	readonly cwd: string;
	/** Absent in a version 1 file. */
	readonly version?: 2 | 3;
	readonly timestamp?: string;
}

export function messageEntry(
	id: string | undefined,
	parentId: string | null | undefined,
	role: "user" | "assistant",
	text: string,
	at = "2026-01-01T00:00:00.000Z",
): Record<string, unknown> {
	const content = [{ type: "text", text }];
	const message =
		role === "user"
			? { role, content, timestamp: Date.parse(at) }
			: {
					role,
					content,
					api: "faux",
					provider: "faux",
					model: "faux-reasoner",
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 2,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.parse(at),
				};
	return { type: "message", ...(id !== undefined && { id, parentId: parentId ?? null }), timestamp: at, message };
}

/** Writes `<dir>/<timestamp>_<id>.jsonl`, one JSON line per entry, the way Pi writes it (LF, a final newline). */
export function writeSessionFile(dir: string, header: ExternalHeader, entries: readonly object[]): string {
	const timestamp = header.timestamp ?? "2026-01-01T00:00:00.000Z";
	const lines = [
		{
			type: "session",
			...(header.version !== undefined && { version: header.version }),
			id: header.id,
			timestamp,
			cwd: header.cwd,
		},
		...entries,
	].map((line) => JSON.stringify(line));
	const path = join(dir, `${timestamp.replace(/[:.]/g, "-")}_${header.id}.jsonl`);
	writeFileSync(path, `${lines.join("\n")}\n`);
	return path;
}

/** A linear conversation of `turns`, as a terminal `pi` would leave it: user, assistant, user, … with a chain of parent ids. */
export function conversation(turns: readonly string[]): Record<string, unknown>[] {
	let parent: string | null = null;
	return turns.map((text, index) => {
		const id = `e${index + 1}`;
		const entry = messageEntry(id, parent, index % 2 === 0 ? "user" : "assistant", text);
		parent = id;
		return entry;
	});
}
