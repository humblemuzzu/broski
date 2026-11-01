/** Lane A · questions about the chain's entries: its newest uuid, and the entry a transcript item came from. */

import type { Rejected, SessionId, TranscriptItemId } from "../../../contract";
import { parseBlockId } from "../ids";
import type { EntryRef } from "../ports/store";
import { isRejected, rejected } from "../rejections";
import { openChain } from "./chain-reader";
import { sourceOf } from "./chain-sources";
import type { StoreContext } from "./context";
import type { IndexEntry } from "./transcript-index";

/** Null for a session with no entries, and for one with no transcript file yet (a session minted before its CLI ran). */
export async function lastChainUuid(ctx: StoreContext, sessionId: SessionId): Promise<string | null | Rejected> {
	const opened = await sourceOf(ctx, sessionId);
	if (isRejected(opened)) return opened.rejection.code === "not_found" ? null : opened;
	const snapshot = await openChain(ctx, opened.source);
	if (isRejected(snapshot)) return snapshot.rejection.code === "not_found" ? null : snapshot;
	return snapshot.index.uuids[snapshot.index.count - 1] ?? null;
}

export async function entryOf(
	ctx: StoreContext,
	sessionId: SessionId,
	itemId: TranscriptItemId,
): Promise<EntryRef | Rejected> {
	const opened = await sourceOf(ctx, sessionId);
	if (isRejected(opened)) return opened;
	const snapshot = await openChain(ctx, opened.source);
	if (isRejected(snapshot)) return snapshot;
	const position = positionOfItem(snapshot.index, itemId);
	const uuid = position === undefined ? undefined : snapshot.index.uuids[position];
	const type = position === undefined ? undefined : snapshot.index.types[position];
	if (uuid === undefined || type === undefined) return rejected("not_found", `no transcript item ${itemId}`);
	return { uuid, type };
}

/** The chain position of the entry that holds `itemId`: a user entry, a block, a tool call or its result. */
export function positionOfItem(index: IndexEntry, itemId: TranscriptItemId): number | undefined {
	const direct = index.positions.get(itemId);
	if (direct !== undefined) return direct;
	if (itemId.endsWith(":result")) return index.toolResults.get(itemId.slice(0, -":result".length));
	const call = index.toolCalls.get(itemId);
	if (call !== undefined) return call;
	return positionOfBlock(index, itemId);
}

function positionOfBlock(index: IndexEntry, itemId: TranscriptItemId): number | undefined {
	const part = parseBlockId(itemId);
	if (part === undefined) return undefined;
	for (let position = 0; position < index.count; position++) {
		const base = index.blockBase[position] ?? 0;
		const count = index.blockCounts[position] ?? 0;
		const messageId = index.messageIds[position] ?? index.uuids[position];
		if (messageId === part.messageId && part.index >= base && part.index < base + count) return position;
	}
	return undefined;
}
