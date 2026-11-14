/** Questions about the chain's entries: its newest uuid, and where a transcript item sits in the chain. */

import type { Rejected, SessionId, TranscriptItemId } from "../../../contract";
import { parseBlockId } from "../ids";
import { isRejected } from "../rejections";
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

/**
 * How many entries of the chain belong to finished runs: all of them without a cut; with one, up to and including
 * the entry `cutAt` names; none for a null cut, and none when the chain has lost that entry (a compaction removed it).
 */
export function finishedEnd(index: IndexEntry, cutAt: string | null | undefined): number {
	if (cutAt === undefined) return index.count;
	return cutAt === null ? 0 : (index.positions.get(cutAt) ?? -1) + 1;
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
