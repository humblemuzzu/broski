/**
 * Fast Pi session transcript reader.
 *
 * Reads the messages a session would replay, directly from its JSONL file, without creating an
 * `AgentSession` (which costs seconds of model resolution and extension loading).
 *
 * The tree, the compaction cut and the branch navigation are the SDK's own (leaf-to-root path over
 * a partial entry set), but only the entries that contribute to the requested messages are loaded.
 * Branch parts of the file that the leaf path does not use are never read.
 */

import { readFile } from "node:fs/promises";
import type { FileEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { loadPiCodingAgent } from "../../sdk/pi-coding-agent";
import { mapAgentMessages } from "./pi-events";
import { indexPiSessionFile, readPiEntryAt } from "./pi-session-index";
import { PiSessionCycleError, piSessionPath, planPiSessionWindow, readPiSessionWindow } from "./pi-session-window";

export type PiSessionTranscript = ReturnType<typeof mapAgentMessages>;

/** Entries guessed per requested message before the window is widened. */
const ENTRY_GUESS_FACTOR = 2;
const ENTRY_GUESS_MARGIN = 4;
const MAX_WINDOW_ATTEMPTS = 24;

function sliceTail(messages: PiSessionTranscript, limit?: number): PiSessionTranscript {
	if (limit && limit > 0 && messages.length > limit) return messages.slice(-limit);
	return messages;
}

async function projectWindow(entries: SessionEntry[], leafId: string): Promise<PiSessionTranscript> {
	const { buildSessionContext } = await loadPiCodingAgent();
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) byId.set(entry.id, entry);
	return mapAgentMessages(buildSessionContext(entries, leafId, byId).messages);
}

function nextStart(start: number, pathLength: number, limit: number): number {
	const widened = Math.max(0, start - Math.max(limit, pathLength - start));
	return widened < start ? widened : 0;
}

async function readWindowedSessionMessages(
	sessionPath: string,
	limit: number | undefined,
): Promise<PiSessionTranscript | null> {
	const index = await indexPiSessionFile(sessionPath);
	if (index.headerVersion < 3 || index.unreliable) return null;

	const path = piSessionPath(index, sessionPath);
	if (!path) return index.entries.length === 0 ? [] : null;

	const cache = new Map<number, SessionEntry | null>();
	const load = async (position: number): Promise<SessionEntry | null> => {
		const cached = cache.get(position);
		if (cached !== undefined) return cached;
		const ref = index.entries[position];
		const entry = ref ? await readPiEntryAt(sessionPath, ref) : null;
		cache.set(position, entry);
		return entry;
	};

	const wantsTail = limit !== undefined && limit > 0;
	let start = wantsTail ? Math.max(0, path.length - (limit * ENTRY_GUESS_FACTOR + ENTRY_GUESS_MARGIN)) : 0;

	for (let attempt = 0; attempt < MAX_WINDOW_ATTEMPTS; attempt++) {
		const plan = await planPiSessionWindow(index, path, start, load);
		if (!plan) return null;
		const window = await readPiSessionWindow(sessionPath, index, plan, path);
		if (!window) return null;

		const messages = await projectWindow(window.entries, window.leafId);
		if (!wantsTail || messages.length >= limit || plan.start === 0) return sliceTail(messages, limit);
		start = nextStart(plan.start, path.length, limit);
	}

	return null;
}

export async function readFullSessionMessages(sessionPath: string, limit?: number): Promise<PiSessionTranscript> {
	const { buildSessionContext, migrateSessionEntries, parseSessionEntries } = await loadPiCodingAgent();
	const content = await readFile(sessionPath, "utf-8");
	const fileEntries = parseSessionEntries(content);

	const entries: SessionEntry[] = [];
	for (const entry of fileEntries) {
		if ((entry as FileEntry).type !== "session") {
			entries.push(entry as SessionEntry);
		}
	}

	migrateSessionEntries(fileEntries);

	return sliceTail(mapAgentMessages(buildSessionContext(entries).messages), limit);
}

export async function readPiSessionTranscript(sessionPath: string, limit?: number): Promise<PiSessionTranscript> {
	try {
		const bounded = await readWindowedSessionMessages(sessionPath, limit);
		if (bounded) return bounded;
	} catch (error) {
		// A looping parent chain exhausts memory in the full read too, so report it instead.
		if (error instanceof PiSessionCycleError) throw error;
	}
	return readFullSessionMessages(sessionPath, limit);
}
