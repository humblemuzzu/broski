/**
 * Paged reads of a Pi session transcript.
 *
 * A page is the newest messages of the session's whole history that end at a boundary entry, and
 * `before` names the entry a page stops before, so pages concatenate to the whole transcript.
 *
 * The history is the leaf-to-root path, not the agent's compaction-cut context: a compaction is a
 * summary marker at its own position and the entries it summarised stay above it. When the tree
 * cannot be trusted — a non-string id, a looping parent chain — the file is paged in written order.
 *
 * `null` means the file itself could not be read.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { TranscriptPage } from "../../types/transcript-page";
import { type FittedPage, fitTranscriptPage } from "../../utils/transcript-page-fit";
import { cutAtTurnStart, TURN_EXTENSION_MAX, type TurnCut } from "../../utils/turn-aligned-page";
import { indexPiSessionFile, type PiSessionFileIndex, readPiEntryLines } from "./pi-session-index";
import { type ContextEditReplacement, entryMessages } from "./pi-session-page-entries";
import type { PiSessionTranscript } from "./pi-session-transcript";
import { piSessionPath } from "./pi-session-window";

/** Entries guessed per requested message before the window is widened. */
const ENTRY_GUESS_FACTOR = 2;
const ENTRY_GUESS_MARGIN = 4;
const MAX_WINDOW_ATTEMPTS = 24;

export type PiTranscriptPage = TranscriptPage<PiSessionTranscript[number]>;

type PiMessage = PiSessionTranscript[number];

type CutRules = {
	isUser: (message: PiMessage) => boolean;
	joinsPrevious: (message: PiMessage) => boolean;
};

type PreparedSession = {
	index: PiSessionFileIndex;
	/** Positions of `index.entries` in transcript order. */
	order: number[];
	edits: Map<string, ContextEditReplacement>;
};

type Window = {
	messages: PiSessionTranscript;
	/** The entry id that produced `messages[i]`: the cursor that puts a page boundary there. */
	owners: string[];
};

async function readEdits(
	sessionPath: string,
	index: PiSessionFileIndex,
	order: number[],
): Promise<Map<string, ContextEditReplacement>> {
	const refs = order
		.map((position) => index.entries[position])
		.filter((ref) => ref !== undefined && ref.type === "context_edit");
	if (refs.length === 0) return new Map();

	const edits = new Map<string, ContextEditReplacement>();
	for (const entry of await readPiEntryLines(sessionPath, refs)) {
		const edit = entry as { type?: string; targetId?: unknown; replacement?: unknown } | null;
		if (edit?.type !== "context_edit" || typeof edit.targetId !== "string") continue;
		edits.set(edit.targetId, (edit.replacement ?? null) as ContextEditReplacement);
	}
	return edits;
}

async function prepare(sessionPath: string): Promise<PreparedSession> {
	const index = await indexPiSessionFile(sessionPath);
	let path: number[] | null = null;
	if (!index.unreliable) {
		try {
			path = piSessionPath(index, sessionPath);
		} catch {
			path = null;
		}
	}
	const order = path ?? index.entries.map((_, position) => position);
	return { index, order, edits: await readEdits(sessionPath, index, order) };
}

async function loadWindow(
	sessionPath: string,
	prepared: PreparedSession,
	start: number,
	end: number,
): Promise<Window | null> {
	const positions = prepared.order.slice(start, end);
	const loaded = await readPiEntryLines(
		sessionPath,
		positions.map((position) => prepared.index.entries[position]),
	);
	if (loaded.some((entry) => entry === null)) return null;

	const messages: PiSessionTranscript = [];
	const owners: string[] = [];
	for (let i = 0; i < loaded.length; i++) {
		const entry = loaded[i] as SessionEntry;
		const id = prepared.index.entries[positions[i] as number]?.id ?? "";
		for (const message of await entryMessages(entry, prepared.edits.get(entry.id))) {
			messages.push(message);
			owners.push(id);
		}
	}
	return { messages, owners };
}

function boundaryOf(prepared: PreparedSession, before: string | undefined): number | null {
	if (before === undefined) return prepared.order.length;
	const position = prepared.index.byId.get(before);
	if (position === undefined) return null;
	const at = prepared.order.indexOf(position);
	return at < 0 ? null : at;
}

function widen(start: number, boundary: number, limit: number): number {
	return Math.max(0, start - Math.max(limit, boundary - start));
}

function cutRules(): CutRules {
	return {
		isUser: (message) => message.role === "user",
		joinsPrevious: (message) => message.role === "toolResult",
	};
}

function pageOf(window: Window, cut: TurnCut, start: number): PiTranscriptPage | null {
	const fitted: FittedPage<PiMessage> = fitTranscriptPage(window.messages.slice(cut.start), {
		canOpen: (message) => message.role !== "toolResult",
	});
	const offset = cut.start + fitted.dropped;
	if (start === 0 && offset === 0) return { messages: fitted.messages, hasMore: false };

	const nextCursor = window.owners[offset];
	if (nextCursor === undefined) return null;
	return { messages: fitted.messages, hasMore: true, nextCursor };
}

async function buildPage(
	sessionPath: string,
	prepared: PreparedSession,
	boundary: number,
	limit: number,
): Promise<PiTranscriptPage | null> {
	let start = Math.max(0, boundary - (limit * ENTRY_GUESS_FACTOR + ENTRY_GUESS_MARGIN));
	const rules = cutRules();

	for (let attempt = 0; attempt < MAX_WINDOW_ATTEMPTS; attempt++) {
		const window = await loadWindow(sessionPath, prepared, start, boundary);
		if (!window) return null;

		const candidate = Math.max(0, window.messages.length - limit);
		const cut = cutAtTurnStart(window.messages, candidate, rules);
		const tooShort = start > 0 && window.messages.length < limit;
		// The turn opened before the window did, so the page would begin mid-turn: read further back.
		const cutShort = start > 0 && !cut.atTurnStart && cut.start === 0 && candidate < TURN_EXTENSION_MAX;
		if (!tooShort && !cutShort) return pageOf(window, cut, start);

		start = widen(start, boundary, limit);
	}

	return null;
}

export async function readPiSessionTranscriptPage(
	sessionPath: string,
	options: { limit: number; before?: string },
): Promise<PiTranscriptPage | null> {
	const limit = Math.max(1, Math.floor(options.limit));
	let prepared: PreparedSession;
	try {
		prepared = await prepare(sessionPath);
	} catch {
		return null;
	}
	if (prepared.order.length === 0) return { messages: [], hasMore: false };

	const boundary = boundaryOf(prepared, options.before);
	if (boundary !== null) return buildPage(sessionPath, prepared, boundary, limit);

	const newest = await buildPage(sessionPath, prepared, prepared.order.length, limit);
	return newest === null ? null : { ...newest, cursorUnknown: true };
}
