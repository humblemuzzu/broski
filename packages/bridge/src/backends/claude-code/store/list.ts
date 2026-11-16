/**
 * A page of sessions (D23, D24, D25): the files are found from `readdir`/`stat` the way `listSessions` finds them and
 * ordered by when their conversation last moved (`activity.ts`), the keyset `(updatedAt, sessionId)` picks where a
 * page starts, and only the rows of that page are read (`getSessionInfo`, one 128 KiB lite read each). The SDK's own
 * paging re-reads every row before its `offset`.
 */

import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { PageRequest, Rejected, SessionQuery, SessionSummary, SessionsListResult } from "../../../contract";
import { parseChildRef } from "../ids";
import type { LiveOverlay } from "../ports/store";
import { isRejected, rejected } from "../rejections";
import { childrenPage } from "./children";
import type { StoreContext } from "./context";
import { byNewest, type Candidate, enumerateSessions, isAfter } from "./enumerate";
import { rowOfInfo, sessionInfo } from "./info";
import { type ListPosition, listCursor, listPosition, listScope } from "./list-cursor";
import { projectDirNames } from "./locator";

const READ_BATCH = 32;

export async function listPage(
	ctx: StoreContext,
	query: SessionQuery,
	page: PageRequest,
	live: LiveOverlay,
): Promise<SessionsListResult> {
	const scope = listScope(query);
	const after = page.cursor === undefined ? undefined : listPosition(page.cursor, scope);
	if (page.cursor !== undefined && after === undefined) {
		return rejected("invalid_input", "this cursor was not minted by this listing");
	}
	const { parent } = query;
	if (parent !== undefined && parseChildRef(parent.sessionId) !== undefined)
		return { status: "accepted", page: { items: [] } };
	if (parent !== undefined) return childrenPage(ctx, parent.sessionId, { after, scope, limit: page.limit }, live);
	return sessionsPage(ctx, query, { after, scope, limit: page.limit }, live);
}

interface PageSpec {
	readonly after: ListPosition | undefined;
	readonly scope: string;
	readonly limit: number;
}

async function wantedCwds(cwd: string): Promise<Set<string>> {
	try {
		return new Set([cwd, await realpath(cwd)]);
	} catch {
		return new Set([cwd]);
	}
}

async function sessionsPage(
	ctx: StoreContext,
	query: SessionQuery,
	spec: PageSpec,
	live: LiveOverlay,
): Promise<SessionsListResult> {
	const root = ctx.deps.services.sdk.configRoot();
	const wanted = query.cwd === undefined ? undefined : await wantedCwds(query.cwd);
	const dirs = (await projectDirNames(root)).filter(
		(dir) => wanted === undefined || ctx.dirs.scopeOf(dir, wanted) !== "out",
	);
	const ahead = newestFirst(ctx, root, await enumerateSessions(root, dirs), spec.after, wanted);
	const items: SessionSummary[] = [];
	let last: Ranked | undefined;
	while (items.length < spec.limit) {
		const batch = await take(ahead, Math.min(spec.limit - items.length, READ_BATCH));
		if (batch.length === 0) break;
		last = batch.at(-1);
		const rows = await Promise.all(batch.map((candidate) => rowOf(ctx, candidate, wanted, live)));
		for (const row of rows) {
			if (row !== undefined && isRejected(row)) return row;
			if (row !== undefined) items.push(row);
		}
	}
	const more = (await take(ahead, 1)).length > 0;
	return {
		status: "accepted",
		page: {
			items,
			...(more && last !== undefined && { nextCursor: listCursor(spec.scope, last) }),
		},
	};
}

interface Ranked extends Candidate, ListPosition {
	readonly path: string;
}

/**
 * The candidates after `after`, newest `updatedAt` first. They come newest mtime first, and a row's `updatedAt` is
 * never later than its file's mtime, so a row is final once it is newer than the next file's mtime: only the files
 * down to there are read, most of them once (`activity.ts` caches by stamp).
 */
async function* newestFirst(
	ctx: StoreContext,
	root: string,
	candidates: readonly Candidate[],
	after: ListPosition | undefined,
	wanted: ReadonlySet<string> | undefined,
): AsyncGenerator<Ranked> {
	const ready: Ranked[] = [];
	for (const candidate of candidates) {
		for (let first = ready[0]; first !== undefined && first.at > candidate.mtime; first = ready[0]) {
			ready.shift();
			yield first;
		}
		if (wanted !== undefined && ctx.dirs.scopeOf(candidate.dir, wanted) === "out") continue;
		const path = join(root, "projects", candidate.dir, `${candidate.sessionId}.jsonl`);
		const at = await ctx.activity.updatedAt(path);
		if (at === undefined) continue;
		const ranked = { ...candidate, path, at: Math.min(at, candidate.mtime) };
		if (after === undefined || isAfter(ranked, after)) ready.splice(insertionPoint(ready, ranked), 0, ranked);
	}
	yield* ready;
}

function insertionPoint(sorted: readonly Ranked[], item: Ranked): number {
	let low = 0;
	let high = sorted.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const held = sorted[middle];
		if (held !== undefined && byNewest(held, item) <= 0) low = middle + 1;
		else high = middle;
	}
	return low;
}

async function take(ranked: AsyncGenerator<Ranked>, count: number): Promise<Ranked[]> {
	const taken: Ranked[] = [];
	while (taken.length < count) {
		const next = await ranked.next();
		if (next.done === true) break;
		taken.push(next.value);
	}
	return taken;
}

async function rowOf(
	ctx: StoreContext,
	candidate: Ranked,
	wanted: ReadonlySet<string> | undefined,
	live: LiveOverlay,
): Promise<SessionSummary | undefined | Rejected> {
	const info = await sessionInfo(ctx, candidate.sessionId);
	if (info === undefined) return undefined;
	if (isRejected(info)) return info;
	ctx.dirs.learn(candidate.dir, info.cwd);
	if (wanted !== undefined && (info.cwd === undefined || !wanted.has(info.cwd))) return undefined;
	return rowOfInfo(ctx, info, live.row(info.sessionId), candidate.path);
}
