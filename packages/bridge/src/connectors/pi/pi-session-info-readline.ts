/**
 * The SDK's own reader for one Pi session file: Node's readline over a byte stream, `JSON.parse` per
 * line, the shared accumulator.
 *
 * It exists for files the head scanner must not touch. Readline breaks lines on `\r`, `\u2028` and
 * `\u2029` as well as `\n` and drops the separator, so a line carrying a raw line separator inside a
 * JSON string arrives as two unparseable halves and the entry is lost. Reusing readline is what keeps
 * the listing identical to the SDK's for those files.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import {
	applyEntryExact,
	asRecord,
	createSessionInfoAccumulator,
	finalizeSessionInfo,
	type RawRecord,
	readSessionHeader,
} from "./pi-session-info-accumulator";

export async function buildPiSessionInfoReadline(path: string): Promise<SessionInfo | null> {
	const acc = createSessionInfoAccumulator();
	let header: RawRecord | null = null;
	let stream: ReturnType<typeof createReadStream> | null = null;

	try {
		stream = createReadStream(path, { encoding: "utf8" });
		const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
		for await (const line of lines) {
			if (!line.trim()) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			if (!parsed) continue;

			if (!header) {
				header = readSessionHeader(parsed);
				if (!header) return null;
				continue;
			}
			if (!applyEntryExact(acc, asRecord(parsed))) return null;
		}
	} catch {
		return null;
	} finally {
		stream?.destroy();
	}

	if (!header) return null;
	const fileInfo = await stat(path).catch(() => null);
	if (!fileInfo) return null;
	return finalizeSessionInfo(acc, header, fileInfo.mtime, path);
}
