/**
 * A `SessionInfo` for one Pi session file from line heads instead of a full parse: the SDK's builder
 * `JSON.parse`s every line, and one tool result can be tens of megabytes. A line whose head leaves a
 * field the result depends on unknown is read in full exactly once, so the output is the SDK's own.
 *
 * `message.timestamp` is such a field on purpose. Pi writes it after the content, and reading it from
 * the tail of the line is not sound — a `diagnostics` object that follows it carries `timestamp` keys
 * of its own — so a long user or assistant message is parsed in full instead.
 */

import { type FileHandle, open, stat } from "node:fs/promises";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { type JsonlLineSpan, readJsonlLineSpans } from "../../utils/jsonl-line-spans";
import { type SessionEntryHead, scanSessionEntryHead } from "./pi-session-head-scan";
import {
	applyEntryExact,
	applyMessageHead,
	applySessionName,
	asRecord,
	createSessionInfoAccumulator,
	decideMessageHead,
	finalizeSessionInfo,
	type RawRecord,
	readSessionHeader,
	type SessionInfoAccumulator,
} from "./pi-session-info-accumulator";

export const DEFAULT_SESSION_HEAD_BYTES = 4096;

/** Above this, a last line with no newline is judged by the head rather than read whole. */
export const PARTIAL_LINE_READ_MAX_BYTES = 4 * 1024 * 1024;

export type PiSessionInfoBuild = {
	info: SessionInfo | null;
	lines: number;
	/** Lines the head could not decide, so they were read and parsed in full. */
	fullLineReads: number;
};

export type FastBuildOptions = {
	headBytes?: number;
	/** The file's `stat`, when the caller already has it. */
	size?: number;
	mtime?: Date;
};

type HeadOutcome = "applied" | "skipped" | "fatal" | "line";

export async function buildPiSessionInfoFast(
	path: string,
	options: FastBuildOptions = {},
): Promise<PiSessionInfoBuild> {
	const headBytes = options.headBytes ?? DEFAULT_SESSION_HEAD_BYTES;
	let size = options.size;
	let mtime = options.mtime;
	if (size === undefined || mtime === undefined) {
		const fileInfo = await stat(path).catch(() => null);
		if (!fileInfo) return { info: null, lines: 0, fullLineReads: 0 };
		size = fileInfo.size;
		mtime = fileInfo.mtime;
	}

	const acc = createSessionInfoAccumulator();
	const counter = { lines: 0, fullLineReads: 0 };
	let header: RawRecord | null = null;
	const io: { handle: FileHandle | null } = { handle: null };

	const readLine = async (span: JsonlLineSpan): Promise<string | null> => {
		if (span.length < headBytes) return span.head;
		if (!io.handle) io.handle = await open(path, "r").catch(() => null);
		if (!io.handle) return null;
		const buffer = Buffer.allocUnsafe(span.length);
		const { bytesRead } = await io.handle.read(buffer, 0, span.length, span.offset);
		return buffer.subarray(0, bytesRead).toString("utf8");
	};

	try {
		for await (const span of readJsonlLineSpans(path, { headBytes })) {
			counter.lines++;
			if (span.length <= 0) continue;
			// The head holds the whole line only while the line is shorter than the cap: comparing the
			// line's byte length against the head's character length misjudges every non-ASCII line.
			const completesLine = span.length < headBytes;
			const tornTail = span.offset + span.length === size && !completesLine;

			if (!header) {
				counter.fullLineReads++;
				const parsed = parseLine(await readLine(span));
				if (parsed === undefined || !parsed) continue;
				header = readSessionHeader(parsed);
				if (!header) return { info: null, ...counter };
				continue;
			}

			const scan = scanSessionEntryHead(span.head, completesLine);
			const outcome = headOutcome(acc, scan, span, completesLine, tornTail);
			if (outcome === "fatal") return { info: null, ...counter };
			if (outcome !== "line") continue;

			counter.fullLineReads++;
			const parsed = parseLine(await readLine(span));
			if (parsed === undefined || !parsed) continue;
			if (!applyEntryExact(acc, asRecord(parsed))) return { info: null, ...counter };
		}
	} catch {
		return { info: null, ...counter };
	} finally {
		const opened = io.handle;
		if (opened) await opened.close().catch(() => {});
	}

	if (!header) return { info: null, ...counter };
	return { info: finalizeSessionInfo(acc, header, mtime, path), ...counter };
}

function headOutcome(
	acc: SessionInfoAccumulator,
	scan: SessionEntryHead,
	span: JsonlLineSpan,
	completesLine: boolean,
	tornTail: boolean,
): HeadOutcome {
	if (scan.closed) {
		if (span.head.slice(scan.end).trim() !== "") return "skipped";
		if (!completesLine) return "line";
	}
	if (tornTail && !scan.closed && span.length <= PARTIAL_LINE_READ_MAX_BYTES) return "line";
	if (!scan.typeResolved) return "line";
	if (scan.type === "session_info") {
		if (!scan.nameResolved) return "line";
		applySessionName(acc, scan.name);
		return "applied";
	}
	if (scan.type !== "message") return "applied";

	const decision = decideMessageHead(scan, !acc.firstMessage);
	if (decision.kind === "fatal") return "fatal";
	if (decision.kind === "recompute") return "line";
	applyMessageHead(acc, decision);
	return "applied";
}

/** Undefined for a line the SDK's `parseSessionEntryLine` would have skipped. */
function parseLine(text: string | null): unknown {
	if (text === null || !text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
