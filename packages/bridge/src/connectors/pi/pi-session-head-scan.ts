/**
 * Reads the fields a Pi `SessionInfo` needs off the head of one JSONL entry line.
 *
 * The head is the first few kilobytes of the line, so a multi-megabyte tool result is never decoded.
 * Every field reports whether it was resolved inside the head: a caller that sees `false` reads that
 * one line in full instead of trusting a value that may have been cut in half.
 */

import {
	CLOSE_OBJECT,
	COLON,
	COMMA,
	OPEN_OBJECT,
	QUOTE,
	readStringAt,
	readStringField,
	skipSpace,
	skipValue,
} from "./pi-session-json-scan";
import { type MessageKind, type SessionMessageHead, scanMessageValue } from "./pi-session-message-head";

export type SessionEntryHead = {
	/** The entry object's closing brace is inside the head. */
	closed: boolean;
	/** Index just past the entry object, when `closed`. */
	end: number;
	type: string | null;
	typeResolved: boolean;
	/** The entry's top-level `timestamp`. */
	timestamp: string | null;
	timestampResolved: boolean;
	/** A `session_info` name, exactly as written (the caller trims it). */
	name: string | null;
	nameResolved: boolean;
	messageKind: MessageKind;
	messageKindResolved: boolean;
	/** Set only when `messageKind` is `object`. */
	message: SessionMessageHead | null;
};

function emptyEntryHead(): SessionEntryHead {
	return {
		closed: false,
		end: 0,
		type: null,
		typeResolved: false,
		timestamp: null,
		timestampResolved: false,
		name: null,
		nameResolved: false,
		messageKind: "unknown",
		messageKindResolved: false,
		message: null,
	};
}

/**
 * `headCompletesLine` says the head is the entire line, which is what makes a value ending exactly at
 * the head boundary trustworthy — a longer line's head may end in half a multi-byte character.
 */
export function scanSessionEntryHead(head: string, headCompletesLine = false): SessionEntryHead {
	const fields = emptyEntryHead();
	let index = skipSpace(head, 0);
	if (index >= head.length || head.charCodeAt(index) !== OPEN_OBJECT) return fields;
	index++;

	while (index < head.length) {
		index = skipSpace(head, index);
		if (head.charCodeAt(index) === COMMA) index = skipSpace(head, index + 1);
		if (index >= head.length) break;
		if (head.charCodeAt(index) === CLOSE_OBJECT) {
			fields.closed = true;
			fields.end = index + 1;
			break;
		}
		if (head.charCodeAt(index) !== QUOTE) break;

		const key = readStringAt(head, index);
		if (!key) break;
		index = skipSpace(head, key.end);
		if (head.charCodeAt(index) !== COLON) break;
		index = skipSpace(head, index + 1);

		const next = readEntryField(head, index, key.value, headCompletesLine, fields);
		if (next === -1) break;
		index = next;
	}

	if (fields.closed) {
		fields.typeResolved = true;
		fields.timestampResolved = true;
		fields.nameResolved = true;
		if (fields.messageKind === "unknown") fields.messageKind = "missing";
		fields.messageKindResolved = true;
	}
	return fields;
}

function readEntryField(
	head: string,
	at: number,
	key: string,
	headCompletesLine: boolean,
	fields: SessionEntryHead,
): number {
	if (key === "type") {
		const read = readStringField(head, at, headCompletesLine);
		fields.typeResolved = read.resolved;
		fields.type = read.value;
		return read.end;
	}
	if (key === "timestamp") {
		const read = readStringField(head, at, headCompletesLine);
		fields.timestampResolved = read.resolved;
		fields.timestamp = read.value;
		return read.end;
	}
	if (key === "name") {
		const read = readStringField(head, at, headCompletesLine);
		fields.nameResolved = read.resolved;
		fields.name = read.value;
		return read.end;
	}
	if (key === "message") {
		const read = scanMessageValue(head, at, headCompletesLine);
		fields.messageKind = read.kind;
		fields.messageKindResolved = read.kindResolved;
		fields.message = read.message;
		return read.end;
	}
	return skipValue(head, at);
}
