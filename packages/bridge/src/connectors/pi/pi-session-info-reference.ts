/**
 * A `SessionInfo` built by parsing every line of a Pi session file, mirroring the SDK's own
 * `buildSessionInfo` exactly.
 *
 * This is the oracle the head-scanning builder is checked against: same accumulator, same line loop,
 * full `JSON.parse` per line. It is kept in `src/` because it is also the fallback for a file whose
 * line is too odd for the head scanner to trust.
 */

import { stat } from "node:fs/promises";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { readJsonlLines } from "../../utils/jsonl-lines";
import {
	applyEntryExact,
	asRecord,
	createSessionInfoAccumulator,
	finalizeSessionInfo,
	type RawRecord,
	readSessionHeader,
} from "./pi-session-info-accumulator";

export async function buildPiSessionInfoReference(path: string): Promise<SessionInfo | null> {
	const acc = createSessionInfoAccumulator();
	let header: RawRecord | null = null;

	try {
		for await (const line of readJsonlLines(path)) {
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
	}

	if (!header) return null;
	const fileInfo = await stat(path).catch(() => null);
	if (!fileInfo) return null;
	return finalizeSessionInfo(acc, header, fileInfo.mtime, path);
}
