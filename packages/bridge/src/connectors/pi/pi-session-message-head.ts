/**
 * The `message` value of a Pi session entry, read from the head of its line.
 *
 * Only `role`, `timestamp` and the text of `content` are of interest, and a text block keeps them at
 * the start of the message, so a tool result's megabytes of output are skipped rather than decoded.
 */

import {
	CLOSE_ARRAY,
	CLOSE_OBJECT,
	COLON,
	COMMA,
	OPEN_ARRAY,
	OPEN_OBJECT,
	QUOTE,
	readNumberField,
	readStringAt,
	readStringField,
	skipSpace,
	skipValue,
} from "./pi-session-json-scan";

export type ContentKind = "absent" | "string" | "array" | "other" | "unknown";

export type SessionMessageHead = {
	/** The message object's closing brace is inside the head, so a missing key is known to be absent. */
	closed: boolean;
	role: string | null;
	roleResolved: boolean;
	/** The message's own `timestamp`, when it is a JSON number. */
	timestamp: number | null;
	timestampResolved: boolean;
	contentKind: ContentKind;
	/** `extractTextContent` of the message, when the whole content value is inside the head. */
	text: string | null;
	textResolved: boolean;
};

export type MessageKind = "object" | "null" | "other" | "missing" | "unknown";

export type MessageValueScan = {
	/** Index just past the value, or -1 when it runs past the head. */
	end: number;
	kind: MessageKind;
	kindResolved: boolean;
	message: SessionMessageHead | null;
};

function emptyMessageHead(): SessionMessageHead {
	return {
		closed: false,
		role: null,
		roleResolved: false,
		timestamp: null,
		timestampResolved: false,
		contentKind: "unknown",
		text: null,
		textResolved: false,
	};
}

/** What the SDK's `join(" ")` produces for one element, including its `undefined` → `""` rule. */
function joinValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	return typeof value === "string" ? value : String(value);
}

export function scanMessageValue(head: string, at: number, headCompletesLine: boolean): MessageValueScan {
	if (at >= head.length) return { end: -1, kind: "unknown", kindResolved: false, message: null };
	const code = head.charCodeAt(at);
	if (code !== OPEN_OBJECT) {
		const end = skipValue(head, at);
		if (end === -1 || (!headCompletesLine && end >= head.length)) {
			return { end: -1, kind: "unknown", kindResolved: false, message: null };
		}
		const kind: MessageKind = head.slice(at, end) === "null" ? "null" : "other";
		return { end, kind, kindResolved: true, message: null };
	}
	return scanMessageObject(head, at, headCompletesLine);
}

function scanMessageObject(head: string, at: number, headCompletesLine: boolean): MessageValueScan {
	const message = emptyMessageHead();
	let index = at + 1;
	let ranPastHead = false;

	while (index < head.length) {
		index = skipSpace(head, index);
		if (head.charCodeAt(index) === COMMA) index = skipSpace(head, index + 1);
		if (index >= head.length) break;
		if (head.charCodeAt(index) === CLOSE_OBJECT) {
			message.closed = true;
			index++;
			break;
		}
		if (head.charCodeAt(index) !== QUOTE) return { end: -1, kind: "object", kindResolved: true, message };

		const key = readStringAt(head, index);
		if (!key) return { end: -1, kind: "object", kindResolved: true, message };
		index = skipSpace(head, key.end);
		if (head.charCodeAt(index) !== COLON) return { end: -1, kind: "object", kindResolved: true, message };
		index = skipSpace(head, index + 1);

		const next = readMessageField(head, index, key.value, headCompletesLine, message);
		if (next === -1) {
			ranPastHead = true;
			break;
		}
		index = next;
	}

	if (message.closed) {
		message.roleResolved = true;
		message.timestampResolved = true;
		if (message.contentKind === "unknown") message.contentKind = "absent";
	}
	return { end: ranPastHead ? -1 : index, kind: "object", kindResolved: true, message };
}

function readMessageField(
	head: string,
	at: number,
	key: string,
	headCompletesLine: boolean,
	message: SessionMessageHead,
): number {
	if (key === "role") {
		const read = readStringField(head, at, headCompletesLine);
		message.roleResolved = read.resolved;
		message.role = read.value;
		return read.end;
	}
	if (key === "timestamp") {
		const read = readNumberField(head, at, headCompletesLine);
		message.timestampResolved = read.resolved;
		message.timestamp = read.value;
		return read.end;
	}
	if (key === "content") {
		const read = readContentValue(head, at, headCompletesLine);
		message.contentKind = read.kind;
		message.text = read.text;
		message.textResolved = read.textResolved;
		return read.end;
	}
	return skipValue(head, at);
}

type ContentValueScan = {
	end: number;
	kind: ContentKind;
	text: string | null;
	textResolved: boolean;
};

/**
 * A string content is its own text; an array is the `join(" ")` of its `text` blocks, which is what
 * `extractTextContent` builds; anything else makes the SDK's read throw, which nulls the whole file.
 */
function readContentValue(head: string, at: number, headCompletesLine: boolean): ContentValueScan {
	const code = head.charCodeAt(at);
	if (code === QUOTE) {
		const read = readStringField(head, at, headCompletesLine);
		return { end: read.end, kind: "string", text: read.value, textResolved: read.resolved };
	}
	if (code !== OPEN_ARRAY) {
		const end = skipValue(head, at);
		const settled = end !== -1 && (headCompletesLine ? end <= head.length : end < head.length);
		return { end: settled ? end : -1, kind: "other", text: null, textResolved: false };
	}

	return readContentArray(head, at, headCompletesLine);
}

function readContentArray(head: string, at: number, headCompletesLine: boolean): ContentValueScan {
	const parts: string[] = [];
	let index = at + 1;

	while (index < head.length) {
		index = skipSpace(head, index);
		if (index >= head.length) break;
		if (head.charCodeAt(index) === CLOSE_ARRAY) {
			return { end: index + 1, kind: "array", text: parts.join(" "), textResolved: true };
		}
		if (head.charCodeAt(index) === COMMA) {
			index++;
			continue;
		}
		const element = readContentElement(head, index, headCompletesLine, parts);
		if (element === -1) break;
		index = element;
	}

	return { end: -1, kind: "array", text: null, textResolved: false };
}

/** `content.filter(block => block.type === "text").map(block => block.text)` for one element. */
function readContentElement(head: string, at: number, headCompletesLine: boolean, parts: string[]): number {
	if (head.charCodeAt(at) !== OPEN_OBJECT) return skipValue(head, at);

	let index = at + 1;
	let type: string | null = null;
	let typeResolved = false;
	let typeSeen = false;
	let text: unknown;
	let textResolved = false;
	let textSeen = false;
	let closed = false;

	while (index < head.length) {
		index = skipSpace(head, index);
		if (head.charCodeAt(index) === COMMA) index = skipSpace(head, index + 1);
		if (index >= head.length) break;
		if (head.charCodeAt(index) === CLOSE_OBJECT) {
			closed = true;
			index++;
			break;
		}
		if (head.charCodeAt(index) !== QUOTE) break;
		const key = readStringAt(head, index);
		if (!key) break;
		index = skipSpace(head, key.end);
		if (head.charCodeAt(index) !== COLON) break;
		index = skipSpace(head, index + 1);

		if (key.value === "type") {
			const read = readStringField(head, index, headCompletesLine);
			type = read.value;
			typeResolved = read.resolved;
			typeSeen = true;
			index = read.end;
		} else if (key.value === "text") {
			const read = readStringField(head, index, headCompletesLine);
			text = read.value;
			textResolved = read.resolved;
			textSeen = true;
			index = read.end;
		} else {
			index = skipValue(head, index);
		}
		if (index === -1) return -1;
	}

	if (!closed) return -1;
	if (!typeSeen) typeResolved = true;
	if (!typeResolved) return -1;
	if (type !== "text") return index;
	if (textSeen && !textResolved) return -1;
	parts.push(joinValue(text));
	return index;
}
