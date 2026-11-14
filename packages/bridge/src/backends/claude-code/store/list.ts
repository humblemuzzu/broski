/**
 * Lane A · a page of sessions (D15, D16, D17): the files are ordered from `readdir`/`stat` the way `listSessions` orders
 * them, the keyset `(lastModified, sessionId)` picks where a page starts, and only the rows of that page are read
 * (`getSessionInfo`, one 128 KiB lite read each). The SDK's own paging re-reads every row before its `offset`.
 */

import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { PageRequest, Rejected, SessionQuery, SessionSummary, SessionsListResult } from "../../../contract";
import { parseChildRef } from "../ids";
import type { LiveOverlay } from "../ports/store";
import { isRejected, rejected } from "../rejections";
import { childrenPage } from "./children";
import type { StoreContext } from "./context";
import { type Candidate, enumerateSessions, isAfter } from "./enumerate";
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
	const everything = await enumerateSessions(root, dirs);
	const { after } = spec;
	const ahead = after === undefined ? everything : everything.filter((candidate) => isAfter(candidate, after));
	const items: SessionSummary[] = [];
	let consumed = 0;
	while (items.length < spec.limit && consumed < ahead.length) {
		const batch = takeBatch(ctx, ahead, consumed, spec.limit - items.length, wanted);
		consumed = batch.next;
		const rows = await Promise.all(batch.candidates.map((candidate) => rowOf(ctx, candidate, wanted, live)));
		for (const row of rows) {
			if (row !== undefined && isRejected(row)) return row;
			if (row !== undefined) items.push(row);
		}
	}
	const last = ahead[consumed - 1];
	return {
		status: "accepted",
		page: {
			items,
			...(consumed < ahead.length &&
				last !== undefined && {
					nextCursor: listCursor(spec.scope, {
						mtime: last.mtime,
						sessionId: last.sessionId,
					}),
				}),
		},
	};
}

interface Batch {
	readonly candidates: Candidate[];
	readonly next: number;
}

function takeBatch(
	ctx: StoreContext,
	ahead: readonly Candidate[],
	from: number,
	need: number,
	wanted: ReadonlySet<string> | undefined,
): Batch {
	const candidates: Candidate[] = [];
	let next = from;
	while (next < ahead.length && candidates.length < Math.min(need, READ_BATCH)) {
		const candidate = ahead[next];
		next += 1;
		if (candidate === undefined) continue;
		if (wanted !== undefined && ctx.dirs.scopeOf(candidate.dir, wanted) === "out") continue;
		candidates.push(candidate);
	}
	return { candidates, next };
}

async function rowOf(
	ctx: StoreContext,
	candidate: Candidate,
	wanted: ReadonlySet<string> | undefined,
	live: LiveOverlay,
): Promise<SessionSummary | undefined | Rejected> {
	const info = await sessionInfo(ctx, candidate.sessionId);
	if (info === undefined) return undefined;
	if (isRejected(info)) return info;
	ctx.dirs.learn(candidate.dir, info.cwd);
	if (wanted !== undefined && (info.cwd === undefined || !wanted.has(info.cwd))) return undefined;
	const path = join(ctx.deps.services.sdk.configRoot(), "projects", candidate.dir, `${candidate.sessionId}.jsonl`);
	return rowOfInfo(ctx, info, live.row(info.sessionId), path);
}
