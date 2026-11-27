/**
 * Reads a session's chain through the SDK (`getSessionMessages`, `getSubagentMessages`): one full read builds
 * the index (D26), then a window of it is one `offset`/`limit` read, checked against the index so a file that changed
 * in between is read again instead of paged wrongly.
 */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { isRejected, rejected } from "../../../adapter-kit/rejections";
import type { Rejected, SessionId } from "../../../contract";
import type { StoreContext } from "./context";
import { attempt } from "./guard";
import { buildIndex } from "./index-build";
import { type FileStamp, stampOf } from "./locator";
import { scanRaw } from "./raw-scan";
import type { IndexEntry } from "./transcript-index";

export interface ChainSource {
	/** The session id, or the child ref: the index key. */
	readonly key: SessionId;
	/** The transcript file, whose `size` and `mtimeMs` say whether the index still holds. */
	readonly path: string;
	read(offset: number, limit: number | undefined): Promise<SessionMessage[]>;
}

export class ChainSnapshot {
	constructor(
		private readonly ctx: StoreContext,
		private readonly source: ChainSource,
		private current: IndexEntry,
		private fresh: SessionMessage[] | undefined,
	) {}

	get index(): IndexEntry {
		return this.current;
	}

	/** Entries `[from, from + length)` of the chain, oldest first, as the index describes them. */
	async window(from: number, length: number): Promise<SessionMessage[] | Rejected> {
		const wanted = Math.min(length, this.current.count - from);
		if (wanted <= 0) return [];
		if (this.fresh !== undefined) return this.fresh.slice(from, from + wanted);
		const read = await attempt(() => this.source.read(from, wanted));
		if (isRejected(read)) return read;
		if (matches(this.current, from, wanted, read)) return read;
		const rebuilt = await rebuild(this.ctx, this.source);
		if (isRejected(rebuilt)) return rebuilt;
		this.current = rebuilt.index;
		this.fresh = rebuilt.fresh;
		return this.fresh.slice(from, from + wanted);
	}
}

function matches(index: IndexEntry, from: number, wanted: number, read: readonly SessionMessage[]): boolean {
	return read.length === wanted && read.every((message, offset) => message.uuid === index.uuids[from + offset]);
}

export interface BuiltChain {
	readonly index: IndexEntry;
	readonly fresh: SessionMessage[];
}

function rebuild(ctx: StoreContext, source: ChainSource): Promise<BuiltChain | Rejected> {
	return ctx.reads.run(source.key, () => readWhole(ctx, source));
}

async function readWhole(ctx: StoreContext, source: ChainSource): Promise<BuiltChain | Rejected> {
	const stamp = await stampOf(source.path);
	if (stamp === undefined) return rejected("not_found", `no transcript for ${source.key}`);
	const fresh = await attempt(() => source.read(0, undefined));
	if (isRejected(fresh)) return fresh;
	const raw = await scanRaw(source.path, new Set(fresh.map((message) => message.uuid)));
	const index = buildIndex(fresh, stamp, raw);
	ctx.index.set(source.key, index);
	return { index, fresh };
}

export async function openChain(ctx: StoreContext, source: ChainSource): Promise<ChainSnapshot | Rejected> {
	const stamp: FileStamp | undefined = await stampOf(source.path);
	if (stamp === undefined) return rejected("not_found", `no transcript for ${source.key}`);
	const cached = ctx.index.get(source.key, stamp.size, stamp.mtimeMs);
	if (cached !== undefined) return new ChainSnapshot(ctx, source, cached, undefined);
	const built = await rebuild(ctx, source);
	return isRejected(built) ? built : new ChainSnapshot(ctx, source, built.index, built.fresh);
}
