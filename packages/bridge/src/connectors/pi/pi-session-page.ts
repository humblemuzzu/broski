/**
 * Paged reads of a Pi session transcript.
 *
 * A page is the newest messages of the context that end at a boundary entry: the context is the
 * SDK's leaf-to-root path cut by a compaction, and `before` names the entry a page stops before.
 * Pages therefore concatenate to the whole-file read, and a cursor names an entry rather than a
 * distance from the tail, so it stays valid when the session grows at the end.
 *
 * `null` means the read could not be paged — an unindexable file, an unknown cursor, a shape the
 * bounded window cannot reproduce — and the caller falls back to the whole-file read.
 */

import type { CompactionEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { loadPiCodingAgent } from "../../sdk/pi-coding-agent";
import type { TranscriptPage } from "../../types/transcript-page";
import { mapAgentMessages } from "./pi-events";
import {
	indexPiSessionFile,
	type PiSessionEntryRef,
	type PiSessionFileIndex,
	readPiEntryAt,
	readPiEntryLines,
} from "./pi-session-index";
import type { PiSessionTranscript } from "./pi-session-transcript";
import { newestCompactionPosition, piSessionPath } from "./pi-session-window";

/** Entries guessed per requested message before the window is widened. */
const ENTRY_GUESS_FACTOR = 2;
const ENTRY_GUESS_MARGIN = 4;
const MAX_WINDOW_ATTEMPTS = 24;

export type PiTranscriptPage = TranscriptPage<PiSessionTranscript[number]>;

type CompactionInfo = {
	entry: CompactionEntry;
	messages: PiSessionTranscript;
	/** Position of the compaction on the leaf path. */
	position: number;
	/** Path position the context starts at, i.e. `firstKeptEntryId` when it is on the path. */
	keptStart: number;
};

type PreparedSession = {
	index: PiSessionFileIndex;
	path: number[] | null;
	compaction: CompactionInfo | null;
};

async function entryMessages(entry: SessionEntry, primaryCompactionId: string | null): Promise<PiSessionTranscript> {
	if (entry.type === "compaction" && entry.id !== primaryCompactionId) return [];
	const { sessionEntryToContextMessages } = await loadPiCodingAgent();
	return mapAgentMessages(sessionEntryToContextMessages(entry));
}

async function prepare(sessionPath: string): Promise<PreparedSession | null> {
	const index = await indexPiSessionFile(sessionPath);
	if (index.headerVersion < 3 || index.unreliable) return null;

	const path = piSessionPath(index, sessionPath);
	if (!path) return { index, path: null, compaction: null };

	// An edit rewrites an earlier entry from a line that can sit on either side of a page boundary,
	// and the whole-file read applies it from anywhere, so a windowed page cannot reproduce it.
	if (path.some((position) => index.entries[position]?.type === "context_edit")) return null;

	const position = newestCompactionPosition(index, path);
	if (position < 0) return { index, path, compaction: null };

	const compactionPathPosition = path[position];
	const ref = compactionPathPosition === undefined ? undefined : index.entries[compactionPathPosition];
	const entry = ref ? ((await readPiEntryAt(sessionPath, ref)) as CompactionEntry | null) : null;
	if (!entry) return null;
	const kept = typeof entry.firstKeptEntryId === "string" ? index.byId.get(entry.firstKeptEntryId) : undefined;
	const keptAt = kept === undefined ? -1 : path.indexOf(kept);
	if (keptAt < 0) return null;

	return {
		index,
		path,
		compaction: { entry, messages: await entryMessages(entry, entry.id), position, keptStart: keptAt },
	};
}

async function loadWindow(
	sessionPath: string,
	index: PiSessionFileIndex,
	path: number[],
	start: number,
	end: number,
): Promise<SessionEntry[] | null> {
	const positions = path.slice(start, end);
	const refs = positions.map((position) => index.entries[position]);
	const loaded = await readPiEntryLines(sessionPath, refs as PiSessionEntryRef[]);
	if (loaded.some((entry) => entry === null)) return null;

	const entries = loaded as SessionEntry[];
	for (let i = 1; i < entries.length; i++) {
		const expected = index.entries[positions[i - 1] as number]?.id;
		if (entries[i]?.parentId !== expected) return null;
	}
	return entries;
}

export async function readPiSessionTranscriptPage(
	sessionPath: string,
	options: { limit: number; before?: string },
): Promise<PiTranscriptPage | null> {
	const limit = Math.max(1, Math.floor(options.limit));
	const prepared = await prepare(sessionPath);
	if (!prepared) return null;

	const { index, path, compaction } = prepared;
	if (!path) return { messages: [], hasMore: false };

	const wall = compaction ? compaction.keptStart : 0;
	const summary = compaction ? compaction.messages : [];
	let boundary = path.length;
	if (options.before !== undefined) {
		const entryPosition = index.byId.get(options.before);
		const at = entryPosition === undefined ? -1 : path.indexOf(entryPosition);
		if (at < 0 || at < wall) return null;
		boundary = at;
	}

	let start = Math.max(wall, boundary - (limit * ENTRY_GUESS_FACTOR + ENTRY_GUESS_MARGIN));

	for (let attempt = 0; attempt < MAX_WINDOW_ATTEMPTS; attempt++) {
		const entries = await loadWindow(sessionPath, index, path, start, boundary);
		if (!entries) return null;

		const tail: PiSessionTranscript = [];
		const produced: number[] = [];
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i] as SessionEntry;
			// The compaction's summary is carried at the front of the context, never in path order.
			const inPathOrder = compaction === null || start + i !== compaction.position;
			const messages = inPathOrder ? await entryMessages(entry, compaction?.entry.id ?? null) : [];
			if (messages.length > 1) return null;
			produced.push(messages.length);
			tail.push(...messages);
		}

		const leading = start === wall ? summary : [];
		const total = leading.length + tail.length;
		if (start > wall && total < limit) {
			const next = Math.max(wall, start - Math.max(limit, boundary - start));
			if (next >= start) return null;
			start = next;
			continue;
		}

		const all = [...leading, ...tail];
		// A tool result joins the assistant message before it, so a page that opens with one would
		// lose it when the app prepends the page above messages it has not loaded yet.
		let offset = Math.max(0, total - limit);
		while (offset > 0 && all[offset]?.role === "toolResult") offset--;
		const messages = offset === 0 ? all : all.slice(offset);
		if (!(start > wall || total > limit)) return { messages, hasMore: false };

		if (offset < leading.length) {
			return compaction ? { messages, hasMore: true, nextCursor: compaction.entry.id } : { messages, hasMore: true };
		}

		let seen = leading.length;
		for (let i = 0; i < entries.length; i++) {
			const count = produced[i] as number;
			if (count === 0) continue;
			if (seen >= offset) {
				const id = index.entries[path[start + i] as number]?.id;
				return id ? { messages, hasMore: true, nextCursor: id } : null;
			}
			seen += count;
		}
		return null;
	}

	return null;
}
